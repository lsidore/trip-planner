"""privacy_check: flags emails, absolute home paths, key-like values and blocklisted words."""
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import privacy_check as P  # noqa: E402


def scan_text(text, blocklist=()):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "sample.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        return P.scan([path], list(blocklist))


def kinds(results):
    return [r[2] for r in results]


class TestScan(unittest.TestCase):
    def test_flags_email(self):
        self.assertEqual(kinds(scan_text("contact me at jane@corp.io")), ["email"])  # privacy-check: ignore

    def test_allows_noreply(self):
        self.assertEqual(scan_text("Co-Authored-By: X <noreply@anthropic.com>"), [])

    def test_allows_github_noreply_and_example(self):
        self.assertEqual(scan_text("a@users.noreply.github.com b@example.com"), [])

    def test_package_version_is_not_an_email(self):
        self.assertEqual(scan_text('"open-meteo-mcp-server@2.5.2"'), [])

    def test_flags_home_path(self):
        self.assertEqual(kinds(scan_text("open /Users/jane/dev/x")), ["abs_path"])  # privacy-check: ignore

    def test_home_path_inside_a_url_is_not_flagged(self):
        self.assertEqual(scan_text("see https://site.com/home/x and https://example.org/a/Users/b"), [])
        self.assertEqual(kinds(scan_text("file:///Users/jane/x")), ["abs_path"])  # privacy-check: ignore
        self.assertEqual(kinds(scan_text('cd "/home/jane/x"')), ["abs_path"])  # privacy-check: ignore

    def test_decorator_lines_of_a_diff_are_not_emails(self):
        diff = "+@unittest.skipIf(Image is None)\n+    @unittest.skip(\"x\")\n+@contextlib.contextmanager"
        self.assertEqual(scan_text(diff), [])
        self.assertEqual(scan_text(r"x = '\n+@contextlib.contextmanager'"), [])   # an escaped newline in source code
        self.assertEqual(kinds(scan_text("+mail jane.doe@corp.io")), ["email"])  # privacy-check: ignore
        self.assertEqual(kinds(scan_text("+jane@corp.io")), ["email"])  # privacy-check: ignore
        self.assertEqual(kinds(scan_text("a+tag@corp.io")), ["email"])  # privacy-check: ignore

    def test_flags_key_like(self):
        self.assertEqual(kinds(scan_text("SERPAPI_API_KEY=" + "a1b2c3d4" * 6)), ["key"])

    def test_flags_blocklist_case_insensitive(self):
        self.assertEqual(kinds(scan_text("Big News", blocklist=["big news"])), ["blocked"])

    def test_result_shape(self):
        res = scan_text("x\nSee /Users/jane/y")  # privacy-check: ignore
        self.assertEqual(len(res), 1)
        path, line, kind, excerpt = res[0]
        self.assertTrue(path.endswith("sample.txt"))
        self.assertEqual((line, kind), (2, "abs_path"))
        self.assertIn("/Users/jane", excerpt)  # privacy-check: ignore

    def test_ignore_marker_skips_email_path_key_but_never_blocked(self):
        self.assertEqual(scan_text("a@corp.io privacy-check: ignore"), [])
        self.assertEqual(scan_text("/Users/jane/x privacy-check: ignore"), [])
        self.assertEqual(kinds(scan_text("secret word privacy-check: ignore", blocklist=["secret"])), ["blocked"])

    def test_data_dir_exempt_from_blocklist_only(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, "data"))
            os.makedirs(os.path.join(root, "scripts"))
            d, s = os.path.join(root, "data", "x.json"), os.path.join(root, "scripts", "x.py")
            for p, text in ((d, '{"city": "Gotham"}\n'), (s, "Gotham\n")):
                with open(p, "w", encoding="utf-8") as f:
                    f.write(text)
            self.assertEqual(P.scan([d], ["gotham"], root=root), [])
            self.assertEqual(kinds(P.scan([s], ["gotham"], root=root)), ["blocked"])
            with open(d, "w", encoding="utf-8") as f:
                f.write('{"mail": "jane@corp.io", "city": "Gotham"}\n')  # privacy-check: ignore
            self.assertEqual(kinds(P.scan([d], ["gotham"], root=root)), ["email"])

    def test_binary_file_is_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "x.bin")
            with open(path, "wb") as f:
                f.write(b"\x00\x01jane@corp.io")  # privacy-check: ignore
            self.assertEqual(P.scan([path], []), [])


