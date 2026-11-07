"""Claude's instructions: CLAUDE.md, .claude/agents/, .claude/commands/, the destination-guide skill and
docs/research-format.md (what the agents write)."""
import glob
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_MD = os.path.join(ROOT, "CLAUDE.md")
AGENTS_DIR = os.path.join(ROOT, ".claude", "agents")
COMMANDS_DIR = os.path.join(ROOT, ".claude", "commands")
SKILL = os.path.join(ROOT, ".claude", "skills", "destination-guide", "SKILL.md")
RESEARCH_DOC = os.path.join(ROOT, "docs", "research-format.md")

AGENTS = ("stay-finder", "flight-hunter", "activity-scout", "food-scout", "events-hunter", "logistics-planner",
          "itinerary-architect", "budget-keeper", "fact-checker")
COMMANDS = ("setup", "trip", "stays", "flights", "scout", "events", "itinerary", "day", "budget", "weather",
            "checklist", "share", "sync-calendar", "contribute", "update")
SECTIONS = ("First launch", "Trips", "The flow", "Files", "Rules", "Tool routing", "Usage budget",
            "Improving the tool", "Contributing back", "Updating", "Language")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def frontmatter(path):
    """{key: value} of the YAML frontmatter (simple `key: value` lines between two `---` lines); {} when absent."""
    text = read(path)
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and not line.startswith(" "):
            out[k.strip()] = v.strip().strip('"')
    return out


def instruction_files():
    """CLAUDE.md and every Markdown file under .claude/."""
    return [CLAUDE_MD] + sorted(glob.glob(os.path.join(ROOT, ".claude", "**", "*.md"), recursive=True))


def allow_rules():
    with open(os.path.join(ROOT, ".claude", "settings.json"), encoding="utf-8") as f:
        perms = json.load(f)["permissions"]
    return [r[len("Bash("):-1] for r in perms.get("allow", []) if r.startswith("Bash(") and r.endswith(")")]


def allowed(cmd, rules):
    """Claude Code's Bash rule syntax used in settings.json: `X *` = X alone or X followed by arguments, `X` = exactly X."""
    for r in rules:
        if r.endswith(" *"):
            if cmd == r[:-2] or cmd.startswith(r[:-1]):
                return True
        elif cmd == r:
            return True
    return False


SAMPLE = {"<server>": "airbnb", "<tool>": "airbnb_search"}   # placeholders filled with a typical value


def script_commands():
    """Every `python3 [-I] scripts/<name>.py ...` command written in backticks in CLAUDE.md and .claude/, its
    `<placeholders>` filled (SAMPLE, else "x"); a pipe, `;`, `&` or a heredoc ends the command."""
    out = set()
    rx = re.compile(r"python3 (?:-I )?scripts/[A-Za-z0-9_]+\.py(?: (?:[^|;&<>]|<(?!<)[^<>\n]*>)*)?")
    for path in instruction_files():
        for code in re.findall(r"`([^`\n]+)`", read(path)):
            for m in rx.finditer(code):
                cmd = re.sub(r"<[^<>]*>", lambda p: SAMPLE.get(p.group(0), "x"), m.group(0)).strip()
                out.add((os.path.relpath(path, ROOT), cmd))
    return sorted(out)


