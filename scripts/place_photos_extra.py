#!/usr/bin/env python3
"""Completes the photos of the places (restaurants, activities, sights) from their own web pages.

For each place with fewer than MAXPH photos: reads its official site (`lien`) and its sources (guides, encyclopedias...),
keeps the real photos (>= 640 px, no logo or icon, no duplicate) and caches them in <trip>/research/poi-cache/.
The retained links go to <trip>/research/lieux-photos-extra.json, which scripts/photos.py adds to the researchers' photos.

Guide / aggregator hosts (whose pages only give their main image) are GUIDES plus the optional
<trip>/research/photo-guides.json (a JSON list of extra host fragments, e.g. a local guide of the destination).

    python3 -I scripts/place_photos_extra.py [--trip DIR]           # every place to complete
    python3 -I scripts/place_photos_extra.py [--trip DIR] --force   # also redo the places already processed
"""
import argparse
import concurrent.futures as cf
import hashlib
import html
import io
import json
import os
import re
import sys
import urllib.parse as up
import urllib.request

try:
    from PIL import Image, ImageStat
except ImportError:  # Pillow missing: main() says so in one line
    Image = ImageStat = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import days  # noqa: E402
import stays  # noqa: E402
import tripctx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_PILLOW = "Pillow (the image library) is not installed, so no photos were made. Run: python3 scripts/setup.py status"
MAXPH = 6
UA = "trip-planner/1.0 (+https://github.com/lsidore/trip-planner)"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/130.0 Safari/537.36")


def _get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


SKIP_HOSTS = ("google.", "goo.gl", "tripadvisor.", "facebook.", "instagram.", "booking.com", "agoda.", "tablecheck.",
              "sevenrooms.", "chope.", "opentable.", "youtube.", "tiktok.", "line.me", "klook.", "getyourguide.", "viator.")
BAD = re.compile(r"logo|icon|favicon|sprite|avatar|flag|badge|payment|visa|mastercard|award|certificate|qr[-_]?code|"
                 r"placeholder|blank|loader|loading|arrow|button|social|facebook|instagram|twitter|whatsapp|emoji|"
                 r"pixel|1x1|spacer|banner-ad|thumb_?\d{2}x|/16x|/32x|/64x|map[-_]?pin|signature|stamp", re.I)
URL_RE = re.compile(r"""(https?:)?//[^\s"'<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>()\\]*)?""", re.I)
ATTR_RE = re.compile(r"""(?:src|data-src|data-lazy-src|data-original|data-bg|poster)\s*=\s*["']([^"']+)["']""", re.I)
SRCSET_RE = re.compile(r"""(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']""", re.I)
OG_RE = re.compile(r"""<meta[^>]+?(?:property|name)\s*=\s*["'](?:og:image|twitter:image)(?::src|:url)?["'][^>]*?>""", re.I)
CONTENT_RE = re.compile(r"""content\s*=\s*["']([^"']+)["']""", re.I)


GUIDES = ("wanderlog.", "michelin.", "timeout.", "wikipedia.", "wikivoyage.", "lonelyplanet.", "tripadvisor.", "trip.com",
          "theworlds50best.", "eater.", "cntraveler.", "google.", "booking.", "agoda.", "expedia.", "yelp.")


def guides(trip=None):
    """GUIDES plus the extra hosts of <trip>/research/photo-guides.json (a JSON list of host fragments)."""
    extra = days.read("photo-guides.json", [], trip.research) if trip is not None else []
    return GUIDES + (tuple(h for h in extra if isinstance(h, str) and h) if isinstance(extra, list) else ())


def page_images(url, own_site):
    """Image links of a page, the most promising first (og:image, large srcset, then the rest).
    On a guide or aggregator only the main image (og:image): the others often show other places."""
    try:
        raw = _get(url, {"User-Agent": BROWSER_UA, "Accept-Language": "en,fr;q=0.8"}, timeout=15)
    except Exception:
        return []
    text = html.unescape(raw[:3_000_000].decode("utf-8", "ignore")).replace("\\/", "/")
    found = []
    for tag in OG_RE.findall(text):
        m = CONTENT_RE.search(tag)
        if m:
            found.append(m.group(1))
    if not own_site:
        found = found[:1]
    for ss in (SRCSET_RE.findall(text) if own_site else []):  # the largest reasonable version of each srcset
        best, bw = None, 0
        for part in ss.split(","):
            bits = part.strip().split()
            if not bits:
                continue
            w = int(re.sub(r"\D", "", bits[1]) or 0) if len(bits) > 1 and bits[1].endswith("w") else 800
            if bw < w <= 2000 or best is None:
                best, bw = bits[0], w
        if best:
            found.append(best)
    if own_site:
        found += ATTR_RE.findall(text)
        found += [m.group(0) for m in URL_RE.finditer(text)]
    out, seen = [], set()
    for u in found:
        u = u.strip()
        if u.startswith("data:") or u.lower().endswith((".svg", ".gif")) or ".svg?" in u.lower():
            continue
        u = up.urljoin(url, u if not u.startswith("//") else "https:" + u)
        key = u.split("?")[0].lower()
        if not u.startswith("http") or key in seen or BAD.search(key):
            continue
        seen.add(key)
        out.append(u)
    return out[:25]


