---
name: destination-guide
description: How to write and use the destination guide of a trip (trips/<slug>/guide.md) - seasons and weather at the dates, zones and where to sleep for each kind of view, getting around between stages, traps and local rules (short-term rental legality, hidden fees, mandatory dinners, scams), etiquette, entry rules, heuristics for the travelers' pace. Load it at the start of every trip, before recommending a zone, a lodging, a day or a cost, and whenever guide.md is missing or older than 3 months.
---

# Destination guide

Every trip gets its own guide: `trips/<slug>/guide.md`. It is the field knowledge the agents rely on, written once at
the start of the trip (after the destination and stages are chosen) and kept up to date. This skill gives its plan and
the way to fill it. The repository ships no guide for any country: you research it for each trip.

## How to write it

1. Read `trips/<slug>/profile.md` (who, when, budget, wishes, pace, constraints) and `trips/<slug>/trip.json` (stages,
   dates, airports).
2. Research each section with live sources (official sites first, then recent guides and traveler forums). Training
   memory is only a starting point: every rule, price, schedule or legal point needs a source.
3. Write it in the trip's language (`language` in trip.json), short and scannable: tables and bullet points, one idea
   per line. About 2 to 4 screens; details go to the agents' research notes.
4. **Dated, sourced facts**: each fact that can change carries its source and check date, inline:
   `Visa-free stay of 90 days for US passports ([official site](https://...), checked 2026-11-07).`
   Durations are orders of magnitude ("about 45 min"); say so, and check them again with a routing tool when it matters.
5. Show the person a 5-line summary (best of the season, the zone recommended per stage, the main trap, the entry
   rule to act on, the booking deadline if any) and ask whether something is missing.
6. Re-check facts older than 3 months before relying on them, and before the departure checklist.

## Plan of guide.md

```markdown
# <Destination>: guide for <trip title> (<dates>)

## 1. Seasons and weather at the dates
| Region / stage | At these dates | What it means for us |
Weather (day and night temperatures, rain, sea), daylight (sunrise and sunset), crowds and prices (peak season,
school holidays, local holidays), what is closed. Sources: climate data (open-meteo), tourism office.

## 2. Zones of each stage
For each stage: 3 to 5 zones in a table (mood, view, quietness, access time from the airport or station, services
around, need for a car) and the zone recommended for these travelers, with why.

## 3. Getting around
Between stages: modes, typical durations, frequencies, last departures (boats, trains, buses), airports (several
in one city?), low-cost traps (bags), driving rules and licenses, ride-hailing apps that work there.

## 4. Traps and local rules
Short-term rental legality (city bans on renting apartments by the night, buildings that refuse guests), prices
shown without taxes or service, tourist taxes, mandatory gala dinners on holidays, minimum stays, scams, safety,
animal welfare (no riding or shows), what is illegal for visitors.

## 5. Etiquette
Greetings, dress codes (religious sites), tipping, bargaining, photos of people, public behavior, table manners.

## 6. Entry and formalities (dated, sourced)
Per traveler and passport: visa or exemption and its length, electronic authorizations (and their official site,
never a paid look-alike), arrival cards, passport validity, proof of onward travel, transit rules for the layover
countries, vaccines, insurance, money (cash, cards, ATM fees), phone (eSIM).

## 7. Heuristics for this trip
How to apply the brief here: the pace (one highlight per day or more), travel days kept light, the time of day for
outings (heat, light, crowds), what to book early, the one place worth the splurge.
```

## Heuristics that travel well

- The lodging makes the stage when the brief values views, calm or time "at home": a beautiful place with few
  outings beats the reverse. When the brief values exploring, location and transport come first.
- Travel days hold the journey and the arrival, nothing else.
- After a long-haul arrival (jet lag), the first day stays light.
- Peak periods (year-end holidays, local festivals, school holidays) mean scarcity: flag it, prefer free cancellation,
  say clearly when to book fast.
- Count the real cost: taxes, service, cleaning, mandatory meals, transfers, minimum stays.
- Prefer an option that matches the group's size and mood (private boat, small tour, quiet table) to a crowded
  standard one, when the brief asks for it.
- Every outing has a weather plan B when it depends on sea or sky.

## How the agents use it

stay-finder reads sections 2 and 4 (zones, rental legality, hidden fees); flight-hunter and logistics-planner sections
3 and 6; activity-scout, food-scout and events-hunter sections 1, 5 and 7; itinerary-architect all of it. When an
agent finds a fact that contradicts the guide, it says so in its report and the guide is corrected with the new source.
