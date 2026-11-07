"""One list of the lodgings of a stage, from every <trip>/research/logements-<stage>*.json file.

Groups: "airbnb" (Airbnb listings), "pépite" (file ending in -pepites), "hôtel" (hotels, resorts, villas outside Airbnb).
Lodgings listed in research/logements-exclus.json ({slug: reason}) are dropped (removed after a photo review).
Duplicates (same Airbnb listing or same name): the first record found wins (zone files first, then the base file).
A lodging with a deep fiche (research/resorts-fiches-*.json, joined by id or slug) gets it as `_fiche`, and the
fiche's verified price replaces the older one. Every function takes the loaded `Trip` (scripts/tripctx.py).
"""
import glob
import json
import os
import re
import unicodedata


def slugify(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48]


def slug_of(o, stage):
    s = slugify(o.get("id") or o.get("nom"))
    return s if s.startswith(stage) else f"{stage}-{s}"


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []  # missing file, or one a researcher is still writing
    if isinstance(d, dict):
        d = d.get("options") or d.get("logements") or []
    return [o for o in d if isinstance(o, dict) and (o.get("id") or o.get("nom"))]


def files(trip, stage):
    base = os.path.join(trip.research, f"logements-{stage}.json")
    others = sorted(glob.glob(os.path.join(trip.research, f"logements-{stage}-*.json")))
    # order: Airbnb listings, zone passes, hidden gems, then the very first list
    rank = lambda p: (0 if p.endswith("-airbnb.json") else 2 if p.endswith("-pepites.json") else 1, p)
    return sorted(others, key=rank) + ([base] if os.path.exists(base) else [])


def exclus(trip):
    """Slugs removed after a photo review (research/logements-exclus.json: slug -> reason)."""
    try:
        with open(os.path.join(trip.research, "logements-exclus.json"), encoding="utf-8") as f:
            return {k for k in json.load(f) if not k.startswith("_")}
    except (OSError, ValueError):
        return set()


def fiches(trip):
    """Deep fiches (research/resorts-fiches-*.json: services, extras, reviews, real cost), by id."""
    out = {}
    for path in sorted(glob.glob(os.path.join(trip.research, "resorts-fiches-*.json"))):
        for f in _load(path):
            if f.get("id"):
                out[str(f["id"])] = f
    return out


def unites(trip):
    """On-site spending as units (research/couts-unites.json: id -> item -> [{n, u, lib, src}]).

    n × u = subtotal; src: "carte" (price read on the menu), "estimé" (price not published) or "inclus"."""
    try:
        with open(os.path.join(trip.research, "couts-unites.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def checked_units(f, U, home=""):
    """Unit lines of the fiche, item by item, only where they add up to the item's total in `cout_reel`."""
    c = f.get("cout_reel") if isinstance(f.get("cout_reel"), dict) else {}
    out = {}
    for k, lines in (U.get(str(f.get("id"))) or {}).items():
        if k.startswith("_"):
            continue
        tot = c.get(k) if isinstance(c.get(k), (int, float)) else 0
        s = sum(x.get("n", 0) * x.get("u", 0) for x in lines if isinstance(x, dict))
        if abs(s - tot) <= 1.5:
            out[k] = lines
        else:
            print(f"  ! {f.get('id')} {k}: units add up to {s:g} {home}, total is {tot} {home} (lines ignored)")
    return out


def with_fiche(o, f, U=None, nights=1, home=""):
    """Copy of the lodging with its fiche (`_fiche`); the fiche's verified price replaces the older one."""
    if U:
        f = dict(f, _u=checked_units(f, U, home))
    o = dict(o, _fiche=f)
    p = f.get("prix") if isinstance(f.get("prix"), dict) else {}
    if isinstance(p.get("total_home"), (int, float)) and p["total_home"] > 0:
        o["prix_total_home"] = p["total_home"]
        o["prix_nuit_home"] = p.get("nuit_home") or round(p["total_home"] / int(o.get("nuits") or nights or 1))
        for k in ("annulation", "plateforme"):
            if p.get(k):
                o[k] = p[k]
    if f.get("chambre_conseillee"):
        o["chambre"] = f["chambre_conseillee"]
    return o


def sources(trip, stage_key):
    """[(group, file, lodging), …] without duplicates or excluded lodgings; the deep fiche is joined when it exists."""
    stage = next(s for s in trip.stages if s["key"] == stage_key)
    out, seen, skip, fi, U = [], set(), exclus(trip), fiches(trip), unites(trip)
    for path in files(trip, stage_key):
        name = os.path.basename(path)
        for o in _load(path):
            url = str(o.get("url", ""))
            m = re.search(r"airbnb\.[a-z.]+/rooms/(\d+)", url)
            key = ("airbnb", m.group(1)) if m else ("nom", slugify(re.split(r" – | - |\(", str(o.get("nom", "")))[0]))
            if key in seen or slug_of(o, stage_key) in skip:
                continue
            seen.add(key)
            group = "pépite" if name.endswith("-pepites.json") else ("airbnb" if m else "hôtel")
            f = fi.get(str(o.get("id"))) or fi.get(slug_of(o, stage_key))
            out.append((group, name, with_fiche(o, f, U, stage["nights"], trip.home_currency) if f else o))
    return out
