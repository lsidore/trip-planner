---
description: Build or rework the day-by-day plan, then have it checked and costed
argument-hint: "[extra constraints]"
---

1. Launch the `itinerary-architect` agent on the active trip (extra constraints: $ARGUMENTS).
2. Then the `fact-checker` agent on `trips/<slug>/itinerary.md`.
3. Then the `budget-keeper` agent to update `budget.md`.
4. Present one line per day, the fact-checker's alerts, the gap to the budget cap, and the ordered list of bookings to
   make with their deadlines. If they approve the plan, offer `/sync-calendar`.
