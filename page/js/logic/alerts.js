// Consistency alerts of the trip: when two choices do not go together, an alert says why and suggests a concrete fix.
// Pure JavaScript, no DOM, no network; tested by tests/js/alerts.test.js.
//
//   alertes(choix, D) -> [{ niveau: "bloquant" | "attention", etape, cle, texte, solution, trajet?, jour?, ligne? }]
//     etape  = the screen that shows the alert: a stage key, "aller" (the arrival flights) or "retour" (the return
//              flights). Rules 1 and 2: the stage of the lodging concerned; rules 3, 3b and 6: the outing's stage;
//              rule 4: "aller" / "retour" (a between leg: its arriving stage); rule 5: "aller" for arrival legs.
//     cle    = stable id (one alert per cle): arrivee-<leg>, arrivee-tardive-<leg>, depart-dernier-transport-<leg>,
//              depart-tres-tot-<leg>, depart-veille-<leg> (a flight after midnight: you leave the evening before),
//              jour-trajet-<outing>, hors-dates-<outing>, date-<leg>, ecart-arrivee-<leg>, meme-moment-<day>-<moment>.
//     trajet = the leg concerned (rules 1, 2, 4, 5).
//     jour   = (rule 2) the day you leave the lodging, to put the alert on the right day-by-day card.
//     ligne  = (rule 4) the "extra night" / "lost night" line of budget.js (ajustementsDates), the same object.
//     Blocking alerts first, then the order of the rules. No input is changed.
//   departLogement(choix, D, leg) -> { heure: "05:45", minutes, veille, jour, jour_vol, enregistrement, trajet_min, premier_public } | null
//     when to leave the lodging for the chosen flight of a leg that leaves a stage; null when it cannot be computed.
//   jourDepartLogement(choix, D, leg) -> { jour, jour_vol, heure, minutes, veille, estime, enregistrement, vol, dep } | null
//     THE shared computation of the day you leave a lodging (budget.js, days.js and this file read it): a flight leaving
//     after midnight makes you leave the evening before (jour = the day before, veille = true): no extra night. Without
//     a known road time only the check-in counts (estime = true). null only when the flight is not chosen or has no times.
//   departsEtape(choix, D, stage) -> [jourDepartLogement + { trajet }] for every chosen flight leaving the stage's
//     lodging, earliest first.
//
//   D = parcours.json, with each parcours-<stage>.json in D.lieux[<stage key>]. Choices read: each leg, each stage,
//   sorties, speciales. An absent field takes the default D.defaut; null or false = nothing. The day of each outing is
//   the one days.js gives it (placementSorties): the alerts see the same program as the day by day.
//   Timing rules come from TRIP.rules (checkin_min, airport_exit_min, earliest_leave, latest_arrival, arrival_gap_min).
//
// Private names start with "alr": this file is concatenated with the other logic/ files in the page. budget.js
// (ajustementsDates) and days.js (placementSorties) are called when computing; under node, by require.

// Thresholds (minutes since midnight)
const ALR_DEPART_TRES_TOT_MIN = 5 * 60 + 30; // leaving the lodging before 05:30 = "very early" (before midnight: "the evening before")
const ALR_FIN_NUIT_MIN = 5 * 60; // a flight landing between 00:00 and 05:00 lands in the night: the evening before goes on
const ALR_ARRIVEE_TARDIVE_MIN = 22 * 60; // reaching the lodging after 22:00 = "late arrival"
const ALR_PRIVE_TARD_MIN = 20 * 60; // beyond that, a private boat is not certain
const ALR_MOMENTS = {
  aube: "moment_dawn", matin: "moment_morning", journee: "moment_all_day", "apres-midi": "moment_afternoon", coucher: "moment_sunset", soir: "moment_evening",
};

// ------------------------------------------------------------------------------------------------ tools

function alrCfg(D) {
  const f = typeof creerTrip === "function" ? creerTrip : require("./config.js").creerTrip;
  return f(D);
}

function alrI18n() {
  return typeof T === "function" && typeof fmtDate === "function" ? { T, fmtDate, fmtMoney } : require("../i18n.js");
}

function alrT(cle, vars) {
  return alrI18n().T(cle, vars);
}

function alrNum(x) {
  return typeof x === "number" && isFinite(x);
}

function alrDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** "21:40" or "2027-06-15T21:40" -> 1300; null when it is not a time. */
function alrMin(s) {
  const m = /(\d{1,2}):(\d{2})/.exec(typeof s === "string" ? s : "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function alr2(n) {
  return (n < 10 ? "0" : "") + n;
}

/** 345 -> "05:45" (modulo 24 h: -220 -> "20:20"). */
function alrHeure(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return alr2(Math.floor(m / 60)) + ":" + alr2(m % 60);
}

/** 100 -> "1 h 40", 45 -> "45 min", 60 -> "1 h". */
function alrDuree(min) {
  const m = Math.round(min);
  if (m < 60) return alrT("dur_min", { m });
  return m % 60 ? alrT("dur_h_min", { h: Math.floor(m / 60), mm: alr2(m % 60) }) : alrT("dur_h", { h: Math.floor(m / 60) });
}

function alrArgent(x) {
  return alrI18n().fmtMoney(x, "home");
}

function alrJours(a, b) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

function alrJourPlus(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function alrDateTxt(iso) {
  return alrI18n().fmtDate(iso);
}

function alrMajuscule(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function alrCite(nom) {
  return alrT("quoted", { name: nom });
}

/** "a, b and c" */
function alrListe(noms) {
  return noms.length < 2 ? noms.join("") : noms.slice(0, -1).join(", ") + alrT("and_last") + noms[noms.length - 1];
}

/** Minutes since 1970 of "2027-06-15T18:00Z"; null when missing. */
function alrUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000 : null;
}

/** One sentence per solution: "Book … . Or sleep … . Or choose … ." */
function alrSolution(parts) {
  const p = parts.filter(Boolean);
  return p.map((x, i) => (i === 0 ? alrMajuscule(x) : alrT("alr_or") + " " + x) + ".").join(" ");
}

// ------------------------------------------------------------------------------------------------ reading choices and data

/** Choice field: undefined -> default D.defaut; null / false / anything but a text -> null. */
function alrChamp(choix, D, cle) {
  let v = choix ? choix[cle] : undefined;
  if (v === undefined) v = D && D.defaut ? D.defaut[cle] : undefined;
  return typeof v === "string" && v ? v : null;
}

function alrVolValide(o) {
  return !!o && Array.isArray(o.segments) && o.segments.length > 0 && !!o.segments[0].dep_local && !!o.segments[o.segments.length - 1].arr_local;
}

function alrOptions(D, leg) {
  const t = D && D.vols && D.vols[leg];
  return t && Array.isArray(t.options) ? t.options.filter(alrVolValide) : [];
}

function alrVolChoisi(choix, D, leg) {
  const id = alrChamp(choix, D, leg);
  return id ? alrOptions(D, leg).find((o) => o.id === id) || null : null;
}

function alrPremier(vol) {
  return vol.segments[0];
}

function alrDernier(vol) {
  return vol.segments[vol.segments.length - 1];
}

function alrNumeros(vol) {
  return vol.segments.map((s) => s.vol).join(" + ");
}

/** { id, nom, acces } of the chosen lodging (full fiche or "other" without access), or null. */
function alrLogement(choix, D, cle) {
  const id = alrChamp(choix, D, cle);
  const L = D && D.lieux && D.lieux[cle];
  if (!id || !L) return null;
  const l = (L.logements || []).concat(L.autres || []).find((x) => x.id === id);
  return l ? { id, nom: l.nom || alrT("alr_the_lodging"), acces: l.acces && typeof l.acces === "object" ? l.acces : null } : null;
}

/**
 * Price of a flight as the budget counts it: "vol" (lowest price found) and "valise" (checked bag supplement) lines,
 * else the price of the reading. { total, n, valiseInconnue } or null. valiseInconnue: the bag is not included and its
 * supplement is unknown (the budget then adds a "price to check" line).
 */
function alrPrixVol(vol) {
  const lignes = (vol.lignes || []).filter((l) => (l.cle === "vol" || l.cle === "valise") && alrNum(l.n) && alrNum(l.u));
  const billets = lignes.filter((l) => l.cle === "vol");
  const v = vol.valise;
  const valiseInconnue = !!v && v.comprise !== true && !alrNum(v.ajout_home) && !lignes.some((l) => l.cle === "valise");
  if (billets.length) {
    return { total: lignes.reduce((s, l) => s + l.n * l.u, 0), n: Math.max.apply(null, billets.map((l) => l.n)), valiseInconnue };
  }
  return alrNum(vol.prix_home) ? { total: vol.prix_home, n: 1, valiseInconnue } : null;
}

function alrPour(n) {
  return n > 1 ? " " + alrT("for_n_people", { n }) : "";
}

function alrPrixTexte(vol) {
  const p = alrPrixVol(vol);
  return p
    ? alrT("alr_price_from", { price: alrArgent(p.total), people: alrPour(p.n), bag: p.valiseInconnue ? alrT("alr_without_bag") : "" })
    : alrT("price_to_check");
}

/** The cheapest flight of this list that fits (then the earliest); null when none. */
function alrChoisir(options, convient) {
  const cle = (o) => {
    const p = alrPrixVol(o);
    return [p ? p.total : Infinity, alrMin(alrPremier(o).dep_local), o.id];
  };
  return options
    .filter(convient)
    .sort((a, b) => {
      const x = cle(a);
      const y = cle(b);
      return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
    })[0] || null;
}

/** The noun phrase of a leg: "Alex's flight", "the return flight", "the flight Comporta → Porto". */
function alrNomTrajet(ctx, leg) {
  const titre = (k) => (ctx.trip.stage(k) ? ctx.trip.stage(k).title : k || "");
  const qui = ctx.trip.whoOf(leg);
  if (leg.kind === "arrival") return qui ? alrT("alr_leg_arrival_who", { who: qui }) : alrT("alr_leg_arrival");
  if (leg.kind === "return") return qui ? alrT("alr_leg_return_who", { who: qui }) : alrT("alr_leg_return");
  return alrT("alr_leg_between", { from: titre(leg.from_stage), to: titre(leg.to_stage) });
}

/** The screen of a leg: "aller" for the arrival flights, "retour" for the returns, else the stage it reaches. */
function alrEcranDuTrajet(leg) {
  return leg.kind === "arrival" ? "aller" : leg.kind === "return" ? "retour" : leg.to_stage;
}

// ------------------------------------------------------------------------------------------------ times of a flight

/**
 * Landing time of a flight in minutes counted from the midnight of the evening it lands: a flight landing at 00:30 is
 * worth 24 h 30 (the evening before goes on), so that it is not taken for a morning flight. { t, nuit, soir }.
 */
function alrAtterrissage(vol) {
  const s = alrDernier(vol);
  const m = alrMin(s.arr_local);
  const jour = alrDate(s.arr_local);
  if (m === null || !jour) return null;
  const nuit = m < ALR_FIN_NUIT_MIN;
  return { t: nuit ? m + 1440 : m, nuit, soir: nuit ? alrJourPlus(jour, -1) : jour };
}

/** Arrival of a flight at a lodging: { arr, t, nuit, chez, dernier, bloque }; null when the access gives no road time. */
function alrArrivee(ctx, vol, acces) {
  if (!vol || !acces || !alrNum(acces.duree_min)) return null;
  const arr = alrMin(alrDernier(vol).arr_local);
  const at = alrAtterrissage(vol);
  if (arr === null || !at) return null;
  const chez = at.t + ctx.rules.airport_exit_min + acces.duree_min;
  const dernier = alrMin(acces.dernier_public);
  // right at the last departure is already too late (same rule as the default flights of page_data.py); after
  // midnight there is no public transport left (chez >= 24 h)
  return { arr, t: at.t, nuit: at.nuit, chez, dernier, bloque: dernier !== null && chez >= dernier };
}

/** "03:10 (in the middle of the night)", "01:30 (the next day)", "23:35". */
function alrChezTexte(a) {
  return alrHeure(a.chez) + (a.chez >= 1440 ? alrT(a.nuit ? "alr_in_the_night" : "alr_next_day") : "");
}

/**
 * Leaving a lodging for a flight: { dep, enreg, partir, premier, dernier, veille, niveau }; niveau = bloquant | attention
 * | null. partir < 0: you leave the evening before (a flight after midnight); then the last public transport of that
 * evening matters, not the first one of the morning.
 */
function alrDepart(ctx, vol, acces) {
  if (!vol || !acces || !alrNum(acces.duree_min)) return null;
  const dep = alrMin(alrPremier(vol).dep_local);
  if (dep === null) return null;
  const enreg = ctx.rules.checkin_min;
  const partir = dep - enreg - acces.duree_min;
  const premier = alrMin(acces.premier_public);
  const dernier = alrMin(acces.dernier_public);
  const veille = partir < 0;
  const niveau = veille
    ? (dernier !== null && partir + 1440 >= dernier ? "bloquant" : "attention")
    : premier !== null && partir < premier ? "bloquant" : partir < ALR_DEPART_TRES_TOT_MIN ? "attention" : null;
  return { dep, enreg, partir, premier, dernier, veille, niveau };
}

/**
 * The day and the hour you leave the lodging for this flight (a leg leaving a stage). Without a known road time only the
 * check-in counts (estime): a flight at 00:05 still makes you leave the evening before. null without times.
 */
function alrQuitter(ctx, vol, lg, leg) {
  if (!vol || !leg || !leg.from_stage) return null;
  const s0 = alrPremier(vol);
  const jourVol = alrDate(s0.dep_local);
  const dep = alrMin(s0.dep_local);
  if (!jourVol || dep === null) return null;
  const d = lg && lg.acces ? alrDepart(ctx, vol, lg.acces) : null;
  const enreg = ctx.rules.checkin_min;
  const partir = d ? d.partir : dep - enreg;
  const veille = partir < 0;
  return {
    jour: veille ? alrJourPlus(jourVol, -1) : jourVol,
    jour_vol: jourVol,
    heure: alrHeure(partir),
    minutes: ((partir % 1440) + 1440) % 1440,
    veille,
    estime: !d,
    enregistrement: enreg,
    vol: alrNumeros(vol),
    dep: alrHeure(dep),
    partir,
  };
}

/** The word for the public transport of an access: a boat when its mode goes by boat or ferry, else "transport". */
function alrNature(acces) {
  return acces && typeof acces.mode === "string" && /bateau|boat|ferry/i.test(acces.mode) ? "boat" : "transport";
}

function alrNatureTxt(n) {
  return alrT(n === "boat" ? "nature_boat" : "nature_transport");
}

/** Context: the trip, its rules, the chosen flights and lodgings, read once. */
function alrContexte(choix, D) {
  const c = choix && typeof choix === "object" ? choix : {};
  const trip = alrCfg(D);
  const ctx = { c, D, trip, rules: trip.rules, vol: {}, lg: {}, quitter: {} };
  ctx.confortDepart = alrMin(trip.rules.earliest_leave);
  ctx.confortArrivee = alrMin(trip.rules.latest_arrival);
  // the same choice, absent fields replaced by the defaults: what budget.js reads (ajustementsDates)
  ctx.resolu = Object.assign({}, c);
  trip.legs.map((l) => l.key).concat(trip.stageKeys).concat(["speciales", "inclure"]).forEach((k) => {
    if (ctx.resolu[k] === undefined && D && D.defaut) ctx.resolu[k] = D.defaut[k];
  });
  trip.legs.forEach((leg) => {
    if (leg.mode === "flight") ctx.vol[leg.key] = alrVolChoisi(c, D, leg.key);
  });
  trip.stageKeys.forEach((k) => {
    ctx.lg[k] = alrLogement(c, D, k);
  });
  trip.legs.forEach((leg) => {
    if (leg.mode === "flight" && leg.from_stage) ctx.quitter[leg.key] = alrQuitter(ctx, ctx.vol[leg.key], ctx.lg[leg.from_stage], leg);
  });
  return ctx;
}

/** The departures from a stage's lodging (chosen flights), earliest first. */
function alrDepartsEtape(ctx, etape) {
  return ctx.trip.legsFrom(etape)
    .filter((l) => l.mode === "flight" && ctx.quitter[l.key])
    .map((l) => Object.assign({ trajet: l.key }, ctx.quitter[l.key]))
    .sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : a.minutes - b.minutes));
}

