#!/usr/bin/env python3
"""Page data of a trip: the bundle the web page loads, built from the trip's research files.

Usage (always with -I): python3 -I scripts/page_data.py [--trip DIR] [--out DIR]
  --trip  trip directory (default: the active trip, see tripctx.active_trip_dir)
  --out   where the JSON files go (default: <trip>/site/media)

Inputs, all optional except trip.json (a missing file means "not researched yet"; Trip = scripts/tripctx.py):
  research/logements-<stage>*.json, resorts-fiches-*.json, couts-unites.json   lodgings, deep fiches, on-site costs (stays.py)
  research/vols-brut/, vols-options.json    flights, rebuilt on every run by flights.build (flight legs)
  research/trajets.json                     ground legs: the entry whose `id` is the leg key gives the options
  research/acces-logements.json, formalites.json, taux.json
  research/sorties-<stage>.json + lieux-<stage>-restos/-activites.json, lieux-agenda.json   outings and their places
  research/videos.json                      videos by place id (optional)
  <trip>/site/media/jours.json, logos.json, photos/index.json   read from the trip's media folder, whatever --out is

Outputs (in --out):
  parcours.json         {verifie, trip, vols, logos, formalites, jours, defaut, bases}
  parcours-<stage>.json {logements, sorties, autres}, one file per stage of trip.json

trip = {slug, title, language, start, end, budget_cap, currency: {home, local, rate, rate_date}, travelers,
        stages: [{key, title, from, to, nights, tone, file}], legs, specials, rules}
  currency.rate: 1 unit of home currency in local currency (research/taux.json), null when there is no local currency or
  no rate file. Amounts are in the home currency everywhere.
vols[leg]: {mode: "flight", grille, options} or {mode: "ground", options: [{id: "<leg>-<n>", mode, operateur, duree, lignes}]};
  the options of a flight leg come from flights.build and carry `lignes`.
defaut = {<leg>: option id, <stage>: lodging id, sorties: {}, speciales: {<special key>: null}, inclure: {<leg>: in_budget}}
  Lodging: trip.defaults[stage], else the first lodging with a complete fiche, else the first lodging, else null.
  Flight: trip.defaults[leg], else the cheapest option that respects the timing rules (flights.respecte_regle) against the
  default lodgings' access: an arrival leg against the arriving stage (rejoint only), a return leg against the stage left
  (quitte only), a leg between stages against both; when no option passes, the cheapest overall.
  Ground leg: its first option. No option: null.
bases: one line per paid formality (n = adults concerned) + trip.base_lines. Formalities with a `condition` are skipped on
  purpose: they depend on the transit flags of the chosen flight and are counted by the page.

Budget line = {n, u, lib, src: direct|releve|estime|inclus, quand: avant|place|inclus, etape: "vols" or a stage key,
  poste: vols|trajets|logements|repas|verres|bienetre|activites|formalites, cle, note?, hors_budget?: true}; n × u = amount.
  `cle` of a lodging line: chambre, petits_dej, dejeuners, diners, gala, verres, spa, transferts (an outing with
  `remplace: "diners"` removes the lines whose cle is "diners"); the "gala" line carries `speciale` (the key of the
  special evening its fiche names in `gala_pour`). An outing carries `speciale` too (or null).
Photos: every lodging and outing has `galerie` = {n, vue_en_tete, source, credits, grandes, petites} (addresses relative to
  the page, only files present on disk; no photo: n = 0 and empty lists).
Links of a lodging: the first one has `retenu: true` = the platform of the price kept (`url: null` when no address of that
  site is known); each priced link opens the site it names.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flights  # noqa: E402
import stays  # noqa: E402
import tripctx  # noqa: E402
from i18n import T  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHE_KEYS = ("petits_dej", "dejeuners", "diners", "gala", "verres", "spa", "transferts")
LABEL_KEY = {"petits_dej": "breakfasts", "dejeuners": "lunches", "diners": "dinners", "gala": "gala_dinner", "verres": "drinks",
             "spa": "spa", "transferts": "transfers"}
SRC = {"carte": "releve", "estimé": "estime", "estime": "estime", "inclus": "inclus"}   # research vocabulary -> line source
GROUPE = {"petits_dej": "repas", "dejeuners": "repas", "diners": "repas", "gala": "repas", "verres": "verres",
          "spa": "bienetre", "transferts": "trajets"}                                  # fiche item -> budget poste
PAYE_SUR_PLACE = re.compile(r"^\s*(à l.(hôtel|établissement)\s*(,|;|$)|sur place|pay (at|on)|at the (hotel|property))|aucun prépaiement|"
                            r"paiement sur place|payé sur place|no prepayment|pay on (arrival|site)|pay at the (hotel|property)", re.I)


# ----------------------------------------------------------------- tools
def lire(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("€", "").replace(" ", "").replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def liste(v):
    if isinstance(v, list):
        return [x for x in v if x not in (None, "")]
    return [v] if v not in (None, "") else []


def vrai(v):
    return v is True or str(v).lower() == "true"


def sans_accents(s):
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()


def court(texte, n):
    """Text cut at a word boundary, with an ellipsis."""
    t = " ".join(str(texte or "").split())
    if len(t) <= n:
        return t
    return t[:n].rsplit(" ", 1)[0].rstrip(" ,;:(") + "…"


def premiere_phrase(texte, n=170):
    t = " ".join(str(texte or "").split())
    m = re.search(r"(?<=[.!?])\s", t)
    return court(t[:m.start()] if m else t, n)


def ligne(n, u, lib, src, quand, etape, poste, cle, note=None, hors_budget=False):
    """One budget line (see the module docstring)."""
    d = {"n": n, "u": u, "lib": lib, "src": src, "quand": quand, "etape": etape, "poste": poste, "cle": cle}
    if note:
        d["note"] = note
    if hors_budget:
        d["hors_budget"] = True
    return d


def hors(x):
    """True if the budget line is outside the shared budget (`hors_budget` key of a line, or a legacy list's 8th item)."""
    if isinstance(x, dict):
        return bool(x.get("hors_budget"))
    return len(x) > 7 and bool(x[7])


def quand_chambre(paiement):
    """When the room money leaves: "place" if the kept rate is paid at the hotel, else "avant" (prepaid, charged before a
    date, or not stated)."""
    return "place" if PAYE_SUR_PLACE.search(str(paiement or "")) else "avant"


def strip_example(o):
    """Copy of a JSON value without the `_example` markers of the sample data."""
    if isinstance(o, dict):
        return {k: strip_example(v) for k, v in o.items() if k != "_example"}
    if isinstance(o, list):
        return [strip_example(x) for x in o]
    return o


# ----------------------------------------------------------------- dates in free text (ISO, "17 Nov 2026", "Nov 17, 2026")
_MOIS = {"jan": 1, "janv": 1, "january": 1, "janvier": 1, "feb": 2, "fev": 2, "fevr": 2, "february": 2, "fevrier": 2,
         "mar": 3, "mars": 3, "march": 3, "apr": 4, "avr": 4, "april": 4, "avril": 4, "may": 5, "mai": 5,
         "jun": 6, "juin": 6, "june": 6, "jul": 7, "juil": 7, "july": 7, "juillet": 7, "aug": 8, "aout": 8, "august": 8,
         "sep": 9, "sept": 9, "september": 9, "septembre": 9, "oct": 10, "october": 10, "octobre": 10,
         "nov": 11, "november": 11, "novembre": 11, "dec": 12, "december": 12, "decembre": 12}
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DMY = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th|er)?\s+([A-Za-zéûè]+)\.?,?\s+(\d{4})\b")
_MDY = re.compile(r"\b([A-Za-zéûè]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")


