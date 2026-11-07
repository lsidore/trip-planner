---
description: List the events at the trip's dates - special evenings, holidays, festivals, markets, concerts - and what they change
argument-hint: "[kind of event or stage]"
---

Launch the `events-hunter` agent on the active trip (details: $ARGUMENTS), then merge the entries it returns into
`trips/<slug>/activities.md`. Present first the trip's special evenings
(`specials` in trip.json: where, when, best spots, calm or lively options, prices), then the holidays and closures that
change the plan, then the rest per stage. Say what must be booked now. Then `python3 scripts/check_research.py` and
`python3 scripts/build.py`.