/** Another option of the leg uses the same airports as the chosen flight (where a lodging is concerned). */
function alrMemesAeroports(ctx, leg, vol) {
  const ref = ctx.vol[leg.key];
  if (!ref) return true;
  return (!leg.from_stage || alrPremier(vol).de === alrPremier(ref).de) && (!leg.to_stage || alrDernier(vol).vers === alrDernier(ref).vers);
}

/** This flight triggers no alert of rule 1 or 2 at both ends and stays comfortable (the trip's rules). */
function alrConvient(ctx, leg, vol) {
  if (!alrMemesAeroports(ctx, leg, vol)) return false;
  const lgA = leg.to_stage ? ctx.lg[leg.to_stage] : null;
  if (lgA && lgA.acces) {
    const a = alrArrivee(ctx, vol, lgA.acces);
    if (a && (a.bloque || (ctx.confortArrivee !== null && a.chez > ctx.confortArrivee))) return false;
  }
  const lgD = leg.from_stage ? ctx.lg[leg.from_stage] : null;
  if (lgD && lgD.acces) {
    const d = alrDepart(ctx, vol, lgD.acces);
    if (d && (d.niveau || (ctx.confortDepart !== null && d.partir < ctx.confortDepart))) return false;
  }
  return true;
}

/**
 * Another flight of the same leg, on the same side of the airport, that fits these lodgings: on arrival, the same landing
 * evening; on departure, the same day of leaving the lodging (for a flight at 00:05, the evening before).
 */
function alrAlternative(ctx, leg, actuel, cote) {
  const ref = cote === "arr" ? alrDernier(actuel) : alrPremier(actuel);
  const aeroport = cote === "arr" ? ref.vers : ref.de;
  const lgD = leg.from_stage ? ctx.lg[leg.from_stage] : null;
  const jourDe = (o) => {
    if (cote === "arr") {
      const at = alrAtterrissage(o);
      return at ? at.soir : null;
    }
    const q = alrQuitter(ctx, o, lgD, leg);
    return q ? q.jour : null;
  };
  const jour = jourDe(actuel);
  return alrChoisir(alrOptions(ctx.D, leg.key), (o) => {
    const s = cote === "arr" ? alrDernier(o) : alrPremier(o);
    return o.id !== actuel.id && jourDe(o) === jour && (cote === "arr" ? s.vers : s.de) === aeroport && alrConvient(ctx, leg, o);
  });
}

/** "book the private transfer": its text and price, or "price not given". */
function alrPrive(acces, nature, tard) {
  const nom = alrT(nature === "boat" ? "alr_private_boat" : "alr_private_car");
  const prudence = tard && nature === "boat" ? alrT("alr_private_caution") : "";
  return alrNum(acces.prive_home)
    ? alrT("alr_private_book", { what: nom, price: alrArgent(acces.prive_home), nature: alrNatureTxt(nature), caution: prudence })
    : alrT("alr_private_ask", { what: nom, caution: prudence });
}

/** The road time of a lodging is given for one airport (acces.aeroport): say so when the flight uses another one. */
function alrNoteAeroport(ctx, acces, code, cle) {
  return acces && acces.aeroport && code && acces.aeroport !== code
    ? alrT(cle, { from: ctx.trip.airportName(acces.aeroport), airport: ctx.trip.airportName(code) })
    : "";
}

// ------------------------------------------------------------------------------------------------ rules 1 and 2: flight times

