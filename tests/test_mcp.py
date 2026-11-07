import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import mcp  # noqa: E402


class McpTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        os.makedirs(os.path.join(self.root, "setup"))
        shutil.copy(os.path.join(ROOT, "setup", "services.json"), os.path.join(self.root, "setup"))
        shutil.copy(os.path.join(ROOT, ".mcp.json"), self.root)

    def env(self, text):
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write(text)

    def test_mcp_check_reads_keyed_servers(self):
        self.env("SERPAPI_API_KEY=abc\n")
        seen = []
        lines = []
        with mock.patch.object(mcp, "tool_names", lambda cfg, root=None: seen.append(cfg) or ["t"]):
            ok, total = mcp.check(root=self.root, out=lines.append)
        text = "\n".join(lines)
        self.assertIn("serpapi", text)
        self.assertEqual(ok, total)
        cfg = next(c for c in seen if c.get("url", "").startswith("https://mcp.serpapi.com"))
        self.assertEqual(cfg["headers"]["Authorization"], "Bearer abc")

    def test_keyed_server_absent_without_key(self):
        self.env("OTHER=1\n")
        self.assertNotIn("serpapi", mcp.servers(self.root))
        self.assertIn("kiwi", mcp.servers(self.root))

    def test_env_file_with_quotes_and_comments(self):
        self.env("# c\nSERPAPI_API_KEY=\"q\"\n\nBAD LINE\n")
        self.assertEqual(mcp.load_env(self.root), {"SERPAPI_API_KEY": "q"})

    def test_check_reports_failure_without_traceback(self):
        def bad(cfg, root=None):
            raise OSError("down")
        lines = []
        with mock.patch.object(mcp, "tool_names", bad):
            ok, total = mcp.check(["kiwi"], root=self.root, out=lines.append)
        self.assertEqual((ok, total), (0, 1))
        self.assertIn("FAIL kiwi", "\n".join(lines))

    def test_check_unknown_server(self):
        lines = []
        ok, total = mcp.check(["nope"], root=self.root, out=lines.append)
        self.assertEqual((ok, total), (0, 1))

    def test_render_substitutes_without_shell_quoting(self):
        out = mcp.render({"h": {"a": "Bearer ${K}"}, "l": ["${K}"]}, {"K": 'a"b'})
        self.assertEqual(out, {"h": {"a": 'Bearer a"b'}, "l": ['a"b']})


if __name__ == "__main__":
    unittest.main()


class SerpTests(unittest.TestCase):
    def test_serp_without_key_exits_cleanly(self):
        import serp
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        import contextlib, io
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = serp.main(["google_maps", "{}"], root=tmp)
        self.assertEqual(code, 1)
        self.assertIn("setup.py add-key serpapi", err.getvalue())


class SerpErrorTests(unittest.TestCase):
    """serp.py never shows a traceback: no network, an HTML error page, bad parameters -> one plain line, exit 1."""

    def setUp(self):
        import serp
        self.serp = serp
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write("SERPAPI_API_KEY=fake-key-for-tests\n")

    def call(self, argv, urlopen):
        import contextlib, io
        from unittest import mock
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch.object(self.serp.urllib.request, "urlopen", urlopen):
            code = self.serp.main(argv, root=self.root)
        self.assertNotIn("Traceback", out.getvalue() + err.getvalue())
        self.assertNotIn("fake-key-for-tests", out.getvalue() + err.getvalue())
        return code, out.getvalue(), err.getvalue()

    def test_no_network(self):
        import urllib.error

        def down(*a, **k):
            raise urllib.error.URLError("nodename nor servname provided")
        code, out, err = self.call(["google_maps", "{}"], down)
        self.assertEqual(code, 1)
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertIn("could not be reached", err)

    def test_timeout(self):
        def slow(*a, **k):
            raise TimeoutError("timed out")
        code, _, err = self.call(["google_maps", "{}"], slow)
        self.assertEqual((code, len(err.strip().splitlines())), (1, 1))

    def test_html_error_page(self):
        import io as _io
        import urllib.error

        def html(*a, **k):
            raise urllib.error.HTTPError("https://serpapi.com/search.json", 502, "Bad Gateway", {},
                                         _io.BytesIO(b"<html>bad gateway</html>"))
        code, out, err = self.call(["google_maps", "{}"], html)
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("HTTP 502", err)
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_json_error_is_printed_as_the_answer(self):
        import io as _io
        import urllib.error

        def refused(*a, **k):
            raise urllib.error.HTTPError("https://serpapi.com/search.json", 401, "Unauthorized", {},
                                         _io.BytesIO(b'{"error": "Invalid API key."}'))
        code, out, _ = self.call(["google_maps", "{}"], refused)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out), {"error": "Invalid API key."})

    def test_bad_parameters(self):
        code, _, err = self.call(["google_maps", "{not json"], lambda *a, **k: self.fail("no call expected"))
        self.assertEqual(code, 1)
        self.assertIn("JSON object", err)
