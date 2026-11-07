"""Runs last (alphabetical order): the suite must not leave generated files in the repository root."""
import os
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@unittest.skipUnless(shutil.which("git") and os.path.isdir(os.path.join(ROOT, ".git")), "needs a git checkout")
class TestNoStrayFiles(unittest.TestCase):
    def test_tests_write_nothing_at_the_repo_root(self):
        # e.g. research/medias-cache/.bin/ (the compiled Vision helper) must live in a trip's own folder, never at the root
        out = subprocess.run(["git", "-C", ROOT, "ls-files", "--others", "--exclude-standard"],
                             capture_output=True, text=True, check=True).stdout.split("\n")
        stray = [p for p in out if p.startswith(("research/", "site/", "trips/"))]
        self.assertEqual(stray, [], "files created at the repo root by a test or script")
        self.assertFalse(os.path.exists(os.path.join(ROOT, "research")), "research/ exists at the repo root")


if __name__ == "__main__":
    unittest.main()
