// Consistency alerts (page/js/logic/alerts.js), on the sample trip (tests/fixtures/sample-built).
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./helpers/donnees.js");
const A = require("../../page/js/logic/alerts.js");
const B = require("../../page/js/logic/budget.js");
const J = require("../../page/js/logic/days.js");

const { chargerDonnees, copie, variante, avecAcces, avecSortie, avecHoraires } = H;
const D = chargerDonnees();
const defaut = () => copie(D.defaut);
const avec = (patch) => Object.assign(defaut(), patch);
const choixDe = (D0, patch) => Object.assign(copie(D0.defaut), patch || {});
const trouve = (al, cle) => al.find((a) => a.cle === cle);
const ECRANS = ["aller", "retour"].concat(D.trip.stages.map((s) => s.key));
const COMPORTA = H.logement(D, "comporta", "comporta-01").acces; // last public ferry 20:30, first 07:00, 1 h 45 by car + ferry
const VOITURE = { aeroport: "LIS", duree_min: 25, mode: "voiture", dernier_public: null, premier_public: null, prive_home: 35 };
const IB_ARR = "arrive-a-20270615-IB9002-IB9003"; // lands LIS 21:10
const AF_ARR = "arrive-a-20270615-AF9004-AF9005"; // lands LIS 23:30
const TP_RET = "return-a-20270624-TP9031-TP9032"; // leaves OPO 07:15
const FR = "comporta-porto-20270621-FR9022"; // LIS 15:15 -> OPO 16:10

function forme(al) {
  for (const a of al) {
    assert.ok(a.niveau === "bloquant" || a.niveau === "attention", a.cle);
    assert.ok(ECRANS.includes(a.etape), `${a.cle}: screen ${a.etape}`);
    assert.ok(typeof a.cle === "string" && a.cle, "cle");
    assert.ok(typeof a.texte === "string" && a.texte.length > 20, `${a.cle}: texte`);
    assert.ok(typeof a.solution === "string" && a.solution.length > 20, `${a.cle}: solution`);
    for (const t of [a.texte, a.solution]) assert.doesNotMatch(t, /NaN|undefined|null|\[object|\{[a-z_]+\}/, `${a.cle}: ${t}`);
  }
  assert.equal(new Set(al.map((a) => a.cle)).size, al.length, "one key per alert");
  const niveaux = al.map((a) => a.niveau);
  assert.deepEqual(niveaux, niveaux.slice().sort((x, y) => (x === y ? 0 : x === "bloquant" ? -1 : 1)), "blocking first");
}

// ------------------------------------------------------------------------------------------------ shape

test("alerts: the shape of each alert, no missing value in the texts", () => {
  const D2 = avecAcces(D, "lisbon", "lisbon-01", COMPORTA);
  const al = A.alertes(avec({ "arrive-a": AF_ARR, "return-a": TP_RET }), D2);
  assert.ok(al.length >= 3);
  forme(al);
});

test("the default choice gives no alert at all", () => {
  assert.deepEqual(A.alertes(defaut(), D), []);
  assert.deepEqual(A.alertes({}, D), [], "empty choice = defaults");
});

test("alertes changes neither choix nor D, and gives the same result twice", () => {
  const c = avec({ "arrive-a": AF_ARR, sorties: { "lisbon-azulejo-workshop": { jour: "2027-06-18" } } });
  const avantC = JSON.stringify(c);
  const avantD = JSON.stringify(D);
  assert.deepEqual(A.alertes(c, D), A.alertes(c, D));
  assert.equal(JSON.stringify(c), avantC);
  assert.equal(JSON.stringify(D), avantD);
});

// ------------------------------------------------------------------------------------------------ rule 1: arriving after the last public transport

test("rule 1: a flight landing at LIS at 21:40, a lodging past the 20:30 ferry -> blocking, with the private price", () => {
  const D2 = avecHoraires(avecAcces(D, "lisbon", "lisbon-01", COMPORTA), "arrive-a", IB_ARR, null, "2027-06-15T21:40");
  const a = trouve(A.alertes(avec({ "arrive-a": IB_ARR }), D2), "arrivee-arrive-a");
  assert.ok(a, "alert arrivee-arrive-a");
  assert.equal(a.niveau, "bloquant");
  assert.equal(a.etape, "lisbon");
  assert.match(a.texte, /Alex/);
  assert.match(a.texte, /21:40/);
  assert.match(a.texte, /20:30/);
  assert.match(a.texte, /boat/);
  assert.match(a.solution, /\$140/);
  assert.match(a.solution, /confirm in writing/, "a late private boat must be confirmed");
});

test("rule 1: a train access names the last public transport, a ferry access the last boat", () => {
  const train = Object.assign({}, COMPORTA, { mode: "train" });
  const a = trouve(A.alertes(avec({ "arrive-a": IB_ARR }), avecHoraires(avecAcces(D, "lisbon", "lisbon-01", train), "arrive-a", IB_ARR, null, "2027-06-15T21:40")), "arrivee-arrive-a");
  assert.ok(a, "alert arrivee-arrive-a");
  assert.match(a.texte, /last public transport/);
  assert.doesNotMatch(a.texte + a.solution, /boat/);
  const ferry = Object.assign({}, COMPORTA, { mode: "voiture+ferry" });
  const b = trouve(A.alertes(avec({ "arrive-a": IB_ARR }), avecHoraires(avecAcces(D, "lisbon", "lisbon-01", ferry), "arrive-a", IB_ARR, null, "2027-06-15T21:40")), "arrivee-arrive-a");
  assert.match(b.texte, /last public boat/);
});

test("rule 1: a private boat is to confirm in writing only after dark (out of the airport from 20:00), not for a daytime arrival", () => {
  const acces = Object.assign({}, COMPORTA, { dernier_public: "17:00" });
  // landing 18:59: out of the airport at 19:59, blocking (17:00 missed), but no written confirmation
  const jour = avecHoraires(avecAcces(D, "lisbon", "lisbon-01", acces), "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T18:59");
  const a = trouve(A.alertes(defaut(), jour), "arrivee-arrive-a");
  assert.ok(a);
  assert.equal(a.niveau, "bloquant");
  assert.match(a.solution, /private boat/);
  assert.doesNotMatch(a.solution, /confirm in writing/);
  // landing 19:00 (the default flight): out at 20:00, the same private boat is to confirm in writing
  const b = trouve(A.alertes(defaut(), avecAcces(D, "lisbon", "lisbon-01", acces)), "arrivee-arrive-a");
  assert.match(b.solution, /confirm in writing/);
});

test("rule 1: proposes a flight landing in time, the cheapest of the same evening and airport", () => {
  const D2 = avecAcces(D, "lisbon", "lisbon-01", { dernier_public: "21:00" });
  const a = trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D2), "arrivee-arrive-a");
  assert.ok(a);
  assert.match(a.solution, /TP9001/, a.solution);
  assert.match(a.solution, /\$421/, a.solution);
});

