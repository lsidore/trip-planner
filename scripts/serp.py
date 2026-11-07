#!/usr/bin/env python3
"""Direct call to the SerpApi REST API (any engine, including google_events and google_maps, which the MCP lacks).
Usage: scripts/serp.py <engine> '<json params>'   -> compact JSON on stdout. One call = one search (250/month free).
The key is SERPAPI_API_KEY in .env (add it with: setup.py add-key serpapi)."""
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_key(root=ROOT):
    """The SerpApi key from .env, or '' when the file or the line is missing."""
    try:
        with open(os.path.join(root, ".env"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("SERPAPI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def main(argv=None, root=ROOT):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(__doc__, file=sys.stderr)
        return 1
    key = read_key(root)
    if not key:
        print("No SerpApi key found. Add one with: python3 scripts/setup.py add-key serpapi (see CLAUDE.md > First launch). "
              "Without it, use the other search tools.", file=sys.stderr)
        return 1
    try:
        extra = json.loads(argv[1] if len(argv) > 1 else "{}")
    except ValueError:
        extra = None
    if not isinstance(extra, dict):
        print("The parameters must be a JSON object, e.g. '{\"q\": \"coffee\", \"ll\": \"@38.72,-9.14,14z\"}'.", file=sys.stderr)
        return 1
    ctx = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)
    params = {"engine": argv[0], **extra, "api_key": key}
    try:
        with urllib.request.urlopen("https://serpapi.com/search.json?" + urllib.parse.urlencode(params), timeout=60, context=ctx) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:   # SerpApi explains its refusals in JSON ({"error": ...}): printed as an answer
        try:
            data = json.loads(e.read().decode("utf-8", "replace") or "{}")
        except (ValueError, OSError):
            data = None
        if not isinstance(data, dict) or not data:
            print(f"SerpApi answered HTTP {e.code} without an explanation. Try again later, or use the other search tools.",
                  file=sys.stderr)
            return 1
    except (urllib.error.URLError, OSError) as e:   # no network, DNS, timeout, TLS
        reason = getattr(e, "reason", None) or type(e).__name__
        print(f"SerpApi could not be reached ({reason}). Check the internet connection, or use the other search tools.",
              file=sys.stderr)
        return 1
    except ValueError:
        print("SerpApi sent an answer that is not JSON. Try again later, or use the other search tools.", file=sys.stderr)
        return 1
    for k in ("search_metadata", "search_parameters", "serpapi_pagination", "pagination"):
        data.pop(k, None)
    print(json.dumps(data, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
