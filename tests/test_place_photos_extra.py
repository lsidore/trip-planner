"""place_photos_extra: guide hosts come from a fixed international list plus the trip's optional photo-guides.json."""
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import place_photos_extra as PE  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")


class TestGuides(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dir = os.path.join(self.tmp, "trip")
        shutil.copytree(SAMPLE, self.dir, ignore=shutil.ignore_patterns("site", "state.json"))

    def test_default_guides_are_international(self):
        g = PE.guides(load(self.dir))
        for h in ("tripadvisor.", "michelin.", "timeout.", "lonelyplanet.", "wikipedia.", "wikivoyage.", "yelp."):
            self.assertIn(h, g)
        self.assertFalse([h for h in g if any(w in h for w in ("thai", "wongnai", "tourism"))])

    def test_extra_hosts_come_from_photo_guides_json(self):
        with open(os.path.join(self.dir, "research", "photo-guides.json"), "w", encoding="utf-8") as f:
            json.dump(["visitportugal.", "timeout-lisboa."], f)
        g = PE.guides(load(self.dir))
        self.assertIn("visitportugal.", g)
        self.assertIn("tripadvisor.", g)

    def test_missing_or_malformed_file_is_ignored(self):
        self.assertEqual(PE.guides(load(self.dir)), PE.GUIDES)
        with open(os.path.join(self.dir, "research", "photo-guides.json"), "w") as f:
            json.dump({"not": "a list"}, f)
        self.assertEqual(PE.guides(load(self.dir)), PE.GUIDES)

    def test_jobs_use_the_trip_stages_and_paths(self):
        trip = load(self.dir)
        jobs = PE.jobs_of(trip)
        self.assertTrue(jobs, "the sample trip has places with pages to read")
        keys = {s["key"] for s in trip.stages}
        agenda = {p["id"] for p in json.load(open(os.path.join(trip.research, "lieux-agenda.json")))["pois"]}
        for pid, pages, have, need in jobs:
            self.assertTrue(pid.split("-")[0] in keys or pid in agenda, pid)
            self.assertGreater(need, 0)
            self.assertTrue(all(u.startswith("http") for u in pages))

    def test_output_goes_to_the_trip_research_folder(self):
        trip = load(self.dir)
        with unittest.mock.patch.object(PE, "enrich", lambda job, cache, gl: (job[0], ["https://x.example/a.jpg"])):
            PE.run(trip)
        out = os.path.join(trip.research, "lieux-photos-extra.json")
        self.assertTrue(os.path.isfile(out))
        with open(out, encoding="utf-8") as f:
            done = json.load(f)
        self.assertTrue(done and all(v == ["https://x.example/a.jpg"] for v in done.values()))
        self.assertTrue(os.path.isdir(os.path.join(trip.research, "poi-cache")))


class TestMissingPillow(unittest.TestCase):
    def test_one_plain_line_without_pillow(self):
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                unittest.mock.patch.object(PE, "Image", None):
            self.assertEqual(PE.main(["--trip", SAMPLE]), 1)
        self.assertEqual(err.getvalue(), PE.NO_PILLOW + "\n")
        self.assertNotIn("Traceback", out.getvalue() + err.getvalue())


if __name__ == "__main__":
    unittest.main()