test("rule 1: the edge is included (reaching the lodging right at the last departure is too late)", () => {
  // TP9001 lands 19:00 + 60 + 25 = 20:25
  assert.ok(trouve(A.alertes(defaut(), avecAcces(D, "lisbon", "lisbon-01", { dernier_public: "20:25" })), "arrivee-arrive-a"));
  assert.equal(trouve(A.alertes(defaut(), avecAcces(D, "lisbon", "lisbon-01", { dernier_public: "20:26" })), "arrivee-arrive-a"), undefined);
});

test("rule 1: unknown private price -> no invented price; no last public transport or unknown road time -> no alert", () => {
  const D2 = avecAcces(D, "lisbon", "lisbon-01", { dernier_public: "18:00", prive_home: null });
  const a = trouve(A.alertes(defaut(), D2), "arrivee-arrive-a");
  assert.ok(a);
  assert.doesNotMatch(a.solution, /\$\d/);
  assert.match(a.solution, /price not given/);
  assert.equal(trouve(A.alertes(defaut(), avecAcces(D, "lisbon", "lisbon-01", { duree_min: null, dernier_public: "18:00" })), "arrivee-arrive-a"), undefined);
});

test("rule 1: a between-stages flight is checked against the lodging it reaches; transport that is not a boat", () => {
  const D2 = avecAcces(D, "porto", "porto-01", { dernier_public: "17:00", mode: "voiture" });
  const a = trouve(A.alertes(defaut(), D2), "arrivee-comporta-porto");
  assert.ok(a);
  assert.equal(a.etape, "porto");
  assert.match(a.texte, /public transport/);
  assert.doesNotMatch(a.texte, /boat/);
});

// ------------------------------------------------------------------------------------------------ rule 2: leaving a lodging for a flight

test("rule 2: FR9022 at 15:15 from a lodging 1 h 45 away -> leave at 12:00, no alert", () => {
  const d = A.departLogement(defaut(), D, "comporta-porto");
  assert.equal(d.heure, "12:00");
  assert.equal(d.enregistrement, 90);
  assert.equal(d.trajet_min, 105);
  assert.equal(d.veille, false);
  assert.equal(d.premier_public, "07:00");
  assert.equal(A.departLogement(defaut(), D, "arrive-a"), null, "an arrival flight leaves no lodging of the trip");
});

