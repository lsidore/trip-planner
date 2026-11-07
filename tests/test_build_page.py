"""Page assembly: order of styles and scripts (contract with the screens), safe tags, the trip's title and language."""
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_page as B  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
TRIP = {"title": "A & B <trip>", "language": "en", "slug": "a-b"}


def ecrire(chemin, texte):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(texte)


class TestAssembly(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = self.tmp.name
        ecrire(os.path.join(self.src, "template.html"),
               '<html lang="%%LANG%%" data-trip="%%SLUG%%"><title>%%TITLE%%</title><style>%%APPCSS%%</style>\n%%APPJS%%')
        ecrire(os.path.join(self.src, "app.css"), "/*app*/")
        ecrire(os.path.join(self.src, "js", "i18n.js"), "/*i18n*/")
        ecrire(os.path.join(self.src, "i18n", "en.js"), "/*en*/")
        ecrire(os.path.join(self.src, "js", "ui", "store.js"), "/*store*/")
        ecrire(os.path.join(self.src, "js", "ui", "shell.js"), "/*shell*/")

    def tearDown(self):
        self.tmp.cleanup()

    def noms(self, js):
        return [os.path.relpath(p, self.src).replace(os.sep, "/") for p in js]

    def test_minimal(self):
        page, js = B.construire(self.src, TRIP)
        self.assertEqual(self.noms(js), ["js/i18n.js", "i18n/en.js", "js/ui/store.js", "js/ui/shell.js"])
        self.assertIn("<title>A &amp; B &lt;trip&gt;</title>", page)
        self.assertIn('<html lang="en" data-trip="a-b">', page)
        self.assertNotIn("%%", page)

    def test_order_of_styles_and_scripts(self):
        ecrire(os.path.join(self.src, "css", "vols.css"), "/*vols*/")
        ecrire(os.path.join(self.src, "css", "logement.css"), "/*logement*/")
        ecrire(os.path.join(self.src, "i18n", "fr.js"), "/*fr*/")
        ecrire(os.path.join(self.src, "js", "logic", "budget.js"), "/*budget*/")
        ecrire(os.path.join(self.src, "js", "logic", "alerts.js"), "/*alerts*/")
        ecrire(os.path.join(self.src, "js", "logic", "config.js"), "/*config*/")
        ecrire(os.path.join(self.src, "js", "ui", "vols.js"), 'ECRANS["vols"] = function () {};')
        ecrire(os.path.join(self.src, "js", "ui", "logement.js"), "ECRANS['logement'] = function () {};")
        page, js = B.construire(self.src, dict(TRIP, language="fr"))
        self.assertEqual(self.noms(js), [
            "js/i18n.js", "i18n/en.js", "i18n/fr.js", "js/logic/config.js", "js/logic/alerts.js", "js/logic/budget.js",
            "js/ui/store.js", "js/ui/shell.js", "js/ui/logement.js", "js/ui/vols.js"])
        ordre = ["/*app*/", "/*logement*/", "/*vols*/"]
        self.assertEqual(sorted(ordre, key=page.index), ordre)
        self.assertEqual(page.count("<script>"), 10, "one tag per file")
        self.assertEqual(B.ecrans_enregistres(js), ["logement", "vols"])
        self.assertIn('lang="fr"', page)
        # English: the French dictionary is not loaded
        _, js_en = B.construire(self.src, TRIP)
        self.assertNotIn("i18n/fr.js", self.noms(js_en))

    def test_language_without_dictionary_loads_english_only(self):
        _, js = B.construire(self.src, dict(TRIP, language="xx"))
        self.assertEqual(self.noms(js)[:2], ["js/i18n.js", "i18n/en.js"])
        self.assertNotIn("i18n/xx.js", self.noms(js))

    def test_unsupported_language_falls_back(self):
        import contextlib
        import io
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            page, js = B.construire(self.src, dict(TRIP, language="es"))
        self.assertEqual(err.getvalue().strip().splitlines(), ["language 'es' not translated yet"])
        self.assertEqual(self.noms(js)[:2], ["js/i18n.js", "i18n/en.js"])
        self.assertNotIn("i18n/es.js", self.noms(js))
        # English and a translated language print nothing
        ecrire(os.path.join(self.src, "i18n", "fr.js"), "/*fr*/")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            B.construire(self.src, TRIP)
            B.construire(self.src, dict(TRIP, language="fr"))
        self.assertEqual(err.getvalue(), "")

    def test_script_cannot_close_its_tag(self):
        ecrire(os.path.join(self.src, "js", "ui", "zz.js"), 'var s = "</script><b>";')
        page, _ = B.construire(self.src, TRIP)
        self.assertNotIn('"</script>', page)
        self.assertIn('"<\\/script><b>"', page)

    def test_real_page(self):
        page, js = B.construire(trip=TRIP)
        self.assertNotIn("%%", page)
        self.assertNotRegex(page, r"<(?:img|iframe)[^>]+src=\"https?://", "no external image or iframe")
        noms = [os.path.basename(p) for p in js]
        self.assertEqual(noms[:3], ["i18n.js", "en.js", "config.js"])
        self.assertLess(noms.index("store.js"), noms.index("shell.js"))
        self.assertEqual(sorted(B.ecrans_enregistres(js)), ["detail", "jours", "logement", "plan", "sorties", "vols"])


class TestSample(unittest.TestCase):
    def test_build_page_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            trip = os.path.join(tmp, "sample")
            shutil.copytree(SAMPLE, trip, ignore=shutil.ignore_patterns("site"))
            B.main(["--trip", trip])
            out = os.path.join(trip, "site", "index.html")
            self.assertTrue(os.path.isfile(out))
            with open(out, encoding="utf-8") as f:
                page = f.read()
            self.assertIn("<title>Lisbon, Comporta &amp; Porto (example)</title>", page)
            self.assertIn('lang="en"', page)
            self.assertIn('data-trip="sample-portugal"', page)
            self.assertNotIn("<script>/* i18n/fr.js */", page)
            self.assertIn("<script>/* i18n/en.js */", page)

    def test_active_trip_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            trip = os.path.join(tmp, "sample")
            shutil.copytree(SAMPLE, trip, ignore=shutil.ignore_patterns("site"))
            avant = os.environ.get("TRIP_DIR")
            os.environ["TRIP_DIR"] = trip
            try:
                B.main([])
            finally:
                if avant is None:
                    del os.environ["TRIP_DIR"]
                else:
                    os.environ["TRIP_DIR"] = avant
            self.assertTrue(os.path.isfile(os.path.join(trip, "site", "index.html")))


if __name__ == "__main__":
    unittest.main()
