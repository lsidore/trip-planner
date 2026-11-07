---
name: start
description: Guided trip planning with clickable screens. Load it at the start of every session, when the person says hello, wants to plan or resume a trip, asks what to do next, or needs the setup. It runs setup, brief, destinations, itineraries, lodgings, activities and budget in order, and asks every choice through a screen (widgets in the Claude desktop app, buttons in the terminal) instead of questions in text.
argument-hint: "[new | <trip slug> | setup | example]"
---

# Start: the guided trip, one click at a time

The person should be able to plan a whole trip by clicking. This skill gives the order of the steps and how to ask
each choice. CLAUDE.md keeps the logic of every step (First launch, Trips, The flow, Rules): follow it, and use this
skill for the asking.

Request: $ARGUMENTS (empty: decide from the session-start message, see "The journey").

## 1. Pick the answer mode, once per session

1. **Screens** (best): the tool `mcp__visualize__show_widget` exists (the Claude desktop app). If it is deferred, load
   `select:mcp__visualize__read_me,mcp__visualize__show_widget` in one ToolSearch call. Before the first screen, call
   `mcp__visualize__read_me` with `modules: ["elicitation", "interactive"]`, without mentioning it.
2. **Buttons**: no widget tool, but `AskUserQuestion` exists (the terminal, IDEs).
3. **Text**: neither. Numbered choices; the person answers with the numbers.

If a screen fails to show (tool error), ask that question with buttons and keep screens for the next ones. The person
can always type instead of clicking: an answer in their own words is as good as a click.

## 2. The screens

Templates in `screens/` (read each one once per session, when first needed):

| Screen | Kind | Use |
|---|---|---|
| `hub.html` | cards, one click each | welcome, "what next" between steps, yes or no confirmations |
| `setup.html` | form | the three setup questions: keys, connectors, Chrome |
| `brief.html` | form | the brief: travelers, home, destination, dates, budget, mood, pace, lodging |
| `options.html` | cards to compare | destinations, lodgings, flights, activities, restaurants; one pick or a short-list |
| `itineraries.html` | timelines | 2 or 3 itineraries, stages drawn to scale of nights |
| `budget.html` | live total | total against the cap, line by line, slider for spending on site |

How to show one:

- **Forms** (`setup`, `brief`): copy the template; translate every visible text into the person's language; delete the
  groups you can already answer from the conversation or the trip files (never ask what you know: a one-question form
  beats five questions); in `brief`, put the home currency in the budget question and adapt the budget bands to the
  trip. Keep the structure, the header and the classes as they are. No `<script>` and no `onclick` in a form.
- **Data screens** (`hub`, `options`, `itineraries`, `budget`): copy the template and replace only the line that
  starts with `const DATA =` with the trip's data, as one line of JSON; keep the rest byte for byte. Translate the
  `labels`. Every number comes from the trip files or the research (Rules 2 and 3: real cost, fees in, never
  invented); write prices already formatted (`"$840"`, `"1 250 €"`). `prompt` texts are what the click sends back:
  write them as the person would say it, in their language.
- **Around the screen**: one short sentence before it (what to choose); explanations go in your text, never inside the
  screen. After a screen, end your turn and wait for the click.
- **Photos**: a screen cannot load outside images. Before an `options` screen of places or lodgings, show the photo
  strips (CLAUDE.md > Showing options), and give each option a `link` to its listing or photos.
- **The answer** comes back as a message: a form gives one line (`Trip details — Who: Friends · Mood: Beach and sea,
  Food · ...`); a card gives its `prompt`. `(Skipped the form ...)` means: go on with sensible defaults, say which,
  or ask in plain text.
- **Never in a screen**: an API key (keys are pasted in the chat, First launch step 4), a booking, a payment or a
  "Book" button (Rules 7). Screens only ask and compare.

### `DATA` fields

- `hub`: `cards[]` with `icon` (a Tabler outline name, `ti-...`), `title`, `sub`, `status` (`done`, `next`,
  `later` or empty; one `next` at most: it gets the accent border), `prompt`.
- `options`: `multi` (false: one pick, a Choose button per card; true: short-list, then one Confirm button),
  `prompt` (sent before the chosen titles), `more` (prompt for "other options", or empty), `options[]` with `id`,
  `title`, `subtitle`, `recommended` (one at most), `badge`, `facts[]` (`icon`, `text`: 2 to 4 short facts: view,
  weather, rating, travel time, stops), `price`, `priceNote` (what the price covers), `link`, `linkLabel`.
