---
description: Launch the scouts in parallel for ideas - activities, food and drinks, events - for one stage, a theme, or the whole trip
argument-hint: "[<stage key> | <theme: sunset, food, hiking, rainy day...>]"
---

Stage or theme: $ARGUMENTS (empty: every stage of the active trip).

1. Read `trips/<slug>/profile.md`, `trip.json`, `state.json` and `stays.md` (the picked lodgings are the starting
   points; if none is picked yet, say so and ask whether to scout from the recommended zone).
2. In one message, launch in parallel the useful agents: `activity-scout` and `food-scout` for each stage asked,
   `events-hunter` once for the trip. Give each the slug, the stage, a 3-line summary of the brief and the pace.
3. When they are done: merge the entries they return into `trips/<slug>/activities.md` (agents never edit it in
   parallel), then `python3 scripts/check_research.py`, fix the problems, `python3 scripts/build.py`.
4. Present a short list across types, photos first, what must be booked soon at the top, and remind the pace of the
   brief. Book nothing.