test("rule 2: leaving before 05:30 -> attention 'very early', with a later flight", () => {
  const al = A.alertes(avec({ "return-a": TP_RET }), D); // 07:15 - 90 - 25 = 05:20
  const a = trouve(al, "depart-tres-tot-return-a");
  assert.ok(a, al.map((x) => x.cle).join());
  assert.equal(a.niveau, "attention");
  assert.equal(a.etape, "porto");
  assert.equal(a.jour, "2027-06-24");
  assert.match(a.texte, /05:20/);
  assert.match(a.solution, /IB9033 \+ IB9034/);
});

test("rule 2: 05:30 exactly is not very early, 05:29 is", () => {
  const leg = "return-a";
  const a = avecHoraires(D, leg, TP_RET, "2027-06-24T07:25", null); // 05:30
  assert.equal(trouve(A.alertes(avec({ [leg]: TP_RET }), a), "depart-tres-tot-return-a"), undefined);
  const b = avecHoraires(D, leg, TP_RET, "2027-06-24T07:24", null); // 05:29
  assert.ok(trouve(A.alertes(avec({ [leg]: TP_RET }), b), "depart-tres-tot-return-a"));
});

test("rule 2: leaving before the first public ferry -> blocking, with the private price", () => {
  const D2 = avecHoraires(D, "comporta-porto", FR, "2027-06-21T08:30", "2027-06-21T09:25"); // leave 05:15, first ferry 07:00
  const a = trouve(A.alertes(defaut(), D2), "depart-dernier-transport-comporta-porto");
  assert.ok(a);
  assert.equal(a.niveau, "bloquant");
  assert.equal(a.etape, "comporta");
  assert.match(a.texte, /07:00/);
  assert.match(a.solution, /\$140/);
  // the first ferry wins even after 05:30
  const D3 = avecHoraires(D, "comporta-porto", FR, "2027-06-21T09:30", "2027-06-21T10:25"); // leave 06:15
  assert.ok(trouve(A.alertes(defaut(), D3), "depart-dernier-transport-comporta-porto"));
});

test("last transport alert after 20:30", () => {
  // a flight leaving LIS at 00:30: leave the Comporta lodging the evening before at 21:15, after the last ferry (20:30)
  const D2 = avecHoraires(D, "comporta-porto", FR, "2027-06-21T00:30", "2027-06-21T01:25");
  const al = A.alertes(defaut(), D2);
  const a = al.find((x) => x.cle.startsWith("depart-dernier-transport-"));
  assert.ok(a, al.map((x) => x.cle).join());
  assert.equal(a.cle, "depart-dernier-transport-comporta-porto");
  assert.equal(a.niveau, "bloquant");
  assert.equal(a.jour, "2027-06-20");
  assert.match(a.texte, /21:15/);
  assert.match(a.texte, /20:30/);
});

test("rule 2: a return after midnight -> 'leaving the evening before', not 'very early', on that evening's card", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-25T00:30", "2027-06-25T08:10");
  const al = A.alertes(defaut(), D2);
  const a = trouve(al, "depart-veille-return-a");
  assert.ok(a, al.map((x) => x.cle).join());
  assert.equal(a.niveau, "attention");
  assert.equal(a.jour, "2027-06-24");
  assert.match(a.texte, /22:35/);
  assert.equal(trouve(al, "depart-tres-tot-return-a"), undefined);
  assert.equal(al.filter((x) => x.cle.startsWith("date-")).length, 0, "no extra night");
  const q = A.jourDepartLogement(defaut(), D2, "return-a");
  assert.deepEqual([q.jour, q.jour_vol, q.heure, q.veille], ["2027-06-24", "2027-06-25", "22:35", true]);
});

test("jourDepartLogement: computed even without a known road time (only the check-in counts)", () => {
  const D2 = avecAcces(D, "porto", "porto-01", { duree_min: null });
  const q = A.jourDepartLogement(defaut(), D2, "return-a");
  assert.equal(q.estime, true);
  assert.equal(q.heure, "07:30");
  assert.equal(A.departLogement(defaut(), D2, "return-a"), null, "departLogement needs the road time");
  assert.equal(A.jourDepartLogement(avec({ "return-a": "gone" }), D, "return-a"), null);
});