def parse_date(texte):
    """First date written in the text -> "YYYY-MM-DD", else None. The year is required (no guessing)."""
    t = str(texte or "")
    found = []
    for m in _ISO.finditer(t):
        found.append((m.start(), int(m.group(1)), int(m.group(2)), int(m.group(3))))
    for m in _DMY.finditer(t):
        mo = _MOIS.get(sans_accents(m.group(2)))
        if mo:
            found.append((m.start(), int(m.group(3)), mo, int(m.group(1))))
    for m in _MDY.finditer(t):
        mo = _MOIS.get(sans_accents(m.group(1)))
        if mo:
            found.append((m.start(), int(m.group(3)), mo, int(m.group(2))))
    for _, y, mo, d in sorted(found):
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            continue
    return None


def _after(motif, texte):
    m = re.search(motif, texte, re.I)
    return parse_date(texte[m.end():]) if m else None


def annulation_date(texte):
    """"free cancellation until 2027-05-01" / "gratuite avant le 1 mai 2027" -> "2027-05-01"; non-refundable or no date -> None."""
    t = str(texte or "").strip()
    if not re.match(r"(free|gratuite)", t, re.I):
        return None
    return _after(r"\b(until|before|by|avant|jusqu)", t)


def prelevement_date(texte):
    """"nothing before 2027-05-01" / "rien avant le 1 mai 2027" -> "2027-05-01"; prepaid, pay at the hotel, unclear -> None."""
    t = str(texte or "").strip()
    if not re.match(r"(nothing|no charge|rien)\b", t, re.I):
        return None
    return _after(r"\b(before|avant)", t)


def _offres(fiche):
    """[(offer {texte, avant}, formula)] of the formulas with a deadline ("book before …"), the nearest first."""
    verifie = (fiche.get("prix") or {}).get("verifie") or ""
    out = []
    for fo in liste(fiche.get("formules")):
        if not isinstance(fo, dict):
            continue
        nom, det = str(fo.get("nom") or ""), str(fo.get("detail") or "")
        if not re.search(r"book before|reserve before|valid until|early|réserver avant|valable jusqu'au", nom + " " + det, re.I):
            continue
        avant = parse_date(det)
        if avant and avant >= verifie:
            out.append(({"texte": court(f"{nom}: {det}" if det else nom, 240), "avant": avant}, fo))
    return sorted(out, key=lambda x: x[0]["avant"])


def offres_de(fiche):
    """Offers with a deadline of the fiche: [{texte, avant}], nearest first (all of them, for "Help me decide")."""
    return [o for o, _ in _offres(fiche)]


def offre_de(fiche, retenue=None):
    """The offer that sets the lodging's deadline (`prix.offre`): the nearest one that carries a price or that the kept
    platform (`retenue`, short name) offers. A priceless formula of another site is not one. None otherwise."""
    for o, fo in _offres(fiche):
        if num(fo.get("total_home")) or (retenue and plateforme_de(fo.get("nom")) == retenue):
            return o
    return None


