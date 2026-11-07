#!/usr/bin/env python3
"""Local trip server (standard library only, bound to 127.0.0.1, no authentication).

    python3 -I scripts/server.py [--trip DIR] [--port 8793]

Serves <trip>/site/ (GET / redirects to /index.html) and the state API below. --trip defaults to the active trip
(TRIP_DIR, else trips/.current). The only file ever written is <trip>/state.json (Trip.state_file), atomically
(temporary file in the same folder, then rename) and under a lock.

API (JSON, UTF-8; the error key "erreur" is read by the page):
  GET  /api/etat                        the state: {v, choix, favs, resa, mode} ({} until something is saved)
  PUT  /api/etat  {chemin, valeur[, fusion]}   changes ONE field. chemin: "choix.<stage>", "favs.<key>.<who>",
                                        "resa.<key>", "mode" (or a list of segments when a key contains a dot).
                                        fusion true: valeur is merged into the existing object (like db.update);
                                        otherwise it replaces it.
  PUT  /api/etat?remplacer=1  {…whole state…}  replaces everything (migration from the browser's own storage)
"""
import argparse
import contextlib
import copy
import http.server
import json
import os
import re
import sys
import tempfile
import threading
import urllib.parse

try:
    import fcntl
except ImportError:  # pragma: no cover - no lock between processes outside Unix
    fcntl = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripctx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8793
HOSTS = ("127.0.0.1", "localhost", "::1")

MAX_PUT = 64 * 1024            # one field
MAX_REPLACE = 2 * 1024 * 1024
MAX_STATE = 2 * 1024 * 1024    # the state file
MAX_DEPTH = 12
MAX_SEGMENTS = 6

STATE_FIELDS = ("choix", "favs", "resa", "mode")
MODES = ("simple", "detail")

_SEGMENT = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,200}$")


