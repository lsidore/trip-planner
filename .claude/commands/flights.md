---
description: Find and compare the trip's flights - arrival flights per home airport, flights between stages, return flights - with bags and total price
argument-hint: "[arrival | between | return | all] [dates, airports, airlines...]"
---

Launch the `flight-hunter` agent on the active trip (`trips/.current`) with these details: $ARGUMENTS.
Before it starts, say that the Kiwi price download is free but slow when there are many legs or flexible dates.

Merge the "Flights" section it returns into `trips/<slug>/transport.md`. Then present, per leg, 3 to 5 options
(cheapest, best compromise, best times) with the total price with bags, times, layovers and link, and the advice on
when to book. Rebuild the page (`python3 scripts/build.py`) and offer to open it.
Book nothing.
