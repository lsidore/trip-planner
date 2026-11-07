# trip.json format

Every trip lives in a folder containing `trip.json` (for example `examples/sample-trip/`, or
`trips/<slug>/` for your own). Select it with the `TRIP_DIR` environment variable (absolute, or relative to the
repo root) or by writing its slug in `trips/.current`. `scripts/tripctx.py` loads and validates it; errors name the
field path (`stages[1].to`) and the stage key.

Derived files live next to it: `research/`, `site/` (`site/media/`), and `state.json` (your choices in the page).

## Top level

| Field | Required | Type | Default | Example |
|---|---|---|---|---|
| `slug` | yes | string | | `"sample-portugal"` |
| `title` | yes | string | | `"Lisbon, Comporta & Porto (example)"` |
| `language` | yes | string (`en`, `fr`) | | `"en"` |
| `currency.home` | yes | ISO code | | `"USD"` |
| `currency.local` | no | ISO code | none (ignored if equal to `home`) | `"EUR"` |
| `budget_cap` | yes | number, in home currency | | `6000` |
| `flex_days` | no | integer | `0` | `2` |
| `travelers` | yes | list, at least 1 | | see below |
| `stages` | yes | list, at least 1, in date order | | see below |
| `specials` | no | list | `[]` | see below |
| `rules` | no | object, merged over the defaults | see below | `{"checkin_min": 120}` |
| `defaults` | no | object | `{}` | |
| `base_lines` | no | list of `{lib, n, u, quand, poste}` | `[]` | fixed budget lines |
| `required_formalities` | no | list | `[]` | visa, entry card... |
| `_example` | no | boolean | | marks invented sample data |

## `travelers[]`

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | slug, unique | used in leg keys (`arrive-a`); see [Keys and ids](#keys-and-ids) |
| `label` | yes | string | display name |
| `adults` | yes | integer | |
| `home_airport` | yes | IATA code | travelers sharing one airport share one flight leg (`arrive-a+b`) |
| `home_city` | no | string | |
| `flights_in_budget` | no | boolean, default `true` | `false` keeps this traveler's arrival/return flights out of the budget |

## `stages[]`

| Field | Required | Type | Notes |
|---|---|---|---|
| `key` | yes | slug, unique | the page saves the lodging pick under it; see [Keys and ids](#keys-and-ids) |
| `title` | yes | string | any characters (`"São Paulo"`) |
| `from`, `to` | yes | `YYYY-MM-DD` | `to` after `from`; `nights` is computed. The switch day belongs to the stage that starts that day; the trip's last `to` day belongs to the last stage |
| `tz` | yes | IANA zone | `"Europe/Lisbon"` |
| `ref` | yes | `[lat, lng]` | reference point |
| `country` | yes | string | `"PT"` |
| `airports` | no | list of IATA codes, default `[]` | airports you can **arrive** at for this stage |
| `depart_airports` | no | list, default `[]` | airports to **leave** from when `airports` is empty or differs |
| `arrive_by` | no | `"flight"` or `"ground"` | forces the mode of the leg arriving here |
| `tone` | no | string | free-text mood for the stage |

### Keys and ids

Stage `key`s and traveler `id`s must match `^[a-z0-9][a-z0-9-]{0,39}$`: lowercase ASCII letters, digits and dashes,
starting with a letter or a digit, at most 40 characters. The page saves the picks under them (`state.json`
`choix.<stage key>`, leg keys such as `arrive-<id>` or `<stage>-<stage>`), so a dot, a space or an accent would make
saving fail. Slugify the name and keep the accents in `title` / `label`: `{"key": "sao-paulo", "title": "São Paulo"}`,
`{"id": "zoe", "label": "Zoé"}`. `tripctx.py` names the field and suggests a slug when one does not match.

## `specials[]`

`{"key", "stage", "date", "title"}`: a dated evening or event tied to a stage (`stage` must exist).

## `rules`

Defaults: `checkin_min` 90, `airport_exit_min` 60, `earliest_leave` `"07:00"`, `latest_arrival` `"21:00"`.

## Derived legs

- `arrive-<ids>`: home airport to the first stage (`airports`, else `depart_airports`), dated the first stage's `from`.
- `<from>-<to>` between stages, dated the arriving stage's `from`. Mode: `arrive_by` if set; otherwise `flight`
  when the leaving stage has `airports` or `depart_airports` **and** the arriving stage has `airports`; otherwise
  `ground`.
- `return-<ids>`: last stage (`depart_airports`, else `airports`) to each home airport, dated the last `to`.

## Minimal example (one stage, one traveler)

```json
{
  "slug": "weekend",
  "title": "Weekend in Lisbon",
  "language": "en",
  "currency": {"home": "USD"},
  "budget_cap": 1500,
  "travelers": [{"id": "a", "label": "Alex", "adults": 1, "home_airport": "JFK"}],
  "stages": [
    {"key": "lisbon", "title": "Lisbon", "from": "2027-06-15", "to": "2027-06-18",
     "tz": "Europe/Lisbon", "ref": [38.7223, -9.1393], "airports": ["LIS"], "country": "PT"}
  ]
}
```