# ----------------------------------------------------------------- lodgings
def lignes_logement(trip, stage, o, f):
    """Budget lines of a lodging: the room, then the on-site spending of the fiche (research/couts-unites.json).

    An item priced by the fiche (`cout_reel`) but without valid units becomes one estimated line."""
    lang = trip.language
    p = f.get("prix") if isinstance(f.get("prix"), dict) else {}
    nuits = stage["nights"]
    cond = " · ".join(x for x in (T("cancellation", lang, text=p["annulation"]) if p.get("annulation") else "",
                                  T("payment", lang, text=p["paiement"]) if p.get("paiement") else "") if x)
    room = float(o["prix_total_home"])
    plat = (p.get("plateforme") or o.get("plateforme") or "").split(" (")[0]
    out = [ligne(nuits, round(room / nuits, 2), T("stay_nights", lang, name=o["nom"], platform=plat), "direct",
                 quand_chambre(p.get("paiement")), stage["key"], "logements", "chambre", cond)]
    unites, couts = f.get("_u") or {}, f.get("cout_reel") if isinstance(f.get("cout_reel"), dict) else {}
    for k in FICHE_KEYS:
        lignes = unites.get(k)
        if lignes is None:
            tot = couts.get(k)
            if isinstance(tot, (int, float)) and tot > 0:
                lignes = [{"n": 1, "u": tot, "lib": T("estimated", lang, item=T(LABEL_KEY[k], lang)), "src": "estimé"}]
            else:
                continue
        for x in lignes:
            src = SRC.get(x.get("src"), "estime")
            quand = "inclus" if src == "inclus" else "place"
            note = T("book_with_lodging", lang) if k in ("spa", "transferts") and src != "inclus" else None
            l = ligne(x["n"], x["u"], x["lib"], src, quand, stage["key"], GROUPE[k], k, note)
            if k == "gala" and f.get("gala_pour"):
                l["speciale"] = str(f["gala_pour"])
            out.append(l)
    return out


_PLATEFORMES = (("booking", "Booking.com"), ("trip.com", "Trip.com"), ("agoda", "Agoda"), ("trivago", "trivago"),
                ("tripadvisor", "Tripadvisor"), ("airbnb", "Airbnb"), ("expedia", "Expedia"))
_TYPES = {"resort", "resorts", "hotel", "hotels", "villa", "villas", "suites", "suite", "spa", "wellness", "boutique", "residence", "the"}
_GENERIQUE = _TYPES | {"beach", "view", "adult", "only", "premier", "deluxe", "room", "pool", "private"}


def plateforme_de(texte):
    t = sans_accents(texte)
    return next((nom for cle, nom in _PLATEFORMES if cle in t), None)


def hote(url):
    """"https://www.booking.com/hotel/…" -> "www.booking.com"; not an https address: ""."""
    m = re.match(r"https://([^/?#]+)", str(url or ""))
    return m.group(1).lower() if m else ""


def meme_site(url, site):
    """Does the address open the named site? Known platforms: by host name (fr.trip.com = Trip.com); other names
    ("Hotels.com"): the name, without spaces, inside the host name."""
    h = hote(url)
    if not h:
        return False
    if plateforme_de(site):
        return plateforme_de(h) == plateforme_de(site)
    cle = re.sub(r"[^a-z0-9.]", "", sans_accents(site))
    return len(cle) >= 4 and cle in h


def plateforme_retenue(o, f):
    """Short name of the platform of the kept price: "Trip.com (same price on Booking.com)" -> "Trip.com"."""
    p = f.get("prix") if isinstance(f.get("prix"), dict) else {}
    plein = str(p.get("plateforme") or o.get("plateforme") or "")
    nom = plein.split(" (")[0]
    return plateforme_de(nom) or plateforme_de(plein) or nom


def urls_de(sources):
    """https URLs of the "https://… (checked …)" strings of a fiche."""
    out = []
    for s in liste(sources):
        m = re.search(r"https://[^\s)]+", str(s))
        if m and m.group(0).rstrip(".,;") not in out:
            out.append(m.group(0).rstrip(".,;"))
    return out


def site_officiel(nom, urls):
    """URL of the lodging's own site: a domain name that repeats a word of its name (or the reverse). Among the pages of
    one domain, the shortest (no PDF, download or resource); no domain matches: None."""
    base = re.split(r" – | - |\(", str(nom))[0]
    mots = [m for m in re.findall(r"[a-z]{4,}", sans_accents(base)) if m not in _GENERIQUE]
    coeur = "".join(w for w in re.findall(r"[a-z]+", sans_accents(base)) if w not in _TYPES)
    candidats = []
    for u in urls:
        host = re.match(r"https://([^/]+)", u).group(1).lower()
        if plateforme_de(host) or any(x in host for x in ("wanderlog", "michelin", "cloudfront", "12go", "facebook", "kiwi.com", "exa.ai", "hotels.com")):
            continue
        if re.search(r"\.(pdf|jpe?g|png)\b|/download|/dam/|/FileDownload", u, re.I):
            continue
        label = re.sub(r"^(www\.|th\.|fr\.)", "", host).split(".")[0].replace("-", "")
        if coeur and (label == coeur or (len(label) >= 5 and (label in coeur or (len(coeur) >= 5 and coeur in label)))):
            candidats.append((0, len(label), len(u), u))
        elif any(m in label for m in mots):
            candidats.append((1, len(label), len(u), u))
    return min(candidats)[3] if candidats else None


