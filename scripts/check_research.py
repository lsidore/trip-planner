#!/usr/bin/env python3
"""Checks the structure of a trip's research files (lodging access, outings per stage, formalities).

Usage (always with -I): python3 -I scripts/check_research.py [--trip DIR]
Prints one problem per line and exits 1 when there are problems, 0 otherwise.

`check(trip)` returns the list of problems (empty = valid): missing field, value outside its list, non-https URL,
missing or badly formed date, unknown place, id with the wrong stage prefix. The files read, all optional:
  acces-*.json          {<lodging id>: {aeroport, duree_min, mode, dernier_public, premier_public, prive_home, source, verifie}}
                        mode: words of MODE_WORDS joined by "+" ("voiture+bateau", "train+walk")
                        the id starts with a stage key ("lisbon-01"); `aeroport` is one of that stage's airports
                        (`airports` + `depart_airports` in trip.json)
  sorties-<stage>.json  {<place id>: {prix_couple_home, compris, pas_compris, duree_min, depart, moment, date_fixe,
                        jour_trajet_ok, quand_reserver, remplace, liens, reveillon, hausse[, speciale][, prix_estime]}}
                        No price without a source: a non-zero price (0 included) is carried by a link quoting the same
                        price (free = a link at 0) whose label does not say "estimated", else `prix_estime: true`.
                        `speciale` is null or the key of a special evening of trip.json.
  formalites*.json      [{code, qui, titre, cout_home, delai_jours, avant, condition, url_officielle, source, verifie}]
                        `qui` is a traveler id or "all"; only `trip.required_formalities` must be present.
Every entry may carry `"_example": true` (sample data), which is ignored.
When lieux-*.json files exist, each outing must match a place of the right stage, and each place of the stage
(except "info") needs its outing; when resorts-fiches-*.json exist, each fiche needs its access.
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripctx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEURE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IATA = re.compile(r"^[A-Z]{3}$")
LIBELLE_ESTIME = re.compile(r"estim", re.I)  # a link whose label says "estimated price" does not publish that price

# access modes: one or more of these words joined by "+" ("voiture+bateau", "train+walk"); French and English both read
MODE_WORDS = ("voiture", "car", "taxi", "bateau", "boat", "ferry", "train", "bus", "metro", "tram", "pied", "walk")
MOMENTS = ("aube", "matin", "journee", "apres-midi", "coucher", "soir")
QUAND_RESERVER = ("maintenant", "vite", "veille", "sans")
REMPLACE = ("diners", "dejeuners", "spa", "verres")
AVANT = ("depart", "arrivee", "fin-30-jours")

CLES_ACCES = ("aeroport", "duree_min", "mode", "dernier_public", "premier_public", "prive_home", "source", "verifie")
CLES_SORTIE = ("prix_couple_home", "compris", "pas_compris", "duree_min", "depart", "moment", "date_fixe", "jour_trajet_ok",
               "quand_reserver", "remplace", "liens", "reveillon", "hausse")
CLES_SORTIE_FACULTATIVES = ("speciale", "prix_estime", "_example")
CLES_LIEN = ("site", "prix_home", "url", "verifie", "_example")
CLES_FORMALITE = ("code", "qui", "titre", "cout_home", "delai_jours", "avant", "condition", "url_officielle", "source", "verifie")


# ------------------------------------------------------------------------------------ building blocks


def _nombre(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _entier(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _texte(v):
    return isinstance(v, str) and v.strip() != ""


def _date_ok(v):
    if not isinstance(v, str) or not DATE.match(v):
        return False
    try:
        dt.date.fromisoformat(v)
    except ValueError:
        return False
    return True


def _manquants(ident, d, cles, out):
    for k in cles:
        if k not in d and k != "_example":
            out.append(f"{ident}: missing field '{k}'")


def _inconnus(ident, d, permis, out):
    for k in d:
        if k not in permis and k != "_example":
            out.append(f"{ident}: unknown field '{k}'")


def _enum(ident, d, cle, valeurs, out, nul=False):
    if cle not in d:
        return
    v = d[cle]
    if v is None and nul:
        return
    if v not in valeurs or not isinstance(v, str):
        out.append(f"{ident}: {cle} '{v}' not in the list ({', '.join(valeurs)}{', null' if nul else ''})")


def _heure(ident, d, cle, out):
    if cle in d and d[cle] is not None and not (isinstance(d[cle], str) and HEURE.match(d[cle])):
        out.append(f"{ident}: {cle} '{d[cle]}': HH:MM time expected (or null)")


def _prix(ident, d, cle, out):
    if cle in d and d[cle] is not None and not (_nombre(d[cle]) and d[cle] >= 0):
        out.append(f"{ident}: {cle} '{d[cle]}': positive number expected (or null)")


def _date(ident, d, cle, out, nul=False):
    if cle not in d:
        return
    v = d[cle]
    if v is None and nul:
        return
    if not _date_ok(v):
        out.append(f"{ident}: {cle} '{v}': date YYYY-MM-DD expected")


def _url(ident, v, cle, out):
    if not (isinstance(v, str) and v.startswith("https://") and len(v) > 12):
        out.append(f"{ident}: {cle} '{v}': https URL expected")


def _http_en_clair(ident, valeur, out):
    """Any http:// (non-https) URL in a text, wherever it is."""
    if isinstance(valeur, str):
        if re.search(r"http://", valeur):
            out.append(f"{ident}: non-https URL in the text '{valeur[:80]}'")
    elif isinstance(valeur, dict):
        for k, v in valeur.items():
            if k not in ("url", "url_officielle"):  # already checked field by field
                _http_en_clair(ident, v, out)
    elif isinstance(valeur, list):
        for v in valeur:
            _http_en_clair(ident, v, out)


