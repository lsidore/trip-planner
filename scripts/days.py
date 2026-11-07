#!/usr/bin/env python3
"""Day-by-day data of a trip: <trip>/site/media/jours.json (read by scripts/page_data.py).

Inputs (<trip>/research/, all optional):
  lieux-<stage>-restos.json, lieux-<stage>-activites.json   places (food-scout, activity-scout)
  lieux-agenda.json    dated events of the whole trip (events-hunter), field "etape"; entries without lat/lng are "info"
  trajets.json         journeys between stages, {"trajets": [{id, date, de, vers, conseil, options}]}
Output: one object per day from the first stage's `from` to the last stage's `to` (both included):
  {date, etape, lever, coucher, lune, lune_f, evenements, infos, trajets}
  lever / coucher: sunrise / sunset "HH:MM" in the stage's time zone (stage.tz), computed at the stage's `ref` point.
  lune / lune_f: moon phase at local noon (label, fraction 0-1 where 0 = new, 0.5 = full).
Usage (always with -I): python3 -I scripts/days.py [--trip DIR]
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripctx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name, default, research):
    """JSON file of <research>/ or `default` (missing file, or one a researcher is still writing)."""
    p = os.path.join(research, name)
    if not os.path.exists(p):
        return default
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        print(f"  ! {name} unreadable ({e}), ignored")
        return default


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("\u20ac", "").replace(" ", "").replace("\u202f", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def as_list(v):
    if isinstance(v, list):
        return [x for x in v if x not in (None, "")]
    return [v] if v not in (None, "") else []


def url_ok(u):
    return isinstance(u, str) and u.startswith(("https://", "http://"))


# ----------------------------------------------------------------- places
GROUP = {"à voir": "voir", "point de vue": "voir", "plage": "voir", "nature": "voir", "cascade / nature": "voir",
         "à faire": "faire", "marché": "faire", "aventure": "faire",
         "restaurant": "manger", "street food": "manger", "café": "manger",
         "bar": "boire", "rooftop": "boire", "bar / rooftop": "boire", "soirée": "boire",
         "bien-être": "bienetre", "événement": "agenda", "réveillon": "agenda", "info": "agenda"}


def norm_notes(p):
    out = []
    for n in as_list(p.get("notes")):
        if isinstance(n, dict) and num(n.get("note")) is not None:
            out.append({"site": str(n.get("site") or "")[:24], "note": num(n.get("note")),
                        "avis": int(num(n.get("avis")) or 0), "url": n.get("url") if url_ok(n.get("url")) else ""})
    return out


def norm(p, etape):
    """One place in the page's single format (missing fields get neutral values)."""
    cat = str(p.get("categorie") or "à voir").strip().lower()
    lat, lng = num(p.get("lat")), num(p.get("lng"))
    photos = [u for u in as_list(p.get("photo_urls")) + as_list(p.get("photo_url")) if url_ok(u)]
    srcs = []
    for s in as_list(p.get("sources")):
        u = s.get("url") if isinstance(s, dict) else s
        if url_ok(u) and u not in srcs:
            srcs.append(u)
    score = num(p.get("score"))
    return {
        "id": str(p["id"]), "etape": etape, "nom": str(p.get("nom") or p["id"]),
        "categorie": cat, "groupe": GROUP.get(cat, "voir"), "sous_type": p.get("sous_type") or "",
        "lat": lat, "lng": lng, "approx": bool(p.get("approx")),
        "resume": p.get("resume") or "", "pourquoi": p.get("pourquoi") or "",
        "incontournable": bool(p.get("incontournable")), "score": score if score is not None else 3,
        "tags": [str(t).lower() for t in as_list(p.get("tags"))],
        "distinctions": [str(x) for x in as_list(p.get("distinctions"))],
        "notes": norm_notes(p),
        "prix": p.get("prix") or "", "prix_couple_home": num(p.get("prix_couple_home")),
        "duree": p.get("duree") or "", "horaires": p.get("horaires") or "", "meilleur_moment": p.get("meilleur_moment") or "",
        "plats": [str(x) for x in as_list(p.get("plats"))],
        "a_reserver": bool(p.get("a_reserver")), "reserver_quand": p.get("reserver_quand") or "",
        "lien_reservation": p.get("lien_reservation") if url_ok(p.get("lien_reservation")) else "",
        "lien": p.get("lien") if url_ok(p.get("lien")) else "",
        "fetes": p.get("fetes") or "", "dates": [str(d) for d in as_list(p.get("dates"))],
        "acces": p.get("acces") or "", "sources": srcs[:6], "_photos": photos[:12],
    }


# ----------------------------------------------------------------- sun and moon
def utc_offset_hours(d, tz):
    """UTC offset of time zone `tz` at local noon of date `d`, in hours (DST included)."""
    return ZoneInfo(tz).utcoffset(dt.datetime(d.year, d.month, d.day, 12)).total_seconds() / 3600


