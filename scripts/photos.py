#!/usr/bin/env python3
"""High-quality photos as separate files, for the lodgings and places of a trip.

The page runs locally, so there is no size limit: each photo is downloaded at the largest size its source offers (up to
2 000 px), the useless ones are dropped at the source, and the trip's media folder receives:

  <trip>/site/media/photos/<slug>/<NN>.jpg       1 600 px (long side), progressive JPEG q82, sRGB
  <trip>/site/media/photos/<slug>/<NN>-s.jpg       600 px, q78
  <trip>/site/media/photos/lieux/<id>/<NN>.jpg   1 200 px, q80 (up to 6 per place) and <NN>-s.jpg 500 px, q78
  <trip>/site/media/photos/index.json            slug -> {n, source, credits, vue_en_tete, px...}; "lieux" -> id -> {n, source, credits}
  <trip>/site/media/photos/retraits.json         every dropped photo, with its reason

Sizes per source (checked 2026-10-28): Airbnb ?im_w=1920&im_q=highq (allowed widths 1200, 1440, 1920, 2560), Booking
.../max2048x1536/..., Agoda link without "s=1024x768" (original), Trip.com .../images/<id>.jpg (original), Google =w2000,
Wikimedia a 1 600 px thumbnail (their servers answer 429 to rapid full-size downloads, see https://w.wiki/GHai), official
sites and partners: the link as is.

Two resumable steps (a failure or an interruption only loses the lodging in progress):
  1. `telecharger`: everything the sources offer -> <trip>/research/medias-cache/<slug>/ (c001.jpg 1 600 px + c001-s.jpg + cands.json)
  2. `trier`: drops the useless photos, numbers the rest, writes the media folder and the index. Replayable from the cache.

Removals (reason -> rule; all of them are listed in retraits.json):
  reunion_banquet  the source's section (Trip.com "Multi-function room", Agoda "Meeting room"...) or the file name says so, or the
                   macOS Vision scene classification ("conference", "classroom", "wedding"...)
  hors_logement    "Attractions" of the surroundings (Agoda); floor plan, map, document, screenshot (section or Vision)
  affiche_texte    >= 20 words read with confidence, or >= 20 % of the image in text on >= 2 lines: sign, menu, poster
  personnes        a face over 1.2 % of the image (or three faces over 2.5 % in all)
  objet            close-up of an object (remote, toiletries, cutlery, glass, dish); not applied to restaurants, bars and markets
  format           banner (ratio > 3.5) or almost uniform image
  doublon          same photo (64-bit dHash within 10 bits + close colours): the biggest copy is kept
  petite           under 640 px; or under 800 px when at least 10 bigger photos exist
  plafond          beyond MAX_LOGEMENT photos: first photo of each section, then the second, rooms before the rest
The photo of the view from the room (`photo_cover`) goes first and is never dropped by the visual rules (`vue_en_tete: true`).

The Vision analysis (scene, faces, text) needs macOS and `swiftc`; elsewhere the sort step reports "skipped" and applies
only the section and format rules (every photo is kept otherwise).

Manual photo sources (optional): <trip>/research/sources-photos.json = {slug: {"agoda": [hotel ids], "trip": [hotel ids],
"site": [urls]}}, for lodgings whose listing carries no identifier.

Usage (always with -I; the trip defaults to the active one):
  python3 -I scripts/photos.py [--trip DIR] telecharger [slug ...] [--force] [--part=2/3]
  python3 -I scripts/photos.py [--trip DIR] trier [slug ...]
  python3 -I scripts/photos.py [--trip DIR] lieux [id ...] [--force]     photos of the places (up to 6 each)
  python3 -I scripts/photos.py [--trip DIR] imports [id ...] [--force]   places imported from a video (<trip>/research/imports/*/lieux.json)
  python3 -I scripts/photos.py [--trip DIR] tout                         telecharger + trier + lieux
  python3 -I scripts/photos.py [--trip DIR] inventaire                   sizes, counts, removals per reason
"""
import concurrent.futures as cf
import datetime as dt
import glob
import io
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import threading
import ssl
import time
import urllib.parse
import urllib.request

try:
    from PIL import Image, ImageCms, ImageOps, ImageStat
except ImportError:  # Pillow missing: main() says so in one line
    Image = ImageCms = ImageOps = ImageStat = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_PILLOW = "Pillow (the image library) is not installed, so no photos were made. Run: python3 scripts/setup.py status"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import days  # noqa: E402
import gallery_sources as GS  # noqa: E402
import stays  # noqa: E402
import tripctx  # noqa: E402

SWIFT = os.path.join(ROOT, "scripts", "medias_vision.swift")
# Per-trip paths and settings, set by configure(trip) (tests patch them one by one)
TRIP = None
OUT = INDEX = RETRAITS = CACHE = BIN = IMPORTS = MANUAL = ""
ID_IMPORT = re.compile(r"^(?!)$")   # an imported place's id: <stage>-imp-<entry>-NN (see configure)


def configure(trip):
    """Point every path and the stage-dependent patterns at `trip`."""
    global TRIP, OUT, INDEX, RETRAITS, CACHE, BIN, IMPORTS, MANUAL, ID_IMPORT
    TRIP = trip
    OUT = os.path.join(trip.media, "photos")
    INDEX = os.path.join(OUT, "index.json")
    RETRAITS = os.path.join(OUT, "retraits.json")
    CACHE = os.path.join(trip.research, "medias-cache")
    BIN = os.path.join(CACHE, ".bin", "medias_vision")
    IMPORTS = os.path.join(trip.research, "imports")
    MANUAL = os.path.join(trip.research, "sources-photos.json")
    keys = "|".join(re.escape(s["key"]) for s in trip.stages)
    ID_IMPORT = re.compile(rf"^({keys})-imp-[a-z0-9]{{1,16}}-\d{{2,3}}$")


def stage_keys():
    return [s["key"] for s in TRIP.stages]

# Noms de dossiers : un slug de logement ou un id de lieu devient un dossier de OUT ou de CACHE, que l'on peut
# supprimer (rmtree). Un id lu dans research/imports/*/lieux.json est écrit par l'analyse d'une vidéo (texte venu
# d'Internet) : il doit avoir la forme donnée par `imports.py id`, et tout chemin est vérifié avant d'y toucher.
NOM_DOSSIER = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


class CheminRefuse(Exception):
    """Un nom de dossier hors du motif, ou un chemin qui sortirait de site/media/photos/ ou de research/medias-cache/."""


def dossier_sur(racine, *noms):
    """<racine réelle>/<nom>/… : chaque nom suit NOM_DOSSIER, et ni le dossier ni son « .tmp » ne sont des liens
    symboliques (realpath identique au chemin) : le chemin reste strictement sous `racine` (OUT ou CACHE).
    Lève CheminRefuse sinon — à appeler avant tout rmtree / rename."""
    chemin = os.path.realpath(racine)
    for nom in noms:
        if not isinstance(nom, str) or not NOM_DOSSIER.match(nom):
            raise CheminRefuse(f"folder name refused: {nom!r}")
        chemin = os.path.join(chemin, nom)
        if os.path.realpath(chemin) != chemin:
            raise CheminRefuse(f"{chemin} is a symbolic link: refused")
    if os.path.realpath(chemin + ".tmp") != chemin + ".tmp":
        raise CheminRefuse(f"{chemin}.tmp is a symbolic link: refused")
    return chemin

# --- tailles et qualités (consigne de la tâche 21)
GRAND_PX, GRAND_Q = 1600, 82
PETIT_PX, PETIT_Q = 600, 78
LIEU_PX, LIEU_Q, LIEU_PETIT_PX = 1200, 80, 500
SOURCE_PX = 2000  # plafond de ce qu'on demande aux sources
MAX_LOGEMENT = 80  # au-delà : les sources en renvoient des centaines (Agoda : 270 pour un resort, dont 150 de chambres répétées)
MAX_LIEU = 6
MIN_PX = 640  # sous ce grand côté, une image est une vignette : jamais gardée
PX_CONFORT = 800  # sous ce grand côté, une photo est écartée si au moins MIN_CONFORT autres photos sont plus grandes
MIN_CONFORT = 10
DOUBLON_BITS = 10  # écart maximal (sur 64 bits) de l'empreinte dHash entre deux copies de la même photo : une autre découpe de la
                   # même photo tombe vers 10, deux photos distinctes de la même pièce commencent vers 11-14 (paires réelles, 2026-10-28)
