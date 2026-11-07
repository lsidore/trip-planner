#!/usr/bin/env python3
"""A strip of the first three photos of each option, side by side, to show options in the chat.

    python3 scripts/photo_strip.py OPTIONS.json [--trip DIR] [--out DIR] [--count 3]

OPTIONS.json is a list of options (or {"options": [...]}); each option has a name and its photos:
    [{"name": "Casa Azul", "photos": ["https://...", "https://..."], "url": "https://..."}]
The research files' own keys work too ("nom" for the name, "photo_urls" for the photos), so a lodging file such as
<trip>/research/logements-<stage>.json can be passed as it is. A photo is a web address or a local file (a relative path
is read next to OPTIONS.json). Unreadable photos are skipped and the next ones used.

Each strip goes to <trip>/research/previews/<slug>.jpg (slug: the name in lowercase ASCII with hyphens), or to --out.
One line per option: the file, the number of photos and the option's url; "no photo: <name>" when none could be read.
Exit 0 when at least one strip was written, 1 otherwise.

--trip defaults to the active trip: TRIP_DIR, else the slug in trips/.current. The folder needs no trip.json yet, so
strips also work while destinations are being proposed.

Downloads follow the Wikimedia rules (https://meta.wikimedia.org/wiki/User-Agent_policy): one descriptive User-Agent
for every host, originals fetched as thumbnails, Wikimedia requests one at a time with a pause, and an HTTP 429 retried
after the delay the server asks for. A host that refuses the request is not retried with another identity.
Needs Pillow.
"""
import argparse
import io
import json
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NO_PILLOW = "Pillow (the image library) is not installed, so no photos were made. Run: python3 scripts/setup.py status"
USER_AGENT = "trip-planner/1.0 (+https://github.com/lsidore/trip-planner; photo strips for trip planning)"
HEIGHT = 420          # height of a strip, in pixels
GAP = 8               # white gap between two photos
MAX_WIDTH = 2400      # a wider strip is scaled down
MAX_TRIES = 6         # photos tried per option to collect `count` readable ones
WIKI_PX = 960         # a standard Wikimedia thumbnail width (originals are not downloaded)
WIKI_DELAY = 1.0      # seconds between two Wikimedia requests
TIMEOUT = 30
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)
_last_wiki = [0.0]


class StripError(Exception):
    """A problem the person can fix: no active trip, unreadable options file."""