def adresses_logement(o, f):
    """Every https address found for a lodging, most trusted first: the listing (`url`), the fiche's price link, the best
    price, the other prices (fiche, then the lodging's comparison), the sources of the fiche then of the lodging."""
    p = f.get("prix") if isinstance(f.get("prix"), dict) else {}
    out = [o.get("url"), p.get("url"), o.get("url_meilleur_prix")]
    out += [a.get("url") for a in liste(p.get("autres")) + liste(o.get("prix_compares")) if isinstance(a, dict)]
    out += urls_de(f.get("sources")) + urls_de(o.get("sources"))
    return list(dict.fromkeys(u for u in out if isinstance(u, str) and u.startswith("https://")))


def liens_logement(lang, o, f, prix):
    """(links, address of the kept price): the kept platform first (price + conditions, `retenu: true`; an address of that
    site, else `url: null`: the price without a link), then the other platforms with their address and cheapest price
    (free cancellation first), the official site, Tripadvisor, the map. Each link opens the site it names."""
    urls = adresses_logement(o, f)
    retenue = plateforme_retenue(o, f)
    url_retenue = next((u for u in urls if meme_site(u, retenue)), None)
    out = [{"site": retenue or T("booking_default", lang), "url": url_retenue, "prix_home": prix.get("total_home"),
            "conditions": prix.get("annulation"), "retenu": True}]
    out[0] = {k: v for k, v in out[0].items() if v is not None or k == "url"}
    vus = {url_retenue}

    def ajoute(site, url, prix_home=None, cond=None):
        if url and url.startswith("https://") and url not in vus:
            vus.add(url)
            d = {"site": site, "url": url}
            if prix_home is not None:
                d["prix_home"] = prix_home
            if cond:
                d["conditions"] = cond
            out.append(d)

    for site in ("Booking.com", "Trip.com", "Agoda", "trivago"):
        if site == retenue:
            continue
        url = next((u for u in urls if meme_site(u, site)), None)
        offres = [a for a in liste(prix.get("autres")) if isinstance(a, dict) and plateforme_de(a.get("site")) == site
                  and isinstance(a.get("total_home"), (int, float))]
        gratuites = [a for a in offres if re.match(r"(free|gratuite)", str(a.get("annulation") or ""), re.I)]
        choix = min(gratuites or offres, key=lambda a: a["total_home"]) if (gratuites or offres) else None
        ajoute(site, url, choix["total_home"] if choix else None,
               " · ".join(x for x in (choix.get("annulation"), choix.get("detail")) if x) if choix else None)
    ajoute(T("official_site", lang), site_officiel(o.get("nom"), urls))
    ajoute("Tripadvisor", next((u for u in urls if "tripadvisor" in hote(u)), None))
    lat, lng = num(o.get("lat")), num(o.get("lng"))
    if lat is not None and lng is not None:
        ajoute("Google Maps", f"https://www.google.com/maps/search/?api=1&query={lat},{lng}")
    return out, url_retenue


def charger_index_photos(media):
    """<media>/photos/index.json (scripts/photos.py): {slug: {n, source, credits, vue_en_tete…}, "lieux": {id: {…}}}."""
    d = lire(os.path.join(media, "photos", "index.json"), {})
    return d if isinstance(d, dict) else {}


def galerie(dossier, info, media):
    """High-quality photos of a lodging (dossier = slug) or a place (dossier = "lieux/<id>") from its index entry:
    {n, vue_en_tete, source, credits, grandes, petites}, addresses relative to the page ("media/photos/…").
    Lists only the pairs of files present on disk (an entry without files gives n = 0)."""
    info = info if isinstance(info, dict) else {}
    total = int(num(info.get("n")) or 0)
    largeur = 2 if total < 100 else 3   # same as photos.py
    grandes, petites = [], []
    for k in range(1, total + 1):
        g, p = f"media/photos/{dossier}/{k:0{largeur}d}.jpg", f"media/photos/{dossier}/{k:0{largeur}d}-s.jpg"
        if os.path.isfile(os.path.join(media, g[6:])) and os.path.isfile(os.path.join(media, p[6:])):
            grandes.append(g)
            petites.append(p)
    vue = bool(info.get("vue_en_tete")) and bool(grandes) and grandes[0].endswith(f"/{1:0{largeur}d}.jpg")
    return {"n": len(grandes), "vue_en_tete": vue, "source": str(info.get("source") or ""), "credits": str(info.get("credits") or ""),
            "grandes": grandes, "petites": petites}


