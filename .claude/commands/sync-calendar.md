---
description: Put the approved plan in Google Calendar, only after an explicit yes - or write an .ics file to import
---

1. Read `trips/<slug>/itinerary.md`, `transport.md`, `bookings.md`, `state.json` and `trip.json` (each stage's `tz`).
2. Prepare the events: title, date, start and end in local time (a stage's `tz`; a flight leaves in its departure
   airport's zone and lands in its arrival's), place, and a description with the booking link, whether it is booked,
   and the plan B. Include flights, ground legs, check-ins and check-outs, booked outings and special evenings; mark
   what is not booked yet.
3. Show the list and wait for an explicit "yes" before creating anything. Ask which calendar (Google Calendar connector,
   `list_calendars`).
4. On yes: create the events with the connector (`create_event`) in that calendar only, with no attendee and no
   invitation unless the person explicitly asks for one. Note the sync in `checklist.md` (one line: "Calendar
   synced on YYYY-MM-DD, calendar <name>") so a later sync updates instead of duplicating; `bookings.md` stays for
   real bookings only.
5. Without the Google Calendar connector: give the steps to connect it (`python3 -I scripts/setup.py services`, group
   connector), or offer to write `trips/<slug>/itinerary.ics` for the person to import. $ARGUMENTS
