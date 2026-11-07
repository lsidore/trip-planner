/* Flight screens and ground legs.
   - ECRANS["vols"] (contract of shell.js): the screen "aller" (every arrival leg) or "retour" (every return leg); one
     section per leg of the screen (ecran.legs): dates band, filters, the chosen flight, the other flights.
   - window.blocTrajet(racine, leg, D, choix) → { maj(choix), quitter(), element }: the block of a between-stages leg,
     shown at the top of its arriving stage's lodging screen: a flight leg (chosen flight, "Change flight") or a ground
     leg (one card per option: mode, operator, duration, price; one choice per leg, choix.<leg>).
   - A leg out of the shared budget (all its travelers have flights_in_budget false) has the "Add it to see" toggle,
     stored in choix.inclure[<leg>].
   Data: D.vols[<leg>] = { mode, grille?, options } (parcours.json); logos: D.logos[IATA] (data URI); airline names:
   option.compagnies_noms. A flight card: logos, local times ("+2" = days later), duration, layovers, lowest price read
   and the price on each site (real links; "blocked" greyed with its note), icon pills, "+$X / −$X to the budget" and the
   margin, "See the trip flight by flight" (closed). Detailed mode (.d-only): flight / layover bar, totals, the addition.
   Texts through T(), money through fmtMoney (page/js/i18n.js); TRIP from creerTrip(D) (logic/config.js); the
   computations (ecart, jourDepartLogement) come from js/logic/*.js. Pure functions exported for
   tests/js/vols-ui.test.js. */

(function () {
"use strict";

/* ================= Other modules (globals in the page, require under node) ================= */
function I18() {
  return typeof T === "function" && typeof fmtMoney === "function" ? { T: T, fmtMoney: fmtMoney, fmtDate: fmtDate } : require("../i18n.js");
}
function tr(cle, vars) { return I18().T(cle, vars); }
var trips = typeof WeakMap === "function" ? new WeakMap() : null;
function cfg(D) {
  if (trips && D && trips.has(D)) return trips.get(D);
  var f = typeof creerTrip === "function" ? creerTrip : require("../logic/config.js").creerTrip;
  var t = f(D);
  if (trips && D) trips.set(D, t);
  return t;
}
function peutRequire() { return typeof module !== "undefined" && typeof require === "function"; }
function fnEcart() {
  if (typeof ecart === "function") return ecart;
  if (peutRequire()) { try { return require("../logic/budget.js").ecart; } catch (e) { return null; } }
  return null;
}
function fnJourDepart() {
  if (typeof jourDepartLogement === "function") return jourDepartLogement;
  if (peutRequire()) { try { return require("../logic/alerts.js").jourDepartLogement; } catch (e) { return null; } }
  return null;
}
/* The amount a leg out of the budget adds when ticked (detail.js, FinUI.horsBudgetDuTrajet): the same everywhere. */
function horsBudgetDuTrajet(choix, D, leg) {
  var F = typeof FinUI !== "undefined" && FinUI ? FinUI : null;
  if (!F && peutRequire()) { try { F = require("./detail.js"); } catch (e) { F = null; } }
  return F && typeof F.horsBudgetDuTrajet === "function" ? F.horsBudgetDuTrajet(choix, D, leg) : null;
}

/* ================= Constants ================= */
var NB_VISIBLES = 6;       // cards shown before "See the N other flights"

var ICONES = {
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lune: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/>',
  valise: '<rect x="6" y="7" width="12" height="14" rx="2"/><path d="M9 7V4h6v3"/>',
  cabine: '<rect x="7" y="9" width="10" height="10" rx="2"/><path d="M10 9V6.5a2 2 0 0 1 4 0V9M10 19v2M14 19v2"/>',
  filtres: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  attention: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  passeport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
  coche: '<path d="M5 12l5 5L20 7"/>',
  maison: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/>',
  avion: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  hausse: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  echange: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  gens: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a3 3 0 0 0 0-6M21 20c0-2.6-1.5-4.8-4-5.6"/>',
  route: '<path d="M5 16h14l-1.5-6.5A2 2 0 0 0 15.6 8H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  lien: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
function svg(nom) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[nom] || "") + "</svg>";
}

/* ================= Small tools (pure) ================= */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
function safeUrl(x) { return typeof x === "string" && /^https?:\/\//i.test(x) ? x : ""; }
function nombre(x) { return typeof x === "number" && isFinite(x); }
/* $1,449 in the home currency; null / NaN → "" (the caller then writes "price to check"). */
function argent(n) { return nombre(n) ? I18().fmtMoney(n, "home") : ""; }
/* $4.50 for an amount that is not whole (formalities). */
function argentPrecis(n) {
  if (!nombre(n)) return "";
  if (Math.round(n) === n) return argent(n);
  var F = typeof FinUI !== "undefined" && FinUI ? FinUI : null;
  return F && F.argentPrecis ? F.argentPrecis(n) : argent(n);
}
/* +$120 / −$45 */
function ecartTxt(n) {
  if (!nombre(n)) return "";
  var r = Math.round(n);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + argent(Math.abs(r));
}
function deuxChiffres(n) { return n < 10 ? "0" + n : String(n); }

/* "2027-06-15T08:45" or "2027-06-15" → { y, m, d } */
function dateDe(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function jourSemaine(iso) { var p = dateDe(iso); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : -1; }
function heure(iso) { var m = /T(\d{2}:\d{2})/.exec(String(iso || "")); return m ? m[1] : ""; }
/* "Tue 15" */
function jourCourt(iso) {
  var p = dateDe(iso), j = tr("days_short");
  return p && Array.isArray(j) ? j[jourSemaine(iso)] + " " + p.d : "";
}
/* "Tue Jun 15" */
function jourLong(iso) { return dateDe(iso) ? I18().fmtDate(String(iso).slice(0, 10), "weekday") : ""; }
/* "Jun 15" */
function dateCourte(iso) { return dateDe(iso) ? I18().fmtDate(String(iso).slice(0, 10)) : ""; }
/* Days from a to b ("YYYY-MM-DD"), negative when b is before a. */
function nbJours(a, b) {
  var x = dateDe(a), y = dateDe(b);
  if (!x || !y) return 0;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
}
/* "47 h 55" · "2 h" · "45 min"; no duration → "" */
function duree(min) {
  if (!nombre(min) || min < 0) return "";
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return tr("dur_min", { m: m });
  return m ? tr("dur_h_min", { h: h, mm: deuxChiffres(m) }) : tr("dur_h", { h: h });
}

/* Words of a transport mode of the data ("voiture", "bus+bateau", "car", "ferry"...): "by car", "by bus then by boat". */
var MODES = [[/voiture|car\b|drive/i, "mode_car"], [/bateau|boat|ferry/i, "mode_boat"], [/bus|coach|minivan/i, "mode_bus"],
  [/train|rail/i, "mode_train"], [/metro|subway/i, "mode_metro"], [/tram/i, "mode_tram"], [/taxi/i, "mode_taxi"], [/pied|walk|foot/i, "mode_walk"]];
function libelleMode(mode) {
  return String(mode || "").split("+").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i][0].test(x)) return tr(MODES[i][1]);
    return x;
  }).join(" " + tr("then") + " ");
}

/* ================= Reading a flight (pure) ================= */
function premier(o) { return o && o.segments && o.segments.length ? o.segments[0] : null; }
function dernier(o) { return o && o.segments && o.segments.length ? o.segments[o.segments.length - 1] : null; }
function dateDepart(o) { var s = premier(o); return s ? String(s.dep_local || "").slice(0, 10) : ""; }
function dateArrivee(o) { var s = dernier(o); return s ? String(s.arr_local || "").slice(0, 10) : ""; }
/* "+2": days between departure and arrival, in local dates. */
function plusJours(o) {
  if (nombre(o && o.jours_plus)) return o.jours_plus;
  return o && premier(o) ? Math.max(0, nbJours(dateDepart(o), dateArrivee(o))) : 0;
}
/* An airline's name: the data's own (option.compagnies_noms), else its code. */
function nomCompagnie(code, o) { var n = o && o.compagnies_noms; return (n && n[code]) || code; }
function nomsCompagnies(o) { return ((o && o.compagnies) || []).map(function (c) { return nomCompagnie(c, o); }).join(" + "); }
function escales(o) { return (o && o.escales) || []; }
/* The city of an airport: the trip's (home cities, stage titles), else the layover's city in the data, else the code. */
function ville(iata, o, trip) {
  var v = trip ? trip.cityOf(iata) : "";
  if (v && v !== iata) return v;
  var e = escales(o).filter(function (x) { return x.iata === iata; })[0];
  return e && e.ville ? e.ville : iata;
}
/* "direct", "1 stop: Paris", "2 stops: Madrid, Paris" */
function escalesTexte(o) {
  var e = escales(o);
  return e.length ? tr("fl_stops_list", { n: e.length, places: e.map(function (x) { return x.ville || x.iata; }).join(", ") }) : tr("fl_direct");
}

/* Price of a flight: one fare per site (for every traveler of the leg), cheapest first; blocked sites (or without a read
   price) apart, with their note. min = the cheapest read, or null. */
