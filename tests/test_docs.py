"""The documentation exists, is readable, and does not drift from the files it describes."""
import glob
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def doc_files():
    return ["README.md", "CONTRIBUTING.md"] + sorted(os.path.relpath(p, ROOT) for p in glob.glob(os.path.join(ROOT, "docs", "*.md")))


def headings(text):
    return [m.group(2).strip() for m in re.finditer(r"^(#{1,6})\s+(.+)$", text, re.M)]


class DocsTests(unittest.TestCase):
    def test_docs_exist(self):
        for rel in ("README.md", "CONTRIBUTING.md", "LICENSE", "docs/tools.md", "docs/architecture.md", "docs/screenshot.png"):
            self.assertTrue(os.path.isfile(os.path.join(ROOT, rel)), rel)

    def test_readme_links_resolve(self):
        link = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
        checked = 0
        for rel in doc_files():
            base = os.path.dirname(os.path.join(ROOT, rel))
            for target in link.findall(read(rel)):
                if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                    continue
                path = target.split("#")[0]
                self.assertTrue(os.path.exists(os.path.normpath(os.path.join(base, path))), f"{rel}: broken link {target}")
                checked += 1
        self.assertGreater(checked, 5)

    def test_readme_sections(self):
        h = headings(read("README.md"))
        for want in ("Requirements", "Install", "First launch", "Try the example", "FAQ", "Known limitations", "Privacy"):
            self.assertTrue(any(want.lower() in x.lower() for x in h), f"README heading missing: {want}")

    def test_readme_order(self):
        h = [x.lower() for x in headings(read("README.md"))]

        def pos(word):
            return next(i for i, x in enumerate(h) if word in x)
        order = [pos(w) for w in ("requirements", "install", "first launch", "plan me a trip", "try the example", "services", "faq")]
        self.assertEqual(order, sorted(order))

    def test_readme_key_content(self):
        t = read("README.md")
        for needle in ("Plan me a trip", "https://code.claude.com/docs/en/setup", "git clone", "claude", "WSL",
                       "scripts/build.py --trip examples/sample-trip", "scripts/server.py --trip examples/sample-trip",
                       "http://127.0.0.1:8793/", "/update", "/contribute", "setup/services.json",
                       "docs/screenshot.png", "photo-credits.json", "docs/tools.md"):
            self.assertIn(needle, t, needle)

    def test_try_example_says_where_to_type(self):
        t = read("README.md")
        part = t[t.index("## Try the example"):t.index("## Services and costs")]
        self.assertIn("Show me the example", part)
        self.assertIn("second terminal window", part)
        self.assertIn("Ctrl+C", part)
        self.assertIn("a few minutes", part)
        self.assertIn("Command Line Tools", t)
        self.assertIn("verified on 2026-11-07", t)
        self.assertIn("Show me the example", read("CLAUDE.md"))

    def test_readme_first_screen_and_requirements(self):
        t = read("README.md")
        part = t[t.index("## Install"):t.index("## Plan me a trip")]
        self.assertIn("trust", part)            # the folder trust prompt
        self.assertIn("MCP servers", part)      # and the project servers, if asked
        self.assertIn("waits for you to write first", part)
        self.assertIn("claude --continue", part)  # restart after an install
        self.assertIn("Python 3.9", t)
        self.assertIn("Homebrew is not needed", t)
        self.assertNotIn("3.10", t + read("CONTRIBUTING.md"))
        self.assertIn("Google Fonts", t)        # the one outside request of the page, said plainly

    def test_trip_format_documents_slug_keys(self):
        t = read("docs", "trip-format.md")
        self.assertIn("^[a-z0-9][a-z0-9-]{0,39}$", t)
        self.assertIn("sao-paulo", t)

    def test_tools_keeps_keys_out_of_shell_history(self):
        t = read("docs", "tools.md")
        self.assertNotIn("printf", t)
        self.assertIn("enableAllProjectMcpServers", t)

    def test_readme_limitations(self):
        t = read("README.md").lower()
        for needle in ("children", "not tested", "video", "never books", "pays"):
            self.assertIn(needle, t, needle)

    def test_license_mit(self):
        t = read("LICENSE")
        self.assertIn("MIT License", t)
        self.assertIn("Copyright (c) 2026 lsidore", t)
        self.assertIn("Permission is hereby granted, free of charge", t)

    def test_screenshot(self):
        p = os.path.join(ROOT, "docs", "screenshot.png")
        self.assertLessEqual(os.path.getsize(p), 400 * 1024)
        with open(p, "rb") as f:
            self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")

    def test_first_launch_tests_chrome_and_asks_few_questions(self):
        claude = read("CLAUDE.md")
        first = claude[claude.index("## First launch"):claude.index("## Trips")]
        for needle in ("enable__mcp__claude-in-chrome", "tabs_context_mcp", "https://www.wikipedia.org/",
                       "Browser extension is not connected", "Reconnect extension", "None for now",
                       "claude.ai/customize/connectors", "tool_hint"):
            self.assertIn(needle, first)

    def test_tools_cover_services_and_servers(self):
        t = read("docs", "tools.md")
        services = json.loads(read("setup", "services.json"))["services"]
        for s in services:
            self.assertIn(s["name"], t, s["id"])
        for name in json.loads(read(".mcp.json"))["mcpServers"]:
            self.assertIn(f"`{name}`", t, name)
        for needle in ("add-key", "claude.ai/customize/connectors", "setup/services.json"):
            self.assertIn(needle, t)

    def test_architecture(self):
        t = read("docs", "architecture.md")
        for needle in ("/api/etat", "GET", "PUT", "page/i18n", "scripts/i18n.py", "check_research.py", "build.py", "state.json",
                       "etape", "logement", "sortie", "pour_decider", "dernier_public", "_home", "_example", "gala"):
            self.assertIn(needle, t, needle)

    def test_contributing(self):
        t = read("CONTRIBUTING.md")
        for needle in ("python3 -m unittest discover tests", "node --test tests/js/*.test.js", "privacy_check.py", "/contribute", "English"):
            self.assertIn(needle, t, needle)

    def test_no_private_paths_or_destination(self):
        for rel in doc_files():
            t = read(rel)
            self.assertNotRegex(t, r"/Users/|/home/[a-z]", rel)
            self.assertNotRegex(t, r"(?i)thai", rel)


if __name__ == "__main__":
    unittest.main()
