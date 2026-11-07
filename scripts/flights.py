#!/usr/bin/env python3
"""Flights of a trip: Kiwi requests derived from the trip's flight legs, normalisation, selection, comparators, logos.

Usage (always with -I; the trip defaults to the active one, see tripctx.active_trip_dir):
  python3 -I scripts/flights.py [--trip DIR] download [--force]   # Kiwi (via scripts/mcp.py) -> <trip>/research/vols-brut/
  python3 -I scripts/flights.py [--trip DIR] build                # raw answers -> <trip>/research/vols-options.json
  python3 -I scripts/flights.py [--trip DIR] logos [--all]        # carrier logos -> <trip>/site/media/logos.json
  python3 -I scripts/flights.py [--trip DIR] comparateurs FILE    # merge hand-read prices, then `build`

Raw files are named `<leg>-<YYYYMMDD>[-<variant>][-valise].json`; the `-valise` ones were requested with a checked bag
and give the bag supplement of the same itineraries. Output (`vols-options.json`):
  {"verifie": date, "legs": {leg_key: {"grille": [...], "options": [...]}}}   (flight legs only)
"""
import argparse
import base64
import concurrent.futures
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import tripctx  # noqa: E402
from i18n import T  # noqa: E402

DATA = os.path.join(ROOT, "data")
UTC = dt.timezone.utc
TAGS = ("arrivee-jour", "valise", "billets-separes", "escale-nuit", "change-aeroport", "direct", "moins-cher",
        "plus-court")


class FlightsError(Exception):
    """A problem the user can fix: unknown airport, raw file in another currency, bad comparators file…"""


# --------------------------------------------------------------------------------------------------
# Reference data: data/airports.json {IATA: {city, country (ISO 3166-1 alpha-2), tz (IANA)}}
#                 data/transit_rules.json [{code, title, when_stopover_country, passports_affected, ...}]
# --------------------------------------------------------------------------------------------------

_AIRPORTS = None
# Airports met in a raw answer but absent from the table: city and country read from the answer, time zone
# deduced from Kiwi's durations. (Airports of the trip's own legs must be in the table: see check_airports.)
_UNKNOWN = {}
_COUNTRY_CODES = {"Canada": "CA", "United States": "US", "India": "IN", "China": "CN"}


def load_airports():
    global _AIRPORTS
    if _AIRPORTS is None:
        with open(os.path.join(DATA, "airports.json"), encoding="utf-8") as f:
            _AIRPORTS = json.load(f)
    return _AIRPORTS


_TRANSIT = None


def load_transit_rules():
    global _TRANSIT
    if _TRANSIT is None:
        with open(os.path.join(DATA, "transit_rules.json"), encoding="utf-8") as f:
            _TRANSIT = json.load(f)
    return _TRANSIT


def check_airports(codes):
    known = load_airports()
    for code in codes:
        if code not in known:
            raise FlightsError(
                f"unknown airport {code!r}: add it to data/airports.json, e.g. "
                f'"{code}": {{"city": "City name", "country": "XX", "tz": "Region/City"}} '
                f"(country = ISO 3166-1 alpha-2, tz = IANA time zone)")


def _info(iata):
    return load_airports().get(iata) or _UNKNOWN.get(iata)


def ville_de(iata):
    a = _info(iata)
    return a["city"] if a else iata


def pays_de(iata):
    a = _info(iata)
    return a["country"] if a else None


def _decalage(iata, local):
    """UTC offset (timedelta) of the airport at this local time, or None if its time zone is unknown."""
    a = load_airports().get(iata)
    return None if a is None else local.replace(tzinfo=ZoneInfo(a["tz"])).utcoffset()


# --------------------------------------------------------------------------------------------------
# 1. Kiwi requests
# --------------------------------------------------------------------------------------------------

# variant -> extra Kiwi parameters. Every variant is also requested "with a bag" (suffix -valise) to learn the bag
# supplement of the same itinerary (same `id` in both answers).
VARIANTES_LONGUES = {
    "": {},
    "duree": {"sort": "duration"},
    "qualite": {"sort": "quality"},
    "unique": {"allow_self_transfer": False},
    "unique-duree": {"allow_self_transfer": False, "sort": "duration"},
    "escale1": {"max_sector_stopovers": 1},
    "direct": {"max_sector_stopovers": 0},
}
VARIANTES_COURTES = {"": {}, "duree": {"sort": "duration"}, "qualite": {"sort": "quality"}}
N_OPTIONS = {"long": 25, "short": 6}


def flight_legs(trip):
    return [l for l in trip.legs if l["mode"] == "flight"]


def _check_leg_airports(trip):
    check_airports(dict.fromkeys(a for l in flight_legs(trip) for a in l["from_airports"] + l["to_airports"]))


def _variants_of(leg):
    return VARIANTES_COURTES if leg["kind"] == "between" else VARIANTES_LONGUES


def raw_dir(trip):
    return os.path.join(trip.research, "vols-brut")


def raw_file(trip, leg_key, date, variant, bag):
    suffix = "-".join(p for p in (variant, "valise" if bag else "") if p)
    name = f"{leg_key}-{date.replace('-', '')}" + (f"-{suffix}" if suffix else "") + ".json"
    return os.path.join(raw_dir(trip), name)