function prixSites(o) {
  var tous = ((o && o.prix_par_site) || []).map(function (s) {
    var lu = nombre(s.prix_home) && !s.bloque;
    return { site: s.site || "", prix: lu ? s.prix_home : null, url: safeUrl(s.url), verifie: s.verifie || "", note: s.note || "", bloque: !lu, robot: !!s.bloque };
  });
  var lus = tous.filter(function (s) { return !s.bloque; }).sort(function (a, b) { return a.prix - b.prix || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0); });
  return { lus: lus, bloques: tous.filter(function (s) { return s.bloque; }), min: lus[0] || null };
}
function prixMin(o) { var m = prixSites(o).min; return m ? m.prix : null; }
/* Latest verification date of these flights' prices. */
function verifieLe(options) {
  var max = "";
  (options || []).forEach(function (o) { ((o && o.prix_par_site) || []).forEach(function (s) { if (s.verifie && s.verifie > max) max = s.verifie; }); });
  return max;
}
/* Checked bag: { etat: "comprise" } | { etat: "ajout", montant } | { etat: "inconnu" } (never 0). */
function valise(o) {
  var v = (o && o.valise) || {};
  if (v.comprise === true) return { etat: "comprise" };
  if (nombre(v.ajout_home) && v.ajout_home > 0) return { etat: "ajout", montant: v.ajout_home };
  return { etat: "inconnu" };
}
/* Cabin bag: absent or null = unknown ("to check"), never counted as included. */
function cabine(o) {
  var c = o && o.cabine;
  if (c && c.comprise === true) return { etat: "comprise" };
  if (c && c.comprise === false) return { etat: "ajout" };
  return { etat: "inconnu" };
}
/* Personal item (small bag under the seat): "oui" | "non" | "inconnu". */
function objetPerso(o) {
  var x = o && o.objet_perso;
  return x === true ? "oui" : x === false ? "non" : "inconnu";
}
/* Ticket (cheapest site) + checked-bag supplement: { total, base, supp, etat }; total null when a price is missing. */
function prixAvecValise(o) {
  var base = prixMin(o), v = valise(o);
  if (v.etat === "comprise") return { total: base, base: base, supp: 0, etat: "comprise" };
  if (v.etat === "ajout") return { total: base === null ? null : base + v.montant, base: base, supp: v.montant, etat: "ajout" };
  return { total: null, base: base, supp: null, etat: "inconnu" };
}
function totalAvecValise(o) { return prixAvecValise(o).total; }
/* Number of stops; null when the data does not say. */
function nbEscales(o) {
  if (o && Array.isArray(o.escales)) return o.escales.length;
  return o && o.segments && o.segments.length ? o.segments.length - 1 : null;
}
/* No entry formality for the layover countries. Absent list = unknown: false. */
function sansVisaTransit(o) { return !!o && Array.isArray(o.formalites) && o.formalites.length === 0; }
/* Id of the cheapest flight (cheapest site, or ticket + bag) and of the shortest (door to door). */
function extremes(options, avecValise) {
  var cher = null, court = null;
  (options || []).forEach(function (o) {
    var p = avecValise ? totalAvecValise(o) : prixMin(o);
    if (p !== null && (cher === null || p < cher.p)) cher = { p: p, id: o.id };
    if (nombre(o.porte_a_porte_min) && (court === null || o.porte_a_porte_min < court.p)) court = { p: o.porte_a_porte_min, id: o.id };
  });
  return { moinsCher: cher ? cher.id : null, plusCourt: court ? court.id : null };
}