function alrAlertesArrivee(ctx, leg, vol, out) {
  const lg = leg.to_stage ? ctx.lg[leg.to_stage] : null;
  if (!lg || !lg.acces) return;
  const a = alrArrivee(ctx, vol, lg.acces);
  if (!a || !a.bloque) return;
  const acces = lg.acces;
  const sN = alrDernier(vol);
  const nature = alrNature(acces);
  const sortie = ctx.rules.airport_exit_min;
  const limite = a.dernier - sortie - acces.duree_min; // land before this time
  const alt = alrAlternative(ctx, leg, vol, "arr");
  const texte = alrT("alr_arrival_text", {
    leg: alrMajuscule(alrNomTrajet(ctx, leg)), flights: alrNumeros(vol), airport: ctx.trip.airportName(sN.vers), time: alrHeure(a.arr),
    night: a.nuit ? alrT("alr_in_the_night") : "", exit: alrDuree(sortie), road: alrDuree(acces.duree_min), lodging: lg.nom,
    at: alrChezTexte(a),
  }) + alrT("alr_but_last_public_leaves", { what: alrNatureTxt(nature), time: alrHeure(a.dernier) }) +
    alrNoteAeroport(ctx, acces, sN.vers, "alr_airport_note_arr");
  const premier = alrMin(acces.premier_public);
  const solution = alrSolution([
    alrPrive(acces, nature, a.t + sortie >= ALR_PRIVE_TARD_MIN),
    alrT("alr_sleep_near_airport", {
      city: ctx.trip.cityOf(sN.vers),
      first: premier !== null ? alrT("alr_by_first_public", { what: alrNatureTxt(nature), time: alrHeure(premier) }) : "",
    }),
    alt
      ? alrT("alr_choose_landing_before", { limit: alrHeure(limite), flights: alrNumeros(alt), time: alrHeure(alrMin(alrDernier(alt).arr_local)), price: alrPrixTexte(alt) })
      : null,
  ]);
  out.push({ niveau: "bloquant", etape: leg.to_stage, cle: "arrivee-" + leg.key, trajet: leg.key, texte, solution });
}

/** "+$35 compared with this flight", "-$12 …", "same price as this flight"; "price difference to check" when a price is missing. */
function alrEcartPrix(alt, vol) {
  const a = alrPrixVol(alt);
  const b = alrPrixVol(vol);
  if (!a || !b) return alrT("alr_price_diff_to_check");
  const d = Math.round((a.total - b.total) * 100) / 100;
  const valise = a.valiseInconnue || b.valiseInconnue ? alrT("alr_bag_to_check") : "";
  return (d === 0 ? alrT("alr_same_price") : alrT("alr_price_diff", { diff: (d > 0 ? "+" : "") + alrArgent(d), people: alrPour(a.n) })) + valise;
}

/** A flight of the same leg, the same evening and airport, landing earlier and at the lodging before 22:00, without other alert. */
function alrAlternativeTot(ctx, leg, vol) {
  const at = alrAtterrissage(vol);
  const lgA = ctx.lg[leg.to_stage];
  const lgD = leg.from_stage ? ctx.lg[leg.from_stage] : null;
  const tot = alrOptions(ctx.D, leg.key).filter((o) => {
    const ao = alrAtterrissage(o);
    if (o.id === vol.id || !ao || !at || ao.soir !== at.soir || !alrMemesAeroports(ctx, leg, o) || ao.t >= at.t) return false;
    const a = alrArrivee(ctx, o, lgA.acces);
    if (!a || a.bloque || a.chez > ALR_ARRIVEE_TARDIVE_MIN) return false;
    const d = lgD && lgD.acces ? alrDepart(ctx, o, lgD.acces) : null;
    return !(d && d.niveau);
  });
  // a comfortable flight if possible (the trip's earliest leave and latest arrival)
  const confort = tot.filter((o) => alrConvient(ctx, leg, o));
  return alrChoisir(confort.length ? confort : tot, () => true);
}

/** Reaching the lodging after 22:00 (not already blocked by the last public transport: that is "arrivee-<leg>"). */
function alrAlerteArriveeTardive(ctx, leg, vol, out) {
  const lg = leg.to_stage ? ctx.lg[leg.to_stage] : null;
  if (!lg || !lg.acces) return;
  const a = alrArrivee(ctx, vol, lg.acces);
  if (!a || a.bloque || !(a.chez > ALR_ARRIVEE_TARDIVE_MIN)) return;
  const acces = lg.acces;
  const sN = alrDernier(vol);
  const alt = alrAlternativeTot(ctx, leg, vol);
  const texte = alrT("alr_arrival_text", {
    leg: alrMajuscule(alrNomTrajet(ctx, leg)), flights: alrNumeros(vol), airport: ctx.trip.airportName(sN.vers), time: alrHeure(a.arr),
    night: a.nuit ? alrT("alr_in_the_night") : "", exit: alrDuree(ctx.rules.airport_exit_min), road: alrDuree(acces.duree_min),
    lodging: lg.nom, at: alrChezTexte(a),
  }) + alrT("alr_late_evening_lost", { time: alrHeure(ALR_ARRIVEE_TARDIVE_MIN) }) + alrNoteAeroport(ctx, acces, sN.vers, "alr_airport_note_arr");
  const solution = alrSolution([
    alt
      ? alrT("alr_take_earlier", {
        flights: alrNumeros(alt), time: alrHeure(alrMin(alrDernier(alt).arr_local)), instead: alrHeure(a.arr), price: alrPrixTexte(alt), diff: alrEcartPrix(alt, vol),
      })
      : null,
    alrT("alr_warn_lodging", { time: alrHeure(a.chez) }),
  ]);
  out.push({ niveau: "attention", etape: leg.to_stage, cle: "arrivee-tardive-" + leg.key, trajet: leg.key, texte, solution });
}

function alrAlertesDepart(ctx, leg, vol, out) {
  const lg = leg.from_stage ? ctx.lg[leg.from_stage] : null;
  if (!lg || !lg.acces) return;
  const d = alrDepart(ctx, vol, lg.acces);
  if (!d || !d.niveau) return;
  const acces = lg.acces;
  const s0 = alrPremier(vol);
  const nature = alrNature(acces);
  const q = alrQuitter(ctx, vol, lg, leg);
  const alt = alrAlternative(ctx, leg, vol, "dep");
  const vars = {
    leg: alrMajuscule(alrNomTrajet(ctx, leg)), flights: alrNumeros(vol), airport: ctx.trip.airportName(s0.de), time: alrHeure(d.dep),
    checkin: d.enreg, road: alrDuree(acces.duree_min), lodging: lg.nom, leave: alrHeure(d.partir), day: alrDateTxt(q.jour_vol), date: alrDateTxt(q.jour),
  };
  const debut = alrT(d.veille ? "alr_leave_text_evening" : "alr_leave_text", vars);
  const note = alrNoteAeroport(ctx, acces, s0.de, "alr_airport_note_dep");
  const ville = ctx.trip.cityOf(s0.de);
  const solAlt = alt
    ? alrT("alr_take_flight_at", { flights: alrNumeros(alt), time: alrHeure(alrMin(alrPremier(alt).dep_local)), leave: alrHeure(alrDepart(ctx, alt, acces).partir), price: alrPrixTexte(alt) })
    : null;
  // the day-by-day card that shows the alert: the day you leave the lodging
  const base = { etape: leg.from_stage, trajet: leg.key, jour: q.jour };
  if (d.niveau === "bloquant" && d.veille) {
    out.push(Object.assign({
      niveau: "bloquant",
      cle: "depart-dernier-transport-" + leg.key,
      texte: debut + alrT("alr_but_last_public", { what: alrNatureTxt(nature), time: alrHeure(d.dernier) }) + note,
      solution: alrSolution([
        alrPrive(acces, nature, true),
        solAlt,
        alrT("alr_take_last_public", { what: alrNatureTxt(nature), time: alrHeure(d.dernier), city: ville }),
      ]),
    }, base));
  } else if (d.niveau === "bloquant") {
    out.push(Object.assign({
      niveau: "bloquant",
      cle: "depart-dernier-transport-" + leg.key,
      texte: debut + alrT("alr_but_first_public", { what: alrNatureTxt(nature), time: alrHeure(d.premier) }) + note,
      solution: alrSolution([alrPrive(acces, nature), solAlt, alrT("alr_sleep_before_near_airport", { city: ville })]),
    }, base));
  } else if (d.veille) {
    // a flight after midnight: not "very early" but a departure the evening before; the last night slept is the one before
    out.push(Object.assign({
      niveau: "attention",
      cle: "depart-veille-" + leg.key,
      texte: debut + alrT("alr_evening_departure", { date: alrDateTxt(q.jour) }) + note,
      solution: alrSolution([solAlt, alrT("alr_keep_room", { lodging: lg.nom, time: alrHeure(d.partir) })]),
    }, base));
  } else {
    out.push(Object.assign({
      niveau: "attention",
      cle: "depart-tres-tot-" + leg.key,
      texte: debut + alrT("alr_very_early", { time: alrHeure(ALR_DEPART_TRES_TOT_MIN) }) + note,
      solution: alrSolution([solAlt, alrT("alr_sleep_before_near_airport", { city: ville })]),
    }, base));
  }
}