DOUBLON_COULEUR = 48  # et écart maximal de la couleur moyenne (0-255 par canal, 4×4 cases) : deux pièces semblables mais différentes passent
COUVERTURE_BITS = 14  # écart maximal pour reconnaître la photo choisie à la main parmi les nouvelles
def sources_manuelles(slug, cle):
    """Manual photo sources of a lodging from <trip>/research/sources-photos.json: ids or urls for "agoda", "trip", "site"."""
    d = days.read(os.path.basename(MANUAL), {}, os.path.dirname(MANUAL)) if MANUAL else {}
    v = (d.get(slug) or {}).get(cle) if isinstance(d, dict) else None
    return [str(x) for x in v] if isinstance(v, list) else []


REGLES = {  # seuils des règles visuelles (consignés dans retraits.json)
    "reunion": {"conference": 0.35, "classroom": 0.40, "wedding": 0.45, "theater": 0.45, "wedding_cake": 0.4},
    "hors_logement": {"document": 0.65, "screenshot": 0.5, "diagram": 0.5, "map": 0.5, "illustrations": 0.7},
    "affiche_texte": {"aire": 0.20, "lignes": 2, "mots": 20},
    "personnes": {"visage": 0.012, "trois_visages": 0.025},
    "format": {"rapport_max": 3.5, "rapport_min": 0.4, "ecart_type_min": 12},
    "plan": {"dessin": 0.2, "lignes": 2, "ecart_type_max": 30},
}

# Rubriques de la source (Trip.com, Agoda, Airbnb) et noms de fichiers qui disent « pas une photo du logement ».
RE_REUNION = re.compile(
    r"meeting|conference|conférence|réunion|reunion|boardroom|business ?cent|séminaire|seminar|multi-?function|multifonction|"
    r"salle polyvalente|function ?room|ballroom|salle de bal|banquet|wedding|mariage|salle de f[eê]te|events? ?(space|hall|room)|"
    r"salle d.événement|auditorium|congress|congrès|classroom|training ?room|convention", re.I)
RE_HORS = re.compile(r"attractions?\b", re.I)  # « Facility photos / Attractions », « Nearby attraction / Lumphini Park » (Agoda) : les environs, pas le logement
# Rubriques qui annoncent parfois un plan ou une affiche, parfois une vue aérienne : écartées seulement si Vision y voit un dessin ou du texte
RE_PLAN = re.compile(r"floor ?plan|plan d.étage|site ?map|\bmap\b|brochure|poster|affiche|\blogo\b|certificat|signage|panneau", re.I)

FOURNISSEURS = (("muscache.com", "Airbnb"), ("bstatic.com", "Booking.com"), ("agoda.net", "Agoda"), ("tripcdn.com", "Trip.com"),
                ("googleusercontent.com", "Google Maps"), ("wikimedia.org", "Wikimedia Commons"), ("tripadvisor", "Tripadvisor"),
                ("michelin", "Guide Michelin"),
                ("timeout.com", "Time Out"), ("getyourguide", "GetYourGuide"), ("supabase.co", "Wanderlog"))


# ============================================================================================ links at full size
WIKI_PX = 1600   # Wikimedia asks for thumbnails, not originals (HTTP 429 on rapid full-size downloads, see https://w.wiki/GHai)


