#!/usr/bin/env python3
"""Apify credit used and left this month, and the cost of the latest runs.

    python3 scripts/apify_budget.py

Reads APIFY_TOKEN from .env (added with: python3 -I scripts/setup.py add-key apify); the token is never printed.
Run it before every Apify run (see CLAUDE.md > Rules: paid tools). Exit 1 without a token or when Apify cannot be reached.
"""
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mcp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.apify.com/v2"
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)


def get(path, token):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
        return json.load(r)["data"]


def main(argv=None, root=ROOT):
    token = mcp.load_env(root).get("APIFY_TOKEN", "")
    if not token:
        print("No Apify token in .env: Apify is not set up (optional; see python3 -I scripts/setup.py services).",
              file=sys.stderr)
        return 1
    try:
        lim = get("/users/me/limits", token)
        runs = get("/actor-runs?desc=1&limit=15", token).get("items") or []
    except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
        print(f"Could not read the Apify account ({type(e).__name__}); check the token or the connection.", file=sys.stderr)
        return 1
    used = float(lim["current"]["monthlyUsageUsd"])
    cap = float(lim["limits"]["maxMonthlyUsageUsd"])
    cycle = lim.get("monthlyUsageCycle") or {}
    print(f"Apify credit: used USD {used:.3f} of USD {cap:.2f}, left USD {cap - used:.3f}")
    print(f"Cycle: {str(cycle.get('startAt', '?'))[:10]} -> {str(cycle.get('endAt', '?'))[:10]} (renews after)")
    if runs:
        print("\nLatest runs:")
        for r in runs:
            print(f"  {str(r.get('startedAt', ''))[:16]}  {str(r.get('actId', '?')):<20} {str(r.get('status', '')):<10} "
                  f"USD {float(r.get('usageTotalUsd') or 0):.4f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
