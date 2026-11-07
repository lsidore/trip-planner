"""Local trip server (scripts/server.py): static files of <trip>/site, state of the choices (one field at a time,
atomic write into <trip>/state.json), forbidden paths. Everything happens in a temporary copy of the sample trip, on a
free port of 127.0.0.1."""
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import server as S  # noqa: E402


class Base(unittest.TestCase):
    """One server per test, for a temporary copy of the sample trip (never the sample folder itself)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        for target, name in ((S.Handler, "log_request"), (S.Handler, "log_error")):
            p = mock.patch.object(target, name, lambda *a, **k: None)
            p.start()
            self.addCleanup(p.stop)
        self.dir = os.path.join(self.root, "trip")
        shutil.copytree(SAMPLE, self.dir, ignore=shutil.ignore_patterns("site", "state.json"))
        self.write("site/index.html", "<!doctype html><title>Our trip</title>")
        self.write("site/media/parcours.json", '{"ok": true}')
        self.write("site/media/photo.webp", "RIFF....WEBPfake", binary=True)
        self.write("site/media/photo.jpg", "\xff\xd8\xff", binary=True)
        with open(os.path.join(self.root, "CLAUDE.md"), "w") as f:
            f.write("SECRET-CLAUDE")
        self.srv = S.create_server(self.dir, 0)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def write(self, rel, text, binary=False):
        p = os.path.join(self.dir, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(text.encode("latin-1") if binary else text.encode("utf-8"))

    def path(self, rel):
        return os.path.join(self.dir, rel)

    def read_file(self, rel):
        with open(self.path(rel), encoding="utf-8") as f:
            return json.load(f)

    def request(self, method, path, body=None, headers=None, raw=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = dict(headers or {})
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h.setdefault("Content-Type", "application/json")
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        text = r.read()
        res = (r.status, dict((k.lower(), v) for k, v in r.getheaders()), text)
        c.close()
        return res

    def json(self, method, path, body=None, headers=None, raw=None):
        st, h, t = self.request(method, path, body, headers, raw)
        try:
            return st, json.loads(t.decode("utf-8")), h
        except ValueError:
            return st, t, h

    def put(self, path, value, **kw):
        return self.json("PUT", "/api/etat", dict({"chemin": path, "valeur": value}, **kw))


class TestServesSample(Base):
    def test_serves_sample_page(self):
        st, h, _ = self.request("GET", "/")
        self.assertEqual((st, h["location"]), (302, "/index.html"))
        st, h, t = self.request("GET", "/index.html")
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("text/html"))
        self.assertIn(b"Our trip", t)

    def test_state_written_in_trip_dir(self):
        self.assertFalse(os.path.exists(self.path("state.json")))
        self.assertEqual(self.put("choix.lisbon", "lisbon-01")[0], 200)
        self.assertEqual(self.read_file("state.json"), {"v": 1, "choix": {"lisbon": "lisbon-01"}})
        # nothing else was created next to it but the lock file
        self.assertFalse(os.path.exists(os.path.join(self.root, "state.json")))

    def test_refuses_path_outside_site(self):
        st, _, t = self.request("GET", "/../trip.json")
        self.assertEqual(st, 404)
        self.assertNotIn(b"sample-portugal", t)

    def test_server_uses_the_trip_state_file(self):
        trip = S.tripctx.load(self.dir)
        self.assertEqual(self.srv.paths.state, trip.state_file)
        self.assertEqual(self.srv.paths.site, trip.site)

    def test_binds_loopback_only(self):
        self.assertEqual(self.srv.server_address[0], "127.0.0.1")

    def test_no_tunnel_mode(self):
        self.assertFalse(hasattr(S, "SUFFIXES_PUBLICS"))
        with self.assertRaises(TypeError):
            S.create_server(self.dir, 0, public=True)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "server.py"), "--public"],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("/api/imports", open(os.path.join(ROOT, "scripts", "server.py"), encoding="utf-8").read())

    def test_missing_trip_exits_with_a_message(self):
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "server.py"), "--trip",
                            os.path.join(self.root, "nope"), "--port", "0"], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 1)
        self.assertIn("error:", r.stderr)


class TestState(Base):
    def test_get_creates_an_empty_state(self):
        st, body, _ = self.json("GET", "/api/etat")
        self.assertEqual((st, body), (200, {}))
        self.assertEqual(self.read_file("state.json"), {})

    def test_put_changes_a_single_field(self):
        self.assertEqual(self.put("choix.lisbon", "lisbon-01")[0], 200)
        self.assertEqual(oct(os.stat(self.path("state.json")).st_mode & 0o777), "0o644")
        self.assertEqual(self.put("choix.comporta", "comporta-02")[0], 200)
        self.assertEqual(self.put("favs.log:lisbon-01.us", True)[0], 200)
        self.assertEqual(self.put("resa.log-lisbon-lisbon-01", {"done": True, "by": "us"})[0], 200)
        self.assertEqual(self.put("mode", "detail")[0], 200)
        self.assertEqual(self.put("choix.lisbon", "lisbon-02")[0], 200)
        state = self.read_file("state.json")
        self.assertEqual(state, {
            "v": 1, "choix": {"lisbon": "lisbon-02", "comporta": "comporta-02"}, "favs": {"log:lisbon-01": {"us": True}},
            "resa": {"log-lisbon-lisbon-01": {"done": True, "by": "us"}}, "mode": "detail"})
        self.assertEqual(self.json("GET", "/api/etat")[1], state)

    def test_path_as_list_for_a_key_with_a_dot(self):
        self.assertEqual(self.put(["favs", "log:villa.view", "us"], True)[0], 200)
        self.assertEqual(self.read_file("state.json")["favs"], {"log:villa.view": {"us": True}})

    def test_merge_like_db_update(self):
        self.put("choix.sorties", {"a": {"jour": "2027-06-16"}}, fusion=True)
        self.put("choix.sorties", {"b": {"jour": None}}, fusion=True)
        self.put("choix.sorties", {"a": {"heure": "18:00"}}, fusion=True)
        self.assertEqual(self.read_file("state.json")["choix"]["sorties"],
                         {"a": {"jour": "2027-06-16", "heure": "18:00"}, "b": {"jour": None}})
        self.put("choix.sorties", {"a": False}, fusion=True)
        self.assertEqual(self.read_file("state.json")["choix"]["sorties"]["a"], False)
        self.put("choix.sorties", {"c": {"jour": None}})   # without merge the value replaces the object
        self.assertEqual(self.read_file("state.json")["choix"]["sorties"], {"c": {"jour": None}})

    def test_simultaneous_writes_none_lost(self):
        errors = []

        def write(i):
            try:
                st, _, _ = self.put(f"choix.f{i}", f"v{i}")
                if st != 200:
                    errors.append(st)
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))

        threads = [threading.Thread(target=write, args=(i,)) for i in range(24)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(errors, [])
        self.assertEqual(self.read_file("state.json")["choix"], {f"f{i}": f"v{i}" for i in range(24)})

    def test_failed_write_leaves_the_file_intact(self):
        self.put("choix.lisbon", "lisbon-01")
        before = self.read_file("state.json")
        with mock.patch.object(S.os, "replace", side_effect=OSError("disk full")):
            st, body, _ = self.put("choix.lisbon", "lisbon-02")
        self.assertEqual(st, 500)
        self.assertIn("write failed", body["erreur"])
        self.assertEqual(self.read_file("state.json"), before)
        self.assertEqual([f for f in os.listdir(self.dir) if f.startswith(".tmp-")], [])
        calls = []
        real = S.tempfile.mkstemp
        with mock.patch.object(S.tempfile, "mkstemp", side_effect=lambda **kw: (calls.append(kw), real(**kw))[1]):
            self.put("choix.lisbon", "lisbon-03")
        self.assertEqual(os.path.realpath(calls[0]["dir"]), os.path.realpath(self.dir))

    def test_replace_for_migration(self):
        migrated = {"choix": {"lisbon": "lisbon-02", "sorties": {"x": {"jour": "2027-06-16"}}},
                    "favs": {"log:lisbon-02": {"us": True}}, "resa": {"k": {"done": True, "by": "us"}}}
        self.assertEqual(self.json("PUT", "/api/etat?remplacer=1", migrated)[0], 200)
        self.assertEqual(self.read_file("state.json"), dict(migrated, v=1))
        self.assertEqual(self.json("PUT", "/api/etat", migrated)[0], 400)   # would be taken for a field
        self.assertEqual(self.json("PUT", "/api/etat?remplacer=1", {"other": {}})[0], 400)
        self.assertEqual(self.json("PUT", "/api/etat?remplacer=1", {"favs": {"k": {"us": "yes"}}})[0], 400)
        self.assertEqual(self.json("PUT", "/api/etat?remplacer=1", [1, 2])[0], 400)
        self.assertEqual(self.read_file("state.json"), dict(migrated, v=1))

    def test_validation(self):
        before = self.json("GET", "/api/etat")[1]
        self.assertEqual(self.json("PUT", "/api/etat", headers={"Content-Type": "application/json"}, raw=b"{not json")[0], 400)
        self.assertEqual(self.json("PUT", "/api/etat", headers={"Content-Type": "text/plain"},
                                   raw=b'{"chemin":"mode","valeur":"detail"}')[0], 415)
        for path in ["", "other.x", "choix..x", "choix./x", "choix.__proto__", "../trip", "favs.a.b.c.d", 12, None, ["choix", 3]]:
            self.assertEqual(self.put(path, "x")[0], 400, path)
        self.assertEqual(self.put("mode", "dark")[0], 400)
        self.assertEqual(self.put("favs.k.us", "yes")[0], 400)
        self.assertEqual(self.put("resa.k", {"done": "yes"})[0], 400)
        self.assertEqual(self.put("resa.k", {"fait": True})[0], 400)
        self.assertEqual(self.put("choix", "not an object")[0], 400)
        self.assertEqual(self.json("PUT", "/api/etat", {"chemin": "choix.lisbon"})[0], 400)
        self.assertEqual(self.json("PUT", "/api/etat", {"chemin": "choix.lisbon", "valeur": "x", "extra": 1})[0], 400)
        deep = x = {}
        for _ in range(30):
            x["a"] = {}
            x = x["a"]
        self.assertEqual(self.put("choix.lisbon", deep)[0], 400)
        self.assertEqual(self.put("choix.note", "x" * (S.MAX_PUT + 10))[0], 413)
        self.assertEqual(self.json("GET", "/api/etat")[1], before, "nothing was written")

    def test_corrupt_file_is_not_overwritten(self):
        self.write("state.json", "{this is not json")
        self.assertEqual(self.put("choix.lisbon", "lisbon-01")[0], 500)
        with open(self.path("state.json"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "{this is not json")

    def test_origin_and_host(self):
        body = {"chemin": "choix.lisbon", "valeur": "lisbon-01"}
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": "https://example.org"})[0], 403)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": f"http://localhost:{self.port + 1}"})[0], 403)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": "null"})[0], 403)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": f"http://127.0.0.1:{self.port}"})[0], 200)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": f"http://localhost:{self.port}"})[0], 200)
        # DNS rebinding: a name pointing to 127.0.0.1 is not accepted; tunnel hosts neither
        for host in ("pirate.example.com", "abc.ngrok-free.app"):
            self.assertEqual(self.json("GET", "/api/etat", headers={"Host": host})[0], 403, host)
            self.assertEqual(self.request("GET", "/index.html", headers={"Host": host})[0], 403, host)
        self.assertEqual(self.json("PUT", "/api/etat", body, {"Origin": "https://abc.ngrok-free.app"})[0], 403)
        self.assertEqual(self.json("GET", "/api/etat", headers={"Host": f"localhost:{self.port}"})[0], 200)

    def test_silent_client_does_not_hold_a_thread(self):
        self.assertEqual(S.Handler.timeout, 30)

    def test_method_not_allowed(self):
        self.assertEqual(self.json("DELETE", "/api/etat")[0], 405)
        self.assertEqual(self.json("POST", "/api/etat", {"a": 1})[0], 405)
        self.assertEqual(self.json("GET", "/api/unknown")[0], 404)
        self.assertEqual(self.json("GET", "/api/imports")[0], 404)
        self.assertEqual(self.request("POST", "/index.html", {"a": 1})[0], 405)


class TestWriteIsConfined(unittest.TestCase):
    def test_never_outside_the_state_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            trip = os.path.join(tmp, "trip")
            shutil.copytree(SAMPLE, trip, ignore=shutil.ignore_patterns("site", "state.json"))
            paths = S.Paths(S.tripctx.load(trip))
            for forbidden in (os.path.join(tmp, "CLAUDE.md"), os.path.join(trip, "site", "x.json"),
                              os.path.join(trip, "trip.json"), os.path.join(trip, "research", "x.json"),
                              os.path.join(trip, "..", "x.json"), os.path.join(trip, "state.json.bak")):
                with self.assertRaises(PermissionError, msg=forbidden):
                    S.write_json_atomic(forbidden, {"a": 1}, paths.allowed)
            S.write_json_atomic(paths.state, {"a": 1}, paths.allowed)
            self.assertTrue(os.path.exists(paths.state))
            # a symbolic link standing in for the state file's folder cannot redirect the write
            outside = os.path.join(tmp, "outside")
            os.makedirs(outside)
            link = os.path.join(tmp, "link")
            os.symlink(outside, link)
            with self.assertRaises(PermissionError):
                S.write_json_atomic(os.path.join(link, "state.json"), {}, paths.allowed)


class TestStatic(Base):
    def test_files_and_types(self):
        self.assertEqual(self.request("GET", "/media/parcours.json")[1]["content-type"], "application/json")
        self.assertEqual(self.request("GET", "/media/photo.webp")[1]["content-type"], "image/webp")
        self.assertEqual(self.request("GET", "/media/photo.jpg")[1]["content-type"], "image/jpeg")
        self.assertEqual(self.request("HEAD", "/media/photo.webp")[0], 200)
        self.assertEqual(self.request("GET", "/missing.html")[0], 404)

    def test_no_icon_no_error(self):
        self.assertEqual(self.request("GET", "/favicon.ico")[0], 204)

    def test_no_directory_listing(self):
        for d in ["/media/", "/media"]:
            st, _, _ = self.request("GET", d)
            self.assertIn(st, (301, 404), d)
            if st == 301:
                self.assertEqual(self.request("GET", self.request("GET", d)[1]["location"])[0], 404)

    def test_forbidden_paths(self):
        sentinels = (b"sample-portugal", b"SECRET-CLAUDE")
        paths = ["/../trip.json", "/%2e%2e/trip.json", "/..%2ftrip.json", "/media/../../trip.json",
                 "/media/%2e%2e/%2e%2e/trip.json", "/../../CLAUDE.md", "//../CLAUDE.md", "/..\\trip.json",
                 "/media/..%5c..%5ctrip.json", "/trip.json", "/CLAUDE.md", "/%00/../trip.json", "/./../trip.json",
                 "/state.json", "/research/taux.json"]
        for p in paths:
            try:
                st, _, t = self.request("GET", p)
            except (http.client.HTTPException, OSError):
                continue
            self.assertNotEqual(st, 200, p)
            for s in sentinels:
                self.assertNotIn(s, t, p)
        self.write("site/.secret", "SECRET-HIDDEN")
        self.assertEqual(self.request("GET", "/.secret")[0], 404)

    def test_trip_data_only_through_the_api(self):
        self.assertEqual(self.request("GET", "/state.json")[0], 404)
        self.assertEqual(self.request("GET", "/research/vols-brut/x.json")[0], 404)


class TestClientJs(Base):
    """The real store.js (under Node) against the real server: same paths, same shapes, no refusal."""

    @unittest.skipUnless(shutil.which("node"), "node absent")
    def test_store_js_against_server_py(self):
        script = os.path.join(ROOT, "tests", "fixtures", "serveur_client.js")
        r = subprocess.run(["node", script, f"http://127.0.0.1:{self.port}"], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(out["messages"], [])
        self.assertEqual(out["mode"], "serveur")
        state = self.read_file("state.json")
        self.assertEqual(state, {
            "v": 1,
            "choix": {
                "lisbon": "lisbon-01", "comporta": "comporta-02",
                "sorties": {"porto-cellar-tasting": {"jour": "2027-06-22", "heure": "18:00"}},
                "speciales": {"sao-joao": "porto-fireworks-dinner"}, "inclure": {"arrive-b": True},
            },
            "favs": {"log:a": {"nous": True}, "log:b": {"nous": True}, "log:villa.vue": {"nous": True}},
            "resa": {"r": {"done": True, "by": "nous"}, "logement:lisbon:lisbon-01": {"done": True, "by": "nous"}},
            "mode": "detail",
        })
        self.assertEqual(out["choix"], state["choix"])


if __name__ == "__main__":
    unittest.main()