def wikimedia_thumb(url, px=WIKI_PX):
    """upload.wikimedia.org original (/wikipedia/commons/<a>/<ab>/<File>) -> its `px`-wide thumbnail
    (/wikipedia/commons/thumb/<a>/<ab>/<File>/<px>px-<File>). Any other link is returned unchanged."""
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/[a-z-]+)/([0-9a-f]/[0-9a-f]{2})/([^/?#]+)$", url)
    if not m:
        return url
    return f"{m.group(1)}/thumb/{m.group(2)}/{m.group(3)}/{px}px-{m.group(3)}"


def variantes(url):
    """Liens à essayer pour obtenir la photo en grand (jusqu'à SOURCE_PX), du plus grand au lien d'origine."""
    u = str(url).strip()
    p = urllib.parse.urlparse(u)
    host, out = p.netloc.lower(), []
    if host.endswith("muscache.com"):
        out.append(u.split("?")[0] + "?im_w=1920&im_q=highq")
    elif host.endswith("bstatic.com") and "/images/hotel/" in p.path:
        out.append(re.sub(r"/images/hotel/[^/]+/", "/images/hotel/max2048x1536/", u, count=1))
    elif host.endswith("agoda.net"):
        out.append(GS.agoda_original(u))
    elif host.endswith("tripcdn.com") and "/images/" in p.path:
        m = re.search(r"/images/([^/_.?]+)", p.path)
        if m:
            out.append(f"https://{p.netloc}/images/{m.group(1)}.jpg")
    elif host.endswith("googleusercontent.com"):
        out.append((re.sub(r"=[swh]\d[^/?]*$", "", u) if re.search(r"=[swh]\d[^/?]*$", u) else u) + f"=w{SOURCE_PX}")
    elif "wikimedia.org" in host and "/thumb/" in p.path:
        out.append(re.sub(r"/(\d+)px-([^/]+)$", rf"/{WIKI_PX}px-\2", u))
    elif host == "upload.wikimedia.org":
        out.append(wikimedia_thumb(u))
    else:
        out.append(GS._full_size(u))  # miniatures WordPress « -300x200 »
    out.append(u)
    return list(dict.fromkeys(out))


def fournisseur(url, source=""):
    """Qui crédite-t-on pour ce lien ? (nom court)"""
    host = urllib.parse.urlparse(url).netloc.lower()
    for frag, nom in FOURNISSEURS:
        if frag in host:
            return nom
    if source == "site officiel":
        return "the venue's own site"
    return "the venue's own site" if host else "unknown"


# ============================================================================================ lodgings and their sources
# Sites that are not a lodging's own site (aggregators, press, blogs, booking): never explored.
NOT_OFFICIAL = re.compile(
    r"booking\.com|trip\.com|agoda\.com|tripadvisor|trivago|12go|google\.|goo\.gl|wanderlog|michelin|youtube|facebook|instagram|"
    r"kiwi\.com|expedia|hotels\.com|klook|viator|getyourguide|airbnb|zenhotels|hotelscombined|kayak|"
    r"reddit|wikipedia|timeout|oyster|robbreport|headforpoints|yeogi|hichee|rentbyowner|casai|exa\.ai|milesopedia|luxuryescapes|"
    r"dertour|saku-|familytravelgenie|freepass|wongnai|bing\.com|tiktok|pinterest|tripcdn|bstatic", re.I)
GENERIC = {"resort", "hotel", "spa", "villa", "villas", "beach", "adult", "adults", "only", "residence", "suites", "suite",
           "retreat", "boutique", "house", "view", "seaview", "pool", "luxury", "collection", "centre", "center",
           "convention", "the", "and", "with"}


def dhash(im):
    """64-bit fingerprint: two almost identical photos (other size, other compression) have close fingerprints."""
    g = im.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for r in range(8):
        for c in range(8):
            bits = (bits << 1) | (px[r * 9 + c] > px[r * 9 + c + 1])
    return bits


def lodging_urls(o):
    """Every http(s) link written in the lodging record (photos excepted), the most direct first."""
    d = {k: v for k, v in o.items() if k not in ("photo_urls", "_u")}
    txt = json.dumps(d, ensure_ascii=False)
    return list(dict.fromkeys(u.rstrip(".,;") for u in re.findall(r"https?://[^\s\"\\)\]>]+", txt)))


def _tokens(o):
    name = re.split(r" \u2013 | - |\(|\u00ab", str(o.get("nom", "")))[0]
    return [t for t in stays.slugify(name).split("-") if len(t) >= 4 and t not in GENERIC]


def official_sites(o, slug, urls):
    """Home pages of the sites whose domain carries a distinctive word of the lodging's name."""
    tokens = _tokens(o)
    out = []
    for u in urls:
        p = urllib.parse.urlparse(u)
        host = p.netloc.lower().replace("www.", "")
        if not host or NOT_OFFICIAL.search(host):
            continue
        letters = re.sub(r"[^a-z0-9]", "", host.rsplit(".", 1)[0])
        if any(t in letters for t in tokens):
            root = f"{p.scheme}://{p.netloc}/"
            if root not in out:
                out.append(root)
    return out[:2]


def plausible(o, found):
    """Does the name found on Trip.com / Agoda look like the lodging? (one distinctive word in common, else be wary)"""
    tokens = _tokens(o)
    flat = stays.slugify(found).replace("-", "")
    return not tokens or any(t in flat for t in tokens)


def imports_logements():
    """[(stage, lodging, slug)] of the lodgings imported from a video (<trip>/research/imports/*/lieux.json, type "logement")."""
    out = []
    for path in sorted(glob.glob(os.path.join(IMPORTS, "*", "lieux.json"))):
        d = lire_json(path, None)
        if not isinstance(d, dict) or d.get("type") != "logement" or d.get("etape") not in stage_keys():
            continue
        for o in d.get("lieux") or []:
            if isinstance(o, dict) and (o.get("id") or o.get("nom")):
                out.append((d["etape"], o, stays.slug_of(o, d["etape"])))
    return out


def affiches():
    """[(stage, lodging, slug)] of every lodging shown on the page."""
    return [(k, o, stays.slug_of(o, k)) for k in stage_keys() for _g, _f, o in stays.sources(TRIP, k)] + imports_logements()


# ============================================================================================ images
def vers_srgb(im):
    """Image RGB en sRGB : profil ICC converti (Display P3, Adobe RGB…), transparence posée sur du blanc."""
    icc = im.info.get("icc_profile")
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        fond = Image.new("RGB", im.size, (255, 255, 255))
        rgba = im.convert("RGBA")
        fond.paste(rgba, mask=rgba.split()[3])
        return fond
    if icc and im.mode in ("RGB", "CMYK", "L"):
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            nom = ImageCms.getProfileDescription(src) or ""
            if im.mode == "CMYK" or "srgb" not in nom.lower():
                return ImageCms.profileToProfile(im, src, ImageCms.createProfile("sRGB"), outputMode="RGB")
        except Exception:
            pass
    return im.convert("RGB")


def ouvrir(data):
    im = Image.open(io.BytesIO(data))
    im.load()
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)
    if icc and "icc_profile" not in im.info:
        im.info["icc_profile"] = icc
    return vers_srgb(im)


def ecrire(im, chemin, grand_cote, qualite):
    """JPEG progressif sRGB, sans métadonnées, au plus `grand_cote` px ; jamais agrandi. Renvoie la taille écrite."""
    w, h = im.size
    s = min(1.0, grand_cote / max(w, h))
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    im.save(chemin, "JPEG", quality=qualite, optimize=True, progressive=True)
    return im.size


def empreinte(im):
    """(dHash 64 bits, couleurs moyennes 4×4) : deux copies de la même photo ont les deux proches."""
    g = dhash(im)
    c = im.resize((4, 4), Image.BOX)
    return g, list(c.tobytes())


def meme_photo(a, b):
    """a, b = (dhash, couleurs). Même photo ? (écart dHash ≤ DOUBLON_BITS et couleurs proches)"""
    d = bin(a[0] ^ b[0]).count("1")
    if d > DOUBLON_BITS:
        return False, d
    return max(abs(x - y) for x, y in zip(a[1], b[1])) <= DOUBLON_COULEUR, d


def ecart_type(im):
    return ImageStat.Stat(im.convert("L").resize((64, 64))).stddev[0]


UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36")
UA_WIKI = "trip-planner/1.0 (+https://github.com/lsidore/trip-planner)"   # Wikimedia asks for a descriptive User-Agent
WIKI_DELAY = 0.6      # seconds between two Wikimedia downloads (they are sequential, whatever the thread count)
_WIKI = threading.Lock()
_WIKI_LAST = [0.0]
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)
SANS_IMAGE = re.compile(r"\.(?:js|css|json|php|svg|gif|ico|woff2?|ttf|map|xml|html?)(?:\?|$)", re.I)  # a page link, not an image


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def lire_url(url, timeout=45):
    url = urllib.parse.quote(url, safe="%/:=&?~#+!$,;'@()*[]")  # spaces and accents of a site link: encoded
    if "wikimedia.org" in url:
        with _WIKI:   # one download at a time, with a pause
            wait = _WIKI_LAST[0] + WIKI_DELAY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA_WIKI})
                with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                    return r.read()
            finally:
                _WIKI_LAST[0] = time.monotonic()
    return get(url, timeout=timeout)


def telecharger_un(urls, site=False, tries=4):
    """(image, url retenue, octets) ou (None, raison) : essaie les liens dans l'ordre, un second essai sur erreur réseau."""
    raison = "no link"
    for url in urls:
        for essai in range(tries):
            try:
                data = lire_url(url, timeout=45)
            except Exception as e:  # noqa: BLE001
                raison = f"{type(e).__name__} {str(e)[:60]}"
                if "404" in raison or "403" in raison or "400" in raison:
                    break
                time.sleep(6 * (essai + 1) if "429" in raison else 1.5)
                if "429" not in raison and essai >= 1:
                    break
                continue
            if len(data) < 6000:
                raison = f"too light ({len(data)} bytes)"
                break
            try:
                im = ouvrir(data)
            except Exception as e:  # noqa: BLE001
                raison = f"unreadable ({type(e).__name__})"
                break
            if max(im.size) < MIN_PX or min(im.size) < MIN_PX * 0.45:
                raison = f"too small ({im.size[0]}×{im.size[1]})"
                break
            if site and not 1.25 <= im.width / im.height <= 2.0:
                raison = "poster format (official site)"
                break
            return im, url, len(data)
    return None, raison, 0


# ============================================================================================ sources de candidats
def cand(source, urls, label="", rang=None, **kw):
    return dict({"source": source, "urls": urls if isinstance(urls, list) else [urls], "label": label, "rang": rang}, **kw)


def candidats_airbnb(room_id):
    """Photos de l'annonce (page publique) avec leur rubrique (« Bedroom 1 image 2 » → « Bedroom 1 »). Les vignettes de
    l'interface (PNG, sans rubrique) ne sont pas des photos de l'annonce."""
    html = get(f"https://www.airbnb.com/rooms/{room_id}").decode("utf-8", "ignore")
    out, vus = [], set()
    for m in re.finditer(r'"baseUrl":"(https://a0\.muscache\.com/im/pictures/[^"]+)"', html):
        u = m.group(1)
        if u in vus or "/user/" in u or "platformassets" in u.lower().replace("-", ""):
            continue
        vus.add(u)
        lab = re.findall(r'"accessibilityLabel":(null|"[^"]*")', html[max(0, m.start() - 200):m.start()])
        lab = json.loads(lab[-1]) if lab and lab[-1] != "null" else None
        if not lab:
            continue
        out.append(cand("Airbnb", variantes(u), re.sub(r"\s+image \d+$", "", lab), len(out)))
    return out


def candidats_liens(o):
    """Liens d'images fournis par les chercheurs (`photo_urls`) : Booking, Agoda, Trip.com, Google, site de l'hôtel…"""
    urls = [u for u in (o.get("photo_urls") or []) if isinstance(u, str) and u.startswith("http")]
    return [cand("liens fournis", variantes(u), "", k, origine=u) for k, u in enumerate(urls)]