def logement(trip, stage, groupe, o, f, acces, videos, index=None):
    """A complete Lodging (deep fiche joined). `index` = photo index (charger_index_photos)."""
    slug = stays.slug_of(o, stage["key"])
    p = f.get("prix") if isinstance(f.get("prix"), dict) else {}
    plateforme = (p.get("plateforme") or o.get("plateforme") or "").split(" (")[0]
    prix = {"total_home": float(o["prix_total_home"]) if num(o.get("prix_total_home")) else None,
            "nuit_home": num(o.get("prix_nuit_home")), "plateforme": plateforme,
            "annulation": p.get("annulation") or o.get("annulation"), "annulation_date": annulation_date(p.get("annulation") or o.get("annulation")),
            "paiement": p.get("paiement"), "prelevement_date": prelevement_date(p.get("paiement")),
            "offre": offre_de(f, plateforme_retenue(o, f)), "verifie": p.get("verifie"), "detail": p.get("detail"), "dispo": p.get("dispo"),
            "autres": [a for a in liste(p.get("autres")) if isinstance(a, dict)]}
    liens, url_retenue = liens_logement(trip.language, o, f, prix)
    prix["url"] = url_retenue
    lignes = lignes_logement(trip, stage, o, f)
    # the room: address and date of the kept price (the site is in the label)
    lignes[0].update({k: v for k, v in (("url", url_retenue), ("verifie", p.get("verifie"))) if v})
    av = f.get("avis") if isinstance(f.get("avis"), dict) else {}
    return {
        "id": str(f["id"]), "nom": o["nom"], "ligne": o.get("pourquoi_pepite") and court(o["pourquoi_pepite"], 200) or premiere_phrase(f.get("pourquoi")) or court(o.get("type"), 160),
        "slug": slug, "galerie": galerie(slug, (index or {}).get(slug), trip.media),
        "favori": bool(o.get("top3")), "folie": bool(o.get("folie")),
        "note_qualite": f.get("note_qualite"), "groupe": groupe, "zone": o.get("sous_zone") or o.get("zone") or "", "nuits": stage["nights"],
        "lat": num(o.get("lat")), "lng": num(o.get("lng")), "url": url_retenue or "",
        "prix": prix, "lignes": lignes,
        "incomplet": not any(l["cle"] == "transferts" and l["src"] != "inclus" and l["n"] * l["u"] > 0 for l in lignes),
        "acces": acces.get(str(f["id"])),
        "pour_decider": {"pourquoi": f.get("pourquoi"), "chambre": f.get("chambre_conseillee"), "vue": f.get("vue_depuis_chambre"),
                         "public": f.get("public"), "gala": f.get("gala"), "acces": f.get("acces"), "verdict": f.get("verdict"),
                         "note_qualite_prix": f.get("note_qualite_prix"), "points_forts": liste(o.get("points_forts")),
                         "vigilance": liste(o.get("vigilance")), "offres": offres_de(f)},
        "inclus": [str(x) for x in liste(f.get("inclus"))],
        "prestations": {"equipements": liste(f.get("equipements")), "restaurants": liste(f.get("restaurants")),
                        "formules": liste(f.get("formules")), "non_inclus": liste(f.get("non_inclus"))},
        "avis": {"sources": liste(av.get("sources")), "aiment": liste(av.get("aiment")), "reprochent": liste(av.get("reprochent")),
                 "citations": liste(av.get("citations")), "alerte": av.get("alerte")},
        "liens": liens, "videos": videos.get(str(f["id"]), []),
    }


def date_releve(o):
    """Date of the price reading of a lodging without a fiche, taken from its data (`verifie`, `maj`, comparison,
    "checked on …" in its sources); none: None."""
    dates = [str(o.get(k))[:10] for k in ("verifie", "maj") if o.get(k)]
    dates += [str(a.get("verifie"))[:10] for a in liste(o.get("prix_compares")) if isinstance(a, dict) and a.get("verifie")]
    dates += re.findall(r"(?:checked|read|seen|vérifié|relevé|vu)(?: on| le)? (\d{4}-\d{2}-\d{2})", " ".join(map(str, liste(o.get("sources")))))
    dates = [d for d in dates if re.match(r"^\d{4}-\d{2}-\d{2}$", d)]
    return max(dates) if dates else None