def _liste_de_textes(ident, d, cle, out):
    if cle not in d:
        return
    v = d[cle]
    if not isinstance(v, list) or any(not _texte(x) for x in v):
        out.append(f"{ident}: {cle} must be a list of non-empty texts")


def _stage_of_id(trip, ident):
    """Stage key an id starts with ("lisbon-01" -> "lisbon"), longest key first; None when no stage prefix fits."""
    for k in sorted((s["key"] for s in trip.stages), key=len, reverse=True):
        if str(ident).startswith(k + "-"):
            return k
    return None


def _prefixes(trip):
    return ", ".join(s["key"] + "-" for s in trip.stages)


# ------------------------------------------------------------------------------------ neighbouring places


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _lieux(trip):
    """{id: {"etapes": set, "categorie": str}} from the lieux-*.json files; None when there are none."""
    fichiers = [p for p in sorted(glob.glob(os.path.join(trip.research, "lieux-*.json"))) if "photos-extra" not in p]
    if not fichiers:
        return None
    keys = [s["key"] for s in trip.stages]
    out = {}
    for chemin in fichiers:
        nom = os.path.basename(chemin)[len("lieux-"):-len(".json")]
        fichier_etape = next((k for k in sorted(keys, key=len, reverse=True) if nom.startswith(k + "-")), None)
        d = _read(chemin, {})
        for p in (d.get("pois", []) if isinstance(d, dict) else []):
            if not isinstance(p, dict) or not p.get("id"):
                continue
            etape = fichier_etape or p.get("etape")
            e = out.setdefault(str(p["id"]), {"etapes": set(), "categorie": ""})
            if etape:
                e["etapes"].add(etape)
            e["categorie"] = str(p.get("categorie") or "")
    return out


# ------------------------------------------------------------------------------------ outings


