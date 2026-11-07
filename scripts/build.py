#!/usr/bin/env python3
"""One command from a trip's files to its page: <trip>/site/index.html.

    python3 scripts/build.py [--trip DIR] [--download-flights] [--photos]

Steps, in order (--trip defaults to the active trip):
  1. flights.download   only with --download-flights (Kiwi calls, needs the kiwi MCP server)
  2. flights.build      when <trip>/research/vols-brut/ exists; its result is handed to step 6
  3. days.build
  4. check_research     problems are printed to stderr, the build goes on
  5. photos tout        only with --photos (downloads and sorts photos; slow, needs Pillow)
  6. page_data          -> <trip>/site/media/parcours*.json
  7. build_page         -> <trip>/site/index.html
Anything not researched yet is listed on stderr ("not researched yet") and shows as an empty section in the page.
"""
import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_page  # noqa: E402
import check_research  # noqa: E402
import days  # noqa: E402
import flights  # noqa: E402
import page_data  # noqa: E402
import tripctx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8793


def run_photos(trip):
    """`photos.py tout` for the trip (imported here: it needs Pillow, which the other steps do not)."""
    import photos
    return photos.main(["tout", "--trip", trip.dir])


def _any(trip, pattern):
    return bool(glob.glob(os.path.join(trip.research, pattern)))


def report_unresearched(trip):
    """One stderr line per part of the trip with no research file yet."""
    if not os.path.isdir(flights.raw_dir(trip)):
        print("flights: not researched yet (no research/vols-brut/; run with --download-flights)", file=sys.stderr)
    for st in trip.stages:
        key = st["key"]
        if not _any(trip, f"logements-{key}*.json"):
            print(f"stage '{key}': lodgings not researched yet (no research/logements-{key}.json)", file=sys.stderr)
        if not _any(trip, f"sorties-{key}.json") and not _any(trip, f"lieux-{key}-*.json"):
            print(f"stage '{key}': outings not researched yet (no research/sorties-{key}.json)", file=sys.stderr)


def _shown_path(trip_dir):
    rel = os.path.relpath(trip_dir)
    return trip_dir if rel.startswith("..") else rel


def main(argv=None):
    ap = argparse.ArgumentParser(description="Builds <trip>/site/index.html from the trip's files.")
    ap.add_argument("--trip", help="trip directory (default: the active trip)")
    ap.add_argument("--download-flights", action="store_true", help="fetch the Kiwi flight prices first")
    ap.add_argument("--photos", action="store_true", help="download and sort the photos (slow)")
    a = ap.parse_args(argv)
    try:
        trip = tripctx.load(a.trip or tripctx.active_trip_dir(ROOT))
        if a.download_flights:
            flights.download(trip)
        built = flights.build(trip) if os.path.isdir(flights.raw_dir(trip)) else None
        days.build(trip)
        for problem in check_research.check(trip):
            print("check: " + problem, file=sys.stderr)
        if a.photos:
            run_photos(trip)
        report_unresearched(trip)
        page_data.build(trip, built=built)
        build_page.main(["--trip", trip.dir])
    except (tripctx.TripError, flights.FlightsError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"Open http://127.0.0.1:{PORT}/ after running: python3 scripts/server.py --trip {_shown_path(trip.dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