class TestCli(unittest.TestCase):
    def run_cli(self, *args, cwd):
        return subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "privacy_check.py"), *args],
                              capture_output=True, text=True, cwd=cwd)

    def test_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dirty = os.path.join(tmp, "dirty.txt")
            with open(dirty, "w", encoding="utf-8") as f:
                f.write("mail jane@corp.io\n")  # privacy-check: ignore
            clean = os.path.join(tmp, "clean.txt")
            with open(clean, "w", encoding="utf-8") as f:
                f.write("nothing here\n")
            r = self.run_cli(clean, cwd=tmp)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            r = self.run_cli(dirty, cwd=tmp)
            self.assertEqual(r.returncode, 1)
            self.assertIn("email", r.stdout)

    def test_blocklist_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "bl.txt"), "w", encoding="utf-8") as f:
                f.write("Forbidden\n\n")   # blank lines are ignored
            with open(os.path.join(tmp, "a.txt"), "w", encoding="utf-8") as f:
                f.write("a forbidden word\n")
            r = self.run_cli("--blocklist", os.path.join(tmp, "bl.txt"), "a.txt", cwd=tmp)
            self.assertEqual(r.returncode, 1)
            self.assertIn("blocked", r.stdout)

    def test_dash_reads_stdin(self):
        script = os.path.join(ROOT, "scripts", "privacy_check.py")
        with tempfile.TemporaryDirectory() as tmp:
            bl = os.path.join(tmp, "bl.txt")
            with open(bl, "w", encoding="utf-8") as f:
                f.write("Gotham\n")
            msgs = "feat: better strips\n\nTested on my Gotham trip\n"
            r = subprocess.run([sys.executable, script, "--blocklist", bl, "-"], input=msgs, capture_output=True,
                               text=True, cwd=tmp)
            self.assertEqual(r.returncode, 1)
            self.assertIn("<stdin>:3: blocked", r.stdout)
            r = subprocess.run([sys.executable, script, "--blocklist", bl, "-"], input="feat: better strips\n",
                               capture_output=True, text=True, cwd=tmp)
            self.assertEqual(r.returncode, 0, r.stdout)

    def test_history_finds_what_was_committed_then_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*a):
                subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", *a],
                               cwd=tmp, check=True, capture_output=True)
            git("init", "-q", "-b", "main")
            p = os.path.join(tmp, "f.txt")
            with open(p, "w", encoding="utf-8") as f:
                f.write("mail jane@corp.io\n")  # privacy-check: ignore
            git("add", "f.txt")
            git("commit", "-q", "-m", "add")
            with open(p, "w", encoding="utf-8") as f:
                f.write("clean\n")
            git("commit", "-q", "-am", "clean")
            self.assertEqual(self.run_cli(cwd=tmp).returncode, 0)
            r = self.run_cli("--history", cwd=tmp)
            self.assertEqual(r.returncode, 1)
            self.assertIn("email", r.stdout)

    def test_history_exempts_data_files_from_the_blocklist_like_the_tree_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*a):
                subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", *a],
                               cwd=tmp, check=True, capture_output=True)

            def findings():   # scan_history only: the tree scan resolves data/ against this repo, not the temporary one
                code = ("import sys; sys.path.insert(0, %r); import privacy_check as p; "
                        "print(len(p.scan_history(['Gotham'])))" % os.path.join(ROOT, "scripts"))
                return int(subprocess.run([sys.executable, "-c", code], cwd=tmp, capture_output=True, text=True,
                                          check=True).stdout)
            git("init", "-q", "-b", "main")
            os.makedirs(os.path.join(tmp, "data"))
            with open(os.path.join(tmp, "data", "airports.json"), "w", encoding="utf-8") as f:
                f.write('{"GTH": {"city": "Gotham"}}\n')
            git("add", "data")
            git("commit", "-q", "-m", "reference data")
            self.assertEqual(findings(), 0)
            with open(os.path.join(tmp, "notes.txt"), "w", encoding="utf-8") as f:
                f.write("Gotham\n")
            git("add", "notes.txt")
            git("commit", "-q", "-m", "notes")
            self.assertEqual(findings(), 1)


if __name__ == "__main__":
    unittest.main()