def candidats_trip(o, slug):
    out, ids = [], sources_manuelles(slug, "trip")
    for u in lodging_urls(o):
        m = re.search(r"trip\.com.*[?&]hotelId=(\d+)", u)
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
    for hid in ids[:2]:
        imgs, titre = GS.trip_images(hid)
        if imgs and not plausible(o, titre):
            print(f"  ! {slug}: Trip.com {hid} is called '{titre[:50]}', ignored", flush=True)
            continue
        for im in imgs:
            alt = f"https://ak-d.tripcdn.com/images/{im['id']}_Z_1280_853_R50_Q90.jpg"
            out.append(cand("Trip.com", [im["url"], alt], im["label"], len(out)))
    return out


def candidats_agoda(o, slug):
    ids = sources_manuelles(slug, "agoda")
    for u in lodging_urls(o):
        if "agoda.com" in u:
            hid = GS.agoda_id(u)
            if hid and hid not in ids:
                ids.append(hid)
    out = []
    for hid in ids[:2]:
        imgs, nom = GS.agoda_images(hid)
        if imgs and not plausible(o, nom):
            print(f"  ! {slug}: Agoda {hid} is called '{nom[:50]}', ignored", flush=True)
            continue
        for im in imgs:
            out.append(cand("Agoda", variantes(im["url"]), im["label"], len(out)))
    return out


def candidats_site(o, slug):
    urls = lodging_urls(o)
    sites = sources_manuelles(slug, "site") or official_sites(o, slug, urls)
    return [cand("site officiel", variantes(u), "", k, site=True) for s in sites[:1] for k, u in enumerate(GS.site_urls(s)[:80])]


def collecter(slug, etape, o):
    """Tous les candidats d'un logement, dans l'ordre de priorité : Airbnb / liens des chercheurs, Trip.com, Agoda,
    site officiel (si peu de photos)."""
    cands = []
    m = re.search(r"airbnb\.[a-z.]+/rooms/(\d+)", str(o.get("url", "")))
    if m:
        try:
            cands += candidats_airbnb(m.group(1))
        except Exception as e:  # noqa: BLE001
            print(f"  ! {slug} : Airbnb {type(e).__name__} {e}", flush=True)
    cands += candidats_liens(o)
    for lecteur in (candidats_trip, candidats_agoda):
        try:
            cands += lecteur(o, slug)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {slug} : {lecteur.__name__} {type(e).__name__} {e}", flush=True)
        time.sleep(0.3)
    if len(cands) < 40:
        try:
            cands += candidats_site(o, slug)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {slug} : site officiel {type(e).__name__} {e}", flush=True)
    # même lien demandé deux fois (Trip.com : un identifiant dans plusieurs rubriques) : une fois
    vus, uniques = set(), []
    for c in cands:
        cle = c["urls"][0] if c["urls"] else c["fichier"]
        if cle not in vus:
            vus.add(cle)
            uniques.append(c)
    return uniques


def indice_couverture(o):
    """Rang de la photo de la vue dans la liste de sa source (champ `photo_cover`, 1 = première), ou None."""
    c = o.get("photo_cover")
    return c if isinstance(c, int) and not isinstance(c, bool) and c >= 1 else None


# ============================================================================================ temps 1 : télécharger
def dossier_cache(slug):
    return dossier_sur(CACHE, slug)