def ahash(im):
    g = im.convert("L").resize((8, 8))
    px = list(g.getdata())
    m = sum(px) / 64
    return sum(1 << i for i, p in enumerate(px) if p > m)


def looks_like_photo(im):
    w, h = im.size
    if min(w, h) < 400 or max(w, h) < 640 or not 0.55 <= w / h <= 2.4:
        return False
    small = im.convert("L").resize((64, 64))
    if ImageStat.Stat(small).stddev[0] < 28:  # flat colour, logo, plain background
        return False
    white = sum(1 for p in small.getdata() if p > 235) / 4096
    return white < 0.45  # logo or text on white


def cache_name(cache, pid, url):
    return os.path.join(cache, f"{stays.slugify(pid)}-x{hashlib.sha1(url.encode()).hexdigest()[:10]}.jpg")


def existing_hashes(cache, pid, n):
    hs = []
    for i in range(n + 1):
        f = os.path.join(cache, f"{stays.slugify(pid)}-{i}.jpg")
        if os.path.exists(f):
            try:
                hs.append(ahash(Image.open(f)))
            except Exception:
                pass
    return hs


def enrich(job, cache, extra_guides=GUIDES):
    pid, pages, have, need = job
    hashes = existing_hashes(cache, pid, have)
    kept = []
    for k, page in enumerate(pages):
        own = k == 0 and not any(g in up.urlparse(page).netloc for g in extra_guides)
        for u in page_images(page, own):
            if len(kept) >= need:
                return pid, kept
            ua = UA if "wikimedia.org" in u else BROWSER_UA
            try:
                data = _get(u, {"User-Agent": ua, "Referer": page}, timeout=12)
                if len(data) > 8_000_000:
                    continue
                im = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception:
                continue
            if not looks_like_photo(im):
                continue
            h = ahash(im)
            if any(bin(h ^ x).count("1") <= 6 for x in hashes):
                continue
            hashes.append(h)
            im.thumbnail((720, 720))
            im.save(cache_name(cache, pid, u), "JPEG", quality=70, optimize=True, progressive=True)
            kept.append(u)
    return pid, kept


def jobs_of(trip, force=False):
    """[(place id, pages to read, photos already cached, photos needed)] for every place of the trip to complete."""
    cache = os.path.join(trip.research, "poi-cache")
    done = days.read("lieux-photos-extra.json", {}, trip.research)
    agenda = [p for p in days.read("lieux-agenda.json", {"pois": []}, trip.research).get("pois", [])
              if isinstance(p, dict) and p.get("id")]
    jobs = []
    for s in trip.stages:
        for p in days.places_of_stage(trip, s["key"], agenda):
            pid = p["id"]
            if pid in done and not force:
                continue
            have = sum(1 for i in range(len(p["_photos"])) if os.path.exists(os.path.join(cache, f"{stays.slugify(pid)}-{i}.jpg")))
            need = MAXPH - have
            pages = [u for u in [p["lien"]] + p["sources"] + [n["url"] for n in p["notes"] if n.get("url")]
                     if u and not any(h in up.urlparse(u).netloc for h in SKIP_HOSTS)]
            pages = list(dict.fromkeys(pages))[:3]
            if need > 0 and pages:
                jobs.append((pid, pages, have, need))
    return jobs


def run(trip, force=False):
    out_path = os.path.join(trip.research, "lieux-photos-extra.json")
    cache = os.path.join(trip.research, "poi-cache")
    done = days.read("lieux-photos-extra.json", {}, trip.research)
    jobs = jobs_of(trip, force)
    gl = guides(trip)
    print(f"{len(jobs)} places to complete")
    os.makedirs(cache, exist_ok=True)

    def save():
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(done, f, ensure_ascii=False, indent=1)
    with cf.ThreadPoolExecutor(16) as ex:
        for k, (pid, kept) in enumerate(ex.map(lambda j: enrich(j, cache, gl), jobs), 1):
            done[pid] = kept
            if k % 20 == 0:
                save()
                print(f"  {k}/{len(jobs)}", flush=True)
    save()
    got = [len(v) for k, v in done.items() if any(k == j[0] for j in jobs)]
    print(f"{sum(got)} photos added; {sum(1 for g in got if g)} places completed out of {len(got)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Completes the photos of places, see the module docstring.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    if Image is None:
        print(NO_PILLOW, file=sys.stderr)
        return 1
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
    except tripctx.TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    run(trip, a.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
