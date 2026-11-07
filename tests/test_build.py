"""scripts/build.py: one command from <trip>/trip.json and its research files to <trip>/site/index.html."""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build as B  # noqa: E402
import page_data  # noqa: E402


def run_cli(*args):
    return subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "build.py"), *args],
                          capture_output=True, text=True, timeout=300)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def sample_copy(self):
        d = os.path.join(self.tmp, "sample")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        return d

    def bare_trip(self):
        d = os.path.join(self.tmp, "bare")
        os.makedirs(d)
        shutil.copy(os.path.join(SAMPLE, "trip.json"), d)
        return d

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = B.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_build_sample(self):
        d = self.sample_copy()
        r = run_cli("--trip", d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "index.html")))
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "media", "parcours.json")))
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "media", "jours.json")))
        self.assertTrue(os.path.isfile(os.path.join(d, "research", "vols-options.json")))
        last = r.stdout.strip().splitlines()[-1]
        self.assertTrue(last.startswith("Open http://127.0.0.1:8793/ after running: python3 scripts/server.py --trip "), last)
        # nothing was fetched from the network and the sample itself is untouched
        self.assertNotIn("Kiwi calls", r.stdout)
        self.assertFalse(os.path.exists(os.path.join(SAMPLE, "state.json")))

    def test_build_with_trip_json_only(self):
        d = self.bare_trip()
        r = run_cli("--trip", d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "index.html")))
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "media", "parcours.json")))
        self.assertIn("not researched yet", r.stderr)
        for key in ("lisbon", "comporta", "porto"):
            self.assertTrue(any(key in l and "not researched yet" in l for l in r.stderr.splitlines()), key)
        self.assertTrue(any("flights" in l and "not researched yet" in l for l in r.stderr.splitlines()))
        self.assertNotIn("Traceback", r.stderr)

    def test_sample_has_nothing_unresearched(self):
        code, _, err = self.run_main("--trip", self.sample_copy())
        self.assertEqual(code, 0)
        self.assertNotIn("not researched yet", err)

    def test_steps_run_in_order_and_flights_are_built_once(self):
        d = self.sample_copy()
        calls = []

        def rec(name, ret=None):
            return mock.Mock(side_effect=lambda *a, **k: calls.append(name) or ret)

        built = {"verifie": "2026-11-07", "legs": {}}
        with mock.patch.object(B.flights, "download", rec("download")), \
                mock.patch.object(B.flights, "build", rec("flights", built)), \
                mock.patch.object(B.days, "build", rec("days")), \
                mock.patch.object(B.check_research, "check", rec("check", [])), \
                mock.patch.object(B, "run_photos", rec("photos")), \
                mock.patch.object(B.page_data, "build", rec("page_data")) as pd, \
                mock.patch.object(B.build_page, "main", rec("build_page")):
            code, out, _ = self.run_main("--trip", d, "--download-flights", "--photos")
        self.assertEqual(code, 0)
        self.assertEqual(calls, ["download", "flights", "days", "check", "photos", "page_data", "build_page"])
        self.assertIs(pd.call_args.kwargs.get("built"), built)   # page_data reuses the flights result
        self.assertTrue(out.strip().splitlines()[-1].startswith("Open http://127.0.0.1:8793/"))

    def test_optional_steps_are_skipped_by_default(self):
        d = self.sample_copy()
        calls = []
        with mock.patch.object(B.flights, "download", side_effect=lambda *a, **k: calls.append("download")), \
                mock.patch.object(B, "run_photos", side_effect=lambda *a, **k: calls.append("photos")):
            code, _, _ = self.run_main("--trip", d)
        self.assertEqual((code, calls), (0, []))

    def test_flights_skipped_without_raw_files(self):
        d = self.bare_trip()
        with mock.patch.object(B.flights, "build", wraps=B.flights.build) as fb:
            code, _, err = self.run_main("--trip", d)
        self.assertEqual(code, 0)
        self.assertEqual(fb.call_count, 1)   # only page_data's own (empty) pass: build.py skipped step 2
        self.assertIn("flights", err)

    def test_check_problems_are_printed_and_the_build_continues(self):
        d = self.sample_copy()
        with mock.patch.object(B.check_research, "check", return_value=["sorties-lisbon.json: x: bad price"]):
            code, _, err = self.run_main("--trip", d)
        self.assertEqual(code, 0)
        self.assertIn("sorties-lisbon.json: x: bad price", err)
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "index.html")))

    def test_missing_trip_json(self):
        code, _, err = self.run_main("--trip", os.path.join(self.tmp, "nowhere"))
        self.assertEqual(code, 1)
        self.assertIn("error:", err)

    def test_launch_json_has_no_absolute_path(self):
        with open(os.path.join(ROOT, ".claude", "launch.json"), encoding="utf-8") as f:
            raw = f.read()
        self.assertEqual(json.loads(raw), {"version": "0.0.1", "configurations": [
            {"name": "trip-page", "runtimeExecutable": "python3", "runtimeArgs": ["scripts/server.py", "--port", "8793"],
             "port": 8793}]})
        self.assertNotIn("/Users/", raw)


if __name__ == "__main__":
    unittest.main()