- `itineraries`: `options[]` with `title`, `sub`, `recommended`, `stages[]` (`title`, `nights`), `legs[]` (`mode`:
  plane, train, car, bus, ferry, walk; `text`), `budget`, `why`. A stage keeps its color across options.
- `budget`: `currency` (ISO code), `locale`, `cap`, `lines[]` (`icon`, `label`, `amount` as a number, `flex: true`
  for spending the slider scales: meals, outings), `note`, `tunePrompt` (`{pct}`, `{total}`), `actions[]`
  (`label`, `prompt`). Take the numbers from `budget.md` or the page data, the same as the page shows.

## 3. The journey

The session-start message says `SETUP_NEEDED`, or `Setup done ... Active trip: <slug>.`

1. **Setup** (`SETUP_NEEDED`, `.setup/state.json` missing, or the person asks): CLAUDE.md > First launch. Steps 1 to
   3 and the Chrome test of step 6 run on their own, with one short line each. Then **one `setup` screen** for
   steps 4 to 6: keep in `keys` one card per service of the `keyed` group (`python3 -I scripts/setup.py services`:
   what it adds and its free tier, 6 words); in `connectors` and `extras`, only the connectors not on yet (by
   `tool_hint`); the `chrome` group only when the test failed. Then do what they picked (links and steps for each
   key and connector, Chrome steps), and `python3 -I scripts/setup.py done`.
2. **Welcome**: a `hub`: "Start a new trip" (`next`), one card per trip in `trips/` (title and dates; "Resume ..."),
   "See an example", "Redo the setup". With a single trip in progress, put "Resume" first as `next`.
3. **Brief**: create the trip (CLAUDE.md > Trips), then a `brief` screen. Write `profile.md` from the answer, ask in
   plain text only what is still missing (passport of each traveler when they differ, children's ages). Summarize in
   5 lines, then a `hub` with "Looks right" (`next`) and "Change something".
4. **Destinations** (when not chosen): CLAUDE.md > The flow, step 2; photo strips, then `options` (`multi: false`):
   facts = weather at the dates, travel time from home, the season's crowds; price = the rough total for the trip.
5. **Itineraries**: `itineraries` with 2 or 3 options. Then `trip.json`, validation and the first build (steps 4
   and 5 of The flow) without questions; say in two lines what is ready.
6. **Research**: a `hub` that says what wave 1 runs, how long it takes and that it uses a good share of the plan
   (Usage budget); its `next` card starts it. Then, for each stage: photo strips and `options` (`multi: true`,
   `prompt` "My short-list for <stage>:"); flights: `options` (`multi: false`) per leg, facts = times, stops,
   baggage. Wave 2 (activities, food, events): `options` (`multi: true`) per stage.
7. **Budget**: `budget` after each wave and whenever the person asks.
8. **What next**: a `hub` with the steps of The flow and their status (`done`, `next`, `later`): open the page, day
   by day, flights, budget, checklist, share, calendar. Show it at every pause point, so the person never has to know
   a command.

## 4. Buttons mode (AskUserQuestion)

Same questions, at most 4 per call, 2 to 4 options each (the tool adds "Other" for free text). Put your recommended
option first with "(Recommended)".

- `hub`: one question with the 4 most useful cards.
- `setup`: keys (`multiSelect`; "None for now" first, then the 3 most useful), connectors (`multiSelect`; "Not now"
  first, then Booking.com, Expedia, GetYourGuide), Chrome only when the test failed. The rest: "Other".
- `brief`: call 1: who, budget band, mood (`multiSelect`), pace; call 2: destination known or not, dates fixed or
  flexible, lodging (`multiSelect`), what matters (`multiSelect`). Then one plain message for what needs free text:
  home city and passports, the exact dates, the destination if they know it.
- `options` and `itineraries`: one question; each option's `preview` holds its facts, price and link (itineraries: the
  stages as `Lisbon ███ 3 · Comporta ███ 3 · Porto ███ 3`); `multiSelect` for a short-list. More than 4 options: show
  the best 4, the others are named in your text.
- `budget`: the lines as a short table in your text, then one question: looks good, find savings, change the spending
  on site.

## 5. Text mode

Each question as a short numbered list, several questions in one message at most 3, and say they can answer
"1b, 2a" or in their own words.