/**
 * When to leave the lodging for the chosen flight of a leg leaving a stage. null for other legs or when the road time is
 * unknown. jour: the day you leave the lodging (the day before the flight when veille); jour_vol: the day of the flight.
 */
function departLogement(choix, D, trajet) {
  const ctx = alrContexte(choix, D);
  const leg = ctx.trip.legByKey[trajet];
  if (!leg || leg.mode !== "flight" || !leg.from_stage) return null;
  const vol = ctx.vol[trajet];
  const lg = ctx.lg[leg.from_stage];
  if (!vol || !lg || !lg.acces) return null;
  const d = alrDepart(ctx, vol, lg.acces);
  if (!d) return null;
  const q = ctx.quitter[trajet];
  return {
    heure: alrHeure(d.partir),
    minutes: ((d.partir % 1440) + 1440) % 1440,
    veille: d.partir < 0,
    jour: q.jour,
    jour_vol: q.jour_vol,
    enregistrement: d.enreg,
    trajet_min: lg.acces.duree_min,
    premier_public: lg.acces.premier_public || null,
  };
}

function alrPublicQuitter(q) {
  return q
    ? { jour: q.jour, jour_vol: q.jour_vol, heure: q.heure, minutes: q.minutes, veille: q.veille, estime: q.estime, enregistrement: q.enregistrement, vol: q.vol, dep: q.dep }
    : null;
}

/**
 * The day you leave the lodging for this flight: the shared computation of budget.js (nights), days.js (cards,
 * transfer, travel days) and this file. Computed even without a known road time (estime: only the check-in counts).
 * null when the flight is not chosen, has no times or leaves no lodging (arrival flights).
 */
function jourDepartLogement(choix, D, trajet) {
  const ctx = alrContexte(choix, D);
  return alrPublicQuitter(ctx.quitter[trajet] || null);
}

/** Every departure from this stage's lodging for a chosen flight, earliest first: [{ trajet, jour, heure, minutes, … }]. */
function departsEtape(choix, D, etape) {
  const ctx = alrContexte(choix, D);
  return alrDepartsEtape(ctx, etape).map((q) => Object.assign({ trajet: q.trajet }, alrPublicQuitter(q)));
}

// ------------------------------------------------------------------------------------------------ outings: rules 3, 3b and 6

function alrIndexSorties(ctx) {
  const idx = {};
  ctx.trip.stageKeys.forEach((cle) => {
    const L = ctx.D && ctx.D.lieux && ctx.D.lieux[cle];
    ((L && L.sorties) || []).forEach((s) => {
      if (s && s.id && !idx[s.id]) idx[s.id] = { s, etape: s.etape || cle };
    });
  });
  return idx;
}

/** Bounds of each stage [from, to]. */
function alrBornes(ctx) {
  const bornes = {};
  ctx.trip.stages.forEach((s) => {
    bornes[s.key] = [s.from, s.to];
  });
  return bornes;
}

/** days.js (JoursLogic): loaded in the page before the first call; under node, by require. null when missing. */
function alrJoursLogic() {
  if (typeof JoursLogic !== "undefined" && JoursLogic && typeof JoursLogic.placementSorties === "function") return JoursLogic;
  if (typeof module !== "undefined" && typeof require === "function") return require("./days.js");
  return null;
}

/** The outings as days.js places them (the day by day): { jours, horsDates, impossibles, fenetres }; null without days.js. */
function alrPlacement(ctx) {
  if (ctx.placement === undefined) {
    const J = alrJoursLogic();
    ctx.placement = J ? J.placementSorties(ctx.c, ctx.D) : null;
  }
  return ctx.placement;
}

/** When an outing of this moment is over, back at the lodging included (days.js table); null when unknown. */
function alrFinMoment(moment) {
  const J = alrJoursLogic();
  return J && typeof J.finMoment === "function" ? J.finMoment(moment) : null;
}

/**
 * Travel days { "YYYY-MM-DD": "what happens" } (the same days as days.js): the first day of each stage, the days someone
 * leaves the last hotel (the evening before for a flight after midnight; its last day when no return is chosen), and
 * the real landing days of the arrival flights.
 */
function alrJoursTrajet(ctx) {
  const t = {};
  const poser = (jour, texte) => {
    if (jour && !t[jour]) t[jour] = texte;
  };
  const stages = ctx.trip.stages;
  stages.forEach((s, i) => {
    poser(s.from, i === 0 ? alrT("alr_day_arrival", { stage: s.title }) : alrT("alr_day_change", { from: stages[i - 1].title, to: s.title }));
  });
  const dernier = stages.length ? stages[stages.length - 1] : null;
  const retours = ctx.trip.returns.map((l) => ctx.quitter[l.key]).filter(Boolean);
  retours.forEach((q) => poser(q.jour, q.veille ? alrT("alr_day_leave_evening", { time: q.heure, dep: q.dep }) : alrT("alr_day_return")));
  if (!retours.length && dernier) poser(dernier.to, alrT("alr_day_return"));
  ctx.trip.arrivals.forEach((leg) => {
    const v = ctx.vol[leg.key];
    if (v) poser(alrDate(alrDernier(v).arr_local), alrT("alr_day_landing", { who: ctx.trip.labelsOf(leg) }));
  });
  return t;
}

function alrTableSorties(ctx) {
  const so = ctx.c.sorties;
  return so && typeof so === "object" && !Array.isArray(so) ? so : {};
}

function alrJourChoisi(ctx, id) {
  const v = alrTableSorties(ctx)[id];
  return v && typeof v === "object" ? alrDate(v.jour) : null;
}