def requests_for(trip, bags=False, variants=False):
    """One Kiwi request per flight leg and per date (leg date ± trip.flex_days). `bags`: also the request with a
    checked bag per adult; `variants`: also the extra sort/stopover variants. Each item:
    {leg, date, variante, valise, currency, file, args}."""
    _check_leg_airports(trip)
    out = []
    for leg in flight_legs(trip):
        day = dt.date.fromisoformat(leg["date"])
        dates = [(day + dt.timedelta(days=k)).isoformat() for k in range(-trip.flex_days, trip.flex_days + 1)]
        extras = _variants_of(leg) if variants else {"": {}}
        for date in dates:
            for variant, extra in extras.items():
                for bag in ((False, True) if bags else (False,)):
                    args = {"flyFrom": ",".join(leg["from_airports"]), "flyTo": ",".join(leg["to_airports"]),
                            "departureDate": dt.date.fromisoformat(date).strftime("%d/%m/%Y"),
                            "adults": leg["adults"], "currency": trip.home_currency, "locale": trip.language,
                            "sort": "price"}
                    args.update(extra)
                    if bag:
                        args["adults_hold_bags"] = [1] * leg["adults"]
                    out.append({"leg": leg["key"], "date": date, "variante": variant, "valise": bag,
                                "currency": trip.home_currency, "args": args,
                                "file": raw_file(trip, leg["key"], date, variant, bag)})
    return out


def call_kiwi(args, tries=3):
    """One `search-flight` call of the Kiwi MCP server, through scripts/mcp.py. Returns the parsed answer."""
    cmd = [sys.executable, "-I", os.path.join(ROOT, "scripts", "mcp.py"), "call", "kiwi", "search-flight",
           json.dumps(args)]
    last = ""
    for i in range(tries):
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        try:
            rep = json.loads(p.stdout)
            if rep.get("itineraries") is not None:
                return rep
            last = p.stdout[:300]
        except ValueError:
            last = (p.stdout + p.stderr)[:300]
        time.sleep(5 * (i + 1))
    raise FlightsError(f"Kiwi failed for {args}: {last}")


