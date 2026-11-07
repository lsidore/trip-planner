#!/usr/bin/env python3
"""Privacy guard: finds emails, absolute home paths, key-like values and blocklisted words in text files.

Usage:
    python3 scripts/privacy_check.py [--blocklist FILE] [--history] [PATH...]

PATH "-" reads the text piped on stdin (for example `git log --format=%B upstream/main..HEAD`).
Without PATH it reads the files git tracks or would track (`git ls-files -co --exclude-standard`).
--history also scans `git log -p --all` (commit messages, author lines and every diff).
Exit status 1 when anything is found.

Result types: email, abs_path, key, blocked.
A line holding the ignore marker is skipped for email, abs_path and key, never for blocked.
Files under `data/` (generic reference datasets such as airports and transit rules, path relative to the repo root)
are exempt from the `blocked` category only; email, abs_path and key are still checked there.
The blocklist file (one term per line, case-insensitive) is private and must never be committed.
"""
import argparse
import os
import re
import subprocess
import sys

MARKER = "privacy-check: " + "ignore"
# the domain must end in an alphabetic TLD: "pkg@2.5.2" (an npm version) is not an address; the local part starts with a
# letter or digit and ends with one (or _ -), so a decorator in a diff ("+@unittest.skip", "\\n+@x.y") is not one either
EMAIL = re.compile(r"(?<![A-Za-z0-9._%-])[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9_-])?@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b")
ALLOWED_EMAIL = re.compile(r"^(noreply@anthropic\.com|[^@]+@users\.noreply\.github\.com|[^@]+@example\.com)$", re.I)
# not inside a URL's path ("https://site.com/home/x"): the folder must not follow a host or path character
ABS_PATH = re.compile(r"(?<![A-Za-z0-9._~%-])(?:/Users/|/home/)[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+")
KEY_ASSIGN = re.compile(r"(?i)\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b[\"']?\s*[=:]\s*[\"']?[A-Za-z0-9_\-+/=.]{20,}")
KEY_PREFIX = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|apify_api_[A-Za-z0-9]{20,}"
                        r"|xox[bpas]-[A-Za-z0-9-]{10,})")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCK_EXEMPT_DIR = "data"


def blocklist_exempt(path, root=ROOT):
    """True for files under <root>/data/: generic reference data may name real places."""
    rel = os.path.relpath(os.path.abspath(path), root).replace(os.sep, "/")
    return rel.startswith(BLOCK_EXEMPT_DIR + "/")


def scan_line(line, lineno, path, blocklist, out):
    skip = MARKER in line
    if not skip:
        for m in EMAIL.finditer(line):
            if not ALLOWED_EMAIL.match(m.group(0)):
                out.append((path, lineno, "email", m.group(0)))
        for m in ABS_PATH.finditer(line):
            out.append((path, lineno, "abs_path", m.group(0)))
        for rx in (KEY_ASSIGN, KEY_PREFIX):
            for m in rx.finditer(line):
                out.append((path, lineno, "key", m.group(0)[:40] + "..."))
    low = line.lower()
    for term in blocklist:
        if term and term.lower() in low:
            out.append((path, lineno, "blocked", term))


def scan_text(text, path, blocklist):
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        scan_line(line, i, path, blocklist, out)
    return out


def scan(paths, blocklist, root=ROOT):
    """[(path, line, type, excerpt)] for every finding in the given files; binary files are skipped."""
    out = []
    for path in paths:
        if path == "-":   # text piped on stdin (commit messages before a pull request)
            out.extend(scan_text(sys.stdin.read(), "<stdin>", blocklist))
            continue
        try:
            with open(path, "rb") as f:
                raw = f.read()
            if b"\x00" in raw:
                continue
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        out.extend(scan_text(text, path, [] if blocklist_exempt(path, root) else blocklist))
    return out


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]


def git_files():
    r = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("privacy_check: not a git repository; pass explicit paths")
    return [p for p in r.stdout.splitlines() if os.path.isfile(p)]


def scan_history(blocklist):
    r = subprocess.run(["git", "log", "-p", "--all", "--format=commit %H%n%an <%ae>%n%cn <%ce>%n%B"],
                       capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        return []
    out, exempt = [], False
    for i, line in enumerate(r.stdout.splitlines(), 1):
        m = re.match(r"diff --git a/(\S+) b/", line)
        if m:   # same rule as the tree scan: generic reference data under data/ may name real places
            exempt = m.group(1).startswith(BLOCK_EXEMPT_DIR + "/")
        elif line.startswith("commit "):
            exempt = False
        scan_line(line, i, "<git history>", [] if exempt else blocklist, out)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Find personal data before it is published.")
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--blocklist", help="file with one forbidden term per line (kept outside the repo)")
    ap.add_argument("--history", action="store_true", help="also scan git log -p --all")
    args = ap.parse_args(argv)
    blocklist = read_lines(args.blocklist) if args.blocklist else []
    paths = args.paths or git_files()
    found = scan(paths, blocklist)
    if args.history:
        found += scan_history(blocklist)
    for path, line, kind, excerpt in found:
        print(f"{path}:{line}: {kind}: {excerpt}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