def sun_times(d, lat, lng, tz="UTC"):
    """Sunrise and sunset (simplified NOAA algorithm), local time "HH:MM" in time zone `tz`."""
    n = d.timetuple().tm_yday
    g = 2 * math.pi / 365 * (n - 1)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g)
                    - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    la = math.radians(lat)
    x = math.cos(math.radians(90.833)) / (math.cos(la) * math.cos(decl)) - math.tan(la) * math.tan(decl)
    ha = math.degrees(math.acos(max(-1.0, min(1.0, x))))   # polar day / night: clamped
    off = utc_offset_hours(d, tz) * 60

    def hm(minutes):
        minutes = round(minutes) % 1440
        return f"{minutes // 60:02d}:{minutes % 60:02d}"
    return hm(720 - 4 * (lng + ha) - eqt + off), hm(720 - 4 * (lng - ha) - eqt + off)


def moon(d, tz="UTC"):
    """Moon phase at local noon: (fraction 0-1, label). 0 = new moon, 0.5 = full moon."""
    ref = dt.datetime(2000, 1, 6, 18, 14)                      # a new moon (UTC)
    noon_utc = dt.datetime(d.year, d.month, d.day, 12) - dt.timedelta(hours=utc_offset_hours(d, tz))
    f = (((noon_utc - ref).total_seconds() / 86400) % 29.530588853) / 29.530588853
    if f < 0.017 or f > 0.983:
        lab = "new moon"
    elif abs(f - 0.5) < 0.017:
        lab = "full moon"
    elif f < 0.5:
        lab = "waxing moon"
    else:
        lab = "waning moon"
    return round(f, 3), lab


# ----------------------------------------------------------------- assembly
def places_of_stage(trip, key, agenda):
    merged = {}
    for src in (read(f"lieux-{key}-activites.json", {}, trip.research).get("pois", []),
                read(f"lieux-{key}-restos.json", {}, trip.research).get("pois", []),
                [p for p in agenda if p.get("etape") == key]):
        for p in src:
            if isinstance(p, dict) and p.get("id"):
                try:
                    merged[str(p["id"])] = norm(p, key)
                except Exception as e:  # a badly formed record must not break the rest
                    print(f"  ! {key} {p.get('id')}: {e}")
    return list(merged.values())


def build(trip):
    """Write <trip.media>/jours.json and return the list of days."""
    agenda_all = read("lieux-agenda.json", {"pois": []}, trip.research).get("pois", [])
    agenda = [p for p in agenda_all if isinstance(p, dict) and p.get("id")]
    pois = {s["key"]: places_of_stage(trip, s["key"], agenda) for s in trip.stages}
    trajets = read("trajets.json", {}, trip.research).get("trajets", [])
    infos = [p for p in agenda if num(p.get("lat")) is None or num(p.get("lng")) is None]
    by_key = {s["key"]: s for s in trip.stages}
    out, d, end = [], dt.date.fromisoformat(trip.start), dt.date.fromisoformat(trip.end)
    while d <= end:
        iso = d.isoformat()
        key = trip.stage_of(iso) or max((k for k, v in by_key.items() if v['from'] <= iso), key=lambda k: by_key[k]['from'], default=trip.stages[0]['key'])
        st = by_key[key]
        rise, sett = sun_times(d, st["ref"][0], st["ref"][1], st["tz"])
        frac, lab = moon(d, st["tz"])
        dated = [p["id"] for k in by_key for p in pois[k] if iso in p["dates"] and p["lat"] is not None]
        infod = [{"titre": str(p.get("nom") or ""), "texte": str(p.get("resume") or p.get("pourquoi") or "")}
                 for p in infos if iso in [str(x) for x in as_list(p.get("dates"))]]
        legs = []
        for t in trajets:
            if isinstance(t, dict) and str(t.get("date")) == iso:
                opts = [o for o in as_list(t.get("options")) if isinstance(o, dict)]
                legs.append({"id": t.get("id"), "de": t.get("de"), "vers": t.get("vers"), "conseil": t.get("conseil") or "",
                             "options": [{k: o.get(k) for k in ("mode", "operateur", "depart", "arrivee", "duree",
                                                                "prix_couple_home", "lien", "reserver", "remarque")} for o in opts[:3]]})
        out.append({"date": iso, "etape": key, "lever": rise, "coucher": sett, "lune": lab, "lune_f": frac,
                    "evenements": dated, "infos": infod, "trajets": legs})
        d += dt.timedelta(days=1)
    os.makedirs(trip.media, exist_ok=True)
    with open(os.path.join(trip.media, "jours.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"days: {len(out)} days, {sum(len(j['evenements']) for j in out)} dated events, "
          f"{sum(len(j['trajets']) for j in out)} journeys")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Day-by-day data of a trip, see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    a = ap.parse_args(argv)
    try:
        build(tripctx.load(a.trip or tripctx.active_trip_dir(ROOT)))
    except tripctx.TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
