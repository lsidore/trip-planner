#!/usr/bin/env python3
"""Adds entries to a shared research file without losing what other agents wrote at the same time.

    python3 scripts/merge_json.py TARGET FRAGMENT [FRAGMENT ...]      (FRAGMENT "-" = read it from stdin)

Several research agents run in parallel and some files are shared (acces-logements.json, couts-unites.json,
sorties-<stage>.json, lieux-agenda.json, trajets.json, formalites.json). An agent never rewrites such a file whole: it
puts its own entries in a fragment of the same shape and merges it here. The merge holds an exclusive lock
(<target folder>/.merge.lock) and replaces the file atomically, so concurrent merges never lose an entry.

Rules (the fragment wins for the same id):
  {id: entry} objects       entry by entry: a new id is added, an existing id is replaced
  [ {...}, ... ] lists      by "id" (or "code" for formalities): same id replaced in place, new ones appended
  {"pois": [...]}, {"trajets": [...]}   the inner lists merge by id; any other key (e.g. "meta") is replaced
TARGET is created when missing. A TARGET that is not valid JSON, or a fragment of another shape, stops with exit 1
and leaves TARGET untouched. Prints "<target>: N added, M replaced".
"""
import json
import os
import sys
import tempfile

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows without WSL: no lock between processes
    fcntl = None

LIST_KEYS = ("pois", "trajets", "options", "logements")


class MergeError(Exception):
    pass


def _key(x):
    if isinstance(x, dict):
        for k in ("id", "code"):
            if x.get(k) not in (None, ""):
                return (k, str(x[k]))
    return None


def merge_list(old, new, stats):
    out = list(old)
    where = {_key(x): i for i, x in enumerate(out) if _key(x) is not None}
    for x in new:
        k = _key(x)
        if k is not None and k in where:
            out[where[k]] = x
            stats["replaced"] += 1
        elif x not in out:
            out.append(x)
            if k is not None:
                where[k] = len(out) - 1
            stats["added"] += 1
    return out


def merge(old, new, stats=None):
    """`new` merged into `old` (see the module docstring); `stats` counts added and replaced entries."""
    stats = stats if stats is not None else {"added": 0, "replaced": 0}
    if old is None:
        stats["added"] += len(new) if isinstance(new, (list, dict)) else 1
        return new
    if isinstance(old, list) and isinstance(new, list):
        return merge_list(old, new, stats)
    if isinstance(old, dict) and isinstance(new, dict):
        wrapped = any(isinstance(new.get(k), list) for k in LIST_KEYS)
        out = dict(old)
        for k, v in new.items():
            if wrapped and k in LIST_KEYS and isinstance(v, list) and isinstance(old.get(k), list):
                out[k] = merge_list(old[k], v, stats)
            else:
                if not wrapped:
                    stats["replaced" if k in old else "added"] += 1
                elif isinstance(v, list) and k not in old:
                    stats["added"] += len(v)
                out[k] = v
        return out
    raise MergeError("the fragment must have the same shape as the target (both {...} or both [...])")


def _read(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        raise MergeError(f"{path} is not valid JSON ({e}); fix it first, nothing was written")


def merge_into(target, fragment):
    """Merge one fragment (already parsed) into the target file, under the lock. Returns the stats."""
    folder = os.path.dirname(os.path.abspath(target))
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, ".merge.lock"), "a+") as lock:
        if fcntl:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            stats = {"added": 0, "replaced": 0}
            data = merge(_read(target), fragment, stats)
            fd, tmp = tempfile.mkstemp(dir=folder, prefix=".merge-", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=1)
                    f.write("\n")
                os.replace(tmp, target)
            except BaseException:
                if os.path.exists(tmp):
                    os.unlink(tmp)
                raise
            return stats
        finally:
            if fcntl:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) < 2 or argv[0] in ("-h", "--help"):
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 1
    target = argv[0]
    for src in argv[1:]:
        try:
            if src == "-":
                fragment = json.loads(sys.stdin.read())
            else:
                with open(src, encoding="utf-8") as f:
                    fragment = json.load(f)
        except (OSError, ValueError) as e:
            print(f"error: cannot read the fragment {src}: {e}", file=sys.stderr)
            return 1
        try:
            st = merge_into(target, fragment)
        except MergeError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(f"{target}: {st['added']} added, {st['replaced']} replaced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