test("departsEtape: every departure from a stage's lodging, earliest first", () => {
  const q = A.departsEtape(defaut(), D, "porto");
  assert.deepEqual(q.map((x) => [x.trajet, x.heure]), [["return-b", "06:25"], ["return-a", "07:05"]]);
  assert.deepEqual(A.departsEtape(defaut(), D, "comporta").map((x) => x.trajet), ["comporta-porto"]);
  assert.deepEqual(A.departsEtape(defaut(), D, "lisbon"), [], "the ground trip has no flight time");
});

test("rule 2: check-in comes from the trip's rules", () => {
  const D2 = variante(D, (x) => { x.trip.rules.checkin_min = 150; });
  assert.equal(A.departLogement(defaut(), D2, "comporta-porto").heure, "11:00");
});

// ------------------------------------------------------------------------------------------------ rule 3: outings on travel days

test("rule 3: an outing on a travel day -> attention; with jour_trajet_ok -> nothing", () => {
  const al = A.alertes(avec({ sorties: { "lisbon-azulejo-workshop": { jour: "2027-06-15" } } }), D);
  const a = trouve(al, "jour-trajet-lisbon-azulejo-workshop");
  assert.ok(a);
  assert.equal(a.etape, "lisbon");
  assert.match(a.solution, /Jun 1[67]/, "moves it to a free day");
  assert.deepEqual(A.alertes(avec({ sorties: { "lisbon-alfama-walk": { jour: "2027-06-15" } } }), D), []);
});

test("rule 3: the four travel days, and only them", () => {
  const D2 = avecSortie(D, "porto-cellar-tasting", { jour_trajet_ok: false });
  const jours = [];
  for (let d = "2027-06-21"; d <= "2027-06-24"; d = H.plusJours(d, 1)) {
    const al = A.alertes(avec({ sorties: { "porto-cellar-tasting": { jour: d } } }), D2);
    if (trouve(al, "jour-trajet-porto-cellar-tasting")) jours.push(d);
  }
  assert.deepEqual(jours, ["2027-06-21", "2027-06-24"]);
});

test("rule 3: an outing that ends after someone leaves the lodging that day, even a fixed-date one", () => {
  const D2 = avecHoraires(D, "return-b", D.defaut["return-b"], "2027-06-23T23:30", "2027-06-24T07:15");
  const al = A.alertes(choixDe(D2, { speciales: { "sao-joao": "porto-fireworks-dinner" } }), D2);
  const a = trouve(al, "jour-trajet-porto-fireworks-dinner");
  assert.ok(a, al.map((x) => x.cle).join());
  assert.match(a.texte, /21:35/);
  assert.match(a.solution, /fixed date/);
});

test("rule 3: a fixed-date outing on a travel day is flagged even without a chosen day", () => {
  const D2 = avecSortie(D, "lisbon-azulejo-workshop", { date_fixe: "2027-06-18" }); // the day of the ground trip to Comporta
  const a = trouve(A.alertes(avec({ sorties: { "lisbon-azulejo-workshop": { jour: null } } }), D2), "jour-trajet-lisbon-azulejo-workshop");
  assert.ok(a);
  assert.equal(a.etape, "lisbon");
  assert.match(a.texte, /Jun 18/);
  assert.match(a.texte, /Lisbon → Comporta/);
  assert.match(a.solution, /fixed date/);
  forme([a]);
});

test("the alerts see the same program as the day by day: outings without a chosen day are seen where days.js puts them", () => {
  const D2 = variante(D, (x) => {
    const s = H.sortie(x, "lisbon-tasca-miradouro");
    for (let i = 2; i <= 4; i++) x.lieux.lisbon.sorties.push(Object.assign(copie(s), { id: `tasca-${i}` }));
  });
  // four evening outings for four days, two of them travel days: the alerts follow days.js, without double counting
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: null }, "tasca-2": { jour: null }, "tasca-3": { jour: null }, "tasca-4": { jour: null }, "lisbon-rooftop-tejo": false } });
  const al = A.alertes(c, D2);
  forme(al);
  assert.equal(al.filter((x) => x.cle.startsWith("meme-moment-")).length, 0);
});

// ------------------------------------------------------------------------------------------------ rule 3b: outside your days

test("rule 3b: a chosen day outside your days (everyone lands on Jun 16) -> attention, kept in the budget", () => {
  let D2 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2027-06-16T07:10", "2027-06-16T19:00");
  D2 = avecHoraires(D2, "arrive-b", D.defaut["arrive-b"], "2027-06-16T08:05", "2027-06-16T19:25");
  const c = choixDe(D2, { sorties: { "lisbon-alfama-walk": { jour: "2027-06-15" } } });
  const a = trouve(A.alertes(c, D2), "hors-dates-lisbon-alfama-walk");
  assert.ok(a);
  assert.match(a.texte, /still counted/);
  assert.ok(B.lignesVoyage(c, D2).some((l) => l.cle === "lisbon-alfama-walk"));
});