/**
 * Outings placed on a day, as in the day by day (days.js). fixe: the outing cannot change day (a fixed date without a
 * chosen day, or a special evening's outing, chosen as a block). Without days.js: only chosen days and fixed dates.
 */
function alrSortiesPlacees(ctx) {
  const idx = alrIndexSorties(ctx);
  const placee = (id, jour) => {
    const s = idx[id].s;
    const choisi = alrJourChoisi(ctx, id);
    return { id, s, etape: idx[id].etape, jour, fixe: !choisi && (!!alrDate(s.date_fixe) || !!s.speciale) };
  };
  const pl = alrPlacement(ctx);
  if (pl && pl.jours) {
    return Object.keys(pl.jours).sort().filter((id) => idx[id]).map((id) => placee(id, pl.jours[id]));
  }
  const out = [];
  const so = alrTableSorties(ctx);
  Object.keys(so).sort().forEach((id) => {
    if (!so[id] || !idx[id]) return;
    const jour = alrJourChoisi(ctx, id) || alrDate(idx[id].s.date_fixe);
    if (jour) out.push(placee(id, jour));
  });
  return out;
}

/** Two moments that do not fit the same day: the same moment, or a full day and any other moment but the evening. */
function alrConflit(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  return a === b || (a === "journee" && b !== "soir") || (b === "journee" && a !== "soir");
}

/** The day after the last landing (no dawn that day, as days.js); null when everyone lands before the trip starts. */
function alrLendemainArrivee(ctx) {
  const debut = ctx.trip.start;
  let a = null;
  ctx.trip.arrivals.forEach((leg) => {
    const v = ctx.vol[leg.key];
    const j = v ? alrDate(alrDernier(v).arr_local) : null;
    if (j && (!a || j > a)) a = j;
  });
  if (a && a < debut) return null;
  return alrJourPlus(a || debut, 1);
}

/**
 * A day to move this outing to: one of your days at its stage (days.js: fenetres), without travel, where nothing else
 * falls at the same moment (nor a full day), that respects its dates and the dawn rule, the closest to its current day.
 * null when its date is fixed or no day fits.
 */
function alrJourLibre(ctx, p, placees, bornes, trajet) {
  if (p.fixe || alrDate(p.s.date_fixe)) return null;
  const pl = alrPlacement(ctx);
  const fen = pl && pl.fenetres && pl.fenetres[p.etape];
  const du = fen ? fen.du : bornes[p.etape] && bornes[p.etape][0];
  const au = fen ? fen.au : bornes[p.etape] && bornes[p.etape][1];
  if (!du || !au) return null;
  const seulement = Array.isArray(p.s.dates) && p.s.dates.length && p.s.dates.every((d) => alrDate(d)) ? p.s.dates.map(alrDate) : null;
  const pasAube = alrLendemainArrivee(ctx);
  let meilleur = null;
  for (let d = du; d <= au; d = alrJourPlus(d, 1)) {
    if (trajet[d] || (seulement && seulement.indexOf(d) < 0) || d === p.jour) continue;
    if (p.s.moment === "aube" && d === pasAube) continue;
    if (placees.some((q) => q.id !== p.id && q.jour === d && alrConflit(q.s.moment, p.s.moment))) continue;
    const ecart = Math.abs(alrJours(p.jour, d));
    if (!meilleur || ecart < meilleur.ecart) meilleur = { jour: d, ecart };
  }
  return meilleur ? meilleur.jour : null;
}

function alrMoment(m) {
  return ALR_MOMENTS[m] ? alrT(ALR_MOMENTS[m]) : String(m || "");
}

function alrTitreEtape(ctx, k) {
  return ctx.trip.stage(k) ? ctx.trip.stage(k).title : k;
}

/**
 * Rule 3: an outing on a travel day (without jour_trajet_ok), or, even with jour_trajet_ok, an outing of a stage someone
 * leaves that day that ends after they leave its lodging.
 */
function alrAlertesJourTrajet(ctx, placees, bornes, trajet, out) {
  placees.forEach((p) => {
    const fin = alrFinMoment(p.s.moment);
    const departs = alrDepartsEtape(ctx, p.etape).filter((q) => q.jour === p.jour);
    const q = fin === null ? null : departs.find((x) => fin > x.minutes) || null;
    const pendantDepart = !!q;
    if (!pendantDepart && (!trajet[p.jour] || p.s.jour_trajet_ok)) return;
    const libre = alrJourLibre(ctx, p, placees, bornes, trajet);
    const solution = p.fixe || alrDate(p.s.date_fixe)
      ? alrSolution([alrT(pendantDepart ? "alr_fix_choose_flight" : "alr_fix_keep_if_time"), alrT("alr_remove")])
      : alrSolution([libre ? alrT("alr_move_to", { date: alrDateTxt(libre) }) : alrT("alr_move_other_day"), alrT("alr_remove")]);
    let texte;
    if (pendantDepart) {
      const lg = ctx.lg[p.etape];
      const leg = ctx.trip.legByKey[q.trajet];
      const qui = leg ? ctx.trip.whoOf(leg) : "";
      texte = alrT("alr_during_departure", {
        name: alrCite(p.s.nom), date: alrDateTxt(p.jour), moment: alrMoment(p.s.moment), lodging: lg ? lg.nom : alrT("alr_the_lodging"),
        time: q.heure, who: qui ? ` (${qui})` : "", leg: leg ? alrNomTrajet(ctx, leg) : "", flights: q.vol,
        dep: q.veille ? alrT("alr_dep_night", { time: q.dep, date: alrDateTxt(q.jour), day: alrDateTxt(q.jour_vol) }) : alrT("alr_dep_at", { time: q.dep }),
      });
    } else {
      const soir = departs.some((x) => x.veille);
      texte = alrT("alr_on_travel_day", { name: alrCite(p.s.nom), date: alrDateTxt(p.jour), what: trajet[p.jour] }) +
        alrT(soir ? "alr_on_the_road_evening" : "alr_travel_takes_day");
    }
    out.push({ niveau: "attention", etape: p.etape, cle: "jour-trajet-" + p.id, texte, solution });
  });
}

/**
 * Rule 3b: a counted outing outside your days (days.js: horsDates): a chosen day that is no longer one of your days at the
 * stage (a later landing, an earlier return), or a fixed date outside them. The budget still counts it when it can
 * happen another day of the stage (not in impossibles), otherwise no longer.
 */
