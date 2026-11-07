import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import setup as S  # noqa: E402

SECRET = "fake-value-1234"


def run(argv, root, stdin="", which=None, versions=None, runner=None, plat="macos", brew=False, py=(3, 9, 6),
        pillow=True, env_extra=None):
    """Run setup.main in-process; returns (exit_code, stdout, stderr).
    Nothing depends on the host: platform, Homebrew, the Python version and Pillow are all faked (defaults: a stock Mac,
    Apple's python3 3.9.6, no Homebrew, Pillow present)."""
    out, err = io.StringIO(), io.StringIO()
    which = which if which is not None else (lambda n: "/usr/bin/" + n)
    env = {"brew": brew, "brew_python": False, "managed": False, **(env_extra or {})}
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
            mock.patch.object(S.shutil, "which", which), \
            mock.patch.object(S, "tool_version", versions or (lambda n: {"node": "v22.1.0", "uv": "0.5.0"}.get(n, "1"))), \
            mock.patch.object(S, "has_pillow", lambda: pillow), \
            mock.patch.object(S, "detect_platform", lambda: plat), \
            mock.patch.object(S, "environment", lambda: dict(env)), \
            mock.patch.object(S, "python_version", lambda: py), \
            mock.patch.object(S.mcp, "tool_names", lambda cfg, root=None: ["t1", "t2"]), \
            mock.patch.object(S.sys, "stdin", io.StringIO(stdin)):
        if runner:
            with mock.patch.object(S.subprocess, "run", runner):
                code = S.main(argv, root=root)
        else:
            code = S.main(argv, root=root)
    return code, out.getvalue(), err.getvalue()


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        os.makedirs(os.path.join(self.root, "setup"))
        shutil.copy(os.path.join(ROOT, "setup", "services.json"), os.path.join(self.root, "setup"))
        shutil.copy(os.path.join(ROOT, ".mcp.json"), self.root)

    def test_missing_prereqs_reported(self):
        which = lambda n: None if n in ("node", "uv") else "/usr/bin/" + n
        code, out, err = run(["status"], self.root, which=which)
        self.assertEqual(code, 2)
        self.assertNotIn("Traceback", out + err)
        for tool in ("node", "uv"):
            line = next(l for l in out.splitlines() if l.strip().startswith(tool))
            self.assertIn("missing", line)
        self.assertIn("Install Node.js (missing)", out)  # an install hint is printed
        self.assertIn("Install uv (missing)", out)

    def test_python_39_is_accepted(self):
        code, out, _ = run(["status", "--json"], self.root, py=(3, 9, 6))
        py = next(p for p in json.loads(out)["prerequisites"] if p["id"] == "python")
        self.assertEqual((py["status"], py["version"]), ("ok", "3.9.6"))
        self.assertEqual(code, 0)

    def test_python_38_is_old(self):
        code, out, _ = run(["status", "--json"], self.root, py=(3, 8, 10))
        py = next(p for p in json.loads(out)["prerequisites"] if p["id"] == "python")
        self.assertEqual(py["status"], "old")
        self.assertIn("python.org", py["install"]["macos"])
        self.assertNotIn("brew", py["install"]["macos"])
        self.assertEqual(code, 2)

    def test_stock_mac_without_homebrew_never_suggests_brew(self):
        which = lambda n: None if n in ("node", "uv") else "/usr/bin/" + n
        code, out, _ = run(["status"], self.root, which=which, brew=False, pillow=False)
        self.assertEqual(code, 2)
        self.assertIn("https://nodejs.org/en/download", out)
        self.assertIn("curl -LsSf https://astral.sh/uv/install.sh | sh", out)
        self.assertIn("python3 -m pip install --user Pillow", out)
        self.assertIn("new terminal window", out)
        self.assertNotIn("brew", out)

    def test_homebrew_present_gives_brew_commands(self):
        which = lambda n: None if n in ("node", "uv") else "/usr/bin/" + n
        code, out, _ = run(["status"], self.root, which=which, brew=True)
        self.assertEqual(code, 2)
        self.assertIn("brew install node", out)
        self.assertIn("brew install uv", out)

    def test_pillow_on_a_homebrew_python_uses_brew(self):
        _, out, _ = run(["status"], self.root, brew=True, pillow=False, env_extra={"brew_python": True})
        self.assertIn("brew install pillow", out)
        self.assertNotIn("pip install --user", out)

    def test_only_pillow_missing_says_the_rest_works(self):
        code, out, _ = run(["status"], self.root, pillow=False)
        self.assertEqual(code, 2)
        self.assertIn("Only Pillow is missing", out)

    def test_linux_hints(self):
        which = lambda n: None if n in ("node", "uv") else "/usr/bin/" + n
        _, out, _ = run(["status"], self.root, which=which, plat="linux", brew=True, pillow=False,
                        env_extra={"managed": True})
        self.assertIn("https://nodejs.org/en/download", out)
        self.assertIn("older than 18", out)
        self.assertIn("curl -LsSf https://astral.sh/uv/install.sh | sh", out)
        self.assertIn("python3-pil", out)
        self.assertNotIn("brew", out)

    def test_homebrew_python_detection(self):
        self.assertTrue(S.python_is_brew("/opt/homebrew/bin/python3.12"))
        self.assertFalse(S.python_is_brew("/usr/bin/python3"))

    def test_status_json_has_install_commands_for_each_platform(self):
        which = lambda n: None if n == "uv" else "/usr/bin/" + n
        code, out, _ = run(["status", "--json"], self.root, which=which)
        data = json.loads(out)
        uv = next(p for p in data["prerequisites"] if p["id"] == "uv")
        self.assertEqual(uv["status"], "missing")
        self.assertEqual(set(uv["install"]), {"macos", "linux", "wsl"})
        self.assertEqual(code, 2)

    def test_old_node_is_reported_old(self):
        code, out, _ = run(["status", "--json"], self.root, versions=lambda n: "v16.20.0" if n == "node" else "1")
        node = next(p for p in json.loads(out)["prerequisites"] if p["id"] == "node")
        self.assertEqual(node["status"], "old")
        self.assertEqual(code, 2)

    def test_all_present_exits_0(self):
        code, out, _ = run(["status"], self.root)
        self.assertEqual(code, 0)

    def test_a_crashing_check_never_gives_a_traceback(self):
        def boom(n):
            raise RuntimeError("boom")
        code, out, err = run(["status"], self.root, versions=boom)
        self.assertNotIn("Traceback", out + err)
        self.assertEqual(code, 2)

    def test_hook_when_not_set_up(self):
        code, out, _ = run(["hook"], self.root)
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("SETUP_NEEDED: run the guided setup (see CLAUDE.md"), out)

    def test_hook_when_done(self):
        os.makedirs(os.path.join(self.root, ".setup"))
        with open(os.path.join(self.root, ".setup", "state.json"), "w") as f:
            json.dump({"date": "2026-11-07", "services_enabled": []}, f)
        code, out, _ = run(["hook"], self.root)
        self.assertEqual(out, "Setup done 2026-11-07. Active trip: none. Load the start skill.\n")
        self.assertEqual(len(out.splitlines()), 1)

    def test_hook_names_active_trip(self):
        os.makedirs(os.path.join(self.root, ".setup"))
        with open(os.path.join(self.root, ".setup", "state.json"), "w") as f:
            json.dump({"date": "2026-11-07", "services_enabled": []}, f)
        os.makedirs(os.path.join(self.root, "trips", "sample-portugal"))
        with open(os.path.join(self.root, "trips", "sample-portugal", "trip.json"), "w") as f:
            f.write("{}")
        with open(os.path.join(self.root, "trips", ".current"), "w") as f:
            f.write("sample-portugal\n")
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("TRIP_DIR", None)
            _, out, _ = run(["hook"], self.root)
        self.assertEqual(out, "Setup done 2026-11-07. Active trip: sample-portugal. Load the start skill.\n")

    def test_done_writes_state(self):
        code, out, _ = run(["done"], self.root)
        self.assertEqual(code, 0)
        st = json.load(open(os.path.join(self.root, ".setup", "state.json")))
        self.assertEqual(set(st), {"date", "services_enabled"})
        self.assertRegex(st["date"], r"^\d{4}-\d\d-\d\d$")

    def test_services_lists_groups(self):
        _, out, _ = run(["services"], self.root)
        for g in ("keyless", "keyed", "connector", "browser"):
            self.assertIn(g, out)
        self.assertIn("serpapi", out)

    def test_add_key_keeps_other_lines(self):
        env = os.path.join(self.root, ".env")
        with open(env, "w") as f:
            f.write("A=1\n# comment\nSERPAPI_API_KEY=old\nB=2\n")
        calls = []

        def fake(cmd, **kw):
            calls.append(cmd)
            return mock.Mock(returncode=0, stdout="", stderr="")
        code, out, err = run(["add-key", "serpapi"], self.root, stdin=SECRET + "\n", runner=fake)
        self.assertEqual(code, 0, out + err)
        lines = open(env).read().splitlines()
        self.assertEqual(lines, ["A=1", "# comment", "SERPAPI_API_KEY=" + SECRET, "B=2"])
        self.assertEqual(stat.S_IMODE(os.stat(env).st_mode), 0o600)
        add = next(c for c in calls if "add-json" in c)
        self.assertEqual(add[:5], ["claude", "mcp", "add-json", "--scope", "local"])
        self.assertEqual(add[5], "serpapi")
        self.assertEqual(json.loads(add[6])["headers"]["Authorization"], "Bearer " + SECRET)
        self.assertNotIn(SECRET, " ".join(add[:6]))  # never in argv except the json payload

    def test_add_key_never_prints_the_key(self):
        def fake(cmd, **kw):
            return mock.Mock(returncode=1, stdout=SECRET, stderr="failed " + SECRET)
        code, out, err = run(["add-key", "serpapi"], self.root, stdin=SECRET + "\n", runner=fake)
        self.assertNotIn(SECRET, out + err)
        self.assertNotEqual(code, 0)

    def test_add_key_creates_env_with_mode_600(self):
        fake = lambda cmd, **kw: mock.Mock(returncode=0, stdout="", stderr="")
        run(["add-key", "exa"], self.root, stdin="k\n", runner=fake)
        env = os.path.join(self.root, ".env")
        self.assertEqual(open(env).read(), "EXA_API_KEY=k\n")
        self.assertEqual(stat.S_IMODE(os.stat(env).st_mode), 0o600)

    def test_add_key_without_claude_exits_3_with_manual_command(self):
        code, out, err = run(["add-key", "serpapi"], self.root, stdin=SECRET + "\n", which=lambda n: None)
        self.assertEqual(code, 3)
        self.assertIn("claude mcp add-json --scope local serpapi", out + err)
        self.assertIn("<your key>", out + err)
        self.assertNotIn(SECRET, out + err)
        self.assertIn("SERPAPI_API_KEY=" + SECRET, open(os.path.join(self.root, ".env")).read())

    def test_add_key_unknown_service(self):
        code, out, err = run(["add-key", "nope"], self.root, stdin="k\n")
        self.assertEqual(code, 1)
        self.assertNotIn("Traceback", out + err)

    def test_add_key_empty_stdin(self):
        code, out, err = run(["add-key", "serpapi"], self.root, stdin="\n")
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(os.path.join(self.root, ".env")))

    def test_services_schema(self):
        base = {"id", "name", "group", "what_for", "free_tier", "verified", "signup_url"}
        extra = {"keyless": {"mcp_name"}, "keyed": {"env_var", "mcp_name", "mcp_json_template", "steps"},
                 "connector": {"steps"}, "browser": {"steps"}}
        with open(os.path.join(ROOT, "setup", "services.json")) as f:
            svcs = json.load(f)["services"]
        ids = [s["id"] for s in svcs]
        self.assertEqual(len(ids), len(set(ids)))
        for s in svcs:
            self.assertIn(s["group"], extra, s["id"])
            self.assertTrue((base | extra[s["group"]]) <= set(s), s["id"])
            self.assertTrue(s["signup_url"].startswith("https://"), s["id"])
            self.assertRegex(s["verified"], r"^(unverified|\d{4}-\d\d-\d\d)$")
            if s["group"] == "keyed":
                self.assertIn("${" + s["env_var"] + "}", json.dumps(s["mcp_json_template"]))
        for needed in ("serpapi", "apify", "google_maps", "brave", "exa", "firecrawl", "booking", "expedia",
                       "getyourguide", "accuweather", "tripadvisor", "google_calendar", "openbnb", "gmail",
                       "google_drive", "yelp", "resy", "uber", "ticketmaster", "stubhub", "claude_in_chrome"):
            self.assertIn(needed, ids)
        for s in svcs:
            if s["group"] == "connector":
                self.assertTrue(any("account" in t for t in s["steps"]), s["id"])
            if "tool_hint" in s:
                self.assertRegex(s["tool_hint"], r"^[A-Za-z0-9_-]+$", s["id"])
        openbnb = next(s for s in svcs if s["id"] == "openbnb")
        self.assertIn("credit", openbnb["free_tier"])
        chrome = next(s for s in svcs if s["id"] == "claude_in_chrome")
        steps = " ".join(chrome["steps"])
        for needle in ("chromewebstore.google.com", "/chrome", "Enabled by default", "Preferred browser"):
            self.assertIn(needle, steps)

    def test_services_prints_tool_hints(self):
        _, out, _ = run(["services"], self.root)
        self.assertIn("__accommodations_search", out)
        self.assertIn("__tabs_context_mcp", out)