test("rule 3b: a chosen day after you leave the hotel (everyone flies home a day earlier) -> attention, kept in the budget", () => {
  let D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-23T09:00", "2027-06-23T16:40");
  D2 = avecHoraires(D2, "return-b", D.defaut["return-b"], "2027-06-23T08:20", "2027-06-23T15:45");
  const c = choixDe(D2, { sorties: { "porto-cellar-tasting": { jour: "2027-06-24" } } });
  const p = J.placementSorties(c, D2);
  assert.deepEqual(p.horsDates, ["porto-cellar-tasting"]);
  assert.deepEqual(p.impossibles, [], "another day in Porto fits");
  const a = trouve(A.alertes(c, D2), "hors-dates-porto-cellar-tasting");
  assert.ok(a);
  assert.equal(a.niveau, "attention");
  assert.equal(a.etape, "porto");
  assert.match(a.texte, /Jun 24/);
  assert.match(a.texte, /Jun 23/, "your days in Porto now end on Jun 23");
  assert.match(a.texte, /still counted/);
  assert.match(a.solution, /Jun 22/, "the free day left in Porto");
  assert.ok(B.lignesVoyage(c, D2).some((l) => l.cle === "porto-cellar-tasting"));
});

test("rule 3b: a fixed date outside your days -> attention, neither in the day by day nor in the budget", () => {
  const D2 = avecSortie(D, "porto-cellar-tasting", { date_fixe: "2027-06-19" });
  const c = avec({ sorties: { "porto-cellar-tasting": { jour: null } } });
  const a = trouve(A.alertes(c, D2), "hors-dates-porto-cellar-tasting");
  assert.ok(a);
  assert.match(a.texte, /Jun 19/);
  assert.match(a.texte, /Porto/);
  assert.equal(B.lignesVoyage(c, D2).some((l) => l.cle === "porto-cellar-tasting"), false);
});

// ------------------------------------------------------------------------------------------------ rule 4: dates of the first arrival and the last return

test("rule 4: return on Jun 26 -> 2 extra nights in Porto at the average night price", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  const a = trouve(A.alertes(defaut(), D2), "date-return-a");
  assert.ok(a);
  assert.equal(a.etape, "retour");
  assert.equal(a.niveau, "attention");
  assert.match(a.texte, /2 × \$220 = \$440/);
  assert.match(a.texte, /Jun 26/);
  assert.equal(a.ligne.cle, "nuit-en-plus");
  assert.match(a.solution, /Jun 24/);
});

test("rule 4: everyone back a day earlier -> a lost night; Alex a day early -> an extra night", () => {
  let D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-23T09:00", "2027-06-23T16:40");
  D2 = avecHoraires(D2, "return-b", D.defaut["return-b"], "2027-06-23T08:20", "2027-06-23T15:45");
  const perdue = A.alertes(defaut(), D2).find((x) => x.cle.startsWith("date-"));
  assert.ok(perdue);
  assert.match(perdue.texte, /will not be used/);
  const tot = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2027-06-14T07:10", "2027-06-14T19:00");
  const a = trouve(A.alertes(defaut(), tot), "date-arrive-a");
  assert.ok(a);
  assert.equal(a.etape, "aller");
  assert.match(a.texte, /Alex/);
  assert.match(a.texte, /Jun 14/);
});

test("rule 4: unknown average price -> 'price to check', never NaN nor 0", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  const c = avec({ porto: "porto-02" });
  const D3 = variante(D2, (x) => { const l = H.logement(x, "porto", "porto-02"); l.prix.total_home = null; l.prix.nuit_home = null; });
  const a = trouve(A.alertes(c, D3), "date-return-a");
  assert.ok(a);
  assert.match(a.texte, /price to check/);
  forme([a]);
});

test("rule 4: the same flights on the planned day first, else the cheapest that fits", () => {
  // TP9031 + TP9032 moved one day later: the same flights exist on the planned day (Jun 24)? no -> the cheapest fitting one
  const D2 = avecHoraires(D, "return-a", TP_RET, "2027-06-25T10:00", "2027-06-25T17:00");
  const a = trouve(A.alertes(avec({ "return-a": TP_RET }), D2), "date-return-a");
  assert.ok(a);
  assert.match(a.solution, /IB9033 \+ IB9034/);
});