/* ================= Sort and filters (pure) ================= */
var TRIS = ["prix", "court", "escales"];
var FILTRES_BAGAGES = ["cabine", "valise", "prixValise"];
var FILTRES_TRAJET = ["sansVisa", "unique", "arrivee"];
var CLES_BASCULE = ["arrivee", "valise", "cabine", "unique", "sansVisa", "prixValise"];
var LIB_FILTRES = {
  cabine: ["fl_filter_cabine", "fl_filter_cabine_title"], valise: ["fl_filter_valise", "fl_filter_valise_title"],
  prixValise: ["fl_filter_prixValise", "fl_filter_prixValise_title"], sansVisa: ["fl_filter_sansVisa", "fl_filter_sansVisa_title"],
  unique: ["fl_filter_unique", "fl_filter_unique_title"], arrivee: ["fl_filter_arrivee", "fl_filter_arrivee_title"],
};
var LIB_TRIS = { prix: ["fl_sort_prix", "fl_sort_prix_title"], court: ["fl_sort_court", "fl_sort_court_title"], escales: ["fl_sort_escales", "fl_sort_escales_title"] };
var CLES_SEGMENT = ["escalesMax", "dureeMax"];
var SEUILS_ESCALES = [0, 1, 2];     // "Direct", "1 stop max", "2 stops max"
var SEUILS_DUREE = [24, 30, 36];    // hours, door to door (long-haul legs only)
function libEscales(k) { return k === 0 ? tr("fl_direct_cap") : tr("fl_stops_max", { n: k }); }
/* null (unknown price or duration) always last. */
function comparerNombres(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
/* critere: "prix" | "court" | "escales". opts.avecValise: the price is ticket + checked bag (unknown = last). */
function trier(options, critere, opts) {
  var avec = !!(opts && opts.avecValise);
  var prix = function (o) { return avec ? totalAvecValise(o) : prixMin(o); };
  var pap = function (o) { return nombre(o.porte_a_porte_min) ? o.porte_a_porte_min : null; };
  var f = {
    court: function (a, b) { return comparerNombres(pap(a), pap(b)) || comparerNombres(prix(a), prix(b)); },
    escales: function (a, b) { return escales(a).length - escales(b).length || comparerNombres(prix(a), prix(b)); },
  }[critere] || function (a, b) { return comparerNombres(prix(a), prix(b)) || comparerNombres(pap(a), pap(b)); };
  return (options || []).slice().sort(f);
}
/* filtres: { date, arrivee, valise, cabine, unique, sansVisa, escalesMax, dureeMax }: each one only removes when active. */
function filtrer(options, filtres) {
  var f = filtres || {};
  var max = nombre(f.escalesMax) ? f.escalesMax : null;
  var dmax = nombre(f.dureeMax) ? f.dureeMax * 60 : null;
  return (options || []).filter(function (o) {
    if (f.date && dateDepart(o) !== f.date) return false;
    if (f.arrivee && (o.tags || []).indexOf("arrivee-jour") < 0) return false;
    if (f.valise && !(o.valise && o.valise.comprise === true)) return false;
    if (f.cabine && cabine(o).etat !== "comprise") return false;
    if (f.unique && o.billet_unique !== true) return false;
    if (f.sansVisa && !sansVisaTransit(o)) return false;
    if (max !== null) { var n = nbEscales(o); if (n === null || n > max) return false; }
    if (dmax !== null && !(nombre(o.porte_a_porte_min) && o.porte_a_porte_min <= dmax)) return false;
    return true;
  });
}
function filtresDe(etat, avecDate) {
  var e = etat || {};
  var f = {};
  CLES_BASCULE.forEach(function (k) { if (k !== "prixValise") f[k] = !!e[k]; });
  CLES_SEGMENT.forEach(function (k) { f[k] = nombre(e[k]) ? e[k] : null; });
  if (avecDate !== false) f.date = e.date || null;
  return f;
}
function nbFiltres(etat) {
  var e = etat || {};
  return CLES_BASCULE.filter(function (k) { return !!e[k]; }).length + CLES_SEGMENT.filter(function (k) { return nombre(e[k]); }).length;
}
function filtresActifs(etat) { return nbFiltres(etat) > 0 || !!(etat && etat.date); }
function reinitFiltres(etat) {
  CLES_BASCULE.forEach(function (k) { etat[k] = false; });
  CLES_SEGMENT.forEach(function (k) { etat[k] = null; });
  etat.date = null;
  etat.tout = false;
  return etat;
}
/* Which "trip" settings to offer for these flights: only those that really sort (at least one flight passes and one is
   removed). Stops: at most two thresholds. Duration: only for the legs from or to home (arrival, return). */
function controlesPertinents(options, leg) {
  var opts = options || [];
  function trie(f) { var n = filtrer(opts, f).length; return n > 0 && n < opts.length; }
  var long = !!leg && leg.kind !== "between";
  return {
    arrivee: trie({ arrivee: true }),
    unique: trie({ unique: true }),
    sansVisa: trie({ sansVisa: true }),
    escales: SEUILS_ESCALES.filter(function (k) { return trie({ escalesMax: k }); }).slice(0, 2),
    duree: long ? SEUILS_DUREE.filter(function (h) { return trie({ dureeMax: h }); }) : [],
  };
}

/* ================= Flight / layover bar and totals (pure) ================= */
function barre(o, trip) {
  var out = [];
  var segs = (o && o.segments) || [];
  segs.forEach(function (s, i) {
    out.push({ type: "vol", min: s.duree_min, texte: tr("fl_bar_flight", { flight: s.vol, from: ville(s.de, o, trip), to: ville(s.vers, o, trip), dur: duree(s.duree_min) }) });
    var e = escales(o)[i];
    if (e && i < segs.length - 1) {
      out.push({ type: "escale", min: e.duree_min, nuit: !!e.nuit, texte: tr(e.nuit ? "fl_bar_stop_night" : "fl_bar_stop", { place: e.ville || e.iata, dur: duree(e.duree_min) }) });
    }
  });
  return out;
}
function totauxVol(o) {
  return {
    porteAPorte: nombre(o.porte_a_porte_min) ? o.porte_a_porte_min : null,
    enVol: nombre(o.en_vol_min) ? o.en_vol_min : null,
    escale: nombre(o.escale_min) ? o.escale_min : null,
    escales: escales(o).map(function (e) { return { ville: e.ville || e.iata, min: e.duree_min }; }),
  };
}

/* ================= Context of a leg ================= */
function trouverOption(D, leg, id) {
  var v = D && D.vols && D.vols[leg];
  return ((v && v.options) || []).filter(function (o) { return o.id === id; })[0] || null;
}
function estInclus(choix, leg) { return !!(choix && choix.inclure && choix.inclure[leg.key] === true); }
function horsBudget(leg, choix) { return !!leg && !leg.in_budget && !estInclus(choix, leg); }
/* The other arrival legs reaching the same stage, with their chosen flight: to say who waits for whom. */
function autresArrivees(trip, leg, D, choix) {
  if (!leg || leg.kind !== "arrival") return [];
  return trip.arrivals.filter(function (l) { return l.key !== leg.key && l.to_stage === leg.to_stage; }).map(function (l) {
    return { leg: l, qui: trip.labelsOf(l), vol: trouverOption(D, l.key, choix && choix[l.key]) };
  }).filter(function (x) { return x.vol; });
}
function contexte(leg, D, choix, etat) {
  var trip = cfg(D);
  if (typeof leg === "string") leg = trip.legByKey[leg];
  return {
    leg: leg, trip: trip, D: D, choix: choix || {}, logos: (D && D.logos) || {}, ouverts: (etat && etat.ouverts) || {},
    avecValise: !!(etat && etat.prixValise),
    options: (leg && D && D.vols && D.vols[leg.key] && D.vols[leg.key].options) || [],
    autres: autresArrivees(trip, leg, D, choix),
  };
}
/* "New York → Lisbon" */
function route(leg, trip) {
  if (!leg) return "";
  var de = leg.from_stage ? (trip.stage(leg.from_stage) || {}).title : trip.cityOf(leg.from_airports[0]);
  var vers = leg.to_stage ? (trip.stage(leg.to_stage) || {}).title : trip.cityOf(leg.to_airports[0]);
  return tr("ui_route", { from: de || "", to: vers || "" });
}
/* "Alex · New York → Lisbon" (the route alone when everyone travels together). */
function titreLeg(leg, trip) {
  var qui = trip.whoOf(leg);
  return qui ? tr("fl_leg_who", { who: qui, route: route(leg, trip) }) : route(leg, trip);
}

/* ================= Pills (pure) ================= */
function formalitesDe(o, D) {
  return ((o && o.formalites) || []).map(function (code) {
    var f = ((D && D.formalites) || []).filter(function (x) { return x.code === code; })[0];
    return { code: code, nom: (f && f.titre) || code, cout: f && nombre(f.cout_home) && f.cout_home > 0 ? f.cout_home : null, delai: f && nombre(f.delai_jours) ? f.delai_jours : null };
  });
}
/* The day you leave the lodging for this return flight (jourDepartLogement of alerts.js, shared with the budget and the
   days: the evening before for a flight after midnight); null when unknown. */
function quitterHotel(leg, o, D, choix) {
  var f = fnJourDepart();
  if (!f || !o || !o.id || !leg) return null;
  var c = Object.assign({}, choix || (D && D.defaut) || {});
  c[leg.key] = o.id;
  try { return f(c, D, leg.key); } catch (e) { return null; }
}
/* A flight landing (arrival) or leaving (return) on another day than planned: extra nights or lost nights. */
function decalageDates(leg, o, D, choix) {
  if (!leg || !o || (leg.kind !== "arrival" && leg.kind !== "return")) return null;
  var trip = cfg(D);
  if (leg.kind === "arrival") {
    var arr = dateArrivee(o), k = nbJours(arr, leg.date);
    var st = (trip.stage(leg.to_stage) || {}).title || "";
    if (!arr || !k) return null;
    return k > 0
      ? { ton: "info", icone: "maison", texte: tr("fl_pill_arrival_extra", { date: dateCourte(arr), n: k, stage: st }), k: k, sens: "plus" }
      : { ton: "warn", icone: "maison", texte: tr("fl_pill_arrival_lost", { date: dateCourte(arr), n: -k, stage: st }), k: -k, sens: "perdue" };
  }
  var q = quitterHotel(leg, o, D, choix);
  var dep = q && q.jour ? q.jour : dateDepart(o), j = nbJours(leg.date, dep);
  var stR = (trip.stage(leg.from_stage) || {}).title || "";
  if (!dep || !j) return null;
  var quand = tr(q && q.veille ? "fl_leave_evening" : "fl_leave_on", { date: dateCourte(dep) });
  return j > 0
    ? { ton: "info", icone: "maison", texte: tr("fl_pill_return_extra", { when: quand, n: j, stage: stR }), k: j, sens: "plus" }
    : { ton: "warn", icone: "maison", texte: tr("fl_pill_return_lost", { when: quand, n: -j, stage: stR }), k: -j, sens: "perdue" };
}
/* Minutes between two arrivals (positive: b lands after a), when they land the same local day; null otherwise. */
function decalageArrivee(a, b) {
  var x = dernier(a), y = dernier(b);
  if (!x || !y || String(x.arr_local).slice(0, 10) !== String(y.arr_local).slice(0, 10)) return null;
  var t1 = Date.parse(x.arr_utc), t2 = Date.parse(y.arr_utc);
  if (!isFinite(t1) || !isFinite(t2)) return null;
  return Math.round((t2 - t1) / 60000);
}
function puces(o, ctx) {
  var out = [];
  if (!o) return out;
  var c = ctx || {};
  var tags = o.tags || [];
  var fin = dernier(o);
  var e = escales(o);
  var jour = tags.indexOf("arrivee-jour") >= 0;
  if (fin) out.push(jour ? { cle: "arrivee", ton: "good", icone: "soleil", texte: tr("fl_pill_day_arrival") } : { cle: "arrivee", ton: "warn", icone: "lune", texte: tr("fl_pill_arrival_at", { time: heure(fin.arr_local) }) });
  if (!e.length) out.push({ cle: "direct", ton: "good", icone: "avion", texte: tr("fl_direct") });
  var sep = e.filter(function (x) { return x.billet_separe; }).map(function (x) { return x.ville || x.iata; });
  if (o.billet_unique === false) out.push({ cle: "billets", ton: "warn", icone: "attention", texte: sep.length ? tr("fl_pill_separate_at", { places: sep.join(", ") }) : tr("fl_pill_separate"), titre: tr("fl_pill_separate_title") });
  else if (e.length) out.push({ cle: "billets", ton: "good", icone: "coche", texte: tr("fl_pill_single_ticket") });
  var v = valise(o);
  if (v.etat === "comprise") out.push({ cle: "valise", ton: "good", icone: "valise", texte: tr("fl_pill_bag_included") });
  else if (v.etat === "ajout") out.push({ cle: "valise", ton: "info", icone: "valise", texte: tr("fl_pill_bag_extra", { price: argent(v.montant) }) });
  else out.push({ cle: "valise", ton: "warn", icone: "valise", texte: tr("fl_pill_bag_unknown") });
  var cb = cabine(o), op = objetPerso(o);
  var sousSiege = op === "oui" ? " " + tr("fl_personal_included") : op === "non" ? " " + tr("fl_personal_not_included") : "";
  if (cb.etat === "comprise") out.push({ cle: "cabine", ton: "good", icone: "cabine", texte: tr("fl_pill_cabin_included"), titre: tr("fl_cabin_included_title") + sousSiege });
  else if (cb.etat === "ajout") out.push({ cle: "cabine", ton: "info", icone: "cabine", texte: tr("fl_pill_cabin_extra"), titre: tr("fl_cabin_extra_title") + sousSiege });
  else out.push({ cle: "cabine", ton: "warn", icone: "cabine", texte: tr("fl_pill_cabin_unknown"), titre: tr("fl_cabin_unknown_title") + sousSiege });
  var f = formalitesDe(o, c.D);
  if (f.length) out.push({ cle: "formalites", ton: "warn", icone: "passeport", texte: f.map(function (x) { return x.nom; }).join(", ") });
  var nuit = e.filter(function (x) { return x.nuit; });
  if (nuit.length) out.push({ cle: "nuit", ton: "info", icone: "lune", texte: tr("fl_pill_night_stop", { places: nuit.map(function (x) { return x.ville || x.iata; }).join(", ") }) });
  var change = e.filter(function (x) { return x.change_aeroport; });
  if (change.length) out.push({ cle: "aeroport", ton: "warn", icone: "echange", texte: tr("fl_pill_airport_change", { places: change.map(function (x) { return x.ville || x.iata; }).join(", ") }) });
  if (o.hausse) out.push({ cle: "hausse", ton: "warn", icone: "hausse", texte: tr("fl_pill_price_rise"), titre: o.hausse.texte || "" });
  var dd = decalageDates(c.leg, o, c.D, c.choix);
  if (dd) out.push({ cle: "dates", ton: dd.ton, icone: dd.icone, texte: dd.texte });
  // the other arrivals at the same stage: who waits for whom (same threshold as the alert, rules.arrival_gap_min)
  var seuil = c.trip && c.trip.rules && nombre(c.trip.rules.arrival_gap_min) ? c.trip.rules.arrival_gap_min : 30;
  (c.autres || []).forEach(function (x) {
    var k = decalageArrivee(x.vol, o);
    if (k === null) return;
    var txt = Math.abs(k) < 5 ? tr("fl_pill_same_time", { who: x.qui }) : k < 0 ? tr("fl_pill_lands_before", { who: x.qui, dur: duree(-k) }) : tr("fl_pill_lands_after", { who: x.qui, dur: duree(k) });
    out.push({ cle: "ecart-arrivee", ton: Math.abs(k) > seuil ? "warn" : "info", icone: "gens", texte: txt });
  });
  return out;
}

/* ================= Effect and margin (pure) =================
   e = ecart(choix, D, patch) = { montant, incomplet } or null (no computation: nothing written).
   tot = Parcours.totaux (current margin and cap) or null. Returns [{ ton, texte }]; empty = line hidden. */
/* One wording on every screen: "margin $642" or "$138 over $6,000"; "" without a cap. */
function margeTexte(marge, incomplet, plafond) {
  if (!nombre(marge)) return "";
  var t = marge >= 0 ? tr("ui_margin", { amount: argent(marge) }) : tr("ui_over_cap", { amount: argent(-marge), cap: argent(plafond) });
  return incomplet ? tr("ui_approx_incomplete", { text: t }) : t;
}
function libelleEcart(leg, e, choix, tot, estChoisi) {
  var out = [];
  var hors = horsBudget(leg, choix);
  var totOk = tot && nombre(tot.marge);
  if (estChoisi) {
    if (hors) out.push({ ton: "info", texte: tr("out_of_budget_note") });
    else if (totOk) out.push({ ton: tot.marge >= 0 ? "good" : "bad", texte: margeTexte(tot.marge, tot.incomplet, tot.plafond) });
    return out;
  }
  if (!e || !nombre(e.montant)) return out;
  var r = Math.round(e.montant);
  if (r === 0) {
    out.push({ ton: "info", texte: hors ? tr("out_of_budget_note") : tr("ui_same_budget") });
  } else {
    out.push({ ton: r > 0 ? "warn" : "good", texte: tr("ui_to_budget", { amount: ecartTxt(e.montant) }) });
    if (totOk) out.push({ ton: "info", texte: tr("fl_after", { text: margeTexte(tot.marge - e.montant, tot.incomplet, tot.plafond) }) });
  }
  if (e.incomplet) out.push({ ton: "warn", texte: tr("price_to_check") });
  return out;
}

/* ================= HTML ================= */
function logo(code, ctx) {
  var src = ctx.logos && ctx.logos[code];
  if (typeof src === "string" && /^data:image\//.test(src)) return '<img class="vol-logo" src="' + esc(src) + '" alt="" width="28" height="28">';
  return '<span class="vol-logo vol-logo-txt" aria-hidden="true">' + esc(code) + "</span>";
}
function htmlPuce(p) {
  return '<li class="vol-puce ' + esc(p.ton) + '"' + (p.titre ? ' title="' + esc(p.titre) + '"' : "") + ">" + svg(p.icone) + "<span>" + esc(p.texte) + "</span></li>";
}
function htmlSite(s, i) {
  var nom = esc(s.site);
  var ext = '<span class="vol-ext" aria-hidden="true">↗</span><span class="vol-sr"> ' + esc(tr("fl_opens_site")) + "</span>";
  if (s.bloque) {
    var corps = '<span class="vol-site-n">' + nom + "</span> <i>" + esc(tr(s.robot ? "fl_blocked" : "fl_price_not_read")) + "</i>" + (s.url ? ext : "");
    var titre = s.note ? ' title="' + esc(tr("label_value", { label: s.site, value: s.note })) + '"' : "";
    return s.url ? '<a class="vol-site bloque" href="' + esc(s.url) + '" target="_blank" rel="noopener"' + titre + ">" + corps + "</a>"
      : '<span class="vol-site bloque"' + titre + ">" + corps + "</span>";
  }
  var cls = "vol-site" + (i === 0 ? " meilleur" : "");
  var contenu = '<span class="vol-site-n">' + nom + "</span> <b>" + esc(argent(s.prix)) + "</b>" + (s.url ? ext : "");
  return s.url ? '<a class="' + cls + '" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + contenu + "</a>"
    : '<span class="' + cls + '">' + contenu + "</span>";
}
function htmlSites(o) {
  var p = prixSites(o);
  var liste = p.lus.map(htmlSite).concat(p.bloques.map(htmlSite));
  if (!liste.length) return '<p class="vol-aucun-site">' + esc(tr("fl_no_site_price")) + "</p>";
  return '<ul class="vol-sites" aria-label="' + esc(tr("fl_sites_aria")) + '">' + liste.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
}
function htmlHoraire(s, quand, o, plus, trip) {
  var iata = quand === "dep" ? s.de : s.vers, iso = quand === "dep" ? s.dep_local : s.arr_local;
  return '<p class="vol-h"><span class="vol-hj">' + esc(jourCourt(iso)) + "</span> <b>" + esc(heure(iso)) + "</b> " +
    '<span class="vol-hv">' + esc(ville(iata, o, trip)) + " <small>" + esc(iata) + "</small></span>" +
    (plus ? ' <sup class="vol-plus" title="' + esc(tr("fl_days_later", { n: plus })) + '">+' + plus + "</sup>" : "") + "</p>";
}
function pourN(n) { return tr("for_n_people", { n: n }); }
/* The bags of a flight, one per line: checked bag, cabin bag, personal item; a missing value = "to check". */
function htmlBagages(o, ctx) {
  var n = (ctx.leg && ctx.leg.adults) || 1, v = valise(o), c = cabine(o), p = objetPerso(o);
  var soute = v.etat === "comprise" ? tr("fl_bag_included") : v.etat === "ajout" ? tr("fl_bag_extra", { price: argent(v.montant) }) + (n > 1 ? " " + pourN(n) : "") : tr("fl_bag_to_check");
  var cab = c.etat === "comprise" ? tr("fl_bag_included") : c.etat === "ajout" ? tr("fl_bag_extra_short") : tr("fl_to_check");
  var perso = p === "oui" ? tr("fl_bag_included") : p === "non" ? tr("fl_not_included") : tr("fl_to_check");
  return '<h4 class="vol-h4">' + esc(tr("fl_bags")) + '</h4><ul class="vol-liste-sites"><li>' + esc(tr("fl_checked_bag")) + " <b>" + esc(soute) + "</b></li><li>" +
    esc(tr("fl_cabin_bag")) + " <b>" + esc(cab) + "</b></li><li>" + esc(tr("fl_personal_item")) + " <b>" + esc(perso) + "</b></li></ul>";
}
/* The trip flight by flight: each flight (number, airline, airports, times, duration), each layover, then the prices. */
function htmlTrajet(o, ctx) {
  var segs = o.segments || [], e = escales(o), li = [], trip = ctx.trip;
  segs.forEach(function (s, i) {
    li.push('<li class="vol-seg"><p class="vol-seg-t"><b>' + esc(s.vol) + "</b> · " + esc(nomCompagnie(s.cie, o)) + " · " + esc(duree(s.duree_min)) + "</p>" +
      '<p class="vol-seg-h">' + esc(ville(s.de, o, trip)) + " (" + esc(s.de) + ") <b>" + esc(jourCourt(s.dep_local) + " " + heure(s.dep_local)) + "</b> → " +
      esc(ville(s.vers, o, trip)) + " (" + esc(s.vers) + ") <b>" + esc(jourCourt(s.arr_local) + " " + heure(s.arr_local)) + "</b></p></li>");
    var x = e[i];
    if (x && i < segs.length - 1) {
      var notes = [];
      if (x.nuit) notes.push(tr("fl_night_stop"));
      if (x.billet_separe) notes.push(tr("fl_separate_ticket_note"));
      if (x.change_aeroport) notes.push(tr("fl_airport_change"));
      li.push('<li class="vol-esc"><p>' + esc(tr("fl_stop_at", { place: x.ville || x.iata })) + " · " + esc(duree(x.duree_min)) + "</p>" +
        (notes.length ? '<p class="vol-esc-n">' + esc(notes.join(" · ")) + "</p>" : "") + "</li>");
    }
  });
  var html = '<ol class="vol-etapes">' + li.join("") + "</ol>";
  var ps = prixSites(o), tous = ps.lus.concat(ps.bloques);
  if (tous.length) {
    html += '<h4 class="vol-h4">' + esc(tr("fl_price_each_site")) + '</h4><ul class="vol-liste-sites">' + tous.map(function (s) {
      var nom = s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.site) + " ↗</a>" : esc(s.site);
      // nom and the value are escaped HTML; the dictionary gives the colon and its spacing
      return "<li>" + tr("label_value", { label: nom, value: "<b>" + esc(s.bloque ? tr(s.robot ? "fl_blocked" : "fl_price_not_read") : argent(s.prix)) + "</b>" }) +
        (s.note ? ' <span class="vol-note-site">' + esc(s.note) + "</span>" : "") +
        (s.verifie ? ' <span class="vol-verif">' + esc(tr("fl_checked_on", { date: dateCourte(s.verifie) })) + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  html += htmlBagages(o, ctx);
  var f = formalitesDe(o, ctx.D);
  if (f.length) {
    html += '<h4 class="vol-h4">' + esc(tr("fl_entry")) + '</h4><ul class="vol-liste-sites">' + f.map(function (x) {
      return "<li><b>" + esc(x.nom) + "</b>" + esc(x.cout ? tr("fl_entry_cost", { price: argentPrecis(x.cout) }) : tr("fl_entry_cost_unknown")) +
        (x.delai ? esc(tr("fl_entry_delay", { n: x.delai })) : "") + "</li>";
    }).join("") + "</ul>";
  }
  if (o.note) html += '<p class="vol-note">' + esc(o.note) + "</p>";
  if (o.hausse && o.hausse.texte) html += '<p class="vol-note">' + esc(tr("fl_rise", { text: o.hausse.texte })) + (o.hausse.avant ? esc(tr("fl_rise_before", { date: dateCourte(o.hausse.avant) })) : "") + "</p>";
  return html;
}
function htmlBarre(o, trip) {
  var b = barre(o, trip);
  if (!b.length) return "";
  var desc = tr("fl_bar_aria", { list: b.map(function (x) { return x.texte; }).join(" ; ") });
  return '<div class="vol-barre" role="img" aria-label="' + esc(desc) + '">' + b.map(function (x) {
    return '<i class="' + (x.type === "vol" ? "vol-b-v" : "vol-b-e" + (x.nuit ? " nuit" : "")) + '" style="flex:' + Math.max(1, Math.round(x.min || 1)) + '" title="' + esc(x.texte) + '"></i>';
  }).join("") + "</div>";
}
function htmlTotaux(o) {
  var t = totauxVol(o), p = [];
  if (t.porteAPorte !== null) p.push("<span>" + esc(tr("fl_door_to_door")) + " <b>" + esc(duree(t.porteAPorte)) + "</b></span>");
  if (t.enVol !== null) p.push("<span>" + esc(tr("fl_in_flight")) + " <b>" + esc(duree(t.enVol)) + "</b></span>");
  if (t.escales.length && t.escale !== null) {
    p.push("<span>" + esc(tr("fl_stops_total")) + " <b>" + esc(duree(t.escale)) + "</b> (" + t.escales.map(function (x) { return esc(x.ville) + " " + esc(duree(x.min)); }).join(" · ") + ")</span>");
  }
  return p.length ? '<p class="vol-totaux">' + p.join("") + "</p>" : "";
}
/* Where the bag supplement comes from: the site of its budget line, else "". */
function sourceValise(o) {
  var l = ((o && o.lignes) || []).filter(function (x) { return x && x.cle === "valise"; })[0];
  return l && l.site ? tr("fl_read_at", { site: l.site }) : "";
}
/* Addition of the price (never "all included"): cheapest site + bag = total. */
function htmlAddition(o, ctx) {
  var m = prixSites(o).min, v = valise(o);
  if (!m) return "";
  var n = (ctx.leg && ctx.leg.adults) || 1;
  var base = argent(m.prix) + (n > 1 ? " " + pourN(n) : "") + " (" + m.site + ")";
  var src = sourceValise(o);
  if (v.etat === "ajout") return '<p class="vol-addition">' + esc(tr("fl_addition_bag", { base: base, bag: argent(v.montant) + (src ? " (" + src + ")" : ""), total: argent(m.prix + v.montant) })) + "</p>";
  if (v.etat === "inconnu") return '<p class="vol-addition">' + esc(tr("fl_addition_bag_unknown", { base: base })) + "</p>";
  return '<p class="vol-addition">' + esc(tr("fl_addition_bag_included", { base: base })) + "</p>";
}

/* A flight card. opt: { choisi, ecart: [{ton, texte}], badge, actionsPlus } */
function htmlCarte(o, ctx, opt) {
  opt = opt || {};
  var ps = prixSites(o), n = (ctx.leg && ctx.leg.adults) || 1, trip = ctx.trip || cfg(ctx.D);
  var s0 = premier(o), s1 = dernier(o);
  var v = valise(o);
  var cap = tr(v.etat === "comprise" ? "fl_cap_bag_included" : v.etat === "ajout" ? "fl_cap_no_bag" : "fl_cap_bag_to_check");
  var prix = ps.min ? '<b class="vol-p">' + esc(argent(ps.min.prix)) + "</b>" : '<b class="vol-p inconnu">' + esc(tr("price_to_check")) + "</b>";
  var sansValise = "";
  if (ctx.avecValise && ps.min) {
    // "Price with bag": the card's price is ticket + checked-bag supplement (the addition is shown under the header)
    var pv = prixAvecValise(o);
    if (pv.total !== null) {
      prix = '<b class="vol-p">' + esc(argent(pv.total)) + "</b>";
      cap = tr(v.etat === "comprise" ? "fl_cap_bag_included" : "fl_cap_with_bag");
    } else {
      prix = '<b class="vol-p inconnu">' + esc(tr("price_to_check")) + "</b>";
      cap = tr("fl_cap_bag_price_to_check");
      sansValise = "<span>" + esc(tr("fl_without_bag", { price: argent(pv.base) })) + "</span>";
    }
  }
  var cles = (o.compagnies || []);
  var ouvert = ctx.ouverts && ctx.ouverts[o.id] ? " open" : "";
  var titre = nomsCompagnies(o) + (s0 ? ", " + jourCourt(s0.dep_local) + " " + heure(s0.dep_local) : "");
  var h = '<article class="vol-carte' + (opt.choisi ? " choisi" : "") + '" data-vol="' + esc(o.id) + '">';
  h += '<div class="vol-haut"><div class="vol-gauche"><div class="vol-cies"><span class="vol-logos">' + cles.map(function (c) { return logo(c, ctx); }).join("") +
    '</span><span class="vol-cie">' + esc(nomsCompagnies(o)) + "</span></div>";
  if (s0 && s1) {
    h += '<div class="vol-horaires">' + htmlHoraire(s0, "dep", o, 0, trip) + htmlHoraire(s1, "arr", o, plusJours(o), trip) + "</div>";
    h += '<p class="vol-sous"><b>' + esc(duree(o.porte_a_porte_min)) + "</b> · " + esc(escalesTexte(o)) + "</p>";
  } else {
    h += '<p class="vol-sous">' + esc(tr("fl_times_to_check")) + "</p>";
  }
  h += '</div><div class="vol-prix">' + prix + "<span>" + esc(cap) + "</span>" + sansValise + (n > 1 ? "<span>" + esc(pourN(n)) + "</span>" : "") +
    (opt.badge ? '<span class="vol-badge">' + esc(opt.badge) + "</span>" : "") + "</div></div>";
  // the addition ("$859 + bag $94 = $953") explains the card's price: shown when "Price with bag" is on, else in Detailed mode
  var addition = htmlAddition(o, ctx);
  if (ctx.avecValise) h += addition;
  h += '<div class="d-only vol-detail">' + htmlBarre(o, trip) + htmlTotaux(o) + (ctx.avecValise ? "" : addition) + "</div>";
  h += htmlSites(o);
  if (ps.lus.length || ps.bloques.length) {
    var vf = ps.lus.concat(ps.bloques).map(function (s) { return s.verifie; }).filter(Boolean).sort().pop();
    if (vf) h += '<p class="vol-verif">' + esc(tr("fl_prices_checked_on", { date: dateCourte(vf) })) + "</p>";
  }
  var pu = puces(o, ctx);
  if (pu.length) h += '<ul class="vol-puces">' + pu.map(htmlPuce).join("") + "</ul>";
  if (opt.ecart && opt.ecart.length) {
    h += '<p class="vol-ecart">' + opt.ecart.map(function (x) { return '<span class="' + esc(x.ton) + '">' + esc(x.texte) + "</span>"; }).join(" ") + "</p>";
  }
  h += '<div class="vol-actions">' + (opt.choisi
    ? '<span class="vol-votre" aria-label="' + esc(tr("fl_chosen_aria")) + '">' + svg("coche") + esc(tr("fl_your_flight")) + "</span>" + (opt.actionsPlus || "")
    : '<button type="button" class="btn small vol-choisir" data-va="choisir" data-vid="' + esc(o.id) + '" data-vcle="choisir:' + esc(o.id) + '" aria-label="' +
      esc(tr("fl_choose_aria", { name: titre })) + '">' + esc(tr("fl_choose")) + "</button>") + "</div>";
  h += '<details class="vol-trajet" data-vol="' + esc(o.id) + '"' + ouvert + "><summary>" + esc(tr("fl_see_trip")) +
    (escales(o).length ? " " + esc(tr("fl_see_trip_count", { flights: tr("fl_n_flights", { n: (o.segments || []).length }), stops: tr("fl_n_stops", { n: escales(o).length }) })) : "") +
    "</summary>" + htmlTrajet(o, ctx) + "</details>";
  return h + "</article>";
}

/* ================= Effects of the cards ================= */
function totauxActuels() { return typeof Parcours !== "undefined" && Parcours && Parcours.totaux ? Parcours.totaux : null; }
/* ecart(choix, D, patch) of budget.js — null when absent or failing: the line is then hidden. */
function ecartDe(o, ctx) {
  var f = fnEcart();
  if (!f || !ctx.leg) return null;
  try {
    var patch = {};
    patch[ctx.leg.key] = o.id;
    var r = f(ctx.choix, ctx.D, patch);
    return r && nombre(r.montant) ? r : null;
  } catch (err) { return null; }
}
function optionsCarte(o, ctx, ext, choisi) {
  var e = choisi ? null : ecartDe(o, ctx);
  var badge = o.id === ext.moinsCher ? tr("fl_badge_cheapest") : o.id === ext.plusCourt ? tr("fl_badge_shortest") : "";
  return { choisi: choisi, ecart: libelleEcart(ctx.leg, e, ctx.choix, totauxActuels(), choisi), badge: badge };
}

/* ================= State of each leg (kept between two renders) ================= */
var ETATS = {};
function etatDe(cle) {
  if (!ETATS[cle]) ETATS[cle] = {
    tri: "prix", date: null, tout: false, ouverts: {}, panneau: false, ouvert: false,
    arrivee: false, valise: false, cabine: false, unique: false, sansVisa: false, prixValise: false, escalesMax: null, dureeMax: null,
  };
  return ETATS[cle];
}
function reduireMouvement() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

/* ================= Arrival and return screens ================= */
/* Price of a day of the dates band: the lowest between the grid (all the site's flights that day) and the cards of
   that day, so that the green "cheapest day" never contradicts a card. */
function prixDuJour(x, options, avecValise, prixValise) {
  var grille = avecValise && nombre(x.prix_min_valise_home) ? x.prix_min_valise_home : prixValise ? (nombre(x.prix_min_valise_home) ? x.prix_min_valise_home : null) : x.prix_min_home;
  var cartes = (options || []).filter(function (o) {
    return dateDepart(o) === x.depart && (!avecValise || (o.valise && o.valise.comprise === true));
  }).map(prixValise ? totalAvecValise : prixMin).filter(nombre);
  var tous = (nombre(grille) ? [grille] : []).concat(cartes);
  return tous.length ? Math.min.apply(null, tous) : null;
}
function htmlBandeDates(leg, D, ctx, etat, choisi) {
  var g = ((D.vols[leg.key] || {}).grille) || [];
  if (g.length < 2) return "";
  var prix = g.map(function (x) { return prixDuJour(x, ctx.options, !!etat.valise, !!etat.prixValise); });
  var min = Math.min.apply(null, prix.filter(nombre));
  var dateChoisie = choisi ? dateDepart(choisi) : "";
  var btn = g.map(function (x, i) {
    var p = prix[i], actif = etat.date === x.depart;
    var cls = "vol-date" + (nombre(p) && p === min ? " moins" : "") + (x.depart === dateChoisie ? " votre" : "");
    var t = tr("label_value", { label: jourLong(x.depart), value: nombre(p) ? tr("fl_from_price", { price: argent(p) }) : tr("price_to_check") }) +
      (x.nb_options ? ", " + tr("fl_n_flights_at", { n: x.nb_options, site: x.site || "" }) : "");
    return '<button type="button" class="' + cls + '" data-va="date" data-vdate="' + esc(x.depart) + '" data-vcle="date:' + esc(x.depart) + '" aria-pressed="' + actif + '"' +
      ' title="' + esc(t) + '"><span class="j">' + esc(jourCourt(x.depart)) + "</span><b>" + (nombre(p) ? esc(argent(p)) : "?") + "</b>" +
      (x.depart === dateChoisie ? '<span class="vol-sr"> ' + esc(tr("fl_your_flight_sr")) + "</span>" : "") + "</button>";
  }).join("");
  var vf = g.map(function (x) { return x.verifie; }).filter(Boolean).sort().pop();
  var leg2 = tr("fl_dates_legend", { site: g[0].site || "" }) + (etat.valise ? tr("fl_dates_legend_bag_included") : etat.prixValise ? tr("fl_dates_legend_with_bag") : "") +
    (vf ? " " + tr("fl_checked_paren", { date: dateCourte(vf) }) : "") + tr("fl_dates_legend_end");
  return '<section class="vol-sec"><h3 class="vol-h2">' + esc(tr("fl_dates")) + '</h3><div class="vol-dates" style="--n:' + g.length + '" role="group" aria-label="' +
    esc(tr("fl_dates_aria")) + '">' + btn + "</div>" + '<p class="vol-legende">' + esc(leg2) + "</p></section>";
}
/* A toggle button (a filter or "Price with bag"). */
function htmlChip(cle, lib, titre, actif) {
  return '<button type="button" class="vol-chip" data-va="filtre" data-vfiltre="' + esc(cle) + '" data-vcle="filtre:' + esc(cle) + '"' +
    (titre ? ' title="' + esc(titre) + '"' : "") + ' aria-pressed="' + !!actif + '">' + esc(lib) + "</button>";
}
/* A single-choice setting ("Direct / 1 stop max / All"). valeurs: [{ val, lib }]; "All" (val null) last. */
function htmlPilules(cle, libelle, valeurs, actuelle) {
  var btn = valeurs.concat([{ val: null, lib: tr("fl_all") }]).map(function (x) {
    var on = x.val === null ? actuelle === null : actuelle === x.val;
    var v = x.val === null ? "" : String(x.val);
    return '<button type="button" class="vol-pil" data-va="seg" data-vseg="' + esc(cle) + '" data-vval="' + esc(v) + '" data-vcle="seg:' + esc(cle) + ":" + esc(v || "all") +
      '" aria-pressed="' + on + '">' + esc(x.lib) + "</button>";
  }).join("");
  return '<div class="vol-pilules-bloc"><span class="vol-pl" aria-hidden="true">' + esc(libelle) + '</span><div class="vol-pilules" role="group" aria-label="' + esc(libelle) + '">' + btn + "</div></div>";
}
function seuilsAffiches(proposes, actif) {
  var l = proposes.slice();
  if (nombre(actif) && l.indexOf(actif) < 0) l.push(actif);
  return l.sort(function (a, b) { return a - b; });
}
/* Sort + filters panel. opt.tri === false: no sort (block between stages). Folded under "Filters (n)" below 560 px. */
function htmlFiltres(etat, leg, options, opt) {
  opt = opt || {};
  var pert = controlesPertinents(options, leg);
  var n = nbFiltres(etat), ouvert = !!etat.panneau, id = "vol-f-" + (leg ? leg.key : "x");
  var bagages = FILTRES_BAGAGES.map(function (k) { return htmlChip(k, tr(LIB_FILTRES[k][0]), tr(LIB_FILTRES[k][1]), etat[k]); }).join("");
  var trajetHtml = "";
  var esc_ = seuilsAffiches(pert.escales, etat.escalesMax);
  if (esc_.length) trajetHtml += htmlPilules("escalesMax", tr("fl_stops_label"), esc_.map(function (k) { return { val: k, lib: libEscales(k) }; }), nombre(etat.escalesMax) ? etat.escalesMax : null);
  FILTRES_TRAJET.forEach(function (k) {
    if (pert[k] || etat[k]) trajetHtml += htmlChip(k, tr(LIB_FILTRES[k][0]), tr(LIB_FILTRES[k][1]), etat[k]);
  });
  var dur = seuilsAffiches(pert.duree, etat.dureeMax);
  if (dur.length) {
    trajetHtml += htmlPilules("dureeMax", tr("fl_max_duration"), dur.map(function (h) { return { val: h, lib: "≤ " + tr("dur_h", { h: h }) }; }), nombre(etat.dureeMax) ? etat.dureeMax : null);
  }
  var tris = opt.tri === false ? "" : '<div class="vol-groupe" role="group" aria-label="' + esc(tr("fl_sort_aria")) + '"><span class="vol-gl" aria-hidden="true">' + esc(tr("fl_sort")) + '</span><div class="vol-boutons">' +
    TRIS.map(function (t) {
      return '<button type="button" class="vol-chip" data-va="tri" data-vtri="' + t + '" data-vcle="tri:' + t + '" title="' + esc(tr(LIB_TRIS[t][1])) + '" aria-pressed="' + (etat.tri === t) + '">' + esc(tr(LIB_TRIS[t][0])) + "</button>";
    }).join("") + "</div></div>";
  return '<div class="vol-filtres">' + tris +
    '<button type="button" class="btn small vol-filtres-btn" data-va="panneau" data-vcle="panneau" aria-expanded="' + ouvert + '" aria-controls="' + esc(id) + '">' +
    svg("filtres") + esc(n ? tr("fl_filters_n", { n: n }) : tr("fl_filters")) + "</button>" +
    '<div class="vol-filtres-corps' + (ouvert ? "" : " vol-ferme") + '" id="' + esc(id) + '">' +
    '<div class="vol-groupe" role="group" aria-label="' + esc(tr("fl_bags")) + '"><span class="vol-gl" aria-hidden="true">' + esc(tr("fl_bags")) + '</span><div class="vol-boutons">' + bagages + "</div></div>" +
    (trajetHtml ? '<div class="vol-groupe" role="group" aria-label="' + esc(tr("fl_trip_group")) + '"><span class="vol-gl" aria-hidden="true">' + esc(tr("fl_trip_group")) + '</span><div class="vol-boutons">' + trajetHtml + "</div></div>" : "") +
    "</div></div>";
}
/* "4 flights of 24" when filters hide some, else "24 other flights"; "Reset" as soon as a filter is on. */
function htmlCompte(etat, affiches, total, extra) {
  var txt = affiches < total ? tr("fl_count_of", { n: affiches, total: total }) : tr("fl_count_others", { n: total });
  return '<div class="vol-compte-l"><p class="vol-compte" role="status">' + esc(txt + (extra || "")) + "</p>" +
    (filtresActifs(etat) ? '<button type="button" class="vol-reinit" data-va="reinit" data-vcle="reinit">' + esc(tr("fl_reset")) + "</button>" : "") + "</div>";
}
function nbCabineInconnue(tout, filtres) {
  return filtrer(tout, Object.assign({}, filtres, { cabine: false })).filter(function (o) { return cabine(o).etat === "inconnu"; }).length;
}
/* The chosen flight stays shown even when the filters remove it. */
function htmlHorsFiltres(choisi, etat) {
  if (!choisi || filtrer([choisi], filtresDe(etat, false)).length) return "";
  return '<p class="vol-hors-filtres" role="note">' + svg("attention") + "<span>" + esc(tr("fl_chosen_filtered")) + "</span></p>";
}
/* A leg out of the shared budget: the "Add it to see" toggle (choix.inclure[leg]). The amount is exactly what the toggle
   adds to the total, detailed (ticket + bag + the formalities only this leg asks for): the same in the detail and the plan. */
function htmlHorsBudget(leg, o, choix, D) {
  if (!leg || leg.in_budget) return "";
  var inclus = estInclus(choix, leg);
  var a = o ? horsBudgetDuTrajet(choix, D, leg.key) : null;
  var somme = a ? " (" + a.texte + ")" : "";
  var phrase = inclus
    ? "<b>" + esc(tr("fl_out_included_lead")) + "</b> " + esc(tr("fl_out_included_more", { sum: somme }))
    : "<b>" + esc(tr("fl_out_excluded_lead")) + "</b> " + esc(tr("fl_out_excluded_more", { sum: somme }));
  return '<section class="vol-hors" aria-label="' + esc(tr("fl_out_aria")) + '"><p>' + phrase + "</p>" +
    '<label class="vol-case"><input type="checkbox" data-va="inclure" data-vleg="' + esc(leg.key) + '" data-vcle="inclure:' + esc(leg.key) + '"' + (inclus ? " checked" : "") +
    "><span>" + esc(tr("fl_add_to_see")) + "</span></label></section>";
}
function htmlListe(leg, D, ctx, etat, choisi, ext) {
  var tout = ctx.options.filter(function (o) { return !choisi || o.id !== choisi.id; });
  var filtres = filtresDe(etat);
  var liste = trier(filtrer(tout, filtres), etat.tri, { avecValise: ctx.avecValise });
  var actifs = filtresActifs(etat);
  var visibles = etat.tout ? liste : liste.slice(0, NB_VISIBLES);
  var h = '<section class="vol-sec"><h3 class="vol-h2">' + esc(tr(choisi ? "fl_other_flights" : "fl_flights")) + "</h3>" + htmlFiltres(etat, leg, ctx.options);
  var g = (((D.vols[leg.key] || {}).grille) || []).filter(function (x) { return x.depart === etat.date; })[0];
  var inconnus = etat.cabine ? nbCabineInconnue(tout, filtres) : 0;
  var extra = (g && g.nb_options ? " · " + tr("fl_grid_count", { site: g.site || "", n: g.nb_options }) : "") +
    (inconnus ? " · " + tr("fl_cabin_unknown_removed", { n: inconnus }) : "");
  h += htmlCompte(etat, liste.length, tout.length, extra);
  if (!liste.length) {
    h += '<div class="vol-vide"><p>' + esc(tr("fl_no_match")) + (inconnus ? " " + esc(tr("fl_cabin_not_read", { n: inconnus })) : "") + "</p>" +
      (actifs ? '<button type="button" class="btn small" data-va="reinit" data-vcle="reinit-vide">' + esc(tr("fl_show_all")) + "</button>" : "") + "</div>";
  } else {
    h += '<div class="vol-liste">' + visibles.map(function (o) { return htmlCarte(o, ctx, optionsCarte(o, ctx, ext, false)); }).join("") + "</div>";
    if (liste.length > NB_VISIBLES) {
      h += '<button type="button" class="btn vol-plus-btn" data-va="tout" data-vcle="tout" aria-expanded="' + !!etat.tout + '">' +
        esc(etat.tout ? tr("fl_see_less") : tr("fl_see_more", { n: liste.length - NB_VISIBLES })) + "</button>";
    }
  }
  return h + "</section>";
}
/* A flight leg never researched: no price grid and no option (no raw Kiwi file was read for it). */
function jamaisCherche(D, legKey) {
  var v = D && D.vols && D.vols[legKey];
  return !v || (!((v.grille || []).length) && !((v.options || []).length));
}
/* One leg of the arrival or return screen: <section class="vol-leg" data-leg="…">. */
function htmlLeg(leg, D, choix, etat) {
  var ctx = contexte(leg, D, choix, etat), trip = ctx.trip;
  var h = '<section class="vol-leg" data-leg="' + esc(leg.key) + '"><h2 class="vol-leg-t">' + esc(titreLeg(leg, trip)) + "</h2>";
  if (!ctx.options.length) {
    var jamais = jamaisCherche(D, leg.key);
    return h + '<div class="attente"><p class="attente-t">' + esc(tr(jamais ? "fl_not_researched" : "fl_no_flight")) + "</p><p>" +
      esc(tr(jamais ? "fl_not_researched_how" : "fl_no_flight_how")) + "</p></div></section>";
  }
  var ext = extremes(ctx.options, ctx.avecValise);
  var choisi = trouverOption(D, leg.key, choix && choix[leg.key]);
  var g = ((D.vols[leg.key] || {}).grille) || [];
  var vf = verifieLe(ctx.options);
  var meta = [pourN(leg.adults || 1)];
  if (g.length > 1) meta.push(tr("fl_departures_from_to", { from: jourLong(g[0].depart), to: jourLong(g[g.length - 1].depart) }));
  else meta.push(jourLong(leg.date));
  if (vf) meta.push(tr("fl_read_on", { date: dateCourte(vf) }));
  h += '<p class="vol-meta">' + esc(meta.join(" · ")) + "</p>";
  h += htmlHorsBudget(leg, choisi, choix, D);
  h += htmlBandeDates(leg, D, ctx, etat, choisi);
  if (choisi) {
    h += '<section class="vol-sec vol-choix" tabindex="-1"><h3 class="vol-h2">' + esc(tr("fl_your_flight")) + "</h3>" + htmlCarte(choisi, ctx, optionsCarte(choisi, ctx, ext, true)) + htmlHorsFiltres(choisi, etat) + "</section>";
  } else {
    h += '<div class="attente calme"><p class="attente-t">' + esc(tr("fl_none_chosen")) + "</p><p>" + esc(tr("fl_none_chosen_more")) + "</p></div>";
  }
  h += htmlListe(leg, D, ctx, etat, choisi, ext);
  return h + "</section>";
}
/* The whole screen (pure): every leg of ecran.legs. etats: { <leg>: state } (optional). */
function htmlEcranVols(ecran, D, choix, etats) {
  var trip = cfg(D);
  var legs = ((ecran && ecran.legs) || []).map(function (k) { return trip.legByKey[k]; }).filter(Boolean);
  return legs.map(function (l) { return htmlLeg(l, D, choix, (etats && etats[l.key]) || etatDe(l.key)); }).join("") +
    '<p class="vol-pied discret">' + esc(tr("fl_footer")) + "</p>";
}

/* Common listeners: clicks, opened details. rendre() redraws the block; choosing writes choix.<leg>. */
function brancher(wrap, leg, etat, rendre, apresChoix) {
  wrap.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("[data-va]") : null;
    if (!b || !wrap.contains(b)) return;
    var act = b.getAttribute("data-va");
    if (act === "choisir") {
      if (typeof patchChoix === "function") patchChoix(leg, b.getAttribute("data-vid"));
      if (apresChoix) apresChoix();
    } else if (act === "tri") { etat.tri = b.getAttribute("data-vtri"); rendre(); }
    else if (act === "filtre") { var k = b.getAttribute("data-vfiltre"); if (CLES_BASCULE.indexOf(k) >= 0) { etat[k] = !etat[k]; rendre(); } }
    else if (act === "seg") {
      var sc = b.getAttribute("data-vseg"), sv = b.getAttribute("data-vval");
      if (CLES_SEGMENT.indexOf(sc) >= 0) { etat[sc] = sv === "" || !isFinite(+sv) ? null : +sv; rendre(); }
    }
    else if (act === "panneau") { etat.panneau = !etat.panneau; rendre(); }
    else if (act === "date") { var d = b.getAttribute("data-vdate"); etat.date = etat.date === d ? null : d; rendre(); }
    else if (act === "tout") { etat.tout = !etat.tout; rendre(); }
    else if (act === "reinit") { reinitFiltres(etat); rendre(); }
    else if (act === "bloc-tout") { etat.ouvert = !etat.ouvert; rendre(); }
  });
  wrap.addEventListener("change", function (ev) {
    var b = ev.target;
    if (b && b.getAttribute && b.getAttribute("data-va") === "inclure" && typeof patchChoix === "function") {
      var maj = {};
      maj[b.getAttribute("data-vleg") || leg] = !!b.checked;
      patchChoix("inclure", maj);
    }
  });
  /* "toggle" does not bubble: listened to in capture to keep the opened trips from one render to the next. */
  wrap.addEventListener("toggle", function (ev) {
    var d = ev.target;
    if (d && d.tagName === "DETAILS" && d.getAttribute("data-vol")) {
      if (d.open) etat.ouverts[d.getAttribute("data-vol")] = true; else delete etat.ouverts[d.getAttribute("data-vol")];
    }
  }, true);
}
/* Redraws wrap keeping the focus on the same button. */
function redessiner(wrap, html) {
  var actif = typeof document !== "undefined" && document.activeElement && wrap.contains(document.activeElement) && document.activeElement.getAttribute
    ? document.activeElement.getAttribute("data-vcle") : null;
  wrap.innerHTML = html;
  if (actif) {
    var el = null;
    Array.prototype.slice.call(wrap.querySelectorAll("[data-vcle]")).some(function (x) { if (x.getAttribute("data-vcle") === actif) { el = x; return true; } return false; });
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }
}

function ecranVols(racine, D, choix, ecran) {
  var trip = cfg(D);
  var courant = choix;
  var rendus = [];
  ((ecran && ecran.legs) || []).forEach(function (k) {
    var leg = trip.legByKey[k];
    if (!leg) return;
    var etat = etatDe(k);
    var wrap = document.createElement("div");
    wrap.className = "vol-ecran";
    racine.appendChild(wrap);
    var rendre = function () { redessiner(wrap, htmlLeg(leg, D, courant, etat)); };
    brancher(wrap, k, etat, rendre, function () {
      // the chosen flight moves to the top: bring the view there once the screen is updated
      setTimeout(function () {
        var el = wrap.querySelector(".vol-choix");
        if (el) { try { el.scrollIntoView({ behavior: reduireMouvement() ? "auto" : "smooth", block: "start" }); } catch (e) {} }
      }, 40);
    });
    rendus.push(rendre);
    rendre();
  });
  var pied = document.createElement("p");
  pied.className = "vol-pied discret";
  pied.textContent = tr("fl_footer");
  racine.appendChild(pied);
  return { maj: function (c) { courant = c; rendus.forEach(function (r) { r(); }); }, quitter: function () {} };
}

/* ================= Legs between stages (at the top of the arriving stage) ================= */
/* A ground option's price: its budget lines (n × u), null when none. */
function prixSol(o) {
  var l = ((o && o.lignes) || []).filter(function (x) { return x && nombre(x.n) && nombre(x.u); });
  return l.length ? l.reduce(function (s, x) { return s + x.n * x.u; }, 0) : null;
}
/* A ground leg: one card per option (mode, operator, times, duration, price, booking advice), the chosen one marked;
   out of the shared budget, the "Add it to see" toggle first. */
function htmlSol(leg, D, choix) {
  var trip = cfg(D), options = ((D.vols && D.vols[leg.key]) || {}).options || [];
  var id = choix && choix[leg.key];
  var h = '<div class="gd-bloc-in"><header class="vol-bloc-t"><span class="vol-bloc-i">' + svg("route") + '</span><div><h2 class="vol-bloc-h">' +
    esc(tr("gd_title", { route: route(leg, trip) })) + "</h2>" +
    '<p class="vol-meta">' + esc([jourLong(leg.date), trip.whoOf(leg) || pourN(leg.adults || 1)].filter(Boolean).join(" · ")) + "</p></div></header>";
  if (!options.length) return h + '<p class="discret">' + esc(tr("gd_no_option")) + "</p></div>";
  // out of the shared budget: the same "Add it to see" toggle as a flight leg
  h += htmlHorsBudget(leg, options.filter(function (o) { return o.id === id; })[0] || null, choix, D);
  h += '<div class="gd-liste">' + options.map(function (o) {
    var choisi = o.id === id, p = prixSol(o), lien = safeUrl(o.lien);
    var horaires = o.depart && o.arrivee ? tr("gd_times", { dep: o.depart, arr: o.arrivee }) : "";
    return '<article class="gd-carte vol-carte' + (choisi ? " choisi" : "") + '" data-vol="' + esc(o.id) + '">' +
      '<div class="vol-haut"><div class="vol-gauche"><p class="gd-mode"><b>' + esc(libelleMode(o.mode) || o.mode || "") + "</b></p>" +
      '<p class="gd-op">' + esc(o.operateur || "") + "</p>" +
      '<p class="vol-sous">' + esc([o.duree, horaires].filter(Boolean).join(" · ")) + "</p></div>" +
      '<div class="vol-prix">' + (p !== null ? '<b class="vol-p">' + esc(argent(p)) + "</b><span>" + esc(pourN(leg.adults || 1)) + "</span>"
        : '<b class="vol-p inconnu">' + esc(tr("price_to_check")) + "</b>") + "</div></div>" +
      (o.reserver ? '<p class="gd-note">' + esc(tr("gd_book", { text: o.reserver })) + "</p>" : "") +
      (o.remarque ? '<p class="gd-note discret">' + esc(o.remarque) + "</p>" : "") +
      '<div class="vol-actions">' + (choisi
        ? '<span class="vol-votre">' + svg("coche") + esc(tr("gd_your_choice")) + "</span>"
        : '<button type="button" class="btn small vol-choisir" data-va="choisir" data-vid="' + esc(o.id) + '" data-vcle="choisir:' + esc(o.id) + '">' + esc(tr("gd_choose")) + "</button>") +
      (lien ? ' <a class="vol-site" href="' + esc(lien) + '" target="_blank" rel="noopener">' + esc(tr("gd_link")) + ' <span aria-hidden="true">↗</span></a>' : "") + "</div></article>";
  }).join("") + "</div>";
  return h + "</div>";
}
/* A flight leg between stages: the chosen flight, then "Change flight" (the other flights, filters on bags and trip). */
function htmlBlocVol(leg, D, choix, etat) {
  var ctx = contexte(leg, D, choix, etat), trip = ctx.trip;
  var titre = tr("fl_between_title", { route: route(leg, trip) });
  if (!ctx.options.length) {
    var rien = jamaisCherche(D, leg.key) ? tr("fl_not_researched") + " " + tr("fl_not_researched_how") : tr("fl_no_flight_leg");
    return '<div class="vol-bloc-in"><h2 class="vol-bloc-h">' + esc(titre) + '</h2><p class="discret">' + esc(rien) + "</p></div>";
  }
  var ext = extremes(ctx.options, ctx.avecValise);
  var choisi = trouverOption(D, leg.key, choix && choix[leg.key]);
  var jour = dateDepart(choisi || ctx.options[0]);
  var autres = ctx.options.filter(function (o) { return !choisi || o.id !== choisi.id; });
  var vf = verifieLe(ctx.options);
  var h = '<div class="vol-bloc-in"><header class="vol-bloc-t"><span class="vol-bloc-i">' + svg("avion") + '</span><div><h2 class="vol-bloc-h">' + esc(titre) + "</h2>" +
    '<p class="vol-meta">' + esc([jourLong(jour), trip.whoOf(leg) || pourN(leg.adults || 1), vf ? tr("fl_read_on", { date: dateCourte(vf) }) : ""].filter(Boolean).join(" · ")) + "</p></div></header>";
  h += htmlHorsBudget(leg, choisi, choix, D);
  var bouton = autres.length
    ? '<button type="button" class="btn small vol-autres-btn" data-va="bloc-tout" data-vcle="bloc-tout" aria-expanded="' + !!etat.ouvert + '">' +
      esc(etat.ouvert ? tr("fl_hide_others") : tr("fl_change_flight", { n: autres.length })) + "</button>" : "";
  if (choisi) {
    var opt = optionsCarte(choisi, ctx, ext, true);
    opt.actionsPlus = bouton;
    h += htmlCarte(choisi, ctx, opt);
    if (etat.ouvert) h += htmlHorsFiltres(choisi, etat);
  } else {
    h += '<p class="discret">' + esc(tr("fl_none_chosen")) + "</p>" + bouton;
  }
  if (autres.length && etat.ouvert) {
    var filtres = filtresDe(etat);
    var liste = trier(filtrer(autres, filtres), "prix", { avecValise: ctx.avecValise });
    var inconnus = etat.cabine ? nbCabineInconnue(autres, filtres) : 0;
    h += htmlFiltres(etat, leg, ctx.options, { tri: false });
    h += htmlCompte(etat, liste.length, autres.length, inconnus ? " · " + tr("fl_cabin_unknown_removed", { n: inconnus }) : "");
    h += liste.length
      ? '<div class="vol-liste">' + liste.map(function (o) { return htmlCarte(o, ctx, optionsCarte(o, ctx, ext, false)); }).join("") + "</div>"
      : '<div class="vol-vide"><p>' + esc(tr("fl_no_match")) + '</p><button type="button" class="btn small" data-va="reinit" data-vcle="reinit-vide">' + esc(tr("fl_show_all")) + "</button></div>";
  }
  return h + "</div>";
}
/* The block of a between-stages leg (pure): a flight or a ground leg; "" for an unknown leg. */
function htmlBlocTrajet(legKey, D, choix, etat) {
  var leg = cfg(D).legByKey[legKey];
  if (!leg) return "";
  return leg.mode === "flight" ? htmlBlocVol(leg, D, choix, etat || etatDe("bloc-" + legKey)) : htmlSol(leg, D, choix);
}
/* Puts the block in racine (without emptying it); { maj(choix), quitter(), element } or null for an unknown leg. */
function blocTrajet(racine, legKey, D, choix) {
  var leg = cfg(D).legByKey[legKey];
  if (!leg || !racine || !D) return null;
  var etat = etatDe("bloc-" + legKey);
  var courant = choix;
  var wrap = document.createElement("section");
  wrap.className = leg.mode === "flight" ? "vol-bloc" : "vol-bloc gd-bloc";
  wrap.setAttribute("aria-label", leg.mode === "flight" ? tr("fl_between_title", { route: route(leg, cfg(D)) }) : tr("gd_title", { route: route(leg, cfg(D)) }));
  racine.appendChild(wrap);
  function rendre() { redessiner(wrap, htmlBlocTrajet(legKey, D, courant, etat)); }
  brancher(wrap, legKey, etat, rendre, null);
  rendre();
  return { maj: function (c) { courant = c; rendre(); }, quitter: function () {}, element: wrap };
}

/* ================= Registration ================= */
if (typeof window !== "undefined") {
  window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
  window.ECRANS["vols"] = ecranVols;
  window.blocTrajet = blocTrajet;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    duree: duree, heure: heure, jourCourt: jourCourt, jourLong: jourLong, dateCourte: dateCourte, nbJours: nbJours, plusJours: plusJours,
    dateDepart: dateDepart, dateArrivee: dateArrivee, nomsCompagnies: nomsCompagnies, escalesTexte: escalesTexte, libelleMode: libelleMode,
    prixSites: prixSites, prixMin: prixMin, valise: valise, extremes: extremes, verifieLe: verifieLe,
    cabine: cabine, objetPerso: objetPerso, prixAvecValise: prixAvecValise, totalAvecValise: totalAvecValise, nbEscales: nbEscales, sansVisaTransit: sansVisaTransit,
    trier: trier, filtrer: filtrer, filtresDe: filtresDe, nbFiltres: nbFiltres, filtresActifs: filtresActifs, reinitFiltres: reinitFiltres,
    controlesPertinents: controlesPertinents, htmlFiltres: htmlFiltres, htmlCompte: htmlCompte, barre: barre, totauxVol: totauxVol,
    contexte: contexte, puces: puces, decalageDates: decalageDates, decalageArrivee: decalageArrivee, formalitesDe: formalitesDe,
    libelleEcart: libelleEcart, margeTexte: margeTexte, htmlCarte: htmlCarte, htmlLeg: htmlLeg, htmlEcranVols: htmlEcranVols,
    htmlBlocTrajet: htmlBlocTrajet, htmlSol: htmlSol, jamaisCherche: jamaisCherche, htmlBandeDates: htmlBandeDates, prixSol: prixSol,
    etatDe: etatDe, NB_VISIBLES: NB_VISIBLES, prixDuJour: prixDuJour, sourceValise: sourceValise,
    htmlHorsBudget: htmlHorsBudget, htmlHorsFiltres: htmlHorsFiltres, brancher: brancher,
  };
}
})();