function alrAlertesHorsDates(ctx, placees, bornes, trajet, out) {
  const pl = alrPlacement(ctx);
  if (!pl || !Array.isArray(pl.horsDates)) return;
  const idx = alrIndexSorties(ctx);
  const impossibles = Array.isArray(pl.impossibles) ? pl.impossibles : [];
  pl.horsDates.forEach((id) => {
    if (!idx[id]) return;
    const s = idx[id].s;
    const etape = idx[id].etape;
    const fen = pl.fenetres && pl.fenetres[etape];
    const jours = fen ? (fen.du <= fen.au ? alrT("alr_days_range", { from: alrDateTxt(fen.du), to: alrDateTxt(fen.au) }) : alrT("alr_days_none")) : "";
    const vos = alrT("alr_outside_days", { stage: alrTitreEtape(ctx, etape), range: jours });
    const choisi = alrJourChoisi(ctx, id);
    const garde = impossibles.indexOf(id) < 0;
    const fixe = alrDate(s.date_fixe);
    let texte;
    let solution;
    if (choisi) {
      texte = alrT("alr_outside_chosen", { name: alrCite(s.nom), date: alrDateTxt(choisi), outside: vos }) + " " +
        alrT(garde ? "alr_still_counted" : "alr_not_counted");
      const libre = garde ? alrJourLibre(ctx, { id, s, etape, jour: choisi, fixe: false }, placees, bornes, trajet) : null;
      solution = alrSolution([
        garde && fixe ? alrT("alr_back_to_date", { date: alrDateTxt(fixe) })
          : libre ? alrT("alr_move_to", { date: alrDateTxt(libre) })
            : garde ? alrT("alr_choose_other_day") : null,
        alrT("alr_remove"),
      ]);
    } else {
      const seulement = Array.isArray(s.dates) ? s.dates.map(alrDate).filter(Boolean) : [];
      const quand = fixe
        ? alrT("alr_takes_place_on", { date: alrDateTxt(fixe) })
        : alrT("alr_only_on", { dates: seulement.map(alrDateTxt).join(alrT("or_between")) });
      texte = alrT("alr_outside_fixed", { name: alrCite(s.nom), when: quand, outside: vos });
      solution = alrSolution([alrT("alr_remove_fixed")]);
    }
    out.push({ niveau: "attention", etape, cle: "hors-dates-" + id, texte, solution });
  });
}

/**
 * Rule 6: two outings the same day at the same moment, or an outing "all day" and another one that day (but the
 * evening): one alert per day and per moment ("journee" gathers everything that falls during the day).
 */
function alrAlertesMemeMoment(ctx, placees, bornes, trajet, out) {
  const parJour = {};
  placees.forEach((p) => {
    if (typeof p.s.moment !== "string" || !p.s.moment) return;
    (parJour[p.jour] = parJour[p.jour] || []).push(p);
  });
  const groupes = [];
  Object.keys(parJour).sort().forEach((jour) => {
    const liste = parJour[jour];
    const parMoment = {};
    const ordre = [];
    const ajouter = (m, p) => {
      if (!parMoment[m]) {
        parMoment[m] = [];
        ordre.push(m);
      }
      parMoment[m].push(p);
    };
    const journee = liste.some((p) => p.s.moment === "journee");
    liste.forEach((p) => ajouter(journee && p.s.moment !== "soir" ? "journee" : p.s.moment, p));
    ordre.forEach((m) => {
      if (parMoment[m].length >= 2) groupes.push({ jour, moment: m, g: parMoment[m] });
    });
  });
  groupes.forEach(({ jour, moment, g }) => {
    const memes = g.every((p) => p.s.moment === g[0].s.moment);
    let texte;
    if (memes) {
      texte = alrT("alr_overlap_same", { date: alrDateTxt(jour), moment: alrMoment(moment), n: g.length, names: alrListe(g.map((p) => alrCite(p.s.nom))) });
    } else {
      const longues = g.filter((p) => p.s.moment === "journee");
      const autres = g.filter((p) => p.s.moment !== "journee");
      texte = alrT("alr_overlap_all_day", {
        date: alrDateTxt(jour), long: alrListe(longues.map((p) => alrCite(p.s.nom))),
        others: alrListe(autres.map((p) => `${alrCite(p.s.nom)} (${alrMoment(p.s.moment)})`)),
      });
    }
    const mobiles = g.filter((p) => !p.fixe && !alrDate(p.s.date_fixe));
    let solution;
    if (!mobiles.length) {
      solution = alrSolution([alrT("alr_keep_one_fixed")]);
    } else {
      const p = mobiles[mobiles.length - 1];
      const libre = alrJourLibre(ctx, p, placees, bornes, trajet);
      solution = alrSolution([
        libre ? alrT("alr_move_named_to", { name: alrCite(p.s.nom), date: alrDateTxt(libre) }) : alrT("alr_move_named_other_moment", { name: alrCite(p.s.nom) }),
        alrT("alr_remove"),
      ]);
    }
    out.push({ niveau: "attention", etape: g[0].etape, cle: "meme-moment-" + jour + "-" + moment, texte, solution });
  });
}

// ------------------------------------------------------------------------------------------------ rule 4: dates of the first arrival and the last return

/** ajustementsDates of budget.js: loaded before in the page; under node, by require. */
function alrAjustementsDates(choix, D) {
  if (typeof ajustementsDates === "function") return ajustementsDates(choix, D);
  if (typeof module !== "undefined" && typeof require === "function") return require("./budget.js").ajustementsDates(choix, D);
  return [];
}

function alrAlertesDates(ctx, out) {
  alrAjustementsDates(ctx.resolu, ctx.D).forEach((l) => {
    if (!l || (l.cle !== "nuit-en-plus" && l.cle !== "nuit-perdue")) return;
    const leg = ctx.trip.legByKey[l.cause];
    if (!leg) return;
    const aller = l.sens === "arrivee";
    const prevu = aller ? ctx.trip.start : ctx.trip.end;
    const k = alrNum(l.nuits) ? l.nuits : alrNum(l.n) ? l.n : 1;
    const lg = ctx.lg[l.etape];
    const lieu = lg ? lg.nom : alrTitreEtape(ctx, l.etape);
    const qui = ctx.trip.whoOf(leg);
    const nomLeg = alrMajuscule(alrNomTrajet(ctx, leg));
    // return: l.jour is the day you leave the hotel (the day before the flight when it leaves after midnight), l.jour_vol the flight's
    const quoi = aller
      ? qui ? alrT("alr_lands_on_instead", { who: qui, date: alrDateTxt(l.jour), planned: alrDateTxt(prevu) }) : alrT("alr_arrival_on_instead", { date: alrDateTxt(l.jour), planned: alrDateTxt(prevu) })
      : l.veille && alrDate(l.jour_vol)
        ? alrT("alr_return_leaves_evening", { leg: nomLeg, day: alrDateTxt(l.jour_vol), time: ctx.quitter[leg.key] ? ctx.quitter[leg.key].dep : "", date: alrDateTxt(l.jour), planned: alrDateTxt(prevu) })
        : alrT("alr_return_leaves_on", { leg: nomLeg, date: alrDateTxt(l.jour), planned: alrDateTxt(prevu) });
    // on the planned day, the same flights when they exist, else the cheapest that respects the lodgings' times; on the
    // return, "the planned day" is the day you leave the hotel (a flight at 00:05 on the 25th leaves on the 24th evening)
    const actuel = ctx.vol[leg.key];
    const jourDe = (o) => {
      if (aller) return alrDate(alrDernier(o).arr_local);
      const q = alrQuitter(ctx, o, ctx.lg[leg.from_stage], leg);
      return q ? q.jour : null;
    };
    const leJour = (o) => jourDe(o) === prevu && alrConvient(ctx, leg, o);
    const memes = actuel ? alrNumeros(actuel) : null;
    const alt = alrChoisir(alrOptions(ctx.D, leg.key), (o) => leJour(o) && alrNumeros(o) === memes) || alrChoisir(alrOptions(ctx.D, leg.key), leJour);
    const solAlt = alt
      ? alrT(aller ? "alr_choose_landing_on_ex" : "alr_choose_leaving_on_ex", {
        date: alrDateTxt(prevu), flights: alrNumeros(alt), time: alrHeure(alrMin(aller ? alrDernier(alt).arr_local : alrPremier(alt).dep_local)), price: alrPrixTexte(alt),
      })
      : alrT(aller ? "alr_choose_landing_on" : "alr_choose_leaving_on", { date: alrDateTxt(prevu) });
    let texte;
    let solution;
    if (l.cle === "nuit-en-plus") {
      const prix = alrNum(l.u)
        ? alrT("alr_nights_price", { k, unit: alrArgent(l.u), total: alrArgent(Math.round(k * l.u * 100) / 100) })
        : alrT("price_to_check");
      texte = alrT("alr_extra_nights", { what: quoi, n: k, place: lieu, price: prix });
      solution = alrSolution([alrT(alrNum(l.u) ? "alr_keep_nights_added" : "alr_keep_nights", { n: k }), solAlt]);
    } else {
      texte = alrT("alr_lost_nights", { what: quoi, n: k, place: lieu });
      solution = alrSolution([solAlt, alrT(aller ? "alr_ask_shift_start" : "alr_ask_shorten")]);
    }
    out.push({ niveau: "attention", etape: alrEcranDuTrajet(leg), cle: "date-" + leg.key, trajet: leg.key, texte, solution, ligne: l });
  });
}

