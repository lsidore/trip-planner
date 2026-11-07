"""scripts/photo_strip.py: a strip of the first three photos of each option, built from local fake images (no network)."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    from PIL import Image
except ImportError:  # the Pillow-dependent tests are skipped
    Image = None

import photo_strip as PS  # noqa: E402


def no_network(*a, **k):
    raise AssertionError("the test must not reach the network")


class MissingPillowTests(unittest.TestCase):
    def test_one_plain_line_without_pillow(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.dict(sys.modules, {"PIL": None}):
            code = PS.main(["options.json"])
        self.assertEqual(code, 1)
        self.assertEqual(err.getvalue(), PS.NO_PILLOW + "\n")
        self.assertIn("python3 scripts/setup.py status", err.getvalue())
        self.assertNotIn("Traceback", out.getvalue() + err.getvalue())


@unittest.skipUnless(Image is not None, "Pillow is not installed (python3 -m pip install --user Pillow)")
class PhotoStripTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.trip = os.path.join(self.tmp, "trips", "demo")
        os.makedirs(self.trip)
        self.imgs = []
        for i, (w, h, colour) in enumerate([(800, 600, "red"), (600, 900, "green"), (1200, 600, "blue"),
                                            (700, 700, "yellow")]):
            p = os.path.join(self.tmp, f"p{i}.jpg")
            Image.new("RGB", (w, h), colour).save(p)
            self.imgs.append(p)
        self.broken = os.path.join(self.tmp, "broken.jpg")
        with open(self.broken, "wb") as f:
            f.write(b"not an image")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def options(self, data, name="options.json"):
        p = os.path.join(self.tmp, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return p

    def run_main(self, argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch.object(PS.urllib.request, "urlopen", no_network), \
                mock.patch.dict(os.environ, env or {}, clear=False):
            if env is None:
                os.environ.pop("TRIP_DIR", None)
            code = PS.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_strip_of_the_first_three_photos(self):
        opts = self.options([{"name": "Casa Azul Boutique", "photos": self.imgs, "url": "https://www.example.com/x"}])
        code, out, err = self.run_main([opts, "--trip", self.trip])
        self.assertEqual(code, 0, err)
        path = os.path.join(self.trip, "research", "previews", "casa-azul-boutique.jpg")
        self.assertTrue(os.path.isfile(path), out)
        with Image.open(path) as im:
            self.assertEqual(im.height, PS.HEIGHT)
            # 3 photos at 420 px high: 560 + 280 + 840, plus two gaps
            self.assertEqual(im.width, 560 + 280 + 840 + 2 * PS.GAP)
            self.assertEqual(im.getpixel((10, 10))[0] > 200, True)       # first photo (red) on the left
        self.assertIn("casa-azul-boutique.jpg", out)
        self.assertIn("3 photos", out)
        self.assertIn("https://www.example.com/x", out)

    def test_unreadable_photos_are_skipped_and_the_next_ones_used(self):
        opts = self.options([{"name": "Villa", "photos": [self.broken, os.path.join(self.tmp, "missing.jpg")]
                              + self.imgs[:2]}])
        code, out, _ = self.run_main([opts, "--trip", self.trip])
        self.assertEqual(code, 0)
        self.assertIn("2 photos", out)

    def test_option_without_photo_is_reported(self):
        opts = self.options([{"name": "Nothing here", "photos": []}, {"name": "Broken", "photos": [self.broken]}])
        code, out, _ = self.run_main([opts, "--trip", self.trip])
        self.assertEqual(code, 1)
        self.assertIn("no photo: Nothing here", out)
        self.assertIn("no photo: Broken", out)
        self.assertFalse(os.path.exists(os.path.join(self.trip, "research", "previews", "nothing-here.jpg")))

    def test_research_file_keys_and_options_wrapper(self):
        rel = os.path.basename(self.imgs[0])   # relative paths are read next to the JSON file
        opts = self.options({"options": [{"nom": "Hotel Ribeira", "photo_urls": [rel], "id": "porto-01"}]})
        code, out, _ = self.run_main([opts, "--trip", self.trip])
        self.assertEqual(code, 0, out)
        self.assertTrue(os.path.isfile(os.path.join(self.trip, "research", "previews", "hotel-ribeira.jpg")))

    def test_same_name_twice_gets_two_files(self):
        opts = self.options([{"name": "Same", "photos": self.imgs[:1]}, {"name": "Same", "photos": self.imgs[1:2]}])
        code, _, _ = self.run_main([opts, "--trip", self.trip])
        self.assertEqual(code, 0)
        prev = os.path.join(self.trip, "research", "previews")
        self.assertEqual(sorted(os.listdir(prev)), ["same-2.jpg", "same.jpg"])

    def test_active_trip_from_trips_current_without_trip_json(self):
        with open(os.path.join(self.tmp, "trips", ".current"), "w") as f:
            f.write("demo\n")
        opts = self.options([{"name": "A", "photos": self.imgs[:1]}])
        with mock.patch.object(PS, "ROOT", self.tmp):
            code, _, err = self.run_main([opts])
        self.assertEqual(code, 0, err)
        self.assertTrue(os.path.isfile(os.path.join(self.trip, "research", "previews", "a.jpg")))

    def test_no_active_trip_is_a_clear_error(self):
        opts = self.options([{"name": "A", "photos": self.imgs[:1]}])
        with mock.patch.object(PS, "ROOT", self.tmp):
            code, _, err = self.run_main([opts])
        self.assertEqual(code, 1)
        self.assertIn("no active trip", err)

    def test_out_overrides_the_folder(self):
        out_dir = os.path.join(self.tmp, "elsewhere")
        opts = self.options([{"name": "A", "photos": self.imgs[:1]}])
        code, _, _ = self.run_main([opts, "--out", out_dir])
        self.assertEqual(code, 0)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "a.jpg")))

    def test_invalid_options_file(self):
        bad = self.options({"something": 1}, "bad.json")
        code, _, err = self.run_main([bad, "--trip", self.trip])
        self.assertEqual(code, 1)
        self.assertIn("list of options", err)


class WikimediaTests(unittest.TestCase):
    def test_original_becomes_a_thumbnail(self):
        u = "https://upload.wikimedia.org/wikipedia/commons/b/b0/Alfama%2C_Lisbon.jpg"
        self.assertEqual(PS.wikimedia_thumb(u),
                         "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Alfama%2C_Lisbon.jpg/"
                         f"{PS.WIKI_PX}px-Alfama%2C_Lisbon.jpg")

    def test_existing_thumbnail_gets_the_standard_width(self):
        u = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/A.jpg/2400px-A.jpg"
        self.assertTrue(PS.wikimedia_thumb(u).endswith(f"/{PS.WIKI_PX}px-A.jpg"))

    def test_other_links_unchanged(self):
        u = "https://a0.muscache.com/im/pictures/abc.jpg"
        self.assertEqual(PS.wikimedia_thumb(u), u)

    def test_descriptive_user_agent(self):
        self.assertIn("trip-planner", PS.USER_AGENT)
        self.assertIn("https://github.com/lsidore/trip-planner", PS.USER_AGENT)
        self.assertNotIn("Mozilla", PS.USER_AGENT)

    def test_429_is_retried_after_a_pause(self):
        calls, sleeps = [], []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_open(req, timeout=None, context=None):
            calls.append(req)
            if len(calls) == 1:
                raise PS.urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "2"}, None)
            return Resp(b"bytes")

        with mock.patch.object(PS.urllib.request, "urlopen", fake_open), \
                mock.patch.object(PS.time, "sleep", sleeps.append):
            data = PS.download("https://upload.wikimedia.org/wikipedia/commons/b/b0/A.jpg")
        self.assertEqual(data, b"bytes")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].get_header("User-agent"), PS.USER_AGENT)
        self.assertIn("/thumb/", calls[0].full_url)
        self.assertTrue(any(s >= 2 for s in sleeps), sleeps)


if __name__ == "__main__":
    unittest.main()
