"""The start skill and its screens: widget code the Claude desktop app can render, forms the host can wire, sample
data that matches the example trip, and instructions that point to all of it."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, ".claude", "skills", "start")
FORMS = ("setup", "brief")
DATA_SCREENS = ("hub", "options", "itineraries", "budget")
ALLOWED_HOSTS = {"cdnjs.cloudflare.com", "esm.sh", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"}
HEADER_ICON = "M11.586 2a1.5 1.5 0 0 1 1.06.44l2.914 2.914a1.5 1.5 0 0 1 .44 1.06V16.5"
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿️]")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def screen(name):
    return read(SKILL_DIR, "screens", name + ".html")


def data_of(name):
    lines = [l for l in screen(name).splitlines() if l.startswith("const DATA = ")]
    assert len(lines) == 1, name
    return json.loads(lines[0][len("const DATA = "):].rstrip().rstrip(";"))


def section(text, title):
    start = text.index(title)
    nxt = text.find("\n## ", start + len(title))
    return text[start:nxt if nxt != -1 else len(text)]


class ScreenFilesTests(unittest.TestCase):
    def test_skill_lists_every_screen_and_every_mode(self):
        skill = read(SKILL_DIR, "SKILL.md")
        self.assertRegex(skill, r"(?m)^name: start$")
        self.assertRegex(skill, r"(?m)^description: .*screen")
        for name in FORMS + DATA_SCREENS:
            self.assertTrue(os.path.isfile(os.path.join(SKILL_DIR, "screens", name + ".html")), name)
            self.assertIn(f"`{name}.html`", skill, name)
        for needle in ("mcp__visualize__show_widget", "mcp__visualize__read_me", '"elicitation"', "AskUserQuestion",
                       "const DATA =", "Rules 7", "SETUP_NEEDED", "photo strips"):
            self.assertIn(needle, skill)

    def test_widget_rules(self):
        for name in FORMS + DATA_SCREENS:
            t = screen(name)
            low = t.lower()
            for bad in ("<html", "<head", "<body", "<!doctype", "<!--", "/*", "position:fixed", "position: fixed",
                        "font-weight:600", "font-weight: 600", "font-weight:700", "font-weight: 700", "bold",
                        "requestfullscreen", "localstorage", "innerhtml", "<img", "<iframe", "@import"):
                self.assertNotIn(bad, low, f"{name}: {bad}")
            self.assertIsNone(EMOJI.search(t), name)
            for url in re.findall(r"""(?:src=|href=|url\()["']?(https?://[^"')\s>]+)""", t):
                self.assertIn(url.split("/")[2], ALLOWED_HOSTS, f"{name}: {url}")
            for tag in re.findall(r"<button\b[^>]*>", t):
                self.assertIn('type="button"', tag, f"{name}: {tag[:60]}")

    def test_forms_are_script_free_and_wired(self):
        for name in FORMS:
            t = screen(name)
            self.assertTrue(t.startswith('<form class="elicit">'), name)
            self.assertIn(HEADER_ICON, t, name)
            for cls in ("elicit-header", "elicit-body", "elicit-footer", "elicit-skip", "elicit-submit"):
                self.assertIn(cls, t, f"{name}: {cls}")
            self.assertNotIn("<script", t, name)
            self.assertNotIn("onclick", t.lower(), name)
            for pill in re.findall(r'<button[^>]*class="elicit-pill"[^>]*>', t):
                self.assertRegex(pill, r'data-value="[^"]+"', f"{name}: {pill[:80]}")
            names = re.findall(r'data-name="([^"]+)"', t)
            self.assertEqual(len(names), len(set(names)), f"{name}: duplicate data-name")
            for group in re.findall(r'<div class="elicit-pills"[^>]*>', t):
                self.assertRegex(group, r'data-name="[a-z_]+"', name)
                self.assertRegex(group, r'data-multi="(true|false)"', name)
            for group in t.split('<div class="elicit-group">')[1:]:
                if "data-other" in group:
                    owner = re.search(r'<div class="elicit-pills" data-name="([^"]+)"[^>]*>(?:(?!</div>).)*data-other', group, re.S)
                    self.assertIsNotNone(owner, name)
                    self.assertIn(f'class="elicit-other" data-for="{owner.group(1)}"', group, name)

    def test_setup_form_offers_every_keyed_service(self):
        services = json.loads(read(ROOT, "setup", "services.json"))["services"]
        t = screen("setup")
        self.assertIn('data-value="None for now"', t)
        self.assertIn('data-value="Not now"', t)
        for s in services:
            if s["group"] == "keyed":
                self.assertIn(f'data-value="{s["id"]}"', t, s["id"])
            if s["group"] == "connector" and s["id"] in ("booking", "expedia", "getyourguide", "tripadvisor", "accuweather"):
                self.assertIn(f'data-value="{s["id"]}"', t, s["id"])

    def test_data_screens_have_the_fields_the_skill_documents(self):
        need = {
            "hub": ("labels", "cards"),
            "options": ("multi", "prompt", "more", "labels", "options"),
            "itineraries": ("prompt", "labels", "options"),
            "budget": ("currency", "locale", "cap", "labels", "lines", "note", "tunePrompt", "actions"),
        }
        skill = read(SKILL_DIR, "SKILL.md")
        for name, keys in need.items():
            d = data_of(name)
            for k in keys:
                self.assertIn(k, d, f"{name}: {k}")
                self.assertTrue(f"`{k}`" in skill or f"`{k}[]`" in skill, f"SKILL.md does not document {name}.{k}")
        self.assertLessEqual(sum(1 for c in data_of("hub")["cards"] if c["status"] == "next"), 1)
        self.assertLessEqual(sum(1 for o in data_of("options")["options"] if o.get("recommended")), 1)

    def test_sample_data_matches_the_example_trip(self):
        trip = json.loads(read(ROOT, "examples", "sample-trip", "trip.json"))
        b = data_of("budget")
        self.assertEqual(b["cap"], trip["budget_cap"])
        self.assertEqual(b["currency"], trip["currency"]["home"])
        self.assertEqual(sum(l["amount"] for l in b["lines"]), 6129)   # examples/sample-trip/budget.md
        stays = {x["nom"]: x for x in json.loads(read(ROOT, "examples", "sample-trip", "research", "logements-comporta.json"))}
        for o in data_of("options")["options"]:
            self.assertIn(o["title"], stays)
            self.assertEqual(o["price"], "${:,}".format(stays[o["title"]]["prix_total_home"]))
            self.assertEqual(o["link"], stays[o["title"]]["url"])
        titles = {s["title"] for s in trip["stages"]}
        nights = {o["title"]: sum(s["nights"] for s in o["stages"]) for o in data_of("itineraries")["options"]}
        self.assertTrue(all(n == 9 for n in nights.values()), nights)
        self.assertTrue({s["title"] for o in data_of("itineraries")["options"] for s in o["stages"]} <= titles)


class ScreenWiringTests(unittest.TestCase):
    def test_claude_md_loads_the_skill_first(self):
        claude = read(ROOT, "CLAUDE.md")
        self.assertIn("`start` skill", section(claude, "## At the start of every session"))
        self.assertIn("`start` skill's brief screen", section(claude, "## The flow"))
        self.assertIn("`start` skill's setup screen", section(claude, "## First launch"))
        self.assertIn("| `/start` |", claude)

    def test_hook_points_to_the_skill(self):
        setup = read(ROOT, "scripts", "setup.py")
        self.assertIn("with the start skill", setup)
        self.assertIn("Load the start skill.", setup)

    def test_widget_tools_need_no_prompt(self):
        allow = json.loads(read(ROOT, ".claude", "settings.json"))["permissions"]["allow"]
        for tool in ("mcp__visualize__read_me", "mcp__visualize__show_widget"):
            self.assertIn(tool, allow)

    def test_readme_explains_clicking(self):
        readme = read(ROOT, "README.md")
        self.assertIn("/start", readme)
        self.assertIn("Claude desktop app", readme)


if __name__ == "__main__":
    unittest.main()
