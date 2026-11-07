# Tools

Every outside tool the planner can use, taken from [setup/services.json](../setup/services.json) (free limits, links and
check dates live there; run `python3 scripts/setup.py services` to print them) and from `.mcp.json` (the servers that
start without a key). Nothing here is paid by default.

Claude picks tools in the order given in `CLAUDE.md` ("Tool routing") and moves to the next one when a tool fails: a
missing service never blocks the trip.

## 1. Free, no account (`.mcp.json`)

Switched on for this project: `.claude/settings.json` sets `enableAllProjectMcpServers`, so they are enabled once
you trust the folder. `npx` and `uvx` download each server the first time it starts.

| Service | Server (`.mcp.json`) | Used for |
|---|---|---|
| Kiwi.com flights | `kiwi` | Flight search: prices, schedules, baggage |
| trivago | `trivago` | Hotel and apartment price comparison |
| Viator | `viator` | Tours and activities |
| Civitatis | `civitatis` | Tours and activities (adding to a cart always needs your OK) |
| Airbnb (OpenBnB server) | `airbnb` | Villas, houses and apartments |
| Fetch | `fetch` | Read any web page as text |
| Time | `time` | Time zones and local times |
| Playwright browser | `playwright` | Headless browser for pages that need scripts |
| Exa web search (no key) | `exa` | Web search for pages and places |
| Firecrawl (no key) | `firecrawl` | Search and scrape web pages |
| Open-Meteo | `open-meteo` | Weather, sea conditions, climate |
| Frankfurter currency | `currency` | Exchange rates (ECB) |
| Sequential thinking | `sequential-thinking` | Step-by-step reasoning for long choices (itinerary order, budget trade-offs) |

Check which ones answer on your computer: `python3 -I scripts/mcp.py check`.

## 2. Free tier with a key

Optional. Each key goes in `.env` (mode 600, ignored by git) and the server is registered in your private Claude Code
configuration, never in the repository. Verified dates and the sign-up steps are in `setup/services.json`.

| Service | What it adds | Free tier (as of the check date in `setup/services.json`) |
|---|---|---|
| SerpApi | Google Maps places, ratings and opening hours; Google Events and Flights | 250 searches per month, 50 per hour |
| Apify | Scraping sites with no other source (Agoda, Klook, Google reviews at scale) | USD 5 of platform usage per month, no credit card |
| Google Maps Grounding Lite | Places, distances and driving or walking routes | 10,000 free requests per month, then USD 7 per 1,000; billing must be enabled on the Google Cloud project |
| Brave Search | Independent web search | USD 5 of free credits per month; a card is requested to prevent abuse |
| Exa (with key) | Web search with higher limits than the keyless server | USD 10 of free credits per month, no card |
| Firecrawl (with key) | Scraping and search with higher limits than the keyless server | 1,000 credits per month, no card |

Apify is the only one that can cost money by accident, so Claude announces the estimated cost before each run, caps
every run, asks before spending more than USD 0.50 and logs the spending.

### Adding a keyed service

The easiest way is to ask Claude ("add my Brave key"): it gives the sign-up link and does the rest. By hand, keep the
key off the command line (and out of your shell history). If `.env` does not exist yet, create it with
`cp -n .env.example .env && chmod 600 .env`. Open `.env` in a text editor (`open -e .env` on a Mac), paste the key
after `BRAVE_API_KEY=`, save, then run:

```
sed -n 's/^BRAVE_API_KEY=//p' .env | python3 -I scripts/setup.py add-key brave
```

`add-key` takes the service id from `setup/services.json` (`serpapi`, `apify`, `google_maps`, `brave`, `exa`,
`firecrawl`), reads the key on standard input, saves it in `.env` with mode 600, registers the server in your private
Claude Code configuration and tests it. Then restart Claude Code (or type `/mcp`) to load it. The key is never printed.

To offer a new keyed service to everyone, add an entry to `setup/services.json` (same fields as the others) and a line
in `.env.example`, then run the tests.

## 3. Claude account connectors

Connectors belong to your Claude account, not to this folder: connect one once and every project sees it. To add
one: open <https://claude.ai/customize/connectors>, click **+** next to Connectors, find the service, click
**Connect** and sign in. Then start a new Claude Code session (or type `/mcp`) to see it. At setup, Claude says which
ones are already on (it recognizes each one by a tool name, `tool_hint` in `setup/services.json`).

Useful for every trip:

| Connector | What it adds |
|---|---|
| Booking.com | Hotels, apartments and attractions |
| Expedia | Flights and hotels |
| GetYourGuide | Tours and activities |
| Tripadvisor | Hotel reviews and ratings |
| AccuWeather | Weather forecasts |

Only if you want them:

| Connector | What it adds |
|---|---|
| Google Calendar | Put the final plan in your calendar (only after you approve) |
| Gmail | Find your booking confirmations to fill the bookings list (Claude reads and drafts, never sends) |
| Google Drive | Save the plan or the budget as a document to share |
| Yelp | Restaurants and bars with reviews (best in North America and Europe) |
| Resy | Restaurant tables and availability (mostly US cities; booking needs your OK) |
| Uber | Ride price estimates between two places |
| Ticketmaster | Concert, show and sport tickets on your dates (buying needs your OK) |
| StubHub | Resale tickets for sold-out events (buying needs your OK) |
| OpenBnB (Airbnb, paid) | Airbnb search and listing details plus maps, when the free `airbnb` server fails. No free tier: each call spends prepaid credit; its free `account_balance` tool shows the balance, the price of each tool and a link to add credit. Claude shows the balance and asks before any paid call |

They are free to connect (except OpenBnB's calls); each service has its own terms. The free limits of the others
were not verified (`unverified` in `setup/services.json`).

## 4. Browser: Claude in Chrome

Lets Claude read sites that have no tool (Trip.com, Agoda, airline sites) in your own Chrome, with your own sign-ins.
It needs a paid Claude plan (Pro, Max, Team or Enterprise) and Chrome on a Mac, Windows or Linux (not WSL). At setup
Claude tests it by itself: it opens and closes a test tab. If that works, nothing to do.

To switch it on (docs: <https://code.claude.com/docs/en/chrome>, checked 2026-11-07):

1. Install Chrome if you do not have it (<https://www.google.com/chrome/>).
2. Add the extension: <https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn>, click
   **Add to Chrome**, then sign in to it with the same Claude account as Claude Code.
3. Quit Chrome completely and open it again.
4. **In the terminal:** type `/chrome` in Claude Code and turn on **Enabled by default** (or start Claude Code with
   `claude --chrome`). The panel must say "Status: Enabled".
   **In the Claude desktop app:** Settings > Connectors > Claude in Chrome, turn it on; then set **Preferred browser**
   to Claude in Chrome (type "browser" in the settings search), and start a new session.

If Claude says the extension is not connected: `/chrome` > **Reconnect extension**, quit and reopen Chrome, and check
that the extension and Claude Code use the same Claude account (`/status`).

## Rules that apply to every tool

- Searching and comparing only: no booking, payment, cart, host contact or message without your explicit yes.
- A site that shows a CAPTCHA or an anti-bot check is marked "blocked" and never bypassed.
- Every price and dated fact is saved with its source URL and its check date.