// ------------------------------------------------------------------------------------------------ rule 5: arrivals at one stage far apart

/**
 * Two flights reaching the same stage the same day more than rules.arrival_gap_min minutes apart: the first traveler waits
 * at the airport. One alert per late leg, naming the travelers by their labels.
 */
function alrAlertesEcartArrivee(ctx, out) {
  const ecartMax = alrNum(ctx.rules.arrival_gap_min) ? ctx.rules.arrival_gap_min : 30;
  const parEtape = {};
  ctx.trip.legs.forEach((leg) => {
    const v = leg.mode === "flight" && leg.to_stage ? ctx.vol[leg.key] : null;
    if (v) (parEtape[leg.to_stage] = parEtape[leg.to_stage] || []).push({ leg, v, s: alrDernier(v) });
  });
  const ecart = (a, b) => {
    const ua = alrUtc(a.arr_utc);
    const ub = alrUtc(b.arr_utc);
    return ua !== null && ub !== null ? ub - ua : alrMin(b.arr_local) - alrMin(a.arr_local);
  };
  Object.keys(parEtape).forEach((etape) => {
    const liste = parEtape[etape];
    liste.forEach((tard) => {
      const memeJour = liste.filter((x) => x !== tard && alrDate(x.s.arr_local) === alrDate(tard.s.arr_local));
      if (!memeJour.length) return; // another day: that is the date alert, nobody waits at the airport
      const tot = memeJour.reduce((a, b) => (ecart(a.s, b.s) < 0 ? b : a));
      const attente = ecart(tot.s, tard.s);
      if (!(attente > ecartMax)) return;
      const alt = alrChoisir(alrOptions(ctx.D, tard.leg.key), (o) => {
        const so = alrDernier(o);
        return alrDate(so.arr_local) === alrDate(tot.s.arr_local) && alrConvient(ctx, tard.leg, o) && ecart(tot.s, so) <= ecartMax;
      });
      const lg = ctx.lg[etape];
      const prive = lg && lg.acces && alrNum(lg.acces.prive_home) ? alrT("alr_private_transfer_price", { price: alrArgent(lg.acces.prive_home) }) : "";
      const late = ctx.trip.labelsOf(tard.leg);
      const early = ctx.trip.labelsOf(tot.leg);
      out.push({
        niveau: "attention",
        etape: alrEcranDuTrajet(tard.leg),
        cle: "ecart-arrivee-" + tard.leg.key,
        trajet: tard.leg.key,
        texte: alrT("alr_gap_text", {
          late, airport: ctx.trip.airportName(tard.s.vers), time: alrHeure(alrMin(tard.s.arr_local)), flights: alrNumeros(tard.v),
          gap: alrDuree(attente), early, early_time: alrHeure(alrMin(tot.s.arr_local)),
        }),
        solution: alrSolution([
          alt ? alrT("alr_gap_choose", { late, early, flights: alrNumeros(alt), time: alrHeure(alrMin(alrDernier(alt).arr_local)), price: alrPrixTexte(alt) }) : null,
          alrT("alr_gap_go_ahead", { early, late, private: prive }),
        ]),
      });
    });
  });
}

// ------------------------------------------------------------------------------------------------ API

/**
 * Consistency alerts of the choice. Rules: 1 landing after the last public transport (and, as attention, reaching the
 * lodging after 22:00; a landing between 00:00 and 05:00 ends the evening), 2 leaving too early for the lodging (before
 * the first public transport: blocking; before 05:30: attention; a flight after midnight: "the evening before",
 * blocking when the last public transport has gone), 3 an outing on a travel day or during a departure from its
 * lodging, 3b a counted outing outside your days, 4 the first landing or the last return on another day than the trip's
 * nights, 5 two flights reaching a stage far apart, 6 two outings at the same moment (or a full day and another outing).
 */
function alertes(choix, D) {
  const ctx = alrContexte(choix, D);
  const out = [];
  ctx.trip.legs.forEach((leg) => {
    const vol = ctx.vol[leg.key];
    if (!vol) return;
    alrAlertesArrivee(ctx, leg, vol, out);
    alrAlerteArriveeTardive(ctx, leg, vol, out);
    alrAlertesDepart(ctx, leg, vol, out);
  });
  const bornes = alrBornes(ctx);
  const trajet = alrJoursTrajet(ctx);
  const placees = alrSortiesPlacees(ctx);
  alrAlertesJourTrajet(ctx, placees, bornes, trajet, out);
  alrAlertesHorsDates(ctx, placees, bornes, trajet, out);
  alrAlertesDates(ctx, out);
  alrAlertesEcartArrivee(ctx, out);
  alrAlertesMemeMoment(ctx, placees, bornes, trajet, out);
  // blocking first, else the order of the rules
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.niveau === y.a.niveau ? 0 : x.a.niveau === "bloquant" ? -1 : 1) || x.i - y.i)
    .map((x) => x.a);
}

if (typeof module !== "undefined") {
  module.exports = { alertes, departLogement, jourDepartLogement, departsEtape };
}
