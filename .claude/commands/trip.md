---
description: Start a new trip or resume one, then run (or complete) the brief
argument-hint: "[new | <trip slug>] [anything to know already]"
---

Request: $ARGUMENTS

1. If `.setup/state.json` is missing, run the setup first (CLAUDE.md > First launch).
2. Follow CLAUDE.md > Trips: list `trips/`, then start a new trip (slug, `trips/<slug>/research/`, `trips/.current`)
   or resume the one named (write its slug in `trips/.current`, summarize where it stands in 3 lines).
3. Brief (CLAUDE.md > The flow, step 1): read `trips/<slug>/profile.md` if it exists, find what is missing or vague,
   and ask only that, in small groups of questions (AskUserQuestion when the answers are choices): travelers and
   passports, dates, budget and what it covers, wishes and pace, lodging, constraints, destination. Update
   `profile.md` as you go.
4. Summarize the profile in 5 lines, ask them to confirm, and propose the next step of the flow (destinations,
   itineraries, `trip.json`, or research).