class ClaudeConfigTests(unittest.TestCase):
    def test_every_command_exists(self):
        for name in COMMANDS:
            self.assertTrue(os.path.isfile(os.path.join(COMMANDS_DIR, name + ".md")), name)

    def test_commands_have_description(self):
        files = sorted(glob.glob(os.path.join(COMMANDS_DIR, "*.md")))
        self.assertTrue(files)
        for path in files:
            self.assertTrue(frontmatter(path).get("description"), os.path.basename(path))

    def test_agents_have_name_and_description(self):
        for name in AGENTS:
            path = os.path.join(AGENTS_DIR, name + ".md")
            self.assertTrue(os.path.isfile(path), name)
            fm = frontmatter(path)
            self.assertEqual(fm.get("name"), name)
            self.assertTrue(fm.get("description"), name)

    def test_agents_read_the_trip_folder_and_the_research_format(self):
        for name in AGENTS:
            text = read(os.path.join(AGENTS_DIR, name + ".md"))
            self.assertIn("trips/<slug>/", text, name)
            self.assertIn("docs/research-format.md", text, name)

    def test_claude_md_mentions_every_command(self):
        text = read(CLAUDE_MD)
        for name in COMMANDS:
            self.assertRegex(text, r"(?<![\w/-])/" + re.escape(name) + r"(?![\w-])", name)

    def test_claude_md_sections(self):
        headings = re.findall(r"^#{1,3} +(.+?)\s*$", read(CLAUDE_MD), re.M)
        for s in SECTIONS:
            self.assertTrue(any(h.startswith(s) for h in headings), f"missing section {s!r} in {headings}")

    def test_instructions_in_english(self):
        for path in instruction_files():
            for i, line in enumerate(read(path).splitlines(), 1):
                self.assertIsNone(re.search(r"[éèêàùçôœ]", line, re.I), f"{os.path.relpath(path, ROOT)}:{i}: {line}")

    def test_referenced_scripts_exist(self):
        for path in instruction_files() + [RESEARCH_DOC]:
            for name in set(re.findall(r"scripts/([A-Za-z0-9_]+\.(?:py|sh|swift))", read(path))):
                self.assertTrue(os.path.isfile(os.path.join(ROOT, "scripts", name)),
                                f"{os.path.relpath(path, ROOT)} names scripts/{name}, which does not exist")

    def test_referenced_docs_exist(self):
        for path in instruction_files():
            for name in set(re.findall(r"\bdocs/([A-Za-z0-9_.-]+\.md)", read(path))):
                self.assertTrue(os.path.isfile(os.path.join(ROOT, "docs", name)),
                                f"{os.path.relpath(path, ROOT)} names docs/{name}, which does not exist")

    def test_no_audience_or_destination_assumption(self):
        for path in instruction_files():
            text = read(path)
            self.assertIsNone(re.search(r"(?i)\b(romantic|couples?|honeymoon|girlfriend|boyfriend)\b", text),
                              os.path.relpath(path, ROOT))

    def test_claude_md_states_the_core_rules(self):
        text = read(CLAUDE_MD)
        for needle in ("SETUP_NEEDED", ".setup/state.json", "trips/.current", "CAPTCHA", "blocked",
                       "free cancellation", "all-inclusive", "explicit", "0.50", "trip-page", "photo_strip.py",
                       "check_research.py", "build.py", "tripctx.py", "destination-guide", "docs/research-format.md",
                       "python3 -m unittest discover tests", "node --test tests/js/*.test.js",
                       "page/i18n/en.js", "scripts/i18n.py"):
            self.assertIn(needle, text, needle)

    def test_first_launch_never_loops(self):
        text = read(CLAUDE_MD)
        part = text[text.index("## First launch"):text.index("## Trips")]
        for needle in ("Python 3.9+", "Homebrew only when it is already there", "claude --continue", "new terminal window",
                       "after one retry", "stop looping", "only Pillow is missing", "except the photos",
                       "in the background", "open -e .env"):
            self.assertIn(needle, part, needle)
        self.assertNotIn("until it passes", part)
        self.assertIn("ASCII slugs", text)
        flow = text[text.index("## The flow"):text.index("## Showing options")]
        self.assertIn("in the background", flow)   # --photos and --download-flights take minutes

    def test_every_script_command_is_allowed_except_add_key(self):
        rules = allow_rules()
        cmds = script_commands()
        self.assertGreater(len(cmds), 20)
        for where, cmd in cmds:
            if " add-key" in cmd:
                self.assertFalse(allowed(cmd, rules), f"add-key must keep asking: {cmd}")
                continue
            self.assertTrue(allowed(cmd, rules), f"{where}: `{cmd}` is not covered by .claude/settings.json allow")

    def test_paid_and_key_actions_are_not_allowed(self):
        rules = allow_rules()
        for cmd in ("python3 -I scripts/setup.py add-key serpapi", "python3 scripts/setup.py add-key apify",
                    "python3 -I scripts/mcp.py call apify call-actor {}", "python3 scripts/mcp.py call civitatis add-to-cart {}"):
            self.assertFalse(allowed(cmd, rules), cmd)

    def test_unittest_allowed_only_on_the_tests_folder(self):
        # `python3 -m unittest <anything>` plus Edit(trips/**) would run any Python written under trips/ unprompted
        rules = [r for r in allow_rules() if "unittest" in r]
        self.assertEqual(sorted(rules), ["python3 -m unittest discover -s tests", "python3 -m unittest discover tests"])
        for cmd in ("python3 -m unittest discover -s trips/x", "python3 -m unittest discover tests -t trips",
                    "python3 -m unittest trips.x.evil", "python3 -m unittest tests.test_setup trips.x.evil"):
            self.assertFalse(allowed(cmd, allow_rules()), cmd)

    def test_env_file_is_never_read(self):
        with open(os.path.join(ROOT, ".claude", "settings.json"), encoding="utf-8") as f:
            deny = json.load(f)["permissions"]["deny"]
        for rule in ("Read(./.env)", "Read(./.env.*)", "mcp__kiwi__feedback-to-devs"):
            self.assertIn(rule, deny)
        # .env.example falls under Read(./.env.*): no instruction may ask Claude to read it
        for path in instruction_files():
            for line in read(path).splitlines():
                if ".env.example" in line:
                    self.assertNotRegex(line, r"(?i)\b(read|open|cat|look at)\b[^.]*\.env\.example", line)

    def test_no_robots_override_by_default(self):
        for path in instruction_files():
            for line in read(path).splitlines():
                if "ignoreRobotsText" in line:
                    self.assertRegex(line, r"(?i)ask|answer|profile\.md|person|yes", f"{os.path.relpath(path, ROOT)}: {line}")

    def test_launch_configuration_named_in_claude_md_exists(self):
        with open(os.path.join(ROOT, ".claude", "launch.json"), encoding="utf-8") as f:
            names = [c["name"] for c in json.load(f)["configurations"]]
        self.assertIn("trip-page", names)

    def test_contribute_checks_before_any_pull_request(self):
        text = read(os.path.join(COMMANDS_DIR, "contribute.md"))
        for needle in ("gh auth status", "privacy_check.py", "lsidore/trip-planner", "yes",
                       "git log --format=%B upstream/main..HEAD", "git checkout <their branch> -- <files>"):
            self.assertIn(needle, text, needle)
        # local commit messages may name the trip: the public branch gets fresh commits only
        self.assertNotIn("cherry-pick", text)
        self.assertLess(text.index("--format=%B"), text.index("Send this to the public repository?"))
        # the author identity is shown, and a private address suggested, before the first public commit and the yes
        for needle in ("git config user.name", "git config user.email", "users.noreply.github.com", "gh api user",
                       "git rm", "%ae"):
            self.assertIn(needle, text, needle)
        self.assertLess(text.index("git config user.email"), text.index("git switch -c contrib/"))
        self.assertLess(text.index("%ae"), text.index("Send this to the public repository?"))

    def test_forecast_horizon_and_calendar_note(self):
        for name in ("day", "weather"):
            self.assertIn("16 days", read(os.path.join(COMMANDS_DIR, name + ".md")), name)
        cal = read(os.path.join(COMMANDS_DIR, "sync-calendar.md"))
        self.assertIn("checklist.md", cal)
        self.assertNotIn("bookings.md` the date", cal)

    def test_update_pulls_upstream_and_runs_the_tests(self):
        text = read(os.path.join(COMMANDS_DIR, "update.md"))
        for needle in ("upstream", "https://github.com/lsidore/trip-planner.git", "git pull upstream main",
                       "python3 -m unittest discover tests", "node --test tests/js/*.test.js"):
            self.assertIn(needle, text, needle)

    def test_destination_guide_skill(self):
        self.assertTrue(os.path.isfile(SKILL))
        fm = frontmatter(SKILL)
        self.assertEqual(fm.get("name"), "destination-guide")
        self.assertTrue(fm.get("description"))
        text = read(SKILL)
        self.assertIn("trips/<slug>/guide.md", text)
        for topic in ("Seasons", "Zones", "Getting around", "Traps", "Etiquette", "Heuristics", "Entry"):
            self.assertIn(topic, text, topic)


