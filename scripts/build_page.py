#!/usr/bin/env python3
"""Builds the trip's page (<trip>/site/index.html): one step per screen, the budget always visible, the final plan.

Sources (page/): template.html (the skeleton), app.css then css/*.css (styles: the shell, then one file per screen,
alphabetical order), then the scripts in this order:
  js/i18n.js, i18n/en.js, i18n/<language>.js (when the trip's language is not English and the file exists),
  js/logic/config.js, the other js/logic/*.js (alphabetical), js/ui/store.js, js/ui/shell.js, the other js/ui/*.js.
Each script goes in its own <script> tag: an error in one screen does not stop the others. The screens register in
ECRANS[<type>] (see shell.js). The template's %%TITLE%%, %%LANG%% and %%SLUG%% come from the trip's trip.json.
The page then loads site/media/parcours.json and each parcours-<stage>.json (scripts/page_data.py).

Usage: python3 -I scripts/build_page.py [--trip DIR]     (default: the active trip, see tripctx.active_trip_dir)
"""
import argparse
import glob
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripctx  # noqa: E402

SRC = os.path.join(ROOT, "page")
PREMIERS_UI = ("store.js", "shell.js")


def lire(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def fichiers_css(src=SRC):
    """app.css (tokens and shell), then css/*.css in alphabetical order."""
    return [os.path.join(src, "app.css")] + sorted(glob.glob(os.path.join(src, "css", "*.css")))


def fichiers_js(src=SRC, langue="en"):
    """Translations, configuration, logic, then store.js, shell.js and the other screens (see the module docstring)."""
    debut = [os.path.join(src, "js", "i18n.js"), os.path.join(src, "i18n", "en.js")]
    for p in debut:
        if not os.path.exists(p):
            raise SystemExit(f"Missing file: {os.path.relpath(p, ROOT)}")
    if langue and langue != "en" and re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z]{2,4})?", langue):
        dico = os.path.join(src, "i18n", f"{langue}.js")
        if os.path.exists(dico):
            debut.append(dico)
        else:
            print(f"language '{langue}' not translated yet", file=sys.stderr)
    config = os.path.join(src, "js", "logic", "config.js")
    logique = ([config] if os.path.exists(config) else []) + sorted(
        p for p in glob.glob(os.path.join(src, "js", "logic", "*.js")) if p != config)
    ui_dir = os.path.join(src, "js", "ui")
    premiers = [os.path.join(ui_dir, n) for n in PREMIERS_UI]
    for p in premiers:
        if not os.path.exists(p):
            raise SystemExit(f"Missing file: {os.path.relpath(p, ROOT)}")
    autres = sorted(p for p in glob.glob(os.path.join(ui_dir, "*.js")) if os.path.basename(p) not in PREMIERS_UI)
    return debut + logique + premiers + autres


def balise_script(chemin, src=SRC):
    """A JS file in its tag; "</script" is neutralised so that no text can close the tag."""
    code = re.sub(r"</(script)", r"<\\/\1", lire(chemin), flags=re.I)
    return f"<script>/* {os.path.relpath(chemin, src)} */\n{code}\n</script>"


def ecrans_enregistres(js_paths):
    """Screen types registered (ECRANS["…"] = …) by the screen files, for the summary."""
    cles = []
    for p in js_paths:
        if os.path.basename(p) in PREMIERS_UI or os.sep + "ui" + os.sep not in p:
            continue
        for m in re.finditer(r"""ECRANS\s*\[\s*["']([\w-]+)["']\s*\]\s*=""", lire(p)):
            if m.group(1) not in cles:   # a file's header comment may name its screen too
                cles.append(m.group(1))
    return cles


def _champ(trip, nom, defaut=""):
    v = trip.get(nom) if isinstance(trip, dict) else getattr(trip, nom, None)
    return v if isinstance(v, str) and v else defaut


def construire(src=SRC, trip=None):
    """The whole page (text) and its scripts, from the sources of src, for a trip (tripctx.Trip or a dict with
    title, language, slug)."""
    trip = trip or {}
    langue = _champ(trip, "language", "en")
    css = "\n".join(lire(p) for p in fichiers_css(src)).replace("</style", "<\\/style")
    js_paths = fichiers_js(src, langue)
    js = "\n".join(balise_script(p, src) for p in js_paths)
    gabarit = lire(os.path.join(src, "template.html"))
    for marque in ("%%APPCSS%%", "%%APPJS%%"):
        if marque not in gabarit:
            raise SystemExit(f"Template without {marque}")
    valeurs = {
        "%%TITLE%%": html.escape(_champ(trip, "title", "Trip"), quote=True),
        "%%LANG%%": html.escape(langue, quote=True),
        "%%SLUG%%": html.escape(_champ(trip, "slug", "trip"), quote=True),
    }
    for k, v in valeurs.items():
        gabarit = gabarit.replace(k, v)
    return gabarit.replace("%%APPCSS%%", css).replace("%%APPJS%%", js), js_paths


def main(argv=None):
    ap = argparse.ArgumentParser(description="Builds <trip>/site/index.html, see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    a = ap.parse_args(argv)
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
    except tripctx.TripError as e:
        sys.exit(f"error: {e}")
    page, js_paths = construire(SRC, trip)
    out = os.path.join(trip.site, "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    cles = ecrans_enregistres(js_paths)
    print(f"{os.path.relpath(out)} — {len(js_paths)} scripts, {len(fichiers_css())} style sheets, {os.path.getsize(out) // 1024} KB; "
          f"screens: {', '.join(cles) if cles else 'none'}")


if __name__ == "__main__":
    main()