// ------------------------------------------------------------------------------------------------ rule 5: arrivals at the same stage far apart

test("arrival gap alert names both travelers", () => {
  // Alex lands 3 h after Sam (Sam 19:25 local)
  const D2 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T22:25");
  const al = A.alertes(defaut(), D2);
  const a = al.find((x) => x.cle.startsWith("ecart-arrivee-"));
  assert.ok(a, al.map((x) => x.cle).join());
  assert.equal(a.cle, "ecart-arrivee-arrive-a");
  assert.equal(a.niveau, "attention");
  assert.equal(a.etape, "aller");
  assert.match(a.texte, /Alex/);
  assert.match(a.texte, /Sam/);
  assert.match(a.texte, /3 h/);
  forme([a]);
});

test("rule 5: the gap threshold comes from rules.arrival_gap_min (30 min: 30 nothing, 31 yes)", () => {
  const a30 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T19:55"); // Sam 19:25
  assert.equal(A.alertes(defaut(), a30).filter((x) => x.cle.startsWith("ecart-arrivee-")).length, 0);
  const a31 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T19:56");
  assert.ok(trouve(A.alertes(defaut(), a31), "ecart-arrivee-arrive-a"));
  const large = variante(a31, (x) => { x.trip.rules.arrival_gap_min = 60; });
  assert.equal(trouve(A.alertes(defaut(), large), "ecart-arrivee-arrive-a"), undefined);
});

test("rule 5: hours and minutes are written in the language's form ('2 h 05')", () => {
  const D2 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T21:30"); // Sam 19:25: 125 min
  assert.match(trouve(A.alertes(defaut(), D2), "ecart-arrivee-arrive-a").texte, /2 h 05 after Sam/);
  H.preparerI18n(D, "fr");
  try {
    assert.match(trouve(A.alertes(defaut(), D2), "ecart-arrivee-arrive-a").texte, /2 h 05 après Sam/);
  } finally {
    H.preparerI18n(D, "en");
  }
});

test("rule 5: arrivals on different days -> no wait at the airport", () => {
  const D2 = avecHoraires(D, "arrive-b", D.defaut["arrive-b"], "2027-06-16T08:05", "2027-06-16T19:25");
  assert.equal(A.alertes(defaut(), D2).filter((x) => x.cle.startsWith("ecart-arrivee-")).length, 0);
});

test("rule 5: proposes a flight for the late traveler that lands in time", () => {
  const al = A.alertes(avec({ "arrive-b": "arrive-b-20270615-AF9012-AF9013" }), D); // Sam lands 23:10, Alex 19:00
  const a = trouve(al, "ecart-arrivee-arrive-b");
  assert.ok(a);
  assert.match(a.solution, /AC9011/);
  assert.match(a.solution, /Sam/);
});

// ------------------------------------------------------------------------------------------------ rule 6: two outings at the same moment

const avecSoirs = (n) => variante(D, (x) => {
  const s = H.sortie(x, "lisbon-tasca-miradouro");
  for (let i = 2; i <= n; i++) x.lieux.lisbon.sorties.push(Object.assign(copie(s), { id: `tasca-${i}`, nom: `Tasca ${i}` }));
});

test("rule 6: two outings on the same day at the same moment -> attention", () => {
  const D2 = avecSoirs(2);
  const al = A.alertes(avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "tasca-2": { jour: "2027-06-16" } } }), D2);
  const a = trouve(al, "meme-moment-2027-06-16-soir");
  assert.ok(a);
  assert.match(a.texte, /Tasca 2/);
  assert.match(a.solution, /Jun 17/);
});

test("rule 6: different moments the same day, or the same moment two different days -> nothing", () => {
  const D2 = avecSoirs(2);
  assert.deepEqual(A.alertes(avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "tasca-2": { jour: "2027-06-17" } } }), D2), []);
  assert.deepEqual(A.alertes(avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "lisbon-alfama-walk": { jour: "2027-06-16" } } }), D2), []);
});

test("rule 6: the special evening (fixed date) and a chosen outing at the same moment -> move the one without a fixed date", () => {
  const D2 = avecSortie(D, "porto-douro-cruise", { moment: "soir" });
  const c = avec({ speciales: { "sao-joao": "porto-fireworks-dinner" }, sorties: { "porto-douro-cruise": { jour: "2027-06-23" } } });
  const a = trouve(A.alertes(c, D2), "meme-moment-2027-06-23-soir");
  assert.ok(a);
  assert.equal(a.etape, "porto");
  assert.ok(a.texte.includes("Cais Dinner on São João night"), a.texte);
  assert.ok(a.texte.includes("Small-boat Douro cruise"), a.texte);
  assert.match(a.solution, /^Move “Small-boat Douro cruise[^”]*” to Jun 22/, a.solution);
});

