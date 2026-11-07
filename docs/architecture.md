# Architecture

How the pieces fit. For the file formats see [trip-format.md](trip-format.md) and [research-format.md](research-format.md);
for the outside tools see [tools.md](tools.md).

## Pipeline

```
 brief + trip.json                 (Claude, with the person)
        |
        v
 research/*.json                   agents write their own files (stay-finder, flight-hunter, scouts...)
        |                          shared files are merged with scripts/merge_json.py
        v
 check_research.py                 reports missing or inconsistent fields; the build goes on
        |
        v
 build.py                          flights.py -> days.py -> check_research.py -> photos.py (--photos)
        |                          -> page_data.py -> build_page.py
        v
 site/index.html + site/media/     the page, built from page/ and the research
        |
        v
 server.py  <---- GET/PUT /api/etat ---->  the page in the browser
        |
        v
 state.json                        the picks made in the page
```

Everything for one trip lives in `trips/<slug>/` (git ignores it): `trip.json`, the Markdown notes, `research/`,
`site/` and `state.json`. The invented example in `examples/sample-trip/` has the same layout.

| Step | Script | Reads | Writes |
|---|---|---|---|
| Validate | `scripts/tripctx.py` | `trip.json` | nothing; prints the stages and the derived legs, or the field to fix |
| Research check | `scripts/check_research.py` | `research/` | nothing; problems on stderr |
| Flights | `scripts/flights.py` | `research/vols-brut/` (raw Kiwi results), `data/airports.json` | `research/vols-options.json` |
| Days | `scripts/days.py` | research files, `data/transit_rules.json` | `site/media/jours.json` |
| Photos | `scripts/photos.py`, `scripts/place_photos_extra.py` | photo links in the research | `site/media/photos/<slug>/` (never versioned) |
| Page data | `scripts/page_data.py` | everything above | `site/media/parcours*.json` |
| Page | `scripts/build_page.py` | `page/`, the page data | `site/index.html` |
| Build, all of it | `scripts/build.py` | | |
| Serve | `scripts/server.py` | `site/` | `state.json` only |

Anything not researched yet is listed on stderr ("not researched yet") and shows as an empty section in the page, so a
trip with only a `trip.json` still builds.

## The page

`page/` holds a template, CSS and plain JavaScript (no framework, no build tool). `build_page.py` inlines them into one
`index.html`; the data stays in `site/media/*.json`.

- `page/js/logic/`: pure logic with no DOM, tested with `node --test` (`budget.js`, `alerts.js`, `days.js`, `plan.js`, `config.js`).
- `page/js/ui/`: one file per screen (`shell.js` is the frame; `vols.js`, `logement.js`, `sorties.js`, `jours.js`,
  `plan-ecran.js`; `fiche.js`, `detail.js`, `compare.js` are panels; `store.js` talks to the server).
- `page/css/`: styles per screen family.
- `page/i18n/`: the page's texts, one file per language.

One screen per step, the total against the budget cap always visible in the header:

| Screen | Content |
|---|---|
| `aller` | arrival flights, one per home airport |
| `<stage>` | where to sleep in this stage (a tab per screen: lodging, then outings) |
| `<stage>-sorties` | outings, restaurants and events of the stage |
| `retour` | return flights |
| `jours` | the day by day |
| `plan` | what to book now, what to pay now, deadlines, what is paid on site |

With one stage and one traveler, the same screens appear with one stage in the middle.

## Server and state

`scripts/server.py` is the Python standard library only. It listens on 127.0.0.1 (never on the network), without a
password, serves `site/` and keeps the page's choices in `state.json` (the only file it ever writes, atomically and
under a lock).

| Request | Effect |
|---|---|
| `GET /api/etat` | The state: `{v, choix, favs, resa, mode}`, or `{}` until something is saved |
| `PUT /api/etat` with `{chemin, valeur[, fusion]}` | Changes one field. `chemin` is `choix.<stage>` (chosen lodging id), `choix.<leg>` (chosen flight option), `choix.sorties`, `favs.<key>.<who>`, `resa.<key>` (ticked as booked) or `mode` (`simple` / `detail`). `fusion: true` merges an object instead of replacing it |
| `PUT /api/etat?remplacer=1` with the whole state | Replaces everything; used once to migrate choices kept in the browser |

Errors come back as JSON with an `erreur` key. Limits: 64 KB per field, 2 MB for the state. Opened as a plain file
(without the server), the page keeps its choices in the browser instead.

## Languages

Two layers:

1. **The page.** `page/i18n/<code>.js` defines `I18N.<code> = {...}`.
2. **Labels made in Python** (budget lines, notes, link names). `scripts/i18n.py` holds one table per language.

### Adding a language

1. Copy `page/i18n/en.js` to `page/i18n/<code>.js`. Keep the keys and the `{placeholders}`; translate every value.
2. In `scripts/i18n.py`, copy the `EN` table to a new `<CODE>` table, translate it, and add it to `TABLES`.
3. Run both test suites; they check that every language has the same keys and placeholders.
4. Set `"language": "<code>"` in a trip's `trip.json` and rebuild.

A language without these files falls back to English with a one-line warning.

## Glossary: French internal names

JSON keys and research file names kept their original French names. New names are English.

| Name | Meaning |
|---|---|
| `etape` | stage: one stop of the trip (`stages` in `trip.json`) |
| `logement` | stay, lodging (`logements-<stage>.json`) |
| `sortie` | outing: an activity, restaurant or event (`sorties-<stage>.json`) |
| `vol` | flight (`vols-brut/`, `vols-options.json`) |
| `trajet` | leg, transfer between two places (`trajets.json`) |
| `choix` | choice: what the person picked in the page (`state.json`) |
| `lignes` | budget lines |
| `fiche` | the detailed sheet of a lodging (`resorts-fiches-<stage>.json`) |
| `pour_decider` | decision notes: what helps to choose |
| `galerie` | photo gallery |
| `jours` | days (`jours.json`, the day by day) |
| `formalites` | formalities: visa, entry card, insurance (`formalites.json`) |
| `taux` | exchange rate (`taux.json`) |
| `couts-unites` | unit costs: spending broken into quantity x price (`couts-unites.json`) |
| `acces` | access: how to reach a lodging (`acces-logements.json`) |
| `dernier_public` | last public transport of the evening, as a time (`acces.dernier_public`) |
| `speciale` | special evening (a holiday night, a festival) a lodging or outing is tied to (`specials` in `trip.json`) |
| `gala` | mandatory gala dinner imposed by a lodging on a special evening |
| `favs` | favorites (`state.json`) |
| `resa` | booked: items ticked as booked (`state.json`) |
| `chemin`, `valeur`, `fusion`, `remplacer` | path, value, merge, replace: fields of the state API |
| `erreur` | error |
| `_home` suffix | an amount in the traveler's home currency (`prix_total_home`) |
| `_example` | marks invented sample data (`"_example": true`) |
