"""Collecte de liens de photos pour les galeries complètes (utilisé par scripts/photos.py).

Sources gratuites, sans crédit SerpApi, par ordre d'intérêt :
  - Trip.com : la page « hotels/detail » (rendu serveur) contient les photos de l'hôtel (en-tête, équipements,
    points forts, chambres) → `trip_urls(hotel_id)` = (liens, nom de l'établissement).
  - Agoda : les données publiques de la fiche (« GetSecondaryData ») donnent la mosaïque de l'hôtel et les photos des
    chambres → `agoda_urls(hotel_id)` = (liens, nom) ; `agoda_id(url)` retrouve le numéro d'un lien.
  - Site officiel : photos de grande taille de la page d'accueil et des pages « galerie / chambres / villas… »
    → `site_urls(url)` (une seule couche de liens, 6 pages au plus, jamais de formulaire ni de connexion).
Booking.com n'est pas lu : sa page publique répond par un défi anti-robot (AWS WAF, HTTP 202), qu'on ne contourne pas.
Toute page qui ne répond pas 200 (défi anti-robot, erreur) est ignorée : `page()` renvoie alors ''.
"""
import json, os, re, ssl, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36")
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)


def page(url, timeout=30, lang="en-US,en;q=0.9"):
    """Texte d'une page publique ; '' si erreur, défi anti-robot (HTTP 202) ou page vide."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": lang,
                                                   "Accept": "text/html,application/xhtml+xml"})
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            if r.status != 200:
                return ""
            return r.read().decode("utf-8", "ignore")
    except Exception:
        return ""


# ----------------------------------------------------------------------------------------------- Trip.com
def _flight_objects(html):
    """Objets JSON du flux Next.js (« self.__next_f.push ») d'une page Trip.com."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', html, re.S)
    full = ""
    for c in chunks:
        try:
            full += json.loads('"' + c + '"')
        except ValueError:
            pass
    out = []
    for line in full.split("\n"):
        m = re.match(r"^(\w+):(.*)$", line)
        if m and m.group(2)[:1] in "{[":
            try:
                out.append(json.loads(m.group(2)))
            except ValueError:
                pass
    return out


def _find(o, key):
    if isinstance(o, dict):
        if key in o:
            return o[key]
        for v in o.values():
            r = _find(v, key)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = _find(v, key)
            if r is not None:
                return r
    return None


def _trip_id(u):
    m = re.search(r"/images/([^/_?]+)_", u)
    return m.group(1) if m else None


def trip_urls(hotel_id, host="fr.trip.com"):
    """(photos, nom de l'établissement) : en-tête, équipements, points forts, chambres — sans les photos des clients.
    Chaque photo en 1 280 px. Ordre : en-tête d'abord (la vue d'ensemble), puis le reste."""
    html = page(f"https://{host}/hotels/detail/?hotelId={hotel_id}&checkIn=2026-12-17&checkOut=2026-12-23&adult=2",
                lang="fr-FR,fr;q=0.9")
    if not html:
        return [], ""
    ids, title = [], ""
    for o in _flight_objects(html):
        head = _find(o, "seoHeadData")
        if isinstance(head, dict) and not title:
            title = str((head.get("seoTdk") or {}).get("title") or "")
        d = _find(o, "hotelDetailResponse")
        if isinstance(d, dict):
            for it in (d.get("hotelTopImage") or {}).get("imgUrlList") or []:
                ids.append(_trip_id(it.get("imgUrl") or ""))
            for g in (d.get("hotelFacilityPopV2") or {}).get("pictureGroups") or []:
                for p in g.get("picGroupList") or []:
                    ids.append(_trip_id(p.get("bigImgUrl") or p.get("smallImgUrl") or ""))
            for h in ((d.get("hotelBaseInfo") or {}).get("newHighlights") or {}).get("list") or []:
                for di in h.get("detailInfoList") or []:
                    for u in di.get("pictureList") or []:
                        ids.append(_trip_id(u))
        seo = _find(o, "seoHotelRooms")
        if isinstance(seo, dict):
            for room in (seo.get("physicRoomMap") or {}).values():
                for p in room.get("pictureInfo") or []:
                    ids.append(_trip_id(p.get("url") or ""))
    ids = [i for i in dict.fromkeys(ids) if i]
    return [f"https://ak-d.tripcdn.com/images/{i}_Z_1280_853_R50_Q90.jpg" for i in ids], title


TRIP_ORIGINAL = "https://ak-d.tripcdn.com/images/{id}.jpg"  # l'original déposé par l'hôtel (jusqu'à 1 920 px) ; les variantes « _Z_1280_853 » rognent


