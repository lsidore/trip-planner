#!/usr/bin/env python3
"""Trip loader: reads <trip_dir>/trip.json, validates it and derives stages' nights and travel legs.

Command line (Claude runs it after writing trip.json, then shows the summary to the travelers):
    python3 scripts/tripctx.py [--trip DIR]
Prints the trip, its travelers, stages (with nights), derived legs and special evenings. Exits 1 with one line naming
the field (`stages[1].to`) when trip.json is invalid, or the airport code missing from data/airports.json.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date

DEFAULT_RULES = {"checkin_min": 90, "airport_exit_min": 60,
                 "earliest_leave": "07:00", "latest_arrival": "21:00"}


class TripError(Exception):
    """Raised when a trip cannot be found or its trip.json is invalid."""


# Stage keys and traveler ids name the picks saved by the page (state.json `choix.<stage>`, leg keys such as
# `arrive-<id>`): short ASCII slugs, so that every pick can be saved. Titles and labels keep any characters.
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def suggest_slug(text):
    """'São Paulo' -> 'sao-paulo': a valid key close to `text` ('' when nothing is left)."""
    s = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].strip("-")


def _check_id(value, path, ctx=""):
    if not ID_RE.fullmatch(value):
        hint = suggest_slug(value)
        raise TripError(f"invalid field {path}{ctx}: {value!r} must be a short ASCII slug (lowercase letters a-z, digits "
                        f"and dashes, starting with a letter or digit, at most 40 characters)"
                        + (f", e.g. {hint!r}" if hint and ID_RE.fullmatch(hint) else "")
                        + "; accents and spaces belong in the title or label")
    return value


@dataclass
class Trip:
    dir: str
    slug: str
    title: str
    language: str
    home_currency: str
    local_currency: "str | None"
    budget_cap: float
    start: str
    end: str
    travelers: list
    stages: list
    legs: list
    specials: list
    rules: dict
    defaults: dict
    base_lines: list
    required_formalities: list
    research: str
    site: str
    media: str
    state_file: str
    flex_days: int = 0

    def stage_of(self, date_iso):
        """Stage key owning a date: from <= d < to; the final `to` date belongs to the last stage."""
        for s in self.stages:
            if s["from"] <= date_iso < s["to"]:
                return s["key"]
        if self.stages and date_iso == self.stages[-1]["to"]:
            return self.stages[-1]["key"]
        return None


def _need(obj, field_name, path, typ, ctx=""):
    if not isinstance(obj, dict) or field_name not in obj or obj[field_name] in (None, ""):
        raise TripError(f"missing field {path}{ctx}")
    v = obj[field_name]
    if not isinstance(v, typ) or isinstance(v, bool) and typ is not bool:
        raise TripError(f"invalid field {path}{ctx}: expected {typ.__name__ if isinstance(typ, type) else typ}")
    return v


def _day(s, path, ctx=""):
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        raise TripError(f"invalid date at {path}{ctx}: {s!r} (expected YYYY-MM-DD)")


def _stage_ctx(s):
    return f" (stage '{s.get('key', '?')}')"


def _validate_stage(s, i):
    p = f"stages[{i}]"
    if not isinstance(s, dict):
        raise TripError(f"invalid {p}: expected an object")
    ctx = _stage_ctx(s)
    key = _check_id(_need(s, "key", f"{p}.key", str), f"{p}.key")
    _need(s, "title", f"{p}.title", str, ctx)
    f = _day(_need(s, "from", f"{p}.from", str, ctx), f"{p}.from", ctx)
    t = _day(_need(s, "to", f"{p}.to", str, ctx), f"{p}.to", ctx)
    if t <= f:
        raise TripError(f"{p}.to must be after {p}.from{ctx}")
    _need(s, "tz", f"{p}.tz", str, ctx)
    ref = s.get("ref")
    if not (isinstance(ref, list) and len(ref) == 2 and all(isinstance(x, (int, float)) for x in ref)):
        raise TripError(f"missing or invalid field {p}.ref (expected [lat, lng]){ctx}")
    _need(s, "country", f"{p}.country", str, ctx)
    for fld in ("airports", "depart_airports"):
        if not isinstance(s.get(fld, []), list):
            raise TripError(f"invalid field {p}.{fld}: expected a list{ctx}")
    if s.get("arrive_by") not in (None, "flight", "ground"):
        raise TripError(f"invalid field {p}.arrive_by: expected 'flight' or 'ground'{ctx}")
    out = dict(s)
    out["airports"] = list(s.get("airports") or [])
    out["depart_airports"] = list(s.get("depart_airports") or [])
    out["nights"] = (t - f).days
    return key, out


def _derive_legs(travelers, stages):
    legs = []
    groups = {}
    for tr in travelers:
        groups.setdefault(tr["home_airport"], []).append(tr)
    first, last = stages[0], stages[-1]

    def in_budget(trs):
        # a shared leg counts unless every traveler on it is excluded
        return any(t.get("flights_in_budget", True) is not False for t in trs)

    def make(key, kind, mode, trs, fs, ts, fa, ta, when):
        return {"key": key, "kind": kind, "mode": mode, "travelers": [t["id"] for t in trs],
                "adults": sum(t["adults"] for t in trs), "from_stage": fs, "to_stage": ts,
                "from_airports": fa, "to_airports": ta, "date": when, "in_budget": in_budget(trs)}

    arr = first["airports"] or first["depart_airports"]
    if not arr:
        raise TripError(f"stage '{first['key']}' needs airports (or depart_airports): "
                        f"the trip's arrival flight lands there (stages[0])")
    for ap, trs in groups.items():
        ids = "+".join(t["id"] for t in trs)
        legs.append(make(f"arrive-{ids}", "arrival", "flight", trs, None, first["key"],
                         [ap], list(arr), first["from"]))
    for a, b in zip(stages, stages[1:]):
        src = a["depart_airports"] or a["airports"]
        dst = b["airports"]
        mode = b.get("arrive_by") or ("flight" if src and dst else "ground")
        if mode == "flight" and not (src and dst):
            raise TripError(f"stage '{b['key']}' has arrive_by 'flight' but "
                            f"'{a['key']}' or '{b['key']}' has no airports")
        legs.append(make(f"{a['key']}-{b['key']}", "between", mode, travelers, a["key"], b["key"],
                         list(src) if mode == "flight" else [], list(dst) if mode == "flight" else [],
                         b["from"]))
    dep = last["depart_airports"] or last["airports"]
    if not dep:
        raise TripError(f"stage '{last['key']}' needs airports (or depart_airports) "
                        f"for the return flight (stages[{len(stages) - 1}])")
    for ap, trs in groups.items():
        ids = "+".join(t["id"] for t in trs)
        legs.append(make(f"return-{ids}", "return", "flight", trs, last["key"], None,
                         list(dep), [ap], last["to"]))
    return legs


def load(trip_dir):
    """Load and validate <trip_dir>/trip.json and return a Trip."""
    trip_dir = os.path.abspath(trip_dir)
    path = os.path.join(trip_dir, "trip.json")
    if not os.path.isfile(path):
        raise TripError(f"no trip.json in {trip_dir}")
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except ValueError as e:
        raise TripError(f"trip.json is not valid JSON: {e}")
    if not isinstance(raw, dict):
        raise TripError("trip.json must contain a JSON object")

    slug = _need(raw, "slug", "slug", str)
    title = _need(raw, "title", "title", str)
    language = _need(raw, "language", "language", str)
    cur = _need(raw, "currency", "currency", dict)
    home = _need(cur, "home", "currency.home", str)
    local = cur.get("local") or None
    if local == home:
        local = None
    cap = raw.get("budget_cap")
    if cap is None or isinstance(cap, bool) or not isinstance(cap, (int, float)):
        raise TripError("missing or invalid field budget_cap (expected a number)")

    travelers = raw.get("travelers")
    if not isinstance(travelers, list) or not travelers:
        raise TripError("missing field travelers (need at least one traveler)")
    seen = set()
    for i, t in enumerate(travelers):
        p = f"travelers[{i}]"
        tid = _check_id(_need(t, "id", f"{p}.id", str), f"{p}.id")
        if tid in seen:
            raise TripError(f"duplicate traveler id {tid!r} at {p}.id")
        seen.add(tid)
        _need(t, "label", f"{p}.label", str)
        _need(t, "adults", f"{p}.adults", int)
        _need(t, "home_airport", f"{p}.home_airport", str)

    raw_stages = raw.get("stages")
    if not isinstance(raw_stages, list) or not raw_stages:
        raise TripError("missing field stages (need at least one stage)")
    stages, keys = [], set()
    for i, s in enumerate(raw_stages):
        key, st = _validate_stage(s, i)
        if key in keys:
            raise TripError(f"duplicate stage key {key!r} at stages[{i}].key")
        keys.add(key)
        stages.append(st)
    for i, (a, b) in enumerate(zip(stages, stages[1:]), start=1):
        if b["from"] < a["to"]:
            raise TripError(f"stages[{i}].from overlaps the previous stage (stage '{b['key']}')")

    specials = raw.get("specials") or []
    for i, sp in enumerate(specials):
        p = f"specials[{i}]"
        _need(sp, "key", f"{p}.key", str)
        st = _need(sp, "stage", f"{p}.stage", str)
        if st not in keys:
            raise TripError(f"{p}.stage refers to unknown stage {st!r}")
        _day(_need(sp, "date", f"{p}.date", str), f"{p}.date")
        _need(sp, "title", f"{p}.title", str)

    rules = dict(DEFAULT_RULES)
    rules.update(raw.get("rules") or {})
    return Trip(
        dir=trip_dir, slug=slug, title=title, language=language, home_currency=home,
        local_currency=local, budget_cap=cap, start=stages[0]["from"], end=stages[-1]["to"],
        travelers=travelers, stages=stages, legs=_derive_legs(travelers, stages),
        specials=specials, rules=rules, defaults=dict(raw.get("defaults") or {}),
        base_lines=list(raw.get("base_lines") or []),
        required_formalities=list(raw.get("required_formalities") or []),
        research=os.path.join(trip_dir, "research"), site=os.path.join(trip_dir, "site"),
        media=os.path.join(trip_dir, "site", "media"), state_file=os.path.join(trip_dir, "state.json"),
        flex_days=int(raw.get("flex_days") or 0))


def active_trip_dir(repo_root):
    """TRIP_DIR (absolute, or relative to repo_root), else trips/.current (a slug)."""
    env = os.environ.get("TRIP_DIR")
    if env:
        d = env if os.path.isabs(env) else os.path.join(repo_root, env)
    else:
        cur = os.path.join(repo_root, "trips", ".current")
        slug = ""
        if os.path.isfile(cur):
            with open(cur, encoding="utf-8") as f:
                slug = f.read().strip()
        if not slug:
            raise TripError("no active trip: set TRIP_DIR or write a trip slug in trips/.current")
        d = os.path.join(repo_root, "trips", slug)
    d = os.path.normpath(d)
    if not os.path.isfile(os.path.join(d, "trip.json")):
        raise TripError(f"no active trip: {d} has no trip.json")
    return d


# ----------------------------------------------------------------- command line
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def unknown_airports(trip, root=ROOT):
    """Airport codes of the trip (home airports, stage airports) missing from <root>/data/airports.json."""
    try:
        with open(os.path.join(root, "data", "airports.json"), encoding="utf-8") as f:
            known = json.load(f)
    except (OSError, ValueError):
        return []
    codes = [t["home_airport"] for t in trip.travelers]
    for s in trip.stages:
        codes += s["airports"] + s["depart_airports"]
    return [c for c in dict.fromkeys(codes) if c not in known]


def summary(trip):
    """Plain-text summary: what the travelers should check before any research starts."""
    names = {t["id"]: t["label"] for t in trip.travelers}
    titles = {s["key"]: s["title"] for s in trip.stages}
    local = f", local currency {trip.local_currency}" if trip.local_currency else ""
    nights = sum(s["nights"] for s in trip.stages)
    out = [f"{trip.title} ({trip.slug}): {trip.start} -> {trip.end}, {nights} nights, language {trip.language}",
           f"Budget cap: {trip.budget_cap:g} {trip.home_currency}{local}", "Travelers:"]
    for t in trip.travelers:
        city = f" ({t['home_city']})" if t.get("home_city") else ""
        out.append(f"  {t['id']}: {t['label']}, {t['adults']} adult(s), home airport {t['home_airport']}{city}")
    out.append("Stages:")
    for s in trip.stages:
        ap = ", ".join(s["airports"]) or "none"
        dep = f", leave from {', '.join(s['depart_airports'])}" if s["depart_airports"] else ""
        out.append(f"  {s['key']}: {s['title']}, {s['from']} -> {s['to']}, {s['nights']} nights, airports {ap}{dep}")
    out.append("Legs:")
    for l in trip.legs:
        who = ", ".join(names.get(i, i) for i in l["travelers"])
        if l["mode"] == "flight":
            how = f"flight {'/'.join(l['from_airports'])} -> {'/'.join(l['to_airports'])}"
        else:
            how = f"ground {titles.get(l['from_stage'], '')} -> {titles.get(l['to_stage'], '')}"
        extra = "" if l["in_budget"] else ", outside the budget"
        out.append(f"  {l['key']}: {how}, {l['date']}, {who}{extra}")
    if trip.specials:
        out.append("Special evenings:")
        for sp in trip.specials:
            out.append(f"  {sp['key']}: {sp['title']}, {sp['date']} ({titles.get(sp['stage'], sp['stage'])})")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tripctx.py", description="Validates trip.json and prints its stages and legs.")
    ap.add_argument("--trip", help="trip directory (default: the active trip, TRIP_DIR or trips/.current)")
    a = ap.parse_args(argv)
    try:
        trip = load(a.trip or active_trip_dir(ROOT))
    except TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    missing = unknown_airports(trip)
    for code in missing:
        print(f"error: unknown airport {code!r}: check the code, or add it to data/airports.json, e.g. "
              f'"{code}": {{"city": "City name", "country": "XX", "tz": "Region/City"}}', file=sys.stderr)
    if missing:
        return 1
    print(summary(trip))
    return 0


if __name__ == "__main__":
    sys.exit(main())
