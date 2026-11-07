"""Repo hygiene: no leftover private naming in code, git ignores the private folders."""
import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def grep(pattern, paths):
    """[(relative path, line number, line)] for every match; paths that do not exist yet are skipped."""
    rx = re.compile(pattern)
    found = []
    for rel in paths:
        top = os.path.join(ROOT, rel)
        if not os.path.exists(top):
            continue
        files = [top] if os.path.isfile(top) else [
            os.path.join(d, n) for d, dirs, names in os.walk(top)
            for n in names if "__pycache__" not in d and ".git" not in d.split(os.sep)]
        for f in sorted(files):
            try:
                with open(f, encoding="utf-8") as fh:
                    for i, line in enumerate(fh, 1):
                        if rx.search(line):
                            found.append((os.path.relpath(f, ROOT), i, line.strip()[:120]))
            except (UnicodeDecodeError, OSError):
                continue
    return found


def ignored(path):
    return subprocess.run(["git", "check-ignore", "-q", path], cwd=ROOT).returncode == 0


class TestHygiene(unittest.TestCase):
    def test_no_eur_suffix_in_code(self):
        self.assertEqual(grep(r"_eur\b", ["scripts", "page"]), [])

    def test_no_destination_words(self):
        # the words are split so that this file itself stays free of them (the private blocklist scans it too)
        words = ["tha" + "i", "bang" + "kok", "phu" + "ket", "ba" + "ht"]
        self.assertEqual(grep(r"(?i)" + "|".join(words) + r"|\bTH" + "B\\b", ["scripts", "page", ".claude", "CLAUDE.md"]), [])

    def test_grep_skips_missing_paths(self):
        self.assertEqual(grep(r"x", ["does-not-exist-yet"]), [])

    def test_gitignore_covers_private_dirs(self):
        for p in ("trips/my-trip/trip.json", "examples/sample/site/index.html", ".env", ".env.local", ".setup/state.json",
                  "node_modules/x", ".DS_Store", ".playwright-mcp/x", ".superpowers/x", ".claude/settings.local.json",
                  "trips/.current", "trips/x/research/medias-cache/a/c001.jpg"):
            self.assertTrue(ignored(p), p)

    def test_gitignore_covers_what_a_build_with_photos_writes_in_an_example(self):
        # `build.py --trip examples/<x> --photos` writes these; none may become trackable
        for ex in ("sample-trip", "another-example"):
            for p in ("site/index.html", "site/media/photos/x/01.jpg", "state.json", ".state.json.lock",
                      "research/vols-options.json", "research/medias-cache/x/c001.jpg",
                      "research/medias-cache/.bin/medias_vision", "research/poi-cache/x-0.jpg",
                      "research/previews/options-x.json", "research/previews/x.jpg", "research/lieux-photos-extra.json"):
                self.assertTrue(ignored(f"examples/{ex}/{p}"), f"examples/{ex}/{p}")
        for p in ("examples/sample-trip/trip.json", "examples/sample-trip/research/taux.json",
                  "examples/sample-trip/research/vols-brut/arrive-a-20270615.json"):
            self.assertFalse(ignored(p), p)

    def test_gitignore_keeps_tracked_files(self):
        for p in ("trips/.gitkeep", ".env.example", ".claude/settings.json"):
            self.assertFalse(ignored(p), p)


if __name__ == "__main__":
    unittest.main()