def trip_images(hotel_id, host="fr.trip.com"):
    """(images, nom de l'établissement) pour la galerie en haute définition : chaque image = {"id", "url", "label"}.

    `url` est l'ORIGINAL (jusqu'à 1 920 px, sans rognage) ; `label` est la rubrique de la page (« Piscine extérieure »,
    « Salle multifonctionnelle », « Chambre : Suite avec vue sur la baie », « En-tête »…) : elle sert à écarter à la
    source les salles de réunion et de banquet (scripts/photos.py). Les photos des clients ne sont pas lues."""
    html = page(f"https://{host}/hotels/detail/?hotelId={hotel_id}&checkIn=2026-12-17&checkOut=2026-12-23&adult=2",
                lang="fr-FR,fr;q=0.9")
    if not html:
        return [], ""
    out, title = {}, ""

    def add(url, label):
        i = _trip_id(url or "")
        if i and i not in out:
            out[i] = {"id": i, "url": TRIP_ORIGINAL.format(id=i), "label": label}
    for o in _flight_objects(html):
        head = _find(o, "seoHeadData")
        if isinstance(head, dict) and not title:
            title = str((head.get("seoTdk") or {}).get("title") or "")
        d = _find(o, "hotelDetailResponse")
        if isinstance(d, dict):
            for it in (d.get("hotelTopImage") or {}).get("imgUrlList") or []:
                add(it.get("imgUrl"), "En-tête")
            for g in (d.get("hotelFacilityPopV2") or {}).get("pictureGroups") or []:
                for p in g.get("picGroupList") or []:
                    add(p.get("bigImgUrl") or p.get("smallImgUrl"), str(g.get("picGroupName") or ""))
            for h in ((d.get("hotelBaseInfo") or {}).get("newHighlights") or {}).get("list") or []:
                for di in h.get("detailInfoList") or []:
                    for u in di.get("pictureList") or []:
                        add(u, str(h.get("tagTitle") or ""))
        seo = _find(o, "seoHotelRooms")
        if isinstance(seo, dict):
            for room in (seo.get("physicRoomMap") or {}).values():
                for p in room.get("pictureInfo") or []:
                    add(p.get("url"), "Chambre : " + str(room.get("name") or ""))
    return list(out.values()), title


# ----------------------------------------------------------------------------------------------- Agoda
def agoda_original(u):
    """Lien Agoda sans le paramètre de taille « s=1024x768 » : l'image d'origine (jusqu'à 2 048 px de large)."""
    u = ("https:" + u) if u.startswith("//") else u
    base, _, query = u.partition("?")
    keep = [q for q in query.split("&") if q and not q.startswith("s=") and not q.startswith("ar=")]
    return base + ("?" + "&".join(keep) if keep else "")


def agoda_images(hotel_id):
    """(images, nom de l'établissement) pour la galerie en haute définition : {"id", "url", "label"}.

    Les 140 et quelques images de la mosaïque, chacune avec sa rubrique (« Property views », « On-site dining »,
    « Room photos ») et son titre (« Restaurant », « Cape Panwa Suite - View »), puis les photos des chambres.
    `url` est l'original (voir agoda_original)."""
    txt = page(f"https://www.agoda.com/api/cronos/property/BelowFoldParams/GetSecondaryData?hotel_id={hotel_id}")
    try:
        d = json.loads(txt)
    except ValueError:
        return [], ""
    info = d.get("hotelInfo") or {}
    name = f"{info.get('name') or ''} {info.get('englishName') or ''}"
    out, seen = [], set()
    mosaic = sorted((d.get("mosaicInitData") or {}).get("images") or [], key=lambda i: i.get("orderIndex") or 0)
    for room_pass in (False, True):  # d'abord l'établissement, puis les chambres
        for im in mosaic:
            if im.get("location") and bool(im.get("isRoomImage")) == room_pass:
                u = agoda_original(im["location"])
                if u not in seen:
                    seen.add(u)
                    out.append({"id": str(im.get("id") or ""), "url": u,
                                "label": " / ".join(x for x in (str(im.get("group") or ""), str(im.get("title") or "")) if x)})
    for room in d.get("datelessMasterRoomInfo") or []:
        for u in room.get("images") or []:
            u = agoda_original(u)
            if u not in seen:
                seen.add(u)
                out.append({"id": "", "url": u, "label": "Room photos / " + str(room.get("name") or "")})
    return out, name