def _lien(ident, i, lien, out):
    p = f"{ident}: liens[{i}]"
    if not isinstance(lien, dict):
        out.append(f"{p}: object expected")
        return
    _manquants(p, lien, CLES_LIEN, out)
    _inconnus(p, lien, CLES_LIEN, out)
    if "site" in lien and not _texte(lien["site"]):
        out.append(f"{p}: empty site")
    if "url" in lien:
        _url(p, lien["url"], "url", out)
    _prix(p, lien, "prix_home", out)
    _date(p, lien, "verifie", out)


def _sortie(trip, ident, s, out):
    if not isinstance(s, dict):
        out.append(f"{ident}: object expected")
        return
    _manquants(ident, s, CLES_SORTIE, out)
    _inconnus(ident, s, CLES_SORTIE + CLES_SORTIE_FACULTATIVES, out)
    _prix(ident, s, "prix_couple_home", out)
    _liste_de_textes(ident, s, "compris", out)
    _liste_de_textes(ident, s, "pas_compris", out)
    if "duree_min" in s and not (_entier(s["duree_min"]) and s["duree_min"] > 0):
        out.append(f"{ident}: duree_min '{s['duree_min']}': integer minutes > 0 expected")
    _heure(ident, s, "depart", out)
    _enum(ident, s, "moment", MOMENTS, out)
    _date(ident, s, "date_fixe", out, nul=True)
    if _date_ok(s.get("date_fixe")) and not trip.start <= s["date_fixe"] <= trip.end:
        out.append(f"{ident}: date_fixe '{s['date_fixe']}' outside the trip ({trip.start} -> {trip.end})")
    for cle in ("jour_trajet_ok", "reveillon"):
        if cle in s and not isinstance(s[cle], bool):
            out.append(f"{ident}: {cle} '{s[cle]}': boolean expected")
    _enum(ident, s, "quand_reserver", QUAND_RESERVER, out)
    _enum(ident, s, "remplace", REMPLACE, out, nul=True)
    if "liens" in s:
        if not isinstance(s["liens"], list):
            out.append(f"{ident}: liens must be a list")
        else:
            for i, lien in enumerate(s["liens"]):
                _lien(ident, i, lien, out)
    sp = s.get("speciale")
    if sp is not None:
        spec = next((x for x in trip.specials if x["key"] == sp), None)
        if spec is None:
            out.append(f"{ident}: speciale '{sp}' is not a special evening of trip.json "
                       f"({', '.join(x['key'] for x in trip.specials) or 'none defined'})")
        elif s.get("date_fixe") not in (None, spec["date"]):
            out.append(f"{ident}: date_fixe '{s.get('date_fixe')}' differs from the date of special '{sp}' ({spec['date']})")
    h = s.get("hausse")
    if "hausse" in s and h is not None:
        if not isinstance(h, dict):
            out.append(f"{ident}: hausse must be null or {{avant, prix_apres_home}}")
        else:
            _manquants(f"{ident}: hausse", h, ("avant", "prix_apres_home"), out)
            _inconnus(f"{ident}: hausse", h, ("avant", "prix_apres_home"), out)
            if "avant" in h and not _date_ok(h["avant"]):
                out.append(f"{ident}: hausse.avant '{h['avant']}': date YYYY-MM-DD expected")
            _prix(f"{ident}: hausse", h, "prix_apres_home", out)
    _prix_source(ident, s, out)
    _http_en_clair(ident, s, out)


def prix_porte_par_un_lien(s):
    """True when a link quotes the outing's price: a non-zero link for a price > 0, a link at 0 for a free entry."""
    gratuit = s.get("prix_couple_home") == 0
    return any(isinstance(l, dict) and _nombre(l.get("prix_home")) and (l["prix_home"] == 0) == gratuit
               and not LIBELLE_ESTIME.search(str(l.get("site") or "")) for l in (s.get("liens") or []))