test("rule 6: three outings at the same moment -> one alert naming all of them", () => {
  const D2 = avecSoirs(3);
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "tasca-2": { jour: "2027-06-16" }, "tasca-3": { jour: "2027-06-16" } } });
  const al = A.alertes(c, D2).filter((x) => x.cle.startsWith("meme-moment-"));
  assert.equal(al.length, 1);
  for (const n of ["Tasca do Miradouro", "Tasca 2", "Tasca 3"]) assert.ok(al[0].texte.includes(n), n);
});

test("rule 6: two fixed-date outings at the same moment -> keep only one", () => {
  const D2 = variante(D, (x) => {
    const s = H.sortie(x, "porto-cellar-tasting");
    s.date_fixe = "2027-06-22";
    x.lieux.porto.sorties.push(Object.assign(copie(s), { id: "porto-cellar-2", nom: "Second cellar" }));
  });
  const a = A.alertes(avec({ sorties: { "porto-cellar-tasting": { jour: null }, "porto-cellar-2": { jour: null } } }), D2)
    .find((x) => x.cle.startsWith("meme-moment-"));
  assert.ok(a);
  assert.match(a.solution, /fixed dates/);
});

test("rule 6: a full-day outing and a dawn outing the same day -> attention", () => {
  const D2 = avecSortie(D, "comporta-rice-field-cycle", {});
  const al = A.alertes(avec({ sorties: { "comporta-dune-grill": { jour: "2027-06-19" }, "comporta-rice-field-cycle": { jour: "2027-06-19" } } }), D2);
  assert.ok(trouve(al, "meme-moment-2027-06-19-journee"));
});

// ------------------------------------------------------------------------------------------------ late arrival at the lodging

test("late arrival: an evening flight -> attention with the computed hour and an earlier flight, with the price difference", () => {
  const al = A.alertes(avec({ "arrive-a": AF_ARR }), D); // 23:30 + 60 + 25 = 00:55
  const a = trouve(al, "arrivee-tardive-arrive-a");
  assert.ok(a, al.map((x) => x.cle).join());
  assert.equal(a.etape, "lisbon");
  assert.match(a.texte, /00:55/);
  assert.match(a.texte, /next day/);
  assert.match(a.solution, /TP9001/);
  assert.match(a.solution, /-\$35/);
});

test("late arrival: 22:00 exactly is fine, 22:01 is not; never for a return; not on top of a missed last transport", () => {
  const ok = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T20:35"); // 20:35 + 85 = 22:00
  assert.equal(trouve(A.alertes(defaut(), ok), "arrivee-tardive-arrive-a"), undefined);
  const tard = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], null, "2027-06-15T20:36");
  assert.ok(trouve(A.alertes(defaut(), tard), "arrivee-tardive-arrive-a"));
  assert.ok(!A.alertes(defaut(), tard).some((x) => /tardive-return/.test(x.cle)));
  const bloque = avecAcces(tard, "lisbon", "lisbon-01", { dernier_public: "21:00" });
  const al = A.alertes(defaut(), bloque);
  assert.ok(trouve(al, "arrivee-arrive-a"));
  assert.equal(trouve(al, "arrivee-tardive-arrive-a"), undefined);
});

test("late arrival: no earlier flight in the data -> the solution says it without inventing one", () => {
  const D2 = variante(D, (x) => { x.vols["arrive-a"].options = x.vols["arrive-a"].options.filter((o) => o.id === AF_ARR); });
  const a = trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D2), "arrivee-tardive-arrive-a");
  assert.ok(a);
  assert.doesNotMatch(a.solution, /TP9001|IB9002/);
  assert.match(a.solution, /lodging/);
});

test("price difference: the checked bag counts, as in the budget", () => {
  // AF lands late; TP9001 lands in time. AF's bag supplement unknown: the difference says the bag is to check
  const D2 = variante(D, (x) => { H.option(x, "arrive-a", AF_ARR).valise = { comprise: false, ajout_home: null }; });
  const a = trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D2), "arrivee-tardive-arrive-a");
  assert.match(a.solution, /-\$35 compared with this flight \(checked bag to check\)/);
  // a known bag supplement line is added to the price
  const D3 = variante(D, (x) => {
    const o = H.option(x, "arrive-a", "arrive-a-20270615-TP9001");
    o.lignes.push({ n: 1, u: 40, lib: "checked bag", src: "direct", quand: "avant", etape: "vols", poste: "vols", cle: "valise" });
  });
  assert.match(trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D3), "arrivee-tardive-arrive-a").solution, /\+\$5 compared with this flight/);
});