def agoda_id(url):
    """Numéro d'établissement Agoda d'un lien (hotel_id=, selectedproperty=) ou, à défaut, lu dans la page de l'hôtel."""
    m = re.search(r"(?:hotel_id|selectedproperty)=(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"hotel_id=(\d+)", page(url))
    return m.group(1) if m else None


def agoda_urls(hotel_id):
    """(photos, nom de l'établissement) : mosaïque de la fiche puis photos des chambres, en 1 024 px ; données publiques."""
    txt = page(f"https://www.agoda.com/api/cronos/property/BelowFoldParams/GetSecondaryData?hotel_id={hotel_id}")
    try:
        d = json.loads(txt)
    except ValueError:
        return [], ""
    info = d.get("hotelInfo") or {}
    name = f"{info.get('name') or ''} {info.get('englishName') or ''}"
    out = []
    mosaic = sorted((d.get("mosaicInitData") or {}).get("images") or [], key=lambda i: i.get("orderIndex") or 0)
    for im in mosaic:
        if im.get("location") and not im.get("isRoomImage"):
            out.append(im["location"])
    for im in mosaic:
        if im.get("location") and im.get("isRoomImage"):
            out.append(im["location"])
    for room in d.get("datelessMasterRoomInfo") or []:
        for u in room.get("images") or []:
            out.append(u if "s=" in u else u + ("&" if "?" in u else "?") + "s=1024x768")
    return [("https:" + u if u.startswith("//") else u) for u in dict.fromkeys(out)], name


# ----------------------------------------------------------------------------------------------- site officiel
GALLERY_WORDS = re.compile(r"galler|photo|room|suite|villa|accommodat|stay|pool|spa|dining|restaurant|facilit|experience|"
                           r"beach|view|chambre|hebergement|bungalow|cottage|residence|wellness|activit", re.I)
SKIP_IMG = re.compile(r"logo|icon|sprite|favicon|avatar|flag|badge|award|payment|tripadvisor|footer|placeholder|"
                      r"loader|blank|\.svg|\.gif|\.png|1x1|pixel|thumb|/tn/|_xs|-xs|150x150|100x100|\bsmall\b", re.I)
# Affiches, actualités, mariages, avis, plans : ce ne sont pas des photos du lieu.
NOT_PHOTO = re.compile(r"news|review|wedding|bride|proposal|xmas|christmas|newyear|new-year|countdown|roadshow|promo|offer|"
                       r"banner|poster|flyer|tdac|digital|guideline|voucher|package|campaign|event|team|staff|career|csr|"
                       r"brochure|floor-?plan|masterplan|render|menu|/video/|vdo|blog|press|partner|certif", re.I)
GALLERY_FIRST = re.compile(r"galler|photo|room|suite|villa|accommodat|pool|bedroom|bungalow|cottage|chalet", re.I)


def _abs(base, u):
    u = u.strip().replace("\\/", "/").replace("&amp;", "&")
    if u.startswith("//"):
        u = "https:" + u
    return urllib.parse.urljoin(base, u)


def _images_in(html, base):
    found = []
    for m in re.finditer(r'(?:src|data-src|data-lazy-src|data-original|data-bg|data-image|content|href)\s*=\s*["\']'
                         r'([^"\']+\.(?:jpe?g|webp|png)(?:\?[^"\']*)?)["\']', html, re.I):
        found.append(m.group(1))
    for m in re.finditer(r'(?:srcset|data-srcset)\s*=\s*["\']([^"\']+)["\']', html, re.I):
        parts = [p.strip().split(" ") for p in m.group(1).split(",") if p.strip()]
        best = max(parts, key=lambda p: int(re.sub(r"\D", "", p[1]) or 0) if len(p) > 1 else 0)
        found.append(best[0])
    for m in re.finditer(r'url\(["\']?([^"\')]+\.(?:jpe?g|webp|png)[^"\')]*)', html, re.I):
        found.append(m.group(1))
    for m in re.finditer(r'"((?:https?:)?\\?/\\?/[^"]+\.(?:jpe?g|webp|png)(?:\?[^"]*)?)"', html, re.I):  # JSON embarqué
        found.append(m.group(1))
    out = []
    for u in found:
        u = _abs(base, u)
        path = urllib.parse.urlparse(u).path
        if u.startswith("http") and not SKIP_IMG.search(path) and not NOT_PHOTO.search(path):
            out.append(u)
    return out


def _full_size(u):
    """Retire les suffixes de miniatures WordPress (« -300x200 ») pour viser l'original."""
    return re.sub(r"-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|webp|png)(?:\?|$))", "", u, flags=re.I)


def site_urls(url, max_pages=6):
    """Grandes images du site officiel : accueil + pages de galerie / chambres / villas liées depuis l'accueil."""
    root = urllib.parse.urlparse(url)
    home = f"{root.scheme}://{root.netloc}/"
    html = page(url) or page(home)
    if not html:
        return []
    pages, seen = [(url, html)], set()
    links = []
    for m in re.finditer(r'<a[^>]+href=["\']([^"\'#]+)["\']', html, re.I):
        h = _abs(url, m.group(1))
        p = urllib.parse.urlparse(h)
        if p.netloc.replace("www.", "") == root.netloc.replace("www.", "") and GALLERY_WORDS.search(p.path) \
                and not re.search(r"\.(pdf|jpe?g|png|zip)$|/(blog|news|offers?|contact|wp-admin|cart|login)", p.path, re.I):
            h = h.split("#")[0]
            if h not in seen and h != url:
                seen.add(h)
                links.append(h)
    links.sort(key=lambda h: (0 if re.search(r"galler|photo", h, re.I) else 1, len(h)))
    for h in links[:max_pages - 1]:
        t = page(h)
        if t:
            pages.append((h, t))
    out = []
    for base, t in pages:
        out += [_full_size(u) for u in _images_in(t, base)]
    out = list(dict.fromkeys(out))
    # les chemins « galerie / chambres / villas / piscine » d'abord : l'accueil mélange photos et habillage
    return sorted(out, key=lambda u: 0 if GALLERY_FIRST.search(urllib.parse.urlparse(u).path) else 1)