def download(trip, force=False, workers=3):
    """Fetch every missing raw answer (network; not unit-tested)."""
    os.makedirs(raw_dir(trip), exist_ok=True)
    todo_all = requests_for(trip, bags=True, variants=True)
    todo = [r for r in todo_all if force or not os.path.exists(r["file"])]
    print(f"{len(todo)} Kiwi calls to make out of {len(todo_all)}")

    def one(r):
        rep = {"_requete": r["args"], "_releve": dt.date.today().isoformat(), **call_kiwi(r["args"])}
        with open(r["file"], "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
        return r, len(rep["itineraries"])

    with concurrent.futures.ThreadPoolExecutor(workers) as ex:
        for fut in concurrent.futures.as_completed([ex.submit(one, r) for r in todo]):
            try:
                r, n = fut.result()
                print("ok", os.path.basename(r["file"]), n)
            except Exception as e:  # noqa: BLE001 - keep going, the failures are listed
                print("FAILED", e)


# --------------------------------------------------------------------------------------------------
# 2. Normalising a Kiwi answer
# --------------------------------------------------------------------------------------------------

def _dt(texte):
    """'2027-06-15T08:45', '2027-06-15T08:45:00' or '2027-06-15T14:45Z' -> datetime ('Z' => UTC)."""
    t = texte.strip()
    if t.endswith("Z"):
        return dt.datetime.fromisoformat(t[:-1]).replace(tzinfo=UTC)
    return dt.datetime.fromisoformat(t)


def _local(d):
    return d.strftime("%Y-%m-%dT%H:%M")


def _utc(d):
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%MZ")


def _minutes(a, b):
    return int(round((b - a).total_seconds() / 60))


def _billets(it, segs):
    """Ticket number of each flight. Kiwi's `id` lists pieces `<ticket>_<n>`; one ticket = one prefix. A superfluous
    piece (a ticket seen again, not contiguous) is dropped; if the count is still wrong, fall back to "same carrier =
    same ticket", which over-declares separate tickets rather than hiding them."""
    prefixes = [c.rsplit("_", 1)[0] for c in it["id"].split("|")]
    if len(prefixes) != len(segs):
        kept = []
        for p in prefixes:
            if p in kept and kept[-1] != p:
                continue
            kept.append(p)
        prefixes = kept
    if len(prefixes) != len(segs):
        prefixes = [s["carrier"] for s in segs]
    numero, out = {}, []
    for p in prefixes:
        numero.setdefault(p, len(numero))
        out.append(numero[p])
    return out


def _segments(it):
    """Normalised segments (local times of the source, UTC computed with each airport's time zone)."""
    out = it["outbound"]["segments"]
    billets = _billets(it, out)
    res, current = [], {}
    for s, billet in zip(out, billets):
        de, vers = s["from"], s["to"]
        for iata, city, country in ((de, s.get("fromCity"), s.get("fromCountry")),
                                    (vers, s.get("toCity"), s.get("toCountry"))):
            if iata not in load_airports() and iata not in _UNKNOWN:
                _UNKNOWN[iata] = {"city": city or iata, "country": _COUNTRY_CODES.get(country, country), "tz": None}
        dep = dt.datetime.fromisoformat(s["departureTime"])
        arr = dt.datetime.fromisoformat(s["arrivalTime"])
        off_dep = _decalage(de, dep)
        if off_dep is None:
            off_dep = current.get(de)
        if off_dep is None:
            raise FlightsError(f"unknown time zone for {de}: add it to data/airports.json")
        dep_utc = dep - off_dep
        off_arr = _decalage(vers, arr)
        if off_arr is None:  # deduced from the duration Kiwi gives
            off_arr = arr - (dep_utc + dt.timedelta(seconds=s["durationSeconds"]))
        current[vers] = off_arr
        arr_utc = arr - off_arr
        res.append({"vol": s["flightNumber"], "cie": s["carrier"], "de": de, "vers": vers,
                    "dep_local": _local(dep), "arr_local": _local(arr),
                    "dep_utc": _utc(dep_utc.replace(tzinfo=UTC)), "arr_utc": _utc(arr_utc.replace(tzinfo=UTC)),
                    "duree_min": _minutes(dep_utc, arr_utc), "billet": billet})
    return res


def couvre_la_nuit(arrivee, depart):
    """True if the layover (local times) covers 01:00-05:00 of one night: you sleep at the airport or in town."""
    jour = arrivee.date()
    while jour <= depart.date():
        debut = dt.datetime.combine(jour, dt.time(1, 0))
        fin = dt.datetime.combine(jour, dt.time(5, 0))
        if arrivee <= debut and depart >= fin:
            return True
        jour += dt.timedelta(days=1)
    return False


def escales(segments):
    """A layover between two consecutive flights: city, duration (UTC), overnight?, separate ticket?, airport change?"""
    res = []
    for a, b in zip(segments, segments[1:]):
        arr_loc, dep_loc = _dt(a["arr_local"]), _dt(b["dep_local"])
        if a.get("arr_utc") and b.get("dep_utc"):
            duree = _minutes(_dt(a["arr_utc"]), _dt(b["dep_utc"]))
        else:  # same city, same time zone: the local difference is exact
            duree = _minutes(arr_loc, dep_loc)
        separe = "billet" in a and "billet" in b and a["billet"] != b["billet"]
        res.append({"iata": a["vers"], "ville": ville_de(a["vers"]), "duree_min": duree,
                    "nuit": couvre_la_nuit(arr_loc, dep_loc), "billet_separe": bool(separe),
                    "change_aeroport": a["vers"] != b["de"]})
    return res


def formalites_de(vol, rules=None, passport=None):
    """Formality codes triggered by the layovers, from data/transit_rules.json: a rule applies when a layover airport is
    in its `when_stopover_country` (and, if `only_if_separate_tickets`, when that layover is on separate tickets).
    `passport`: only rules whose `passports_affected` is "all" or lists it."""
    rules = load_transit_rules() if rules is None else rules
    found = set()
    for e in vol.get("escales", []):
        country = pays_de(e["iata"])
        for r in rules:
            if r["when_stopover_country"] != country:
                continue
            if r.get("only_if_separate_tickets") and not e.get("billet_separe"):
                continue
            aff = r.get("passports_affected", "all")
            if passport is not None and aff != "all" and passport not in aff:
                continue
            found.add(r["code"])
    return [r["code"] for r in rules if r["code"] in found]


def _clock(hhmm):
    h, m = str(hhmm).split(":")
    return dt.time(int(h), int(m))


def _arrivee_de_jour(vol, rules):
    """Daytime arrival: after the earliest time you would leave a stay, early enough to still exit the airport and
    be settled by `latest_arrival`."""
    arrive = _dt(vol["segments"][-1]["arr_local"])
    latest = (dt.datetime.combine(arrive.date(), _clock(rules["latest_arrival"]))
              - dt.timedelta(minutes=rules["airport_exit_min"]))
    return _clock(rules["earliest_leave"]) <= arrive.time() and arrive <= latest


def tags_de(vol, rules):
    """Badges of the flight itself; "moins-cher" and "plus-court" are set on the whole list (marquer_extremes)."""
    t = set()
    if len(vol["segments"]) == 1:
        t.add("direct")
    if _arrivee_de_jour(vol, rules):
        t.add("arrivee-jour")
    if vol["valise"]["comprise"]:
        t.add("valise")
    if not vol["billet_unique"]:
        t.add("billets-separes")
    if any(e["nuit"] for e in vol["escales"]):
        t.add("escale-nuit")
    if any(e["change_aeroport"] for e in vol["escales"]):
        t.add("change-aeroport")
    return [x for x in TAGS if x in t]


def _duree_txt(minutes):
    h, m = divmod(int(minutes), 60)
    return f"{h} h {m:02d}" if m else f"{h} h"


def note_de(vol, lang="en"):
    """One sentence on what matters: overnight layovers, separate tickets."""
    phrases = []
    for e in vol["escales"]:
        parts = []
        if e["nuit"]:
            parts.append(T("overnight", lang))
        if e["change_aeroport"]:
            parts.append(T("airport_change", lang))
        if e["billet_separe"]:
            parts.append(T("separate", lang))
        if parts:
            phrases.append(f"{e['ville']} {_duree_txt(e['duree_min'])} ({', '.join(parts)})")
    texte = T("layover", lang, parts=" ; ".join(phrases)) if phrases else ""
    if not vol["billet_unique"]:
        texte += " " + T("separate_note", lang)
    return texte.strip()


def _article_compris(bagage, cle, n):
    """Kiwi gives, per item, the number of units included for all passengers (`personalItem`, `cabinBag`,
    `checkedBag`). True if every passenger has one, False if not; None if the number is missing (never guessed)."""
    v = bagage.get(cle) if isinstance(bagage, dict) else None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v >= n


def normalise_kiwi(raw, leg_key, rules, lang="en", verifie=None):
    """Flights of a raw `search-flight` answer. Price: total for all priced passengers (`passagers`). If the request
    asked for a bag (`_requete.adults_hold_bags`), every flight carries `_avec_valise: True` and its `prix_home` is the
    price WITH the bag; `fusionner_valise` uses it to compute the supplement."""
    voyageurs = raw.get("passengers", {})
    n = (voyageurs.get("adults") or 1) + (voyageurs.get("children") or 0)
    avec_valise = bool((raw.get("_requete") or {}).get("adults_hold_bags"))
    verifie = raw.get("_releve") or verifie
    vols = []
    for it in raw.get("itineraries") or []:
        segments = _segments(it)
        liste_escales = escales(segments)
        premier, dernier = segments[0], segments[-1]
        porte_a_porte = _minutes(_dt(premier["dep_utc"]), _dt(dernier["arr_utc"]))
        en_vol = sum(s["duree_min"] for s in segments)
        prix = int(round(it["price"]))
        noms = {s["carrier"]: s.get("carrierName") for s in it["outbound"]["segments"] if s.get("carrierName")}
        compagnies = list(dict.fromkeys(s["cie"] for s in segments))
        vol = {
            "id": f"{leg_key}-{premier['dep_local'][:10].replace('-', '')}-" + "-".join(s["vol"] for s in segments),
            "trajet": leg_key,
            "compagnies": compagnies,
            "compagnies_noms": {c: noms[c] for c in compagnies if c in noms},
            "segments": segments,
            "escales": liste_escales,
            "porte_a_porte_min": porte_a_porte,
            "en_vol_min": en_vol,
            "escale_min": porte_a_porte - en_vol,
            "jours_plus": (_dt(dernier["arr_local"]).date() - _dt(premier["dep_local"]).date()).days,
            "valise": {"comprise": (it["baggage"]["checkedBag"] >= n) and not avec_valise, "ajout_home": None},
            "cabine": {"comprise": _article_compris(it.get("baggage"), "cabinBag", n)},
            "objet_perso": _article_compris(it.get("baggage"), "personalItem", n),
            "billet_unique": not any(e["billet_separe"] for e in liste_escales),
            "passagers": n,
            "prix_home": prix,
            "hausse": None,
            "prix_par_site": [{"site": "Kiwi", "prix_home": prix, "url": it["bookingUrl"], "verifie": verifie}],
        }
        if vol["valise"]["comprise"]:
            vol["valise"]["ajout_home"] = 0
        vol["formalites"] = formalites_de(vol)
        vol["tags"] = tags_de(vol, rules)
        vol["note"] = note_de(vol, lang)
        if avec_valise:
            vol["_avec_valise"] = True
        vols.append(vol)
    return vols


def fusionner_valise(sans, avec):
    """Complete `valise.ajout_home` of the flights `sans` with the price of the same flights requested `avec` a bag
    (same `id`). Flights missing from the bag request keep ajout_home = None (supplement unknown)."""
    prix_avec = {v["id"]: v["prix_home"] for v in avec}
    res = []
    for v in sans:
        v = {k: x for k, x in v.items() if not k.startswith("_")}
        v["valise"] = dict(v["valise"])
        if isinstance(v.get("cabine"), dict):
            v["cabine"] = dict(v["cabine"])
        if not v["valise"]["comprise"] and v["id"] in prix_avec:
            v["valise"]["ajout_home"] = max(0, prix_avec[v["id"]] - v["prix_home"])
        res.append(v)
    return res


# --------------------------------------------------------------------------------------------------
# 3. Selection
# --------------------------------------------------------------------------------------------------

def _prix(o):
    return o.get("prix_home", 0)


def _duree(o):
    return o.get("porte_a_porte_min", 10 ** 9)


def prix_valise(o):
    """Price with a checked bag for every passenger, or None if the supplement is unknown."""
    valise = o.get("valise") or {}
    if valise.get("comprise"):
        return _prix(o)
    if valise.get("ajout_home") is None:
        return None
    return _prix(o) + valise["ajout_home"]


def _cle_vols(o):
    return tuple((s.get("vol"), (s.get("dep_local") or "")[:10]) for s in o.get("segments", [])) or (o.get("id"),)


def _jour_depart(o):
    segs = o.get("segments") or [{}]
    return (segs[0].get("dep_local") or "")[:10]


def sans_doublon(options):
    """For one sequence of flights (numbers and departure date), keep the cheapest option."""
    meilleurs = {}
    for o in options:
        c = _cle_vols(o)
        if c not in meilleurs or (_prix(o), _duree(o)) < (_prix(meilleurs[c]), _duree(meilleurs[c])):
            meilleurs[c] = o
    return list(meilleurs.values())


def choisir(options, n=25):
    """Up to n varied options. Always kept: the cheapest, the shortest, the cheapest with a bag included and the best
    bag price (price + supplement). Then, while there is room, for each departure day: the cheapest, then the best
    price x duration compromise. The rest is filled in turn by price, duration, price x duration score and carrier."""
    uniques = sans_doublon(options)
    if not uniques:
        return []
    cle_prix = lambda o: (_prix(o), _duree(o), str(o.get("id")))  # noqa: E731
    cle_duree = lambda o: (_duree(o), _prix(o), str(o.get("id")))  # noqa: E731
    p_min = max(min(_prix(o) for o in uniques), 1)
    d_min = max(min(_duree(o) for o in uniques), 1)
    cle_score = lambda o: (_prix(o) / p_min + 0.7 * _duree(o) / d_min, str(o.get("id")))  # noqa: E731
    choisis = []

    def prendre(o):
        if all(o is not c for c in choisis):
            choisis.append(o)

    prendre(min(uniques, key=cle_prix))
    prendre(min(uniques, key=cle_duree))
    comprises = [o for o in uniques if (o.get("valise") or {}).get("comprise")]
    if comprises:
        prendre(min(comprises, key=cle_prix))
    avec_prix = [o for o in uniques if prix_valise(o) is not None]
    if avec_prix:
        prendre(min(avec_prix, key=lambda o: (prix_valise(o), _duree(o), str(o.get("id")))))
    jours = sorted({_jour_depart(o) for o in uniques})
    for cle in (cle_prix, cle_score):
        for jour in jours:
            if len(choisis) >= n:
                break
            prendre(min((o for o in uniques if _jour_depart(o) == jour), key=cle))
    # one option per carrier combination (cheapest first), then the rest by price
    vues, par_compagnie = set(), []
    for o in sorted(uniques, key=cle_prix):
        c = tuple(o.get("compagnies") or ())
        if c not in vues:
            vues.add(c)
            par_compagnie.append(o)
    classements = [sorted(uniques, key=cle_prix), sorted(uniques, key=cle_duree), sorted(uniques, key=cle_score),
                   par_compagnie]
    while len(choisis) < min(n, len(uniques)):
        avant = len(choisis)
        for c in classements:
            if len(choisis) >= n:
                break
            while c and any(c[0] is x for x in choisis):
                c.pop(0)
            if c:
                prendre(c.pop(0))
        if len(choisis) == avant:
            break
    return sorted(choisis, key=cle_prix)


def marquer_extremes(options):
    """Set "moins-cher" and "plus-court" on the list (clearing old marks first)."""
    if not options:
        return options
    for o in options:
        o["tags"] = [t for t in o.get("tags", []) if t not in ("moins-cher", "plus-court")]
    p_min = min(_prix(o) for o in options)
    d_min = min(_duree(o) for o in options)
    for o in options:
        extra = [t for t, ok in (("moins-cher", _prix(o) == p_min), ("plus-court", _duree(o) == d_min)) if ok]
        o["tags"] = [t for t in TAGS if t in set(o["tags"]) | set(extra)]
    return options


# --------------------------------------------------------------------------------------------------
# 4. Timing rules (trip.rules) for a flight between two stays
# --------------------------------------------------------------------------------------------------

def _hhmm(hhmm):
    h, m = str(hhmm).split(":")
    return int(h) * 60 + int(m)


def _instant(iso):
    return dt.datetime.strptime(str(iso)[:16], "%Y-%m-%dT%H:%M")


def respecte_regle(vol, rules, quitte=None, rejoint=None):
    """Does the flight respect the trip's timing rules, so that a default choice does not start with an alert?

    quitte  = access info ({"duree_min", ...}) of the stay we leave: departure - rules.checkin_min - trip time must be
              >= rules.earliest_leave on the departure day (leaving the evening before is not allowed).
    rejoint = access info of the stay we join: arrival + rules.airport_exit_min + trip time must be <=
              rules.latest_arrival on the departure day (a flight landing after midnight is refused) and, when
              given, before its `dernier_public` (last public transport; absent/null: by car, no last service).
    Computed on full dates and times (local time of each airport, like the raw answers)."""
    depart = _instant(vol["segments"][0]["dep_local"])
    if quitte:
        part = depart - dt.timedelta(minutes=rules["checkin_min"] + int(quitte["duree_min"]))
        if part < depart.replace(hour=0, minute=0) + dt.timedelta(minutes=_hhmm(rules["earliest_leave"])):
            return False
    if rejoint:
        arrivee = _instant(vol["segments"][-1]["arr_local"])
        if arrivee.date() > depart.date():
            return False
        au_logement = arrivee + dt.timedelta(minutes=rules["airport_exit_min"] + int(rejoint["duree_min"]))
        minuit = arrivee.replace(hour=0, minute=0)
        if au_logement > minuit + dt.timedelta(minutes=_hhmm(rules["latest_arrival"])):
            return False
        if rejoint.get("dernier_public") and au_logement >= minuit + dt.timedelta(minutes=_hhmm(rejoint["dernier_public"])):
            return False
    return True


# --------------------------------------------------------------------------------------------------
# 5. Assembling research/vols-options.json
# --------------------------------------------------------------------------------------------------

DUREE_MAX_MIN = 72 * 60  # beyond 72 h door to door it is no longer a travel option


def lire_releve(chemin):
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def _meilleur(a, b):
    """Of two readings of the same flight (same flights, same day): the cheaper; a known supplement preferred."""
    if b["prix_home"] < a["prix_home"]:
        a, b = b, a
    if a["valise"]["ajout_home"] is None and b["valise"]["ajout_home"] is not None and a["prix_home"] == b["prix_home"]:
        a = {**a, "valise": b["valise"]}
    return a


def raw_files_of(trip, leg_key):
    """{(date, variant): {"sans": path|None, "avec": path|None}} of the raw files of a leg."""
    pat = re.compile(r"^" + re.escape(leg_key) + r"-(\d{8})(?:-(.+?))?\.json$")
    found = {}
    for path in sorted(glob.glob(os.path.join(raw_dir(trip), glob.escape(leg_key) + "-*.json"))):
        m = pat.match(os.path.basename(path))
        if not m:
            continue
        date, rest = m.group(1), m.group(2) or ""
        bag = rest == "valise" or rest.endswith("-valise")
        variant = re.sub(r"-?valise$", "", rest) if bag else rest
        found.setdefault((date, variant), {"sans": None, "avec": None})["avec" if bag else "sans"] = path
    return found


def releves_du_trajet(trip, leg):
    """Every flight read for a leg (all dates and variants), without duplicates, plus the newest `_releve` date."""
    pool, newest = {}, ""
    for (date, variant), files in raw_files_of(trip, leg["key"]).items():
        read = {"sans": [], "avec": []}
        for kind, path in files.items():
            if not path:
                continue
            raw = lire_releve(path)
            cur = raw.get("currency")
            if cur and cur != trip.home_currency:
                raise FlightsError(f"{os.path.basename(path)} is priced in {cur} but the trip uses "
                                   f"{trip.home_currency}: download it again (flights.py download --force)")
            n_raw = (raw.get("passengers") or {}).get("adults")
            if isinstance(n_raw, int) and n_raw != leg["adults"]:
                print(f"warning: {os.path.basename(path)} is priced for {n_raw} adult{'s' if n_raw != 1 else ''} but leg "
                      f"'{leg['key']}' has {leg['adults']}: its prices are not scaled", file=sys.stderr)
            newest = max(newest, raw.get("_releve") or "")
            read[kind] = normalise_kiwi(raw, leg["key"], trip.rules, trip.language, raw.get("_releve"))
        for v in fusionner_valise(read["sans"], read["avec"]):
            pool[v["id"]] = _meilleur(pool[v["id"]], v) if v["id"] in pool else v
    res = []
    for v in pool.values():
        if v["porte_a_porte_min"] > DUREE_MAX_MIN:
            continue
        if leg["to_airports"] and v["segments"][-1]["vers"] not in leg["to_airports"]:
            continue
        if leg["from_airports"] and v["segments"][0]["de"] not in leg["from_airports"]:
            continue
        res.append(v)
    return sorted(res, key=lambda o: (o["prix_home"], o["porte_a_porte_min"], o["id"])), newest


def grille(pool):
    """The lowest price of each departure day (the date band), with the flight that carries it."""
    jours = {}
    for o in pool:
        jours.setdefault(_jour_depart(o), []).append(o)
    res = []
    for jour in sorted(jours):
        moins_cher = min(jours[jour], key=lambda o: (o["prix_home"], o["porte_a_porte_min"], o["id"]))
        avec_valise = [prix_valise(o) for o in jours[jour] if prix_valise(o) is not None]
        premier = moins_cher["segments"][0]
        dernier = moins_cher["segments"][-1]
        res.append({"depart": jour, "de": premier["de"], "vers": dernier["vers"],
                    "prix_min_home": moins_cher["prix_home"],
                    "prix_min_valise_home": min(avec_valise) if avec_valise else None,
                    "arrivee": dernier["arr_local"], "vol_id": moins_cher["id"], "nb_options": len(jours[jour]),
                    "site": "Kiwi", "verifie": moins_cher["prix_par_site"][0]["verifie"]})
    return res


def sans_marques_internes(o):
    return {k: v for k, v in o.items() if not k.startswith("_")}


# --- comparators: prices read by hand on other sites ----------------------------------------------

def comparators_path(trip):
    return os.path.join(trip.research, "vols-comparateurs.json")


def charger_comparateurs(trip):
    """Prices read in a browser (Trip.com, Kayak, Google Flights, Expedia, Skyscanner, Hopper…): research/
    vols-comparateurs.json. Format: {"verifie", "prix": [{"id", "site", "prix_home", "url", "verifie", "bloque"?,
    "note"?}], "hausse": [{"id", "texte", "avant"}]}; `prix_home` is null for a blocked site (CAPTCHA) or a site
    without a web price."""
    p = comparators_path(trip)
    if not os.path.exists(p):
        return {"prix": [], "hausse": []}
    return lire_releve(p)


def fusionner_comparateurs(options, comparateurs):
    """Add to `prix_par_site` the prices read elsewhere than Kiwi, and `hausse` when a site announces one. Returns the
    comparator `id`s that match no option."""
    par_id = {o["id"]: o for o in options}
    inconnus = []
    for r in comparateurs.get("prix", []):
        o = par_id.get(r["id"])
        if o is None:
            inconnus.append(r["id"])
            continue
        entree = {"site": r["site"], "prix_home": r.get("prix_home"), "url": r["url"], "verifie": r["verifie"]}
        if r.get("bloque"):
            entree["bloque"] = True
        if r.get("note"):
            entree["note"] = r["note"]
        o["prix_par_site"] = [e for e in o["prix_par_site"] if e["site"] != r["site"]] + [entree]
    for h in comparateurs.get("hausse", []):
        o = par_id.get(h["id"])
        if o is None:
            inconnus.append(h["id"])
            continue
        o["hausse"] = {"texte": h["texte"], "avant": h["avant"]}
    for o in options:  # cheapest first; sites without a price (blocked) last
        o["prix_par_site"].sort(key=lambda e: (e.get("prix_home") is None, e.get("prix_home") or 0, e["site"]))
    return sorted(set(inconnus))


def _ajouter_phrase(sites, site, phrase):
    if phrase not in sites.get(site, ""):
        sites[site] = (sites.get(site, "") + " ; " + phrase).strip(" ;")


def fusionner_releves_manuels(comparateurs, releves):
    """Merge a hand-read file (`{"verifie", "releves": [{vol_id, site, prix_home, pour, detail, url, prix_local?,
    verifie?}], "hausse"?: [{vol_id, texte, avant}], "sites"?: {site: sentence}}`) into the comparators file.
    An exact `vol_id` replaces the (same flight, same site) entry of `prix`; one ending with `*` is the lowest price of
    a site that day, not the same flight: it goes to `jours`, never to an option's `prix_par_site`. `hausse` replaces
    the forecast of the same flight; `sites` adds a sentence to the site's description (once). Replayable."""
    comp = comparateurs
    comp.setdefault("prix", [])
    comp.setdefault("jours", [])
    comp.setdefault("hausse", [])
    for r in releves["releves"]:
        verifie = r.get("verifie") or releves["verifie"]
        cle = (r["vol_id"], r["site"])
        if r["vol_id"].endswith("*"):
            entree = {"id": r["vol_id"], "site": r["site"], "prix_home": r["prix_home"]}
            if r.get("prix_local") is not None:
                entree["prix_local"] = r["prix_local"]
            entree.update({"pour": r.get("pour"), "url": r["url"], "verifie": verifie,
                           "note": "lowest price of the day on this site, not the same flight as the option: "
                                   + (r.get("detail") or "")})
            place = next((i for i, e in enumerate(comp["jours"]) if (e["id"], e["site"]) == cle), None)
            if place is None:
                comp["jours"].append(entree)
            else:
                comp["jours"][place] = entree
        else:
            entree = {"id": r["vol_id"], "site": r["site"], "prix_home": r["prix_home"], "url": r["url"],
                      "verifie": verifie}
            if r.get("prix_local") is not None:
                entree["prix_local"] = r["prix_local"]
            if r.get("detail"):
                entree["note"] = r["detail"] + (f" ({r['pour']})" if r.get("pour") else "")
            place = next((i for i, e in enumerate(comp["prix"]) if (e["id"], e["site"]) == cle), None)
            if place is None:
                comp["prix"].append(entree)
            else:  # same place as the old entry: the file is not reordered
                comp["prix"][place] = entree
    for h in releves.get("hausse", []):
        entree = {"id": h["vol_id"], "texte": h["texte"], "avant": h["avant"]}
        place = next((i for i, e in enumerate(comp["hausse"]) if e["id"] == h["vol_id"]), None)
        if place is None:
            comp["hausse"].append(entree)
        else:
            comp["hausse"][place] = entree
    sites = comp.setdefault("sites", {})
    for site, phrase in (releves.get("sites") or {}).items():
        _ajouter_phrase(sites, site, phrase)
    return comp


def importer_releves(trip, chemin):
    """Merge the hand-read file `chemin` into research/vols-comparateurs.json; run `build` afterwards so the prices
    reach the options' `prix_par_site`."""
    releves = lire_releve(chemin)
    try:
        comp = fusionner_releves_manuels(charger_comparateurs(trip), releves)
    except (KeyError, TypeError) as e:
        raise FlightsError(f"{chemin} is not a valid hand-read prices file (missing {e})")
    if "sites" not in releves:  # no description of its own: one sentence per site read
        sites = comp.setdefault("sites", {})
        for site in sorted({r["site"] for r in releves["releves"]}):
            _ajouter_phrase(sites, site, f"read by hand on {releves['verifie']} (file {os.path.basename(chemin)})")
    os.makedirs(trip.research, exist_ok=True)
    with open(comparators_path(trip), "w", encoding="utf-8") as f:
        json.dump(comp, f, ensure_ascii=False, indent=1)
    exacts = [r for r in releves["releves"] if not r["vol_id"].endswith("*")]
    print(f"{len(exacts)} flight prices, {len(releves['releves']) - len(exacts)} day notes, "
          f"{len(releves.get('hausse', []))} price-rise forecasts -> {comparators_path(trip)}")


# --- budget lines ---------------------------------------------------------------------------------

def prix_retenu(vol):
    """The lowest price among the non-blocked sites -> {site, prix_home, url, verifie}; else the Kiwi price."""
    connus = [p for p in vol.get("prix_par_site") or [] if isinstance(p, dict) and not p.get("bloque")
              and isinstance(p.get("prix_home"), (int, float)) and not isinstance(p.get("prix_home"), bool)]
    if connus:
        m = min(connus, key=lambda p: p["prix_home"])
        return {"site": m["site"], "prix_home": m["prix_home"], "url": m.get("url"), "verifie": m.get("verifie")}
    return {"site": "Kiwi", "prix_home": vol["prix_home"], "url": None, "verifie": None}


def lignes_vol(vol, leg, trip):
    """Budget lines of a flight: the ticket at the lowest price found (+ a bag line when the bag is not included and its
    supplement is known). n = the leg's adults, u = price per adult. Lines of a leg outside the budget are `hors_budget`."""
    lang = trip.language
    r = prix_retenu(vol)
    pax = max(vol.get("passagers") or 1, 1)
    hors = not leg["in_budget"]
    segs = vol["segments"]
    frm, to = ville_de(segs[0]["de"]), ville_de(segs[-1]["vers"])
    who = ""
    if len(leg["travelers"]) < len(trip.travelers):
        labels = {t["id"]: t["label"] for t in trip.travelers}
        who = " + ".join(labels[i] for i in leg["travelers"]) + " · "
    airlines = " + ".join(vol.get("compagnies_noms", {}).get(c, c) for c in vol.get("compagnies", []))
    valise = vol.get("valise") or {}
    ajout = valise.get("ajout_home")
    notes = [T("lowest", lang, site=r["site"], price=round(r["prix_home"]), cur=trip.home_currency, n=pax)
             + (T("checked", lang, date=r["verifie"]) if r.get("verifie") else "")]
    if not valise.get("comprise") and not (isinstance(ajout, (int, float)) and ajout > 0):
        notes.append(T("bag_unknown", lang))
    if hors:
        notes.append(T("out_of_budget", lang))

    def line(u, lib, src, cle, note):
        out = {"n": leg["adults"], "u": round(u, 2), "lib": lib, "src": src, "quand": "avant", "etape": "vols",
               "poste": "vols", "cle": cle, "note": note}
        if hors:
            out["hors_budget"] = True
        return out

    date = segs[0]["dep_local"][:10]
    lib = T("ticket", lang, who=who, frm=frm, to=to, date=date, airlines=airlines,
            bag=T("bag_included", lang) if valise.get("comprise") else "", site=r["site"])
    out = [line(r["prix_home"] / pax, lib, "direct" if r["site"] == "Kiwi" else "releve", "vol", " · ".join(notes))]
    if not valise.get("comprise") and isinstance(ajout, (int, float)) and ajout > 0:
        kiwi = r["site"] == "Kiwi"
        note = T("bag_kiwi", lang) if kiwi else T("bag_estimated", lang, site=r["site"])
        out.append(line(ajout / pax, T("bag_line", lang, who=who, frm=frm, to=to),
                        "direct" if kiwi else "estime", "valise",
                        note + (" · " + T("out_of_budget", lang) if hors else "")))
    return out


def build(trip):
    """Normalise and select the raw answers of every flight leg -> <trip>/research/vols-options.json."""
    _check_leg_airports(trip)
    comparateurs = charger_comparateurs(trip)
    legs, newest = {}, ""
    for leg in flight_legs(trip):
        pool, latest = releves_du_trajet(trip, leg)
        newest = max(newest, latest)
        n = N_OPTIONS["short" if leg["kind"] == "between" else "long"]
        options = [sans_marques_internes(o) for o in choisir(pool, n)]
        marquer_extremes(options)
        prefix = leg["key"] + "-"
        inconnus = fusionner_comparateurs(options, {
            "prix": [r for r in comparateurs.get("prix", []) if r["id"].startswith(prefix)],
            "hausse": [h for h in comparateurs.get("hausse", []) if h["id"].startswith(prefix)]})
        if inconnus:
            print(f"[{leg['key']}] comparators without a matching option: {inconnus}")
        for o in options:
            o["lignes"] = lignes_vol(o, leg, trip)
        legs[leg["key"]] = {"grille": grille(pool), "options": options}
        print(f"[{leg['key']}] {len(pool)} flights read -> {len(options)} options, {len(legs[leg['key']]['grille'])} days")
    out = {"verifie": newest or dt.date.today().isoformat(), "legs": legs}
    os.makedirs(trip.research, exist_ok=True)
    path = os.path.join(trip.research, "vols-options.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("written", path)
    return out


# --------------------------------------------------------------------------------------------------
# 6. Carrier logos
# --------------------------------------------------------------------------------------------------

def logos(trip, tous=False):
    """Logos of the carriers present in vols-options.json -> <trip>/site/media/logos.json. By default only the missing
    ones are downloaded; `tous=True` (--all) downloads all again."""
    path = os.path.join(trip.research, "vols-options.json")
    if not os.path.exists(path):
        raise FlightsError("no vols-options.json yet: run `flights.py build` first")
    donnees = lire_releve(path)
    codes = sorted({c for t in donnees["legs"].values() for o in t["options"] for c in o["compagnies"]})
    out = os.path.join(trip.media, "logos.json")
    res = {}
    if not tous and os.path.exists(out):
        res = lire_releve(out)
    manquants = []
    for code in codes:
        if code in res:
            continue
        url = f"https://images.kiwi.com/airlines/64/{code}.png"
        try:  # curl: some Python builds lack the root certificates (CERTIFICATE_VERIFY_FAILED)
            png = subprocess.run(["curl", "-sfL", "-m", "30", url], capture_output=True, timeout=40, check=True).stdout
            if not png.startswith(b"\x89PNG"):
                raise ValueError("not a PNG")
            res[code] = "data:image/png;base64," + base64.b64encode(png).decode()
        except Exception as e:  # noqa: BLE001
            manquants.append((code, str(e)))
    os.makedirs(trip.media, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f"{len([c for c in codes if c in res])} logos out of {len(codes)} carriers -> {out} "
          f"({os.path.getsize(out) // 1024} KB); missing: {manquants}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Flights of a trip (Kiwi), see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("command", choices=["download", "build", "logos", "comparateurs"])
    ap.add_argument("file", nargs="?", help="hand-read prices file (comparateurs)")
    ap.add_argument("--force", action="store_true", help="download: fetch again the files already there")
    ap.add_argument("--all", action="store_true", help="logos: download every logo again")
    a = ap.parse_args(argv)
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
        if a.command == "download":
            download(trip, force=a.force)
        elif a.command == "build":
            build(trip)
        elif a.command == "logos":
            logos(trip, tous=a.all)
        else:
            if not a.file:
                ap.error("comparateurs needs a file")
            importer_releves(trip, a.file)
    except (FlightsError, tripctx.TripError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