def logement_court(trip, stage, o, videos, index=None):
    """Lodging without a complete fiche: shown behind "other lodgings", budget incomplete. A price with no date in the
    data has `verifie` null and `estime: true` (to check again)."""
    slug = stays.slug_of(o, stage["key"])
    total = num(o.get("prix_total_home"))
    nuits = int(num(o.get("nuits")) or stage["nights"])
    plateforme = re.split(r" \(| · ", str(o.get("plateforme") or ""))[0]
    lat, lng = num(o.get("lat")), num(o.get("lng"))
    liens = []
    if str(o.get("url", "")).startswith("https://"):
        # the label names the site the link opens (not the platform of the price, which can be another one)
        liens.append({"site": plateforme_de(hote(o["url"])) or plateforme_de(plateforme) or plateforme or T("booking_default", trip.language),
                      "url": o["url"]})
    if lat is not None and lng is not None:
        liens.append({"site": "Google Maps", "url": f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"})
    verifie = date_releve(o)
    prix = {"total_home": float(total) if total is not None else None, "nuit_home": num(o.get("prix_nuit_home")), "plateforme": plateforme,
            "annulation": o.get("annulation"), "verifie": verifie}
    if verifie is None:
        prix["estime"] = True
    return {
        "id": str(o.get("id") or slug), "nom": o["nom"], "slug": slug,
        "galerie": galerie(slug, (index or {}).get(slug), trip.media), "favori": bool(o.get("top3")),
        "ligne": court(o.get("pourquoi_pepite") or f"{o.get('type') or ''} · {o.get('zone') or ''}".strip(" ·"), 160),
        "note_qualite": None, "zone": o.get("sous_zone") or o.get("zone") or "", "nuits": nuits, "lat": lat, "lng": lng, "url": o.get("url") or "",
        "incomplet": True, "note": num(str(o.get("note") or "").split(" ")[0].split("/")[0].replace(",", ".")),
        "prix": prix, "liens": liens, "videos": videos.get(str(o.get("id") or slug), []),
    }


# ----------------------------------------------------------------- outings
GROUPE_LIEU = {"à voir": "voir", "point de vue": "voir", "plage": "voir", "nature": "voir", "cascade / nature": "voir", "sight": "voir",
               "viewpoint": "voir", "beach": "voir", "à faire": "faire", "marché": "faire", "aventure": "faire", "activity": "faire",
               "market": "faire", "adventure": "faire", "restaurant": "manger", "street food": "manger", "café": "manger", "cafe": "manger",
               "bar": "boire", "rooftop": "boire", "bar / rooftop": "boire", "soirée": "boire", "evening": "boire", "bien-être": "bienetre",
               "wellness": "bienetre", "événement": "agenda", "event": "agenda", "réveillon": "agenda", "info": "agenda"}


def lieu(p):
    """A place in the page's format (missing fields = neutral values)."""
    cat = str(p.get("categorie") or "à voir").strip().lower()
    https = lambda u: u if isinstance(u, str) and u.startswith("https://") else ""
    notes = [{"site": str(n.get("site") or "")[:24], "note": num(n.get("note")), "avis": int(num(n.get("avis")) or 0), "url": https(n.get("url"))}
             for n in liste(p.get("notes")) if isinstance(n, dict) and num(n.get("note")) is not None]
    srcs = []
    for s in liste(p.get("sources")):
        u = https(s.get("url") if isinstance(s, dict) else s)
        if u and u not in srcs:
            srcs.append(u)
    out = {"nom": str(p.get("nom") or p["id"]), "categorie": cat, "groupe": GROUPE_LIEU.get(cat, "voir"), "sous_type": p.get("sous_type") or "",
           "lat": num(p.get("lat")), "lng": num(p.get("lng")), "approx": vrai(p.get("approx")),
           "resume": p.get("resume") or "", "pourquoi": p.get("pourquoi") or "", "incontournable": bool(p.get("incontournable")),
           "score": num(p.get("score")) if num(p.get("score")) is not None else 3, "tags": [str(t).lower() for t in liste(p.get("tags"))],
           "distinctions": [str(x) for x in liste(p.get("distinctions"))], "notes": notes, "prix": p.get("prix") or "",
           "duree": p.get("duree") or "", "horaires": p.get("horaires") or "", "meilleur_moment": p.get("meilleur_moment") or "",
           "plats": [str(x) for x in liste(p.get("plats"))], "a_reserver": vrai(p.get("a_reserver")),
           "reserver_quand": p.get("reserver_quand") or "", "lien_reservation": https(p.get("lien_reservation")), "lien": https(p.get("lien")),
           "fetes": p.get("fetes") or "", "dates": [str(d) for d in liste(p.get("dates"))], "acces": p.get("acces") or "", "sources": srcs[:6]}
    if p.get("meme_lieu_que"):   # same place as another outing, at another time
        out["meme_lieu_que"] = str(p["meme_lieu_que"])
    return out


def lieux_etape(trip, stage_key):
    """Places of a stage: map, activities, restaurants, agenda (a place in several files: the latest wins)."""
    def pois(nom):
        d = lire(os.path.join(trip.research, nom), {})
        return [p for p in (d.get("pois", []) if isinstance(d, dict) else d) if isinstance(p, dict) and p.get("id")]
    agenda = [p for p in pois("lieux-agenda.json") if p.get("etape") == stage_key]
    out = {}
    for src in (pois(f"carte-{stage_key}.json"), pois(f"lieux-{stage_key}-activites.json"), pois(f"lieux-{stage_key}-restos.json"), agenda):
        for p in src:
            out[str(p["id"])] = lieu(p)
    return out


def sortie(trip, stage_key, sid, s, lieux, videos, index=None):
    """An outing: the place + the fields of sorties-<stage>.json + its photos (`galerie`).

    `speciale`: key of the special evening it belongs to, or null. `verifie`: date of the most recent priced link; an
    estimated price (`prix_estime`) without a priced link takes the date of its unpriced links; no price: null."""
    l = lieux.get(sid)
    if l is None:
        raise SystemExit(f"error: outing {sid}: no place in research/carte-{stage_key}.json or research/lieux-{stage_key}-*.json")
    out = {**l, **s, "id": sid, "etape": stage_key}
    for k in ("photos", "reveillon", "noel"):   # old fields: the gallery and `speciale` replace them
        out.pop(k, None)
    out["speciale"] = s.get("speciale") or None
    out["galerie"] = galerie(f"lieux/{sid}", ((index or {}).get("lieux") or {}).get(sid), trip.media)
    out["videos"] = videos.get(sid, [])
    liens = [x for x in liste(s.get("liens")) if isinstance(x, dict) and re.match(r"^\d{4}-\d{2}-\d{2}$", str(x.get("verifie") or ""))]
    chiffres = [x["verifie"] for x in liens if x.get("prix_home") is not None]
    if s.get("prix_couple_home") is None:
        out["verifie"] = None
    elif chiffres:
        out["verifie"] = max(chiffres)
    else:
        out["verifie"] = max((x["verifie"] for x in liens), default=None) if s.get("prix_estime") else None
    return out


def charger_videos(chemin):
    """research/videos.json: {place id: [video]}; missing or unreadable: {}."""
    d = lire(chemin, {})
    return {str(k): [x for x in v if isinstance(x, dict)] for k, v in d.items() if isinstance(v, list)} if isinstance(d, dict) else {}


# ----------------------------------------------------------------- legs, defaults, base lines
def vols_du_parcours(trip, built):
    """vols[leg] for every leg of the trip: flight legs from flights.build, ground legs from research/trajets.json."""
    lang = trip.language
    titles = {s["key"]: s["title"] for s in trip.stages}
    trajets = lire(os.path.join(trip.research, "trajets.json"), {})
    trajets = {t.get("id"): t for t in (trajets.get("trajets", []) if isinstance(trajets, dict) else []) if isinstance(t, dict)}
    out = {}
    for leg in trip.legs:
        if leg["mode"] == "flight":
            b = (built.get("legs") or {}).get(leg["key"]) or {}
            out[leg["key"]] = {"mode": "flight", "grille": b.get("grille", []), "options": b.get("options", [])}
            continue
        t = trajets.get(leg["key"]) or {}
        frm, to = titles.get(leg["from_stage"], t.get("de", "")), titles.get(leg["to_stage"], t.get("vers", ""))
        opts = []
        for i, x in enumerate(liste(t.get("options")), start=1):
            if not isinstance(x, dict):
                continue
            prix = num(x.get("prix_couple_home"))
            lib = T("ground_line", lang, frm=frm, to=to, date=leg["date"], operator=x.get("operateur") or x.get("mode") or "")
            note = " · ".join(y for y in (x.get("remarque"), T("ground_booking", lang, text=x["reserver"]) if x.get("reserver") else "") if y)
            l = ligne(1, x["prix_couple_home"] if prix is not None else 0, lib, "releve", "avant", leg["to_stage"] or "vols", "trajets", "trajet", note or None,
                      not leg["in_budget"])
            if x.get("lien"):
                l["url"] = x["lien"]
            opts.append({"id": f"{leg['key']}-{i}", "mode": x.get("mode") or "", "operateur": x.get("operateur") or "",
                         "depart": x.get("depart"), "arrivee": x.get("arrivee"), "duree": x.get("duree") or "",
                         "lien": x.get("lien") or "", "reserver": x.get("reserver") or "", "remarque": x.get("remarque") or "",
                         "lignes": [l] if prix is not None else []})
        out[leg["key"]] = {"mode": "ground", "options": opts}
    return out


def _prix_vol(o):
    try:
        return flights.prix_retenu(o)["prix_home"]
    except (KeyError, TypeError):
        return float("inf")


def vol_defaut(trip, leg, options, quitte=None, rejoint=None):
    """Default option id of a leg (see the module docstring), or None when there is no option."""
    if not options:
        return None
    ids = [o["id"] for o in options]
    wanted = trip.defaults.get(leg["key"])
    if wanted in ids:
        return wanted
    if leg["mode"] == "ground":
        return ids[0]
    cle = lambda o: (_prix_vol(o), o.get("porte_a_porte_min") or 0, o["id"])
    ok = [o for o in options if flights.respecte_regle(o, trip.rules, quitte, rejoint)]
    return min(ok or options, key=cle)["id"]


def bases_lines(trip, formalites):
    """One line per paid formality that does not depend on a flight choice (n = adults concerned), then trip.base_lines."""
    lang_total = sum(t["adults"] for t in trip.travelers)
    adults = {t["id"]: t["adults"] for t in trip.travelers}
    labels = {t["id"]: t["label"] for t in trip.travelers}
    out = []
    for f in formalites:
        cout = f.get("cout_home")
        if f.get("condition") or isinstance(cout, bool) or not isinstance(cout, (int, float)) or cout <= 0:
            continue
        qui = str(f.get("qui") or "all")
        if qui in adults:
            n, who = adults[qui], (f"{labels[qui]} · " if len(trip.travelers) > 1 else "")
        else:
            if qui != "all":
                print(f"  ! formality {f.get('code')}: unknown traveler {qui!r}, counted for everyone", file=sys.stderr)
            n, who = lang_total, ""
        l = ligne(n, cout, who + court(f.get("titre") or f.get("code"), 110),
                  "estime" if re.search(r"estim", str(f.get("source")), re.I) else "releve", "avant", "vols", "formalites", f["code"])
        l.update(source=f.get("source"), verifie=f.get("verifie"), url=f.get("url_officielle"))
        out.append(l)
    for b in trip.base_lines:
        if isinstance(b, dict):
            out.append({"src": "estime", "etape": "vols", "cle": stays.slugify(b.get("lib")), **b})
    return out


def devise(trip):
    """trip.currency = {home, local, rate, rate_date}; rate = 1 home unit in local currency (research/taux.json)."""
    out = {"home": trip.home_currency, "local": trip.local_currency, "rate": None, "rate_date": None}
    t = lire(os.path.join(trip.research, "taux.json"), None)
    if trip.local_currency and isinstance(t, dict) and isinstance(t.get("taux"), (int, float)) and not isinstance(t["taux"], bool):
        out["rate"], out["rate_date"] = t["taux"], t.get("date")
    return out


# ----------------------------------------------------------------- assembly
def build(trip, out_dir=None, write=True, built=None):
    """Build {"parcours": …, "<stage>": {logements, sorties, autres}, …}; write the JSON files to out_dir if `write`.
    `built`: the result of flights.build(trip) when the caller already ran it (else it is run here)."""
    out_dir = out_dir or trip.media
    if built is None:
        built = flights.build(trip)
    acces = lire(os.path.join(trip.research, "acces-logements.json"), {})
    acces = {k: v for k, v in acces.items() if isinstance(v, dict)} if isinstance(acces, dict) else {}
    videos = charger_videos(os.path.join(trip.research, "videos.json"))
    index = charger_index_photos(trip.media)
    formalites = lire(os.path.join(trip.research, "formalites.json"), [])
    formalites = formalites if isinstance(formalites, list) else []
    specials = {s["key"] for s in trip.specials}

    bundles, order, verifie = {}, {}, built["verifie"]
    for st in trip.stages:
        key = st["key"]
        logs, autres, ids = [], [], []
        for groupe, _, o in stays.sources(trip, key):
            f = o.get("_fiche")
            if isinstance(f, dict) and f.get("id") and num(o.get("prix_total_home")):
                logs.append(logement(trip, st, groupe, o, f, acces, videos, index))
                ids.append(logs[-1]["id"])
                verifie = max(verifie, str(logs[-1]["prix"].get("verifie") or ""))
            else:
                autres.append(logement_court(trip, st, o, videos, index))
        order[key] = ids or [a["id"] for a in autres]
        logs.sort(key=lambda x: not x["favori"])   # favourites first, file order otherwise
        lieux = lieux_etape(trip, key)
        brut = lire(os.path.join(trip.research, f"sorties-{key}.json"), {})
        sorties = [sortie(trip, key, sid, s, lieux, videos, index) for sid, s in brut.items() if isinstance(s, dict)]
        for s in sorties:
            if s["speciale"] and s["speciale"] not in specials:
                print(f"  ! outing {s['id']}: unknown special {s['speciale']!r} (not in trip.json specials)", file=sys.stderr)
        bundles[key] = {"logements": logs, "sorties": sorties, "autres": autres}

    # default lodging per stage
    defaut = {}
    stage_default = {}
    for st in trip.stages:
        key = st["key"]
        ids = {x["id"] for k in ("logements", "autres") for x in bundles[key][k]}
        wanted = trip.defaults.get(key)
        if wanted is not None and wanted not in ids:
            print(f"  ! defaults[{key!r}] = {wanted!r} is not a lodging of this stage, ignored", file=sys.stderr)
            wanted = None
        stage_default[key] = wanted or (order[key][0] if order[key] else None)

    def acces_of(stage_key):
        if stage_key is None or stage_default.get(stage_key) is None:
            return None
        lg = next((x for x in bundles[stage_key]["logements"] if x["id"] == stage_default[stage_key]), None)
        return (lg or {}).get("acces")

    vols = vols_du_parcours(trip, built)
    for leg in trip.legs:
        defaut[leg["key"]] = vol_defaut(trip, leg, vols[leg["key"]]["options"], acces_of(leg["from_stage"]), acces_of(leg["to_stage"]))
    defaut.update(stage_default)
    defaut["sorties"] = {}
    defaut["speciales"] = {s["key"]: None for s in trip.specials}
    defaut["inclure"] = {leg["key"]: leg["in_budget"] for leg in trip.legs}

    tripblock = {"slug": trip.slug, "title": trip.title, "language": trip.language, "start": trip.start, "end": trip.end,
                 "budget_cap": trip.budget_cap, "currency": devise(trip), "travelers": trip.travelers,
                 "stages": [{"key": s["key"], "title": s["title"], "from": s["from"], "to": s["to"], "nights": s["nights"],
                             "tone": s.get("tone") or i, "file": f"parcours-{s['key']}.json"} for i, s in enumerate(trip.stages, start=1)],
                 "legs": trip.legs, "specials": trip.specials, "rules": trip.rules}
    jours = lire(os.path.join(trip.media, "jours.json"), [])
    logos = lire(os.path.join(trip.media, "logos.json"), {})
    parcours = {"verifie": verifie, "trip": tripblock, "vols": vols, "logos": logos if isinstance(logos, dict) else {},
                "formalites": formalites, "jours": jours if isinstance(jours, list) else [], "defaut": defaut,
                "bases": bases_lines(trip, formalites)}
    result = strip_example({"parcours": parcours, **bundles})
    if write:
        os.makedirs(out_dir, exist_ok=True)
        for nom, contenu in result.items():
            chemin = os.path.join(out_dir, "parcours.json" if nom == "parcours" else f"parcours-{nom}.json")
            with open(chemin, "w", encoding="utf-8") as fh:
                json.dump(contenu, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            print(f"{os.path.basename(chemin)}: {os.path.getsize(chemin) / 1024:.0f} KB")
        for st in trip.stages:
            b = result[st["key"]]
            print(f"{st['key']}: {len(b['logements'])} lodgings, {len(b['autres'])} others, {len(b['sorties'])} outings "
                  f"({sum(1 for s in b['sorties'] if s['galerie']['n'])} with photos, "
                  f"{sum(1 for s in b['sorties'] if s.get('prix_couple_home') is None)} without a price)")
        print("legs: " + ", ".join(f"{k} {len(v['options'])}" for k, v in vols.items()) + f" · {len(result['parcours']['bases'])} base lines")
        print("defaults:", json.dumps(result["parcours"]["defaut"], ensure_ascii=False))
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description="Page data of a trip, see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("--out", help="output directory (default: <trip>/site/media)")
    a = ap.parse_args(argv)
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
        build(trip, a.out)
    except (tripctx.TripError, flights.FlightsError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