class RequestError(Exception):
    """A refused request: HTTP code and a readable message."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ───────────────────────────── files: paths, lock, atomic write ─────────────────────────────

class Paths:
    """The only places the server reads or writes, taken from the Trip."""

    def __init__(self, trip):
        self.site = os.path.abspath(trip.site)
        self.state = os.path.abspath(trip.state_file)
        self.allowed = (self.state,)


_THREAD_LOCKS = {}
_THREAD_LOCKS_GUARD = threading.Lock()


def _lock_file(path):
    return os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".lock")


@contextlib.contextmanager
def locked(data_path):
    """Exclusive lock between threads (RLock) and between processes (flock on a hidden file next to the data)."""
    lock_path = _lock_file(data_path)
    with _THREAD_LOCKS_GUARD:
        thread_lock = _THREAD_LOCKS.setdefault(lock_path, threading.RLock())
    with thread_lock:
        os.makedirs(os.path.dirname(lock_path), exist_ok=True)
        f = open(lock_path, "a+")
        try:
            if fcntl:
                fcntl.flock(f, fcntl.LOCK_EX)
            yield
        finally:
            f.close()   # closes and releases the flock


def _is_allowed(path, allowed):
    real = os.path.join(os.path.realpath(os.path.dirname(path)), os.path.basename(path))
    return any(real == os.path.join(os.path.realpath(os.path.dirname(a)), os.path.basename(a)) for a in allowed)


def write_json_atomic(path, data, allowed):
    """Write `data` to `path` (only if it is one of the `allowed` files): temporary file in the same folder, fsync, rename."""
    if not _is_allowed(path, allowed):
        raise PermissionError(f"write refused outside the trip's state file: {path}")
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)   # mkstemp creates 0600; project files are readable like the others
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (ValueError, OSError) as e:
        raise RequestError(500, f"unreadable file ({os.path.basename(path)}): {e}. Fix it or delete it.")


def _depth_ok(obj, limit=MAX_DEPTH):
    stack = [(obj, 1)]
    while stack:
        o, d = stack.pop()
        if d > limit:
            return False
        if isinstance(o, dict):
            stack.extend((v, d + 1) for v in o.values())
        elif isinstance(o, list):
            stack.extend((v, d + 1) for v in o)
    return True


def deep_merge(a, b):
    """Like db.update (and the page's deep merge): nested objects merge, everything else replaces."""
    out = dict(a) if isinstance(a, dict) else {}
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


# ───────────────────────────── the state of the choices ─────────────────────────────

def split_path(path):
    """"choix.lisbon" or ["favs", "log:a.b", "nous"] -> list of valid segments."""
    if isinstance(path, str):
        segs = path.split(".")
    elif isinstance(path, list):
        segs = path
    else:
        raise RequestError(400, "chemin: a text like \"choix.lisbon\" or a list of segments is expected")
    if not segs or len(segs) > MAX_SEGMENTS:
        raise RequestError(400, f"chemin: 1 to {MAX_SEGMENTS} segments")
    for s in segs:
        if not isinstance(s, str) or not _SEGMENT.match(s) or s.startswith("__"):
            raise RequestError(400, "chemin: invalid segment")
    if segs[0] not in STATE_FIELDS:
        raise RequestError(400, "chemin: must start with " + ", ".join(STATE_FIELDS))
    return list(segs)


def _bool_dict(d):
    return isinstance(d, dict) and all(isinstance(v, bool) for v in d.values())


def _booking_ok(r):
    if not isinstance(r, dict) or set(r) - {"done", "by"}:
        return False
    if "done" in r and not isinstance(r["done"], bool):
        return False
    return r.get("by") is None or (isinstance(r["by"], str) and len(r["by"]) <= 60)


def _shape_ok(segs, value):
    """Light check of the favourites' and "booked" boxes' shape; the choice itself is free."""
    t, n = segs[0], len(segs)
    if t == "mode":
        return n == 1 and value in MODES
    if t == "choix":
        return n > 1 or isinstance(value, dict)
    if t == "favs":
        if n == 1:
            return isinstance(value, dict) and all(_bool_dict(v) for v in value.values())
        if n == 2:
            return _bool_dict(value)
        return n == 3 and isinstance(value, bool)
    if t == "resa":
        if n == 1:
            return isinstance(value, dict) and all(_booking_ok(v) for v in value.values())
        if n == 2:
            return _booking_ok(value)
        if n == 3 and segs[2] == "done":
            return isinstance(value, bool)
        if n == 3 and segs[2] == "by":
            return value is None or (isinstance(value, str) and len(value) <= 60)
        return False
    return False


def apply_field(state, path, value, merge=False):
    """New state = `state` with ONE field changed (the argument is not modified)."""
    segs = split_path(path)
    if not _shape_ok(segs, value):
        raise RequestError(400, "valeur: invalid shape for " + ".".join(segs))
    new = copy.deepcopy(state) if isinstance(state, dict) else {}
    cur = new
    for s in segs[:-1]:
        if not isinstance(cur.get(s), dict):
            cur[s] = {}
        cur = cur[s]
    last = segs[-1]
    if merge and isinstance(value, dict) and isinstance(cur.get(last), dict):
        cur[last] = deep_merge(cur[last], value)
    else:
        cur[last] = copy.deepcopy(value)
    new.setdefault("v", 1)
    return new


def validate_whole_state(obj):
    """A whole state (migration): known sections, valid shapes, version 1."""
    if not isinstance(obj, dict):
        raise RequestError(400, "the state must be a JSON object")
    unknown = set(obj) - set(STATE_FIELDS) - {"v"}
    if unknown:
        raise RequestError(400, "unknown fields: " + ", ".join(sorted(map(str, unknown))))
    new = {"v": 1}
    for k in STATE_FIELDS:
        if k in obj:
            if not _shape_ok([k], obj[k]):
                raise RequestError(400, "invalid shape for \"" + k + "\"")
            new[k] = obj[k]
    return new


def _check_size(state):
    if len(json.dumps(state, ensure_ascii=False)) > MAX_STATE:
        raise RequestError(413, "the state exceeds the maximum size")


def _state_object(paths):
    state = read_json(paths.state, {})
    if not isinstance(state, dict):
        raise RequestError(500, "the state file is not a JSON object")
    return state


def read_state(paths):
    """Content of the trip's state file; creates it empty ({}) if missing."""
    with locked(paths.state):
        if not os.path.exists(paths.state):
            write_json_atomic(paths.state, {}, paths.allowed)
            return {}
        return _state_object(paths)


def write_field(paths, path, value, merge=False):
    with locked(paths.state):
        new = apply_field(_state_object(paths), path, value, merge)
        _check_size(new)
        write_json_atomic(paths.state, new, paths.allowed)
    return new


def replace_state(paths, obj):
    new = validate_whole_state(obj)
    _check_size(new)
    with locked(paths.state):
        write_json_atomic(paths.state, new, paths.allowed)
    return new


# ───────────────────────────── HTTP ─────────────────────────────

def _host_ok(value, port):
    """Host or Origin netloc: 127.0.0.1, localhost or [::1] on the server's port (guards against DNS rebinding)."""
    if not value:
        return False
    try:
        p = urllib.parse.urlsplit("//" + value)
        return (p.hostname or "").lower() in HOSTS and (p.port is None or p.port == port)
    except ValueError:
        return False


def _origin_ok(origin, port):
    """Origin of a page: http on this machine only."""
    try:
        p = urllib.parse.urlsplit(origin)
    except ValueError:
        return False
    return p.scheme == "http" and _host_ok(p.netloc, port)


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "TripLocal/1.0"
    timeout = 30   # s: a slow or silent local client does not hold a thread forever
    extensions_map = {
        "": "application/octet-stream", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
        ".mp4": "video/mp4", ".pdf": "application/pdf",
    }

    def setup(self):
        super().setup()
        self.directory = self.server.paths.site
        self._no_cache_sent = False

    # -- log: only the API and errors
    def log_request(self, code="-", size="-"):
        if str(code) not in ("200", "304") or self.path.startswith("/api/"):
            super().log_request(code, size)

    def end_headers(self):
        if not self._no_cache_sent:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    # -- JSON answers
    def _json(self, code, obj, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._no_cache_sent = True
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code, message, extra=None):
        self._json(code, {"erreur": message}, extra)

    # -- origin checks
    def _port(self):
        return self.server.server_address[1]

    def _check_host(self):
        if not _host_ok(self.headers.get("Host"), self._port()):
            self._error(403, "host refused: this address is only reachable from this machine")
            return False
        return True

    def _check_write(self):
        origin = self.headers.get("Origin")
        if origin is not None and not _origin_ok(origin, self._port()):
            self._error(403, "origin refused")
            return False
        if (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            self._error(403, "cross-site request refused")
            return False
        return True

    def _read_json(self, limit):
        ct = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ct != "application/json":
            raise RequestError(415, "Content-Type: application/json expected")
        raw_n = self.headers.get("Content-Length")
        if raw_n is None:
            raise RequestError(411, "Content-Length missing")
        try:
            n = int(raw_n)
        except ValueError:
            raise RequestError(400, "invalid Content-Length")
        if n < 0:
            raise RequestError(400, "invalid Content-Length")
        if n > limit:
            left = min(n, 4 * 1024 * 1024)   # drain what is arriving so the client receives the answer
            while left > 0:
                chunk = self.rfile.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
            raise RequestError(413, f"body too large (maximum {limit // 1024} KB)")
        raw = self.rfile.read(n)
        try:
            obj = json.loads(raw.decode("utf-8"))
        except (ValueError, RecursionError):
            raise RequestError(400, "invalid JSON")
        if not _depth_ok(obj):
            raise RequestError(400, "JSON too deep")
        return obj

    # -- routing
    def _api(self):
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        m = self.command
        paths = self.server.paths
        try:
            if url.path == "/api/etat":
                if m == "GET":
                    return self._json(200, read_state(paths))
                if m == "PUT":
                    if not self._check_write():
                        return
                    if query.get("remplacer") == ["1"]:
                        return self._json(200, {"ok": True, "etat": replace_state(paths, self._read_json(MAX_REPLACE))})
                    body = self._read_json(MAX_PUT)
                    if not isinstance(body, dict) or "chemin" not in body or "valeur" not in body:
                        raise RequestError(400, "body: {chemin, valeur[, fusion]} expected")
                    if set(body) - {"chemin", "valeur", "fusion"}:
                        raise RequestError(400, "body: unknown fields")
                    write_field(paths, body["chemin"], body["valeur"], body.get("fusion") is True)
                    return self._json(200, {"ok": True})
                return self._error(405, "method not allowed", {"Allow": "GET, PUT"})
            return self._error(404, "unknown route")
        except RequestError as e:
            return self._error(e.code, e.message)
        except PermissionError as e:
            return self._error(403, str(e))
        except OSError as e:
            return self._error(500, "write failed: " + str(e))

    def _static(self):
        p = urllib.parse.urlsplit(self.path).path
        if p == "/":
            self.send_response(302)
            self.send_header("Location", "/index.html")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        if p == "/favicon.ico" and not os.path.exists(os.path.join(self.directory, "favicon.ico")):
            self.send_response(204)   # no icon: no 404 in the browser console
            self.end_headers()
            return False
        path = urllib.parse.unquote(p)
        segments = path.split("/")
        if "\x00" in path or "\\" in path or any(s.startswith(".") for s in segments if s):
            self.send_error(404, "Not found")
            return False
        target = os.path.normpath(self.translate_path(self.path))
        site = os.path.normpath(self.directory)
        if target != site and not target.startswith(site + os.sep):
            self.send_error(404, "Not found")
            return False
        return True

    def _dispatch(self):
        self._no_cache_sent = False
        if not self._check_host():
            return
        if urllib.parse.urlsplit(self.path).path.startswith("/api/"):
            return self._api()
        if self.command in ("GET", "HEAD"):
            if self._static():
                if self.command == "GET":
                    super().do_GET()
                else:
                    super().do_HEAD()
            return
        self._error(405, "method not allowed", {"Allow": "GET, HEAD"})

    do_GET = do_HEAD = do_PUT = do_POST = do_PATCH = do_DELETE = do_OPTIONS = _dispatch


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, paths):
        self.paths = paths
        super().__init__(address, Handler)


def create_server(trip_dir, port=DEFAULT_PORT):
    """A server bound to 127.0.0.1 (port 0: a free port) for the trip in `trip_dir`. The caller runs serve_forever()."""
    return Server(("127.0.0.1", port), Paths(tripctx.load(trip_dir)))


# ───────────────────────────── command line ─────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(prog="server.py", description="Serves <trip>/site/ and the state API on 127.0.0.1.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args(argv)
    try:
        trip_dir = args.trip or tripctx.active_trip_dir(ROOT)
        srv = create_server(trip_dir, args.port)
    except tripctx.TripError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"error: cannot open port {args.port}: {e}", file=sys.stderr)
        return 1
    print(f"Trip server: http://127.0.0.1:{srv.server_address[1]}/  (Ctrl+C to stop)", flush=True)
    if not os.path.isfile(os.path.join(srv.paths.site, "index.html")):
        print("note: no site/index.html yet: run python3 scripts/build.py first", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