def telecharger(slug, etape, o, workers=8):
    """Télécharge tous les candidats d'un logement dans research/medias-cache/<slug>/. Renvoie un petit bilan."""
    d = dossier_cache(slug)
    tmp = d + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    cands = collecter(slug, etape, o)

    def un(args):
        k, c = args
        im, url, n = telecharger_un(c["urls"], c.get("site", False))
        return k, im, url, n
    meta, echecs = [], []
    with cf.ThreadPoolExecutor(workers) as ex:
        for debut in range(0, len(cands), 3 * workers):  # par lots : les images décodées (≈ 9 Mo) ne s'accumulent pas
            for k, im, url, n in ex.map(un, list(enumerate(cands))[debut:debut + 3 * workers]):
                c = cands[k]
                if im is None:
                    echecs.append({"url": (c["urls"] or [""])[-1], "source": c["source"], "raison": url})
                    continue
                cid = f"c{k:03d}"
                ecrire(im, os.path.join(tmp, cid + ".jpg"), GRAND_PX, GRAND_Q)
                ecrire(im, os.path.join(tmp, cid + "-s.jpg"), PETIT_PX, PETIT_Q)
                h, col = empreinte(im)
                meta.append({"id": cid, "ordre": k, "source": c["source"], "label": c["label"], "rang": c["rang"],
                             "url": c.get("origine") or url, "px": list(im.size), "octets": n, "hash": h, "couleur": col,
                             "sd": round(ecart_type(im), 1), "couverture": bool(c.get("couverture")),
                             "fournisseur": fournisseur(url, c["source"])})
    couv = indice_couverture(o)
    info = {"slug": slug, "fait": dt.date.today().isoformat(), "nom": o.get("nom", ""), "photo_cover": couv,
                        "candidats": meta, "echecs": echecs}
    with open(os.path.join(tmp, "cands.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False)
    shutil.rmtree(d, ignore_errors=True)
    os.rename(tmp, d)
    par_source = {}
    for m in meta:
        par_source[m["source"]] = par_source.get(m["source"], 0) + 1
    return {"candidats": len(cands), "images": len(meta), "echecs": len(echecs), "par_source": par_source}


# ============================================================================================ temps 2 : trier
def vision_prete():
    """Compiles the Vision helper (scripts/medias_vision.swift) when needed. False unless this is macOS with `swiftc`."""
    if sys.platform != "darwin" or not shutil.which("swiftc"):
        return False
    if os.path.exists(BIN) and os.path.getmtime(BIN) >= os.path.getmtime(SWIFT):
        return True
    os.makedirs(os.path.dirname(BIN), exist_ok=True)
    try:
        r = subprocess.run(["swiftc", "-O", SWIFT, "-o", BIN], capture_output=True, text=True, timeout=300)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def vision_note():
    """One line saying whether the Vision analysis (scene, faces, text) runs in the sort step."""
    if sys.platform != "darwin" or not shutil.which("swiftc"):
        return "skipped (needs macOS with swiftc): only the section and format rules apply, every other photo is kept"
    return "on"


def analyser(chemins, workers=4, lot=40):
    """{chemin: caractéristiques Vision} (labels, visages, texte) ; {} si Vision n'est pas disponible."""
    if not chemins or not vision_prete():
        return {}
    lots = [chemins[i:i + lot] for i in range(0, len(chemins), lot)]

    def un(lot_):
        r = subprocess.run([BIN] + lot_, capture_output=True, text=True, timeout=600)
        out = {}
        for ligne in r.stdout.splitlines():
            try:
                d = json.loads(ligne)
            except ValueError:
                continue
            if "erreur" not in d:
                out[d["f"]] = d
        return out
    res = {}
    with cf.ThreadPoolExecutor(workers) as ex:
        for part in ex.map(un, lots):
            res.update(part)
    return res


def texte_libelle(c):
    txt = c.get("label") or ""
    if c["source"] in ("site officiel", "liens fournis"):
        txt += " " + urllib.parse.unquote(urllib.parse.urlparse(c.get("url") or "").path.rsplit("/", 1)[-1])
    return txt


def motif_libelle(c):
    """(raison, détail) si la rubrique de la source ou le nom du fichier écarte la photo à coup sûr, sinon None."""
    txt = texte_libelle(c)
    if RE_REUNION.search(txt):
        return "reunion_banquet", f"section '{c.get('label') or txt.strip()}' ({c['source']})"
    if RE_HORS.search(txt):
        return "hors_logement", f"section '{c.get('label') or txt.strip()}' ({c['source']})"
    return None


def motif_plan(c, f, regles=REGLES):
    """Rubrique « plan / affiche » : écartée seulement si l'image est un dessin ou du texte (Vision), pas une vue aérienne."""
    if not RE_PLAN.search(texte_libelle(c)):
        return None
    r = regles["plan"]
    labels = dict((f or {}).get("labels") or [])
    dessin = max([labels.get(k, 0) for k in ("diagram", "illustrations", "document", "map", "screenshot", "drawing")] or [0])
    t = (f or {}).get("texte") or {}
    if dessin >= r["dessin"] or t.get("lignes", 0) >= r["lignes"] or c.get("sd", 99) < r["ecart_type_max"]:
        return "hors_logement", f"section '{c.get('label') or texte_libelle(c).strip()}' and drawing / text (Vision: {dessin:.2f}, {t.get('lignes', 0)} lines)"
    return None


def motif_visuel(c, f, regles=REGLES, objets=None):
    """(raison, détail) d'après l'analyse Vision `f` et les mesures de l'image `c`, sinon None. Pas de f : seulement le format.
    `objets` : étiquettes qui font un gros plan d'objet (OBJETS par défaut ; objets_pour(catégorie) pour un lieu)."""
    w, h = c["px"]
    r = regles["format"]
    if w / h > r["rapport_max"] or w / h < r["rapport_min"]:
        return "format", f"aspect ratio {w / h:.2f}"
    if c.get("sd", 99) < r["ecart_type_min"]:
        return "format", f"almost uniform image (std dev {c['sd']})"
    if not f:
        return None
    labels = dict(f.get("labels") or [])
    for nom, seuil in regles["reunion"].items():
        if labels.get(nom, 0) >= seuil:
            return "reunion_banquet", f"Vision: '{nom}' {labels[nom]:.2f}"
    for nom, seuil in regles["hors_logement"].items():
        if labels.get(nom, 0) >= seuil:
            return "hors_logement", f"Vision: '{nom}' {labels[nom]:.2f}"
    t, r = f.get("texte") or {}, regles["affiche_texte"]
    if t.get("mots", 0) >= r["mots"] or (t.get("aire", 0) >= r["aire"] and t.get("lignes", 0) >= r["lignes"]):
        return "affiche_texte", f"text: {t.get('mots', 0)} words on {t.get('lignes', 0)} lines, {t.get('aire', 0):.0%} of the image"
    vis = sorted(f.get("visages") or [], reverse=True)
    p = regles["personnes"]
    if vis and (vis[0] >= p["visage"] or sum(vis[:3]) >= p["trois_visages"]):
        return "personnes", f"face(s): {vis[0]:.1%} of the image"
    obj = motif_objet(labels, f.get("blanc", 0.0), OBJETS if objets is None else objets)
    if obj:
        return "objet", obj
    return None


# Étiquettes de lieu (pas celles de matière ou de meuble, qui apparaissent aussi sur un gros plan : « structure », « furniture »,
# « material »…) : si l'une d'elles est reconnue à 0,35 ou plus, l'image montre un lieu et non un objet seul.
SCENE = {"indoor", "outdoor", "interior_room", "interior_shop", "living_room", "bedroom", "bathroom_room", "kitchen_room",
         "dining_room", "restaurant", "health_club", "sky", "blue_sky", "cloudy", "water", "water_body", "pool", "ocean", "beach",
         "sand", "mountain", "hill", "land", "grass", "tree", "palm_tree", "forest", "balcony", "patio", "garden", "building",
         "city", "street", "road", "cityscape", "skyline", "terrace", "lobby", "bar", "spa", "hallway", "stairs", "ceiling",
         "domicile", "house_single", "apartment", "villa", "hut", "cabin", "bed", "sofa", "bathtub", "shower", "fireplace"}
# Ce qui domine un gros plan : produit de toilette, télécommande, interrupteur, couvert, verre…
OBJETS = {"remote_control", "keypad", "light_switch", "switch", "outlet", "electronics", "computer_keyboard", "computer_mouse",
          "phone", "payphone", "soap", "toiletries", "cosmetics", "razor", "toothbrush", "key", "credit_card", "gift_card", "pen",
          "office_supplies", "sticker", "packaging", "paper_bag", "cardboard_box", "tissue", "coin", "thermostat", "bottle",
          "tableware", "utensil", "drinking_glass", "plate", "cord", "crib", "pillow", "bedding", "textile"}
# Ce qu'on vient chercher dans un restaurant, un bar, un marché : plats, verres, bouteilles (décision du contrôleur, 2026-10-28)
OBJETS_TABLE = {"plate", "tableware", "utensil", "drinking_glass", "bottle"}
CATEGORIES_TABLE = re.compile(r"restaurant|street ?food|café|cafe|\bbar\b|rooftop|soirée|marché|market|food|cuisine|brunch", re.I)


def objets_pour(categorie):
    """Étiquettes d'objet qui écartent un gros plan pour un lieu de cette catégorie : sans les plats, verres et bouteilles pour
    un restaurant, un bar, un marché, un lieu de street food (« restaurant », « bar / rooftop », « marché »…) ; OBJETS sinon."""
    return OBJETS - OBJETS_TABLE if CATEGORIES_TABLE.search(str(categorie or "")) else OBJETS


def motif_objet(labels, blanc=0.0, objets=OBJETS):
    """Gros plan d'un objet : aucun lieu reconnu (≥ 0,35) et soit une étiquette d'objet (`objets`) domine (≥ 0,35), soit plus rien
    de net (meilleure étiquette < 0,30) sur un fond en grande partie blanc (≥ 40 % : produit photographié en studio, plan dessiné).
    Une vue aérienne n'a pas non plus d'étiquette nette, mais elle n'a pas de fond blanc : elle reste."""
    if not labels:
        return None
    if max((labels.get(s, 0) for s in SCENE), default=0) >= 0.35:
        return None
    haut = max(labels.items(), key=lambda kv: kv[1])
    if haut[0] in objets and haut[1] >= 0.35:
        return f"Vision: '{haut[0]}' {haut[1]:.2f}, no place recognised"
    if haut[1] < 0.30 and blanc >= 0.40:
        return f"Vision: no place or clear subject ('{haut[0]}' {haut[1]:.2f}), white background {blanc:.0%}"
    return None


def groupes(cands):
    """Groupes de copies de la même photo (union-find sur meme_photo). Renvoie [[indices]] et {(i, j): distance}."""
    n = len(cands)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    dist = {}
    emp = [(c["hash"], c["couleur"]) for c in cands]
    for i in range(n):
        for j in range(i + 1, n):
            ok, d = meme_photo(emp[i], emp[j])
            if ok:
                dist[(i, j)] = d
                parent[find(j)] = find(i)
    out = {}
    for i in range(n):
        out.setdefault(find(i), []).append(i)
    return list(out.values()), dist


# Rang d'une rubrique de la source dans la galerie : l'établissement vu de dehors et ses vues, puis les chambres (la priorité du
# voyage : les logements), la piscine et la plage, la table, enfin le reste (spa, salle de sport, club enfants, hall…).
# On teste dans cet ordre : « Room photos / Sea View Suite » est une chambre, pas une vue.
RANGS = ((1, re.compile(r"room|chambre|suite|villa|bungalow|bedroom|bathroom|salle de bain|pavilion|loft|cottage|penthouse|living|salon", re.I)),
         (2, re.compile(r"pool|piscine|beach|plage|garden|jardin|terrace|terrasse|sunset|infinity|water", re.I)),
         (0, re.compile(r"propert(y|ies) view|exterior|extérieur|en-tête|\bview\b|^vue|vue sur|panoram|aerial|façade|surrounding|environnement|entrance", re.I)),
         (3, re.compile(r"dining|restaurant|\bbar\b|breakfast|food|beverage|coffee|café|lounge|buffet", re.I)))


def rang_rubrique(label):
    """0 vues et extérieur · 1 chambres · 2 piscine et plage · 3 table · 4 le reste ; 2 si la source ne dit rien."""
    if not label:
        return 2
    return next((r for r, rx in RANGS if rx.search(label)), 4)


def cle_ordre(c):
    """Clé de tri de la galerie : d'abord les photos des chercheurs et de l'annonce (Airbnb) dans leur ordre ; ensuite Trip.com,
    Agoda, site officiel, rangés par rubrique (rang_rubrique) puis dans l'ordre de la source."""
    if c["source"] in ("Airbnb", "liens fournis"):
        return (0, 0, c["ordre"])
    return (1, rang_rubrique(c.get("label") or ""), c["ordre"])


def rubrique(c):
    """Rubrique d'un candidat Trip.com / Agoda (chambre de même nom = même rubrique) ; '' pour les autres sources."""
    if c["source"] not in ("Trip.com", "Agoda") or not c.get("label"):
        return ""
    return re.sub(r"\s+", " ", c["label"]).strip().lower()


def trier_logement(info, features, regles=REGLES, max_logement=MAX_LOGEMENT):
    """info = contenu de cands.json ; features = {id: analyse Vision}. Renvoie (gardés, retraits) : gardés = liste de
    candidats dans l'ordre final (le premier est la photo de la vue si `vue` est vrai), retraits = [{photo, raison…}]."""
    cands = info["candidats"]
    retraits = []

    def retrait(c, raison, detail):
        retraits.append({"photo": c["id"], "source": c["source"], "url": c.get("url") or "", "label": c.get("label") or "",
                         "px": c["px"], "raison": raison, "detail": detail})
    grp, dist = groupes(cands)
    # la photo de la vue : choisie à la main (0-cover.jpg), sinon `photo_cover` (rang dans la liste de sa source)
    couv_idx = next((i for i, c in enumerate(cands) if c.get("couverture")), None)
    if couv_idx is None and info.get("photo_cover"):
        couv_idx = next((i for i, c in enumerate(cands)
                         if c["source"] in ("Airbnb", "liens fournis") and c["rang"] == info["photo_cover"] - 1), None)
    couv_grp = next((g for g in grp if couv_idx in g), None) if couv_idx is not None else None
    vus = []  # (ordre, représentant, est la photo de la vue)
    ecart = lambda i, j: bin(cands[i]["hash"] ^ cands[j]["hash"]).count("1")  # noqa: E731
    for g in grp:
        membres = sorted(g, key=lambda i: cands[i]["ordre"])
        rep = max(membres, key=lambda i: (cands[i]["px"][0] * cands[i]["px"][1], -cands[i]["ordre"]))
        est_couv = g is couv_grp
        verdict = None  # (porteur, raison, détail)
        if not est_couv:
            for i in membres:  # une rubrique de la source qui écarte une copie les écarte toutes
                m = motif_libelle(cands[i])
                if m:
                    verdict = (i,) + m
                    break
            if not verdict:
                f = features.get(cands[rep]["id"])
                m = motif_visuel(cands[rep], f, regles) or next((x for i in membres for x in [motif_plan(cands[i], f, regles)] if x), None)
                if m:
                    verdict = (rep,) + m
        if verdict:
            retrait(cands[verdict[0]], verdict[1], verdict[2])
            for i in membres:
                if i != verdict[0]:
                    retrait(cands[i], "doublon", f"copy of {cands[verdict[0]]['id']} (distance {ecart(i, verdict[0])}/64), dropped: {verdict[1]}")
            continue
        for i in membres:
            if i != rep:
                retrait(cands[i], "doublon", f"copy of {cands[rep]['id']} (distance {ecart(i, rep)}/64), the largest is kept")
        vus.append((min(cle_ordre(cands[i]) for i in membres), rep, est_couv))
    # résolution : sous MIN_PX (anciens téléchargements, vignettes de sources) une photo est floue en plein écran : écartée ;
    # sous PX_CONFORT, écartée si MIN_CONFORT autres sont plus grandes
    reste = []
    for v in vus:
        if max(cands[v[1]]["px"]) < MIN_PX and not v[2]:
            retrait(cands[v[1]], "petite", f"{cands[v[1]]['px'][0]}×{cands[v[1]]['px'][1]} px, moins de {MIN_PX} px")
        else:
            reste.append(v)
    vus = reste
    grandes = [v for v in vus if max(cands[v[1]]["px"]) >= PX_CONFORT]
    if len(grandes) >= MIN_CONFORT:
        reste = []
        for v in vus:
            if max(cands[v[1]]["px"]) < PX_CONFORT and not v[2]:
                retrait(cands[v[1]], "petite", f"{cands[v[1]]['px'][0]}×{cands[v[1]]['px'][1]} px, {len(grandes)} photos plus grandes")
            else:
                reste.append(v)
        vus = reste
    # ordre : la vue d'abord, puis les photos des chercheurs, puis les rubriques (cle_ordre)
    vus.sort(key=lambda v: (not v[2], v[0]))
    gardes = [cands[v[1]] for v in vus]
    vue = bool(vus and vus[0][2])
    # plafond : on garde d'abord la 1re photo de chaque rubrique, puis la 2e, etc. (les chambres avant le reste à rang égal) ;
    # les photos des chercheurs et de l'annonce, sans rubrique, comptent pour la 1re. La photo de la vue reste toujours.
    if len(gardes) > max_logement:
        compte, cles = {}, []
        for pos, c in enumerate(gardes):
            r = rubrique(c)
            k = 0
            if r:
                k = compte[r] = compte.get(r, -1) + 1
            cles.append((-1 if (vue and pos == 0) else k, rang_rubrique(c.get("label") or "") if r else 0, pos, k))
        garde = set(sorted(range(len(gardes)), key=lambda i: cles[i][:3])[:max_logement])
        for pos, c in enumerate(gardes):
            if pos not in garde:
                retrait(c, "plafond", f"photo #{cles[pos][3] + 1} of section '{c['label']}', cap of {max_logement} photos")
        gardes = [c for pos, c in enumerate(gardes) if pos in garde]
    return gardes[:max_logement], retraits, vue


def fraction_blanche(chemin):
    """Part de l'image presque blanche (> 240 sur 255 en gris) : un produit en studio ou un plan dessiné en a beaucoup."""
    g = Image.open(chemin).convert("L").resize((64, 64))
    return round(sum(1 for v in g.tobytes() if v > 240) / 4096, 3)


def charger_features(slug, gardes_a_analyser):
    """Analyse Vision des images du cache (mémorisée dans feat.json)."""
    d = dossier_cache(slug)
    chemin = os.path.join(d, "feat.json")
    feat = lire_json(chemin, {})
    manque = [c["id"] for c in gardes_a_analyser if c["id"] not in feat]
    if manque:
        res = analyser([os.path.join(d, i + "-s.jpg") for i in manque])
        for i in manque:
            r = res.get(os.path.join(d, i + "-s.jpg"))
            if r:
                feat[i] = {k: r[k] for k in ("labels", "visages", "texte") if k in r}
                feat[i]["blanc"] = fraction_blanche(os.path.join(d, i + "-s.jpg"))
        ecrire_json(chemin, feat)
    return feat


def resume_sources(gardes):
    """(source lisible, crédits) d'après les fournisseurs des photos gardées, du plus fréquent au plus rare."""
    compte = {}
    for c in gardes:
        compte[c["fournisseur"]] = compte.get(c["fournisseur"], 0) + 1
    noms = [n for n, _ in sorted(compte.items(), key=lambda kv: -kv[1])]
    source = " + ".join(noms)
    credits = "Photos: " + ", ".join(noms) + (" (photos supplied by the venue or the host)" if noms else "")
    return source, credits


def lire_json(chemin, defaut):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def ecrire_json(chemin, data):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = chemin + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, chemin)


def publier_logement(slug, gardes, vue, retraits):
    """Écrit site/media/photos/<slug>/NN.jpg + NN-s.jpg depuis le cache ; met à jour index.json et retraits.json."""
    src = dossier_cache(slug)
    dest = dossier_sur(OUT, slug)
    tmp = dest + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    largeur = 2 if len(gardes) < 100 else 3
    for k, c in enumerate(gardes, 1):
        shutil.copyfile(os.path.join(src, c["id"] + ".jpg"), os.path.join(tmp, f"{k:0{largeur}d}.jpg"))
        shutil.copyfile(os.path.join(src, c["id"] + "-s.jpg"), os.path.join(tmp, f"{k:0{largeur}d}-s.jpg"))
    shutil.rmtree(dest, ignore_errors=True)
    os.rename(tmp, dest)
    source, credits = resume_sources(gardes)
    cotes = [max(c["px"]) for c in gardes]
    entree = {"n": len(gardes), "source": source, "credits": credits, "vue_en_tete": bool(vue),
              "px_median": int(statistics.median(cotes)) if cotes else 0, "px_max": max(cotes) if cotes else 0,
              "retirees": len(retraits)}
    idx = lire_json(INDEX, {})
    idx[slug] = entree
    ecrire_json(INDEX, dict(sorted(idx.items(), key=lambda kv: (kv[0] == "lieux", kv[0]))))
    ret = lire_json(RETRAITS, {"retraits": []})
    ret["retraits"] = [r for r in ret.get("retraits", []) if not (r.get("genre") == "logement" and r.get("slug") == slug)]
    ret["retraits"] += [dict(r, genre="logement", slug=slug) for r in retraits]
    enregistrer_retraits(ret)
    return entree


def enregistrer_retraits(ret):
    # liens qui n'étaient pas des images (scripts, feuilles de style : lus par erreur dans les pages des lieux avant le filtre SANS_IMAGE)
    ret["retraits"] = [r for r in ret["retraits"] if not (r.get("genre") == "lieu" and SANS_IMAGE.search(r.get("url") or ""))]
    totaux = {}
    for r in ret["retraits"]:
        totaux[r["raison"]] = totaux.get(r["raison"], 0) + 1
    ret.update({"genere": dt.date.today().isoformat(), "regles": REGLES, "totaux": dict(sorted(totaux.items())),
                "doublon": {"bits_dhash": DOUBLON_BITS, "couleur": DOUBLON_COULEUR},
                "vision": os.path.exists(BIN)})
    ecrire_json(RETRAITS, ret)


def trier(slug, regles=REGLES):
    info = lire_json(os.path.join(dossier_cache(slug), "cands.json"), None)
    if not info:
        return None
    # l'analyse Vision ne porte que sur les représentants de groupe : on analyse tout ce qui n'est pas un doublon évident
    grp, _ = groupes(info["candidats"])
    reps = [max(g, key=lambda i: info["candidats"][i]["px"][0] * info["candidats"][i]["px"][1]) for g in grp]
    feat = charger_features(slug, [info["candidats"][i] for i in reps])
    gardes, retraits, vue = trier_logement(info, feat, regles)
    return publier_logement(slug, gardes, vue, retraits)


# ============================================================================================ lieux
def lieux_a_faire():
    """[(id, stage, place)] of every place of the trip (restaurants, activities, agenda), with their photo links."""
    agenda = [p for p in days.read("lieux-agenda.json", {"pois": []}, TRIP.research).get("pois", [])
              if isinstance(p, dict) and p.get("id")]
    extra = days.read("lieux-photos-extra.json", {}, TRIP.research)
    out = []
    for k in stage_keys():
        for p in days.places_of_stage(TRIP, k, agenda):
            p["_extra"] = [u for u in (extra.get(p["id"]) or []) if isinstance(u, str)]
            out.append((p["id"], k, p))
    return out


def photo_de_lieu(im):
    """Une vraie photo (pas un logo, une carte ou un aplat) : mêmes critères que place_photos_extra.py."""
    import place_photos_extra as PE  # noqa: E402
    return PE.looks_like_photo(im)


def faire_lieu(pid, etape, p, workers=6):
    """Jusqu'à MAX_LIEU photos d'un lieu : liens des chercheurs, liens de place_photos_extra, puis les pages du lieu
    (site officiel : toutes ses images ; guides : l'image principale). Renvoie ([(image, lien, lien utilisé)], retraits)."""
    import place_photos_extra as PE  # noqa: E402
    deja, gardes, retraits = [], [], []

    def accepter(lien, res):
        im, url, _n = res
        if im is None:
            retraits.append({"url": lien, "raison": "echec", "detail": url})
        elif not photo_de_lieu(im):
            retraits.append({"url": lien, "raison": "pas_une_photo", "detail": f"{im.size[0]}×{im.size[1]}: logo, flat colour, map or odd format"})
        else:
            e = empreinte(im)
            for k, x in enumerate(deja):
                ok, d = meme_photo(e, x)
                if ok:
                    retraits.append({"url": lien, "raison": "doublon", "detail": f"copy of photo {k + 1} (distance {d}/64)"})
                    return
            deja.append(e)
            gardes.append((im, lien, url))
    liens = list(dict.fromkeys(p["_photos"] + p["_extra"]))[:12]
    chercher = lambda l: telecharger_un(variantes(l))  # noqa: E731
    liens = [l for l in liens if not SANS_IMAGE.search(l)]
    with cf.ThreadPoolExecutor(workers) as ex:
        for lien, res in zip(liens, ex.map(chercher, liens)):
            if len(gardes) < MAX_LIEU:
                accepter(lien, res)
        if len(gardes) < MAX_LIEU:
            pages = [u for u in [p["lien"]] + p["sources"] + [n["url"] for n in p["notes"] if n.get("url")]
                     if u and not any(s in urllib.parse.urlparse(u).netloc for s in PE.SKIP_HOSTS)]
            for k, page in enumerate(list(dict.fromkeys(pages))[:3]):
                own = k == 0 and not any(g in urllib.parse.urlparse(page).netloc for g in PE.guides(TRIP))
                nouveaux = [l for l in PE.page_images(page, own) if l not in liens and not SANS_IMAGE.search(l)][:12]
                for lien, res in zip(nouveaux, ex.map(chercher, nouveaux)):
                    if len(gardes) < MAX_LIEU:
                        accepter(lien, res)
                if len(gardes) >= MAX_LIEU:
                    break
    return gardes, retraits


def publier_lieu(pid, gardes, retraits):
    dest = dossier_sur(OUT, "lieux", pid)   # avant tout rmtree : un id venu d'une vidéo ne choisit pas ce qui est supprimé
    tmp = dest + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(dest, ignore_errors=True)
    if gardes:
        os.makedirs(tmp)
        for k, (im, lien, url) in enumerate(gardes, 1):
            ecrire(im, os.path.join(tmp, f"{k:02d}.jpg"), LIEU_PX, LIEU_Q)
            ecrire(im, os.path.join(tmp, f"{k:02d}-s.jpg"), LIEU_PETIT_PX, PETIT_Q)
        os.rename(tmp, dest)
    noms = []
    for im, lien, url in gardes:
        n = fournisseur(url)
        if n == "the venue's own site":
            n = urllib.parse.urlparse(url).netloc.replace("www.", "")
        if n not in noms:
            noms.append(n)
    idx = lire_json(INDEX, {})
    lieux = idx.get("lieux", {})
    if gardes:
        lieux[pid] = {"n": len(gardes), "source": " + ".join(noms), "credits": "Photos: " + ", ".join(noms),
                      "px_median": int(statistics.median([max(im.size) for im, _l, _u in gardes]))}
    else:
        lieux.pop(pid, None)
    idx["lieux"] = dict(sorted(lieux.items()))
    ecrire_json(INDEX, dict(sorted(idx.items(), key=lambda kv: (kv[0] == "lieux", kv[0]))))
    ret = lire_json(RETRAITS, {"retraits": []})
    ret["retraits"] = [r for r in ret.get("retraits", []) if not (r.get("genre") == "lieu" and r.get("slug") == pid)]
    ret["retraits"] += [dict(r, genre="lieu", slug=pid, photo="", source="", label="", px=[]) for r in retraits]
    enregistrer_retraits(ret)


# ============================================================================================ lignes de commande
def logements_demandes(mots):
    lots = affiches()
    if not mots:
        return lots
    return [t for t in lots if any(m == t[2] or t[2].startswith(m) for m in mots)]


def cmd_telecharger(mots, force, part=None):
    lots = logements_demandes(mots)
    if part:  # « 2/3 » : un logement sur trois, pour lancer plusieurs téléchargements en parallèle
        i, n = (int(x) for x in part.split("/"))
        lots = lots[i - 1::n]
    for k, (etape, o, slug) in enumerate(lots, 1):
        if not force and os.path.exists(os.path.join(dossier_cache(slug), "cands.json")):
            print(f"= {slug} (already in the cache)", flush=True)
            continue
        t0 = time.time()
        try:
            b = telecharger(slug, etape, o)
        except Exception as e:  # noqa: BLE001
            print(f"! {slug}: {type(e).__name__} {e}", flush=True)
            continue
        print(f"[{k}/{len(lots)}] {slug}: {b['images']} images / {b['candidats']} links ({b['echecs']} failures) "
              f"{b['par_source']} in {time.time() - t0:.0f} s", flush=True)


def cmd_trier(mots):
    print(f"vision analysis: {vision_note()}", flush=True)
    for etape, o, slug in logements_demandes(mots):
        e = trier(slug)
        print(f"{'✓' if e else '✗'} {slug}: {e['n'] if e else 'no cache'} photos"
              + (f" (dropped {e['retirees']}, median px {e['px_median']}, view first {e['vue_en_tete']})" if e else ""), flush=True)


def cmd_lieux(mots, force, en_parallele=3):
    todo = [t for t in lieux_a_faire() if not mots or t[0] in mots]
    idx = lire_json(INDEX, {}).get("lieux", {})
    todo = [t for t in todo if force or not (t[0] in idx and os.path.isdir(os.path.join(OUT, "lieux", t[0])))]

    def un(t):
        t0 = time.time()
        try:
            return t[0], faire_lieu(*t), time.time() - t0, None
        except Exception as e:  # noqa: BLE001
            return t[0], ([], []), time.time() - t0, f"{type(e).__name__} {e}"
    with cf.ThreadPoolExecutor(en_parallele) as ex:  # l'écriture (index, retraits) reste dans ce fil
        for k, (pid, (gardes, retraits), duree, erreur) in enumerate(ex.map(un, todo), 1):
            if erreur:
                print(f"! {pid}: {erreur}", flush=True)
                continue
            publier_lieu(pid, gardes, retraits)
            print(f"[{k}/{len(todo)}] {pid}: {len(gardes)} photos (dropped {len(retraits)}) in {duree:.0f} s", flush=True)


def imports_a_faire():
    """[(genre, étape, lieu, dossier)] des lieux importés d'une vidéo (research/imports/*/lieux.json, format de la tâche 19) :
    logement → dossier = son slug (site/media/photos/<slug>/) ; sortie → dossier = son id (site/media/photos/lieux/<id>/)."""
    out = []
    for chemin in sorted(glob.glob(os.path.join(IMPORTS, "*", "lieux.json"))):
        d = lire_json(chemin, None)
        if not isinstance(d, dict) or d.get("type") not in ("logement", "sortie"):
            continue
        for x in d.get("lieux") or []:
            etape = isinstance(x, dict) and (x.get("etape") or d.get("etape"))
            if etape not in stage_keys():
                continue
            ident = x.get("id")
            if not isinstance(ident, str) or not ID_IMPORT.match(ident) or not ident.startswith(etape + "-"):
                print(f"! {chemin}: id refused {str(ident)[:80]!r} (expected: {etape}-imp-<entry>-NN, see imports.py id)",
                      file=sys.stderr, flush=True)
                continue
            out.append((d["type"], etape, x, ident))   # un id valide est déjà son propre slug
    return out


def cmd_imports(mots, force):
    """Photos des lieux importés, par le même chemin que les autres : logement = `telecharger` (`photo_urls` de la fiche, puis
    Airbnb, Trip.com, Agoda, site officiel d'après ses sources ; sauté s'il est déjà en cache, sauf --force) puis `trier` ;
    sortie = photos du lieu (`photo_urls`, puis ses pages), comme `lieux`. Mêmes fichiers, même index.json, même retraits.json."""
    lots = [t for t in imports_a_faire() if not mots or any(t[3] == m or t[3].startswith(m) for m in mots)]
    for k, (genre, etape, x, cle) in enumerate(lots, 1):
        t0 = time.time()
        try:
            if genre == "logement":
                if force or not os.path.exists(os.path.join(dossier_cache(cle), "cands.json")):
                    b = telecharger(cle, etape, x)
                    print(f"  {cle}: {b['images']} images / {b['candidats']} links ({b['echecs']} failures) {b['par_source']}", flush=True)
                e = trier(cle)
                print(f"[{k}/{len(lots)}] {cle}: {e['n']} photos (dropped {e['retirees']}, median px {e['px_median']}, view first {e['vue_en_tete']})"
                      f" en {time.time() - t0:.0f} s", flush=True)
            else:
                if not force and cle in lire_json(INDEX, {}).get("lieux", {}) and os.path.isdir(dossier_sur(OUT, "lieux", cle)):
                    print(f"= {cle} (photos already there)", flush=True)
                    continue
                p = days.norm(dict(x, id=cle), etape)
                p["_extra"] = []
                gardes, retraits = faire_lieu(cle, etape, p)
                publier_lieu(cle, gardes, retraits)
                print(f"[{k}/{len(lots)}] {cle}: {len(gardes)} photos (dropped {len(retraits)}) in {time.time() - t0:.0f} s", flush=True)
        except Exception as e:  # noqa: BLE001  (un lieu en échec ne bloque pas les autres)
            print(f"! {cle}: {type(e).__name__} {e}", flush=True)
    if not lots:
        print("no imported place (research/imports/*/lieux.json)")


def cmd_inventaire():
    idx = lire_json(INDEX, {})
    logs = {k: v for k, v in idx.items() if k != "lieux"}
    ns = sorted(v["n"] for v in logs.values())
    print(f"{len(logs)} lodgings, photos: min {ns[0] if ns else 0} · median {statistics.median(ns) if ns else 0} · max {ns[-1] if ns else 0} "
          f"· total {sum(ns)}; {len(idx.get('lieux', {}))} places, {sum(v['n'] for v in idx.get('lieux', {}).values())} photos")
    ret = lire_json(RETRAITS, {})
    print("removals:", ret.get("totaux"))
    taille = sum(os.path.getsize(os.path.join(d, f)) for d, _s, fs in os.walk(OUT) for f in fs)
    print(f"size of the photos folder: {taille / 1e6:.0f} MB")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    trip_dir = None
    for i, a in enumerate(argv):
        if a == "--trip" and i + 1 < len(argv):
            trip_dir = argv[i + 1]
            del argv[i:i + 2]
            break
        if a.startswith("--trip="):
            trip_dir = a.split("=", 1)[1]
            del argv[i]
            break
    flags = {a for a in argv if a.startswith("--")}
    args = [a for a in argv if not a.startswith("--")]
    cmd, mots = (args[0], args[1:]) if args else ("", [])
    part = next((f.split("=", 1)[1] for f in flags if f.startswith("--part=")), None)
    if not cmd:
        print(__doc__)
        return 2
    try:
        configure(tripctx.load(trip_dir or tripctx.active_trip_dir(ROOT)))
    except tripctx.TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if Image is None:
        print(NO_PILLOW, file=sys.stderr)
        return 1
    if cmd == "telecharger":
        cmd_telecharger(mots, "--force" in flags, part)
    elif cmd == "trier":
        cmd_trier(mots)
    elif cmd == "lieux":
        cmd_lieux(mots, "--force" in flags)
    elif cmd == "imports":
        cmd_imports(mots, "--force" in flags)
    elif cmd == "tout":
        cmd_telecharger(mots, "--force" in flags)
        cmd_trier(mots)
        cmd_lieux(mots, "--force" in flags)
    elif cmd == "inventaire":
        cmd_inventaire()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