class ImportCheckTests(unittest.TestCase):
    """Pillow is checked in a child interpreter WITHOUT -I: `python3 -I scripts/setup.py status` hides the user
    site-packages, where `pip install --user Pillow` puts it, so an in-process check would report it missing forever."""

    def test_checked_in_a_child_python_without_isolation(self):
        calls = []

        def fake_run(cmd, **kw):
            calls.append((cmd, kw))
            return subprocess.CompletedProcess(cmd, 0, "", "")
        with mock.patch.object(S.subprocess, "run", fake_run):
            self.assertTrue(S.has_pillow())
        cmd, kw = calls[0]
        self.assertEqual(cmd[0], sys.executable)
        self.assertNotIn("-I", cmd)
        self.assertNotIn("-s", cmd)
        self.assertEqual(cmd[1:], ["-c", "import PIL"])
        self.assertTrue(kw.get("timeout"))

    def test_import_failure_is_missing(self):
        with mock.patch.object(S.subprocess, "run",
                               lambda cmd, **kw: subprocess.CompletedProcess(cmd, 1, "", "ModuleNotFoundError")):
            self.assertFalse(S.has_pillow())

    def test_timeout_or_error_is_missing_not_a_crash(self):
        def boom(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd, 30)
        with mock.patch.object(S.subprocess, "run", boom):
            self.assertFalse(S.has_pillow())
        with mock.patch.object(S.subprocess, "run", mock.Mock(side_effect=OSError("no python"))):
            self.assertFalse(S.importable("PIL"))

    def test_status_reports_pillow_from_the_child_check(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        shutil.copytree(os.path.join(ROOT, "setup"), os.path.join(root, "setup"))
        shutil.copy(os.path.join(ROOT, ".mcp.json"), root)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                mock.patch.object(S.shutil, "which", lambda n: "/usr/bin/" + n), \
                mock.patch.object(S, "tool_version", lambda n: "v22.1.0"), \
                mock.patch.object(S, "importable", lambda m: False), \
                mock.patch.object(S, "python_version", lambda: (3, 9, 6)):
            code = S.main(["status"], root=root)
        self.assertEqual(code, 2)
        self.assertIn("Install Pillow", out.getvalue())


if __name__ == "__main__":
    unittest.main()
