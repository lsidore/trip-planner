---
description: Find and compare the lodgings of one stage, or of every stage in parallel, at the real cost, photos first
argument-hint: "[<stage key> | all] [zone, budget per night, kind of place...]"
---

Stage and details: $ARGUMENTS (empty or "all": every stage of the active trip).

1. Read `trips/<slug>/profile.md`, `trip.json` and `stays.md` (slug from `trips/.current`).
2. Launch the `stay-finder` agent for each stage asked (several stages: in one message, in parallel), giving the slug,
   the stage key, its dates, the budget per night, the view and mood wanted, and what was already rejected.
3. When they are done: merge the sections they return into `trips/<slug>/stays.md` (agents never edit it in
   parallel). Show each stage's short-list photos first (their strips in `research/previews/`, CLAUDE.md >
   Showing options), then name, total price, rating, one line, link; the recommended zone; scarcity alerts.
4. Ask which ones to keep; then `python3 scripts/check_research.py` and `python3 scripts/build.py` (add `--photos`
   for the kept short-list) and offer to open the page. Book nothing.