test("a lodging whose road time is given from another airport: the alert says so, without inventing a duration", () => {
  const D2 = avecAcces(D, "porto", "porto-01", { aeroport: "LIS", dernier_public: "17:00" });
  const a = trouve(A.alertes(defaut(), D2), "arrivee-comporta-porto");
  assert.ok(a);
  assert.match(a.texte, /computed from Lisbon \(LIS\); this flight lands at Porto \(OPO\) \(to check\)/);
});

test("late arrival: unknown price of the proposed flight -> 'price difference to check'", () => {
  const D2 = variante(D, (x) => {
    const o = H.option(x, "arrive-a", "arrive-a-20270615-TP9001");
    o.lignes = [];
    o.prix_home = null;
  });
  const a = trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D2), "arrivee-tardive-arrive-a");
  assert.match(a.solution, /price difference to check/);
});

test("a landing after midnight (00:00 - 05:00) ends the evening, it is not a morning flight", () => {
  const D2 = avecHoraires(avecAcces(D, "lisbon", "lisbon-01", COMPORTA), "arrive-a", AF_ARR, null, "2027-06-16T00:40");
  const a = trouve(A.alertes(avec({ "arrive-a": AF_ARR }), D2), "arrivee-arrive-a");
  assert.ok(a);
  assert.match(a.texte, /in the middle of the night/);
});

// ------------------------------------------------------------------------------------------------ robustness

test("partial or empty choice: absent fields take the defaults", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  assert.deepEqual(A.alertes({ "arrive-a": D.defaut["arrive-a"] }, D2).map((x) => x.cle), A.alertes(copie(D2.defaut), D2).map((x) => x.cle));
});

test("incomplete data: stage not loaded, unknown flight or lodging, nothing breaks", () => {
  const D2 = variante(D, (x) => { delete x.lieux.comporta; });
  forme(A.alertes(defaut(), D2));
  forme(A.alertes(avec({ "comporta-porto": "gone", porto: "gone", sorties: { gone: { jour: "2027-06-22" } } }), D));
  assert.deepEqual(A.alertes(null, { trip: D.trip }), []);
});

test("sweep: every option of every leg, every lodging of every stage -> well-formed alerts", () => {
  for (const leg of D.trip.legs) {
    for (const o of D.vols[leg.key].options) forme(A.alertes(avec({ [leg.key]: o.id }), D));
  }
  for (const s of D.trip.stages) {
    for (const l of D.lieux[s.key].logements.concat(D.lieux[s.key].autres)) forme(A.alertes(avec({ [s.key]: l.id }), D));
  }
});

test("a lodging without public transport never has a first or last transport alert", () => {
  for (const leg of ["return-a", "return-b"]) {
    for (const o of D.vols[leg].options) {
      assert.ok(!A.alertes(avec({ [leg]: o.id }), D).some((x) => x.cle.startsWith("depart-dernier-transport-")), o.id);
    }
  }
});

test("loaded as classic scripts (the page): global functions, no name conflict", () => {
  const PAGE = path.join(__dirname, "..", "..", "page");
  const ctx = vm.createContext({ console });
  const fichiers = ["js/i18n.js", "i18n/en.js", "i18n/fr.js", "js/logic/alerts.js", "js/logic/budget.js", "js/logic/config.js", "js/logic/days.js", "js/logic/plan.js"];
  for (const f of fichiers) vm.runInContext(fs.readFileSync(path.join(PAGE, f), "utf8"), ctx, { filename: f });
  for (const f of ["alertes", "lignesVoyage", "jourParJour", "planItems", "creerTrip", "sortiesComptees", "departsEtape"]) {
    assert.equal(vm.runInContext(`typeof ${f}`, ctx), "function", f);
  }
  ctx.D = chargerDonnees();
  ctx.TRIP = vm.runInContext("creerTrip(D)", ctx);
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  ctx.D2 = D2;
  const al = vm.runInContext("alertes(D2.defaut, D2)", ctx);
  assert.deepEqual(Array.from(al, (x) => x.cle), A.alertes(copie(D2.defaut), D2).map((x) => x.cle)); // vm arrays: another realm
  assert.ok(vm.runInContext("planItems(D.defaut, D, '2026-11-07').length > 5", ctx));
});