def _prix_source(ident, s, out):
    """No price without a source: a quoting link or `prix_estime: true`."""
    estime = s.get("prix_estime")
    if "prix_estime" in s and not isinstance(estime, bool):
        out.append(f"{ident}: prix_estime '{estime}': boolean expected")
        return
    if not _nombre(s.get("prix_couple_home")):
        if estime is True:
            out.append(f"{ident}: prix_estime true without a price (prix_couple_home null)")
        return
    if estime is not True and not prix_porte_par_un_lien(s):
        out.append(f"{ident}: price {s['prix_couple_home']} without a link quoting it: add the link or set prix_estime true")


def _verifie_sorties(trip, nom, data, out):
    if not isinstance(data, dict):
        out.append("sorties: a dictionary {place id: outing} is expected")
        return
    keys = [s["key"] for s in trip.stages]
    m = re.match(r"^sorties-(.+)\.json$", nom)
    etape = m.group(1) if m and m.group(1) in keys else None
    if m and etape is None:
        out.append(f"stage '{m.group(1)}' is not a stage of trip.json ({', '.join(keys)}): expected sorties-<stage>.json")
    lieux = _lieux(trip)
    agenda = {str(p.get("id")) for p in (_read(os.path.join(trip.research, "lieux-agenda.json"), {}).get("pois") or [])
              if isinstance(p, dict)}
    for ident, s in data.items():
        _sortie(trip, ident, s, out)
        if _stage_of_id(trip, ident) is None and ident not in agenda:
            out.append(f"{ident}: id has no stage prefix (expected one of {_prefixes(trip)})")
    if lieux is None:
        return
    for ident, s in data.items():
        if not isinstance(s, dict):
            continue
        L = lieux.get(ident)
        if L is None:
            out.append(f"{ident}: unknown place (not in any lieux-*.json)")
            continue
        if etape and L["etapes"] and etape not in L["etapes"]:
            out.append(f"{ident}: place of another stage ({', '.join(sorted(L['etapes']))}), not of {etape}")
        if L["categorie"] == "info":
            out.append(f"{ident}: place of category 'info' (pure information): no outing")
    if etape:
        for ident, L in sorted(lieux.items()):
            if etape in L["etapes"] and L["categorie"] != "info" and ident not in data:
                out.append(f"{ident}: place of stage {etape} without an outing")


# ------------------------------------------------------------------------------------ access


def _verifie_acces(trip, data, out):
    if not isinstance(data, dict):
        out.append("access: a dictionary {lodging id: access} is expected")
        return
    stages = {s["key"]: s for s in trip.stages}
    for ident, a in data.items():
        if not isinstance(a, dict):
            out.append(f"{ident}: object expected")
            continue
        _manquants(ident, a, CLES_ACCES, out)
        _inconnus(ident, a, CLES_ACCES, out)
        if "mode" in a:
            parts = a["mode"].split("+") if isinstance(a["mode"], str) else [None]
            if not all(p in MODE_WORDS for p in parts):
                out.append(f"{ident}: mode '{a['mode']}': one or more of {', '.join(MODE_WORDS)} joined by +")
        if "duree_min" in a and not (_entier(a["duree_min"]) and a["duree_min"] > 0):
            out.append(f"{ident}: duree_min '{a['duree_min']}': integer minutes > 0 expected")
        _heure(ident, a, "dernier_public", out)
        _heure(ident, a, "premier_public", out)
        _prix(ident, a, "prive_home", out)
        if "source" in a and not _texte(a["source"]):
            out.append(f"{ident}: empty source")
        _date(ident, a, "verifie", out)
        key = _stage_of_id(trip, ident)
        if key is None:
            out.append(f"{ident}: id has no stage prefix (expected one of {_prefixes(trip)})")
        if "aeroport" in a:
            ap = a["aeroport"]
            if not (isinstance(ap, str) and IATA.match(ap)):
                out.append(f"{ident}: aeroport '{ap}': 3-letter airport code expected")
            elif key is not None:
                allowed = stages[key]["airports"] + stages[key]["depart_airports"]
                if ap not in allowed:
                    out.append(f"{ident}: aeroport {ap} is not an airport of stage {key} "
                               f"({', '.join(allowed) or 'none listed: add airports or depart_airports in trip.json'})")
        _http_en_clair(ident, a, out)
    for chemin in sorted(glob.glob(os.path.join(trip.research, "resorts-fiches-*.json"))):
        d = _read(chemin, [])
        for x in (d if isinstance(d, list) else []):
            if isinstance(x, dict) and x.get("id") and str(x["id"]) not in data:
                out.append(f"{x['id']}: full fiche without an access in this file")


