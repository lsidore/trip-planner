// The trip's configuration for the page logic: creerTrip(D) turns parcours.json's `trip` block into TRIP, the one place
// that knows the stages, the legs, the travelers, the currencies, the special evenings and the timing rules.
// Pure JavaScript, no DOM, no network.
//
// How the logic modules get TRIP (one pattern for all of them): their public functions keep their (choix, D)
// arguments and derive TRIP from D with creerTrip(D) when they are called; they never read a global TRIP. The shell
// (page/js/ui/shell.js) sets the global `TRIP = creerTrip(D)` once the data is loaded, for the screens and for i18n.js
// (language, currencies). In node, `require("./config.js").creerTrip`.
//
// TRIP = {
//   slug, title, language, start, end, budgetCap (null when absent),
//   currency: { home, local, rate, rate_date },        local / rate are null when there is no local currency
//   travelers: [{ id, label, adults, home_airport, home_city, flights_in_budget }], adults (the total),
//   stages: [{ key, title, from, to, nights, tone, file }], stageKeys,
//   legs: [{ key, kind: arrival|between|return, mode: flight|ground, travelers, adults, from_stage, to_stage,
//            from_airports, to_airports, date, in_budget }], legByKey,
//   arrivals, returns                                    the legs of kind arrival / return
//   legsArrivingAt(stage)   between legs whose to_stage is this stage
//   legLeaving(stage)       the between leg whose from_stage is this stage, or null
//   legsTo(stage), legsFrom(stage)   every leg (arrival or between / between or return) reaching / leaving the stage
//   specials: [{ key, stage, date, title }], specialsAt(stage)
//   rules: { checkin_min, airport_exit_min, earliest_leave, latest_arrival, arrival_gap_min } over the defaults
//   stage(key), stageAt(date)   the stage of a key; the stage where a date is spent (before the first: the first)
//   traveler(id), labelsOf(leg) a traveler; the labels of a leg's travelers ("Alex", "Alex + Sam")
//   whoOf(leg)                  the same, but "" when every traveler of the trip is on the leg
//   airportName(code), cityOf(code)   "Lisbon (LIS)" / "Lisbon", from the trip (home cities, stage titles) and the
//                                     flight layovers in D.vols; the bare code when unknown
// }
// A leg is in the budget unless every traveler on it has flights_in_budget false (as tripctx.py derives it).

var CFG_REGLES = { checkin_min: 90, airport_exit_min: 60, earliest_leave: "07:00", latest_arrival: "21:00", arrival_gap_min: 30 };

function cfgListe(x) {
  return Array.isArray(x) ? x : [];
}

function cfgNuits(a, b) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  const n = Math.round((p(b) - p(a)) / 86400000);
  return isFinite(n) ? n : 0;
}

function creerTrip(D) {
  const t = (D && D.trip) || {};
  const cur = t.currency || {};
  const travelers = cfgListe(t.travelers).map((x) => Object.assign({}, x, { adults: typeof x.adults === "number" ? x.adults : 1 }));
  const parId = {};
  travelers.forEach((x) => { parId[x.id] = x; });
  const stages = cfgListe(t.stages).map((s, i) => Object.assign({}, s, {
    nights: typeof s.nights === "number" ? s.nights : cfgNuits(s.from, s.to),
    tone: s.tone || i + 1,
  }));
  const parCle = {};
  stages.forEach((s) => { parCle[s.key] = s; });
  const legs = cfgListe(t.legs).map((l) => {
    const qui = cfgListe(l.travelers);
    const dans = l.in_budget !== false && (!qui.length || qui.some((id) => !parId[id] || parId[id].flights_in_budget !== false));
    return Object.assign({}, l, {
      travelers: qui.slice(), from_airports: cfgListe(l.from_airports).slice(), to_airports: cfgListe(l.to_airports).slice(),
      in_budget: dans,
    });
  });
  const legByKey = {};
  legs.forEach((l) => { legByKey[l.key] = l; });
  const specials = cfgListe(t.specials).map((s) => Object.assign({}, s));

  // airport code -> city: home airports, the stage a flight lands in, the stage a flight leaves, layovers
  const villes = {};
  const poser = (code, ville) => {
    if (code && ville && !villes[code]) villes[code] = ville;
  };
  travelers.forEach((x) => poser(x.home_airport, x.home_city));
  legs.forEach((l) => l.to_airports.forEach((c) => poser(c, l.to_stage && parCle[l.to_stage] && parCle[l.to_stage].title)));
  legs.forEach((l) => l.from_airports.forEach((c) => poser(c, l.from_stage && parCle[l.from_stage] && parCle[l.from_stage].title)));
  Object.keys((D && D.vols) || {}).forEach((k) => {
    cfgListe(D.vols[k] && D.vols[k].options).forEach((o) => cfgListe(o.escales).forEach((e) => poser(e.iata, e.ville)));
  });

  const trip = {
    slug: t.slug || "",
    title: t.title || "",
    language: t.language || "en",
    start: t.start || (stages[0] && stages[0].from) || null,
    end: t.end || (stages.length ? stages[stages.length - 1].to : null),
    budgetCap: typeof t.budget_cap === "number" && isFinite(t.budget_cap) ? t.budget_cap : null,
    currency: {
      home: cur.home || null,
      local: cur.local || null,
      rate: typeof cur.rate === "number" && isFinite(cur.rate) ? cur.rate : null,
      rate_date: cur.rate_date || null,
    },
    travelers,
    adults: travelers.reduce((s, x) => s + x.adults, 0),
    stages,
    stageKeys: stages.map((s) => s.key),
    legs,
    legByKey,
    arrivals: legs.filter((l) => l.kind === "arrival"),
    returns: legs.filter((l) => l.kind === "return"),
    specials,
    rules: Object.assign({}, CFG_REGLES, t.rules || {}),
  };
  trip.legsArrivingAt = (k) => legs.filter((l) => l.kind === "between" && l.to_stage === k);
  trip.legLeaving = (k) => legs.find((l) => l.kind === "between" && l.from_stage === k) || null;
  trip.legsTo = (k) => legs.filter((l) => l.to_stage === k);
  trip.legsFrom = (k) => legs.filter((l) => l.from_stage === k);
  trip.specialsAt = (k) => specials.filter((s) => s.stage === k);
  trip.stage = (k) => parCle[k] || null;
  trip.stageAt = (date) => {
    let s = stages[0] || null;
    stages.forEach((x) => {
      if (x.from <= date) s = x;
    });
    return s;
  };
  trip.traveler = (id) => parId[id] || null;
  trip.labelsOf = (leg) => cfgListe(leg && leg.travelers).map((id) => (parId[id] ? parId[id].label : id)).join(" + ");
  trip.whoOf = (leg) => {
    const ids = cfgListe(leg && leg.travelers);
    return !ids.length || ids.length === travelers.length ? "" : trip.labelsOf(leg);
  };
  trip.cityOf = (code) => villes[code] || String(code || "");
  trip.airportName = (code) => (villes[code] ? `${villes[code]} (${code})` : String(code || ""));
  return trip;
}

if (typeof module !== "undefined") {
  module.exports = { creerTrip };
}