# ----------------------------------------------------------------- downloads
def wikimedia_thumb(url, px=WIKI_PX):
    """upload.wikimedia.org original or thumbnail -> its `px`-wide thumbnail; any other link unchanged."""
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/[a-z-]+)/thumb/(.+)/\d+px-([^/?#]+)$", url)
    if m:
        return f"{m.group(1)}/thumb/{m.group(2)}/{px}px-{m.group(3)}"
    m = re.match(r"^(https://upload\.wikimedia\.org/wikipedia/[a-z-]+)/([0-9a-f]/[0-9a-f]{2})/([^/?#]+)$", url)
    if m:
        return f"{m.group(1)}/thumb/{m.group(2)}/{m.group(3)}/{px}px-{m.group(3)}"
    return url


def _retry_after(err, attempt):
    try:
        return max(1.0, float(err.headers.get("Retry-After")))
    except (TypeError, ValueError, AttributeError):
        return 5.0 * (attempt + 1)


def download(url, tries=3):
    """Bytes of an image address (Wikimedia: thumbnail, paced, 429 retried). Raises on failure."""
    url = wikimedia_thumb(url.strip())
    wiki = "wikimedia.org" in url
    for attempt in range(tries):
        if wiki:
            wait = _last_wiki[0] + WIKI_DELAY - time.monotonic()
            if wait > 0:
                time.sleep(wait)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == tries - 1:
                raise
            time.sleep(_retry_after(e, attempt))
        finally:
            if wiki:
                _last_wiki[0] = time.monotonic()
    raise OSError(f"could not download {url}")


def open_photo(ref, base_dir):
    """A photo (address or local path) as an RGB image, or None when it cannot be read."""
    from PIL import Image, ImageOps
    try:
        if re.match(r"^https?://", ref):
            data = download(ref)
        else:
            path = ref if os.path.isabs(ref) or os.path.exists(ref) else os.path.join(base_dir, ref)
            with open(path, "rb") as f:
                data = f.read()
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        return im.convert("RGB")
    except Exception:  # noqa: BLE001 - any unreadable photo is skipped
        return None


# ----------------------------------------------------------------- strips
def slugify(name):
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48]


def strip(images, height=HEIGHT):
    """The images side by side at the same height, white gaps, scaled down beyond MAX_WIDTH."""
    from PIL import Image
    ims = [im.resize((max(1, round(im.width * height / im.height)), height)) for im in images]
    width = sum(im.width for im in ims) + GAP * (len(ims) - 1)
    out = Image.new("RGB", (width, height), "white")
    x = 0
    for im in ims:
        out.paste(im, (x, 0))
        x += im.width + GAP
    if width > MAX_WIDTH:
        out.thumbnail((MAX_WIDTH, height))
    return out


def load_options(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        raise StripError(f"cannot read {path}: {e}")
    if isinstance(data, dict):
        data = data.get("options") or data.get("logements")
    if not isinstance(data, list):
        raise StripError(f"{path}: expected a list of options [{{\"name\", \"photos\"}}] or {{\"options\": [...]}}")
    return [o for o in data if isinstance(o, dict)]


def name_of(o, i):
    return str(o.get("name") or o.get("nom") or o.get("id") or f"option {i}")


def photos_of(o):
    ph = o.get("photos") if o.get("photos") is not None else o.get("photo_urls")
    return [str(p) for p in (ph or []) if isinstance(p, str) and p.strip()]


def preview_dir(trip=None, root=None):
    """<trip>/research/previews for --trip, TRIP_DIR or trips/.current (no trip.json needed)."""
    root = root or ROOT
    d = trip or os.environ.get("TRIP_DIR")
    if d:
        d = d if os.path.isabs(d) else os.path.join(root, d)
    else:
        slug = ""
        try:
            with open(os.path.join(root, "trips", ".current"), encoding="utf-8") as f:
                slug = f.read().strip()
        except OSError:
            pass
        if not slug or not os.path.isdir(os.path.join(root, "trips", slug)):
            raise StripError("no active trip: pass --trip DIR (or --out DIR), or write the trip's slug in trips/.current")
        d = os.path.join(root, "trips", slug)
    return os.path.join(os.path.normpath(d), "research", "previews")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="photo_strip.py", description="Strips of the first photos of each option.")
    ap.add_argument("options", help="JSON file: [{name, photos: [...], url?}] (or nom / photo_urls)")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("--out", help="output folder (default: <trip>/research/previews)")
    ap.add_argument("--count", type=int, default=3, help="photos per strip (default 3)")
    a = ap.parse_args(argv)
    try:
        import PIL  # noqa: F401
    except ImportError:
        print(NO_PILLOW, file=sys.stderr)
        return 1
    try:
        options = load_options(a.options)
        out_dir = a.out or preview_dir(a.trip)
    except StripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    base = os.path.dirname(os.path.abspath(a.options))
    written, used = 0, set()
    for i, o in enumerate(options, 1):
        name = name_of(o, i)
        images = []
        for ref in photos_of(o)[:MAX_TRIES]:
            im = open_photo(ref, base)
            if im is not None:
                images.append(im)
            if len(images) >= a.count:
                break
        if not images:
            print(f"no photo: {name}")
            continue
        slug = slugify(name) or f"option-{i}"
        if slug in used:
            n = 2
            while f"{slug}-{n}" in used:
                n += 1
            slug = f"{slug}-{n}"
        used.add(slug)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, slug + ".jpg")
        strip(images).save(path, "JPEG", quality=82)
        url = f"  {o['url']}" if isinstance(o.get("url"), str) and o["url"] else ""
        print(f"{path}  {len(images)} photo{'s' if len(images) > 1 else ''}  {name}{url}")
        written += 1
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