# ------------------------------------------------------------------------------------ formalities


def _verifie_formalites(trip, data, out):
    if not isinstance(data, list):
        out.append("formalities: a list is expected")
        return
    qui_ok = [t["id"] for t in trip.travelers] + ["all"]
    codes = [f.get("code") for f in data if isinstance(f, dict)]
    vus = set()
    for i, f in enumerate(data):
        if not isinstance(f, dict):
            out.append(f"formality #{i + 1}: object expected")
            continue
        ident = str(f.get("code") or f"formality #{i + 1}")
        _manquants(ident, f, CLES_FORMALITE, out)
        _inconnus(ident, f, CLES_FORMALITE, out)
        if f.get("code") in vus:
            out.append(f"{ident}: duplicate code")
        vus.add(f.get("code"))
        if "titre" in f and not _texte(f["titre"]):
            out.append(f"{ident}: empty titre")
        _enum(ident, f, "qui", qui_ok, out)
        if "cout_home" in f and not (_nombre(f["cout_home"]) and f["cout_home"] >= 0):
            out.append(f"{ident}: cout_home '{f['cout_home']}': positive number expected")
        if "delai_jours" in f and not (_entier(f["delai_jours"]) and f["delai_jours"] >= 0):
            out.append(f"{ident}: delai_jours '{f['delai_jours']}': integer days expected")
        _enum(ident, f, "avant", AVANT, out, nul=True)
        if "condition" in f and f["condition"] is not None and f["condition"] not in codes:
            out.append(f"{ident}: condition '{f['condition']}' is not the code of a formality in the file")
        if "url_officielle" in f:
            _url(ident, f["url_officielle"], "url_officielle", out)
        if "source" in f and not _texte(f["source"]):
            out.append(f"{ident}: empty source")
        _date(ident, f, "verifie", out)
        _http_en_clair(ident, f, out)
    for code in trip.required_formalities:
        if code not in vus:
            out.append(f"{code}: required formality missing")


# ------------------------------------------------------------------------------------ entry point


def check_file(trip, fichier):
    """Problems of one research file (empty = valid). The file type comes from its name."""
    nom = os.path.basename(fichier)
    if not os.path.exists(fichier):
        return [f"{nom}: file not found"]
    try:
        with open(fichier, encoding="utf-8") as f:
            data = json.load(f)
    except ValueError as e:
        return [f"{nom}: unreadable JSON ({e})"]
    out = []
    if nom.startswith("sorties-"):
        _verifie_sorties(trip, nom, data, out)
    elif nom.startswith("acces-"):
        _verifie_acces(trip, data, out)
    elif nom.startswith("formalites"):
        _verifie_formalites(trip, data, out)
    else:
        return [f"{nom}: unknown file type (expected acces-*.json, sorties-<stage>.json, formalites*.json)"]
    return [f"{nom}: {p}" for p in out]


def check(trip):
    """All problems of the trip's research files. A trip with no research yet has none."""
    out = []
    files = []
    for pattern in ("acces-*.json", "sorties-*.json", "formalites*.json"):
        files += sorted(glob.glob(os.path.join(trip.research, pattern)))
    for f in files:
        out += check_file(trip, f)
    if not any(os.path.basename(f).startswith("formalites") for f in files) and trip.required_formalities:
        out += [f"formalites.json: {c}: required formality missing (no formalites file)" for c in trip.required_formalities]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Checks a trip's research files, see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    a = ap.parse_args(argv)
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
    except tripctx.TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    problems = check(trip)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