class ResearchFormatDocTests(unittest.TestCase):
    FILES = ("logements-<stage>.json", "resorts-fiches-", "couts-unites.json", "acces-logements.json",
             "sorties-<stage>.json", "lieux-<stage>-restos.json", "lieux-<stage>-activites.json", "lieux-agenda.json",
             "trajets.json", "formalites.json", "taux.json", "vols-brut/", "vols-comparateurs.json",
             "sources-photos.json", "photo-guides.json", "logements-exclus.json")

    def test_doc_names_every_research_file(self):
        text = read(RESEARCH_DOC)
        for name in self.FILES:
            self.assertIn(name, text, name)

    def test_doc_names_every_sample_file(self):
        text = read(RESEARCH_DOC)
        sample = os.path.join(ROOT, "examples", "sample-trip", "research")
        stages = ("lisbon", "comporta", "porto")
        for path in sorted(glob.glob(os.path.join(sample, "*.json"))):
            name = os.path.basename(path)
            for st in stages:
                name = name.replace(f"-{st}-", "-<stage>-").replace(f"-{st}.", "-<stage>.")
            if name.startswith("resorts-fiches-"):
                name = "resorts-fiches-"
            self.assertIn(name, text, name)

    def test_doc_explains_home_suffix_ids_and_validation(self):
        text = read(RESEARCH_DOC)
        for needle in ("_home", "<stage>-<nn>", "python3 scripts/check_research.py --trip", "_example",
                       "examples/sample-trip/research"):
            self.assertIn(needle, text, needle)


if __name__ == "__main__":
    unittest.main()
