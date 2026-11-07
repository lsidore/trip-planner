// Day by day (page/js/logic/days.js), on the sample trip (tests/fixtures/sample-built).
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const J = require("../../page/js/logic/days.js");

const { chargerDonnees, copie, variante, avecSortie, avecHoraires, plusJours } = H;
const D = chargerDonnees();
const defaut = () => copie(D.defaut);
const avec = (patch) => Object.assign(defaut(), patch);
const sorties = (...ids) => Object.fromEntries(ids.map((id) => [id, { jour: null }]));
const carte = (jours, date) => jours.find((j) => j.date === date);
const TRAJETS = ["2027-06-15", "2027-06-18", "2027-06-21", "2027-06-24"];
const premier = (o) => o.segments[0];
const dernier = (o) => o.segments[o.segments.length - 1];
const vol = (leg, c) => H.option(D, leg, (c || D.defaut)[leg]);
const transferts = (lignes) => lignes.filter((l) => /^Transfer/.test(l));

/** Copy of D with copies of an outing (new ids), to have several outings of the same kind at one stage. */
function avecCopies(D0, id, n, patch) {
  return variante(D0, (x) => {
    const s = H.sortie(x, id);
    if (patch) Object.assign(s, patch);
    for (let i = 2; i <= n; i++) x.lieux[s.etape].sorties.push(Object.assign(copie(s), { id: `${id}-${i}` }));
  });
}

test("ten days, from Jun 15 to Jun 24, without gap; the shape of a card", () => {
  const jours = J.jourParJour(defaut(), D);
  assert.equal(jours.length, 10);
  assert.equal(jours[0].date, "2027-06-15");
  assert.equal(jours[9].date, "2027-06-24");
  for (let i = 1; i < jours.length; i++) assert.equal(jours[i].date, plusJours(jours[i - 1].date, 1));
  for (const j of jours) {
    assert.deepEqual(Object.keys(j).slice(0, 8), ["date", "etape", "dort", "lever", "coucher", "trajets", "sorties", "libre"]);
    assert.equal(typeof j.libre, "boolean");
    H.propre(j, j.date);
  }
});

test("where you sleep, stage and sun of each day", () => {
  const c = defaut();
  const jours = J.jourParJour(c, D);
  assert.equal(carte(jours, "2027-06-15").dort, c.lisbon);
  assert.equal(carte(jours, "2027-06-17").dort, c.lisbon);
  assert.equal(carte(jours, "2027-06-18").dort, c.comporta, "on the evening of the 18th you sleep in Comporta");
  assert.equal(carte(jours, "2027-06-21").dort, c.porto);
  assert.equal(carte(jours, "2027-06-23").dort, c.porto);
  assert.equal(carte(jours, "2027-06-24").dort, null, "the last day you go home");
  assert.deepEqual([...new Set(jours.map((j) => j.etape))], ["lisbon", "comporta", "porto"]);
  for (const j of jours) {
    const source = D.jours.find((x) => x.date === j.date);
    assert.equal(j.lever, source.lever);
    assert.equal(j.coucher, source.coucher);
    assert.equal(j.etape, source.etape);
  }
  assert.equal(carte(jours, "2027-06-19").dort_nom, H.logement(D, "comporta", c.comporta).nom);
});

test("arrival day: both flights to Lisbon, then one transfer", () => {
  const t = carte(J.jourParJour(defaut(), D), "2027-06-15").trajets;
  const a = premier(vol("arrive-a")).vol;
  const b = premier(vol("arrive-b")).vol;
  assert.ok(t.some((l) => l.includes(a) && /Lisbon \(LIS\)/.test(l) && /^Alex/.test(l)), t.join(" | "));
  assert.ok(t.some((l) => l.includes(b) && /^Sam/.test(l)), t.join(" | "));
  assert.equal(transferts(t).length, 1, "one transfer for both, they land at the same airport the same evening");
  assert.ok(/^Transfer/.test(t[t.length - 1]), "the transfer comes after the landings");
  assert.ok(!t.some((l) => /\b[ap]m\b/i.test(l)), "24 h times");
});

test("the other travel days carry the ground trip, the flight and the transfers", () => {
  const jours = J.jourParJour(defaut(), D);
  const t18 = carte(jours, "2027-06-18").trajets;
  assert.equal(t18.length, 1);
  assert.match(t18[0], /Rental car/);
  assert.match(t18[0], /10:00/);
  const t21 = carte(jours, "2027-06-21").trajets;
  assert.ok(t21.some((l) => l.includes(premier(vol("comporta-porto")).vol)));
  assert.equal(transferts(t21).length, 2, "lodging -> airport, then airport -> Porto lodging");
  const t24 = carte(jours, "2027-06-24").trajets;
  assert.ok(t24.some((l) => l.includes(premier(vol("return-a")).vol) && /^Alex/.test(l)));
  assert.ok(t24.some((l) => l.includes(premier(vol("return-b")).vol) && /^Sam/.test(l)));
  assert.equal(transferts(t24).length, 2, "one transfer per return flight");
  for (const j of jours) if (!TRAJETS.includes(j.date)) assert.deepEqual(j.trajets, [], "no trip on " + j.date);
});

test("transfer lines name any access mode; the last public departure is a boat only for boats and ferries", () => {
  const D2 = H.avecAcces(D, "lisbon", "lisbon-01", { mode: "train", dernier_public: "23:50" });
  const t = transferts(carte(J.jourParJour(defaut(), D2), "2027-06-15").trajets).join(" | ");
  assert.match(t, /by train/);
  assert.match(t, /last public transport at 23:50/);
  const D3 = H.avecAcces(D, "lisbon", "lisbon-01", { mode: "metro+ferry", dernier_public: "23:50" });
  const u = transferts(carte(J.jourParJour(defaut(), D3), "2027-06-15").trajets).join(" | ");
  assert.match(u, /by metro then by boat/);
  assert.match(u, /last public boat at 23:50/);
});

test("transfer times: landing + 60 min + road; departure - check-in - road", () => {
  const t21 = carte(J.jourParJour(defaut(), D), "2027-06-21").trajets;
  // FR9022 leaves LIS at 15:15: 15:15 - 90 min check-in - 1 h 45 road = 12:00; lands OPO 16:10 + 60 + 25 = 17:35
  const dep = transferts(t21).find((l) => /Herdade do Sal/.test(l.split("→")[0]));
  assert.ok(dep && dep.includes("12:00"), t21.join(" | "));
  const arr = transferts(t21).find((l) => /Casa da Ribeira/.test(l));
  assert.ok(arr && arr.includes("17:35"), t21.join(" | "));
  // check-in follows the trip's rules
  const D2 = variante(D, (x) => { x.trip.rules.checkin_min = 120; });
  const t2 = carte(J.jourParJour(defaut(), D2), "2027-06-21").trajets;
  assert.ok(transferts(t2).some((l) => l.includes("11:30")), t2.join(" | "));
});

test("a dawn outing is never placed the day after the last arrival", () => {
  const D2 = avecCopies(D, "lisbon-alfama-walk", 3, { moment: "aube" });
  const ids = ["lisbon-alfama-walk", "lisbon-alfama-walk-2", "lisbon-alfama-walk-3"];
  const p = J.placerSorties(avec({ sorties: sorties(...ids) }), D2);
  assert.equal(Object.keys(p).length, 3);
  for (const id of ids) assert.notEqual(p[id], "2027-06-16", id);
});

test("two full-day outings of a stage fall on two different days", () => {
  const D2 = avecCopies(D, "comporta-dune-grill", 2);
  const p = J.placerSorties(avec({ sorties: sorties("comporta-dune-grill", "comporta-dune-grill-2") }), D2);
  assert.notEqual(p["comporta-dune-grill"], p["comporta-dune-grill-2"]);
});

// Lisbon: Jun 15 (landing) and Jun 18 (ground leg to Comporta) are travel days; Jun 16 and 17 are ordinary days.
// Comporta: Jun 18 and 21 (flight to Porto) are travel days; Jun 19 and 20 are ordinary.

test("hard rules before preferences: a dawn outing shares its moment rather than take the day after the landing", () => {
  // the alfama walk becomes a dawn outing without jour_trajet_ok, a copy of it is chosen on Jun 17:
  // Jun 15 and 18 (travel days) and Jun 16 (the day after the landing) break a rule, Jun 17 only collides
  const D2 = avecCopies(D, "lisbon-alfama-walk", 2, { moment: "aube", jour_trajet_ok: false });
  const c = avec({ sorties: { "lisbon-alfama-walk-2": { jour: "2027-06-17" }, "lisbon-alfama-walk": { jour: null } } });
  assert.equal(J.placerSorties(c, D2)["lisbon-alfama-walk"], "2027-06-17");
});

test("with no constraint, an outing goes to the earliest free day, then to the least busy one", () => {
  // the alfama walk (morning, travel days allowed): Jun 16, the first ordinary day
  assert.equal(J.placerSorties(avec({ sorties: sorties("lisbon-alfama-walk") }), D)["lisbon-alfama-walk"], "2027-06-16");
  // an evening already on Jun 16: Jun 17 is less busy, even though later
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "lisbon-alfama-walk": { jour: null } } });
  assert.equal(J.placerSorties(c, D)["lisbon-alfama-walk"], "2027-06-17");
});

test("a travel day gets nothing while an ordinary day remains, even with no outing at the same moment", () => {
  // the alfama walk is allowed on travel days; Jun 16 and 17 already hold an outing (other moments), Jun 15 is empty
  const c = avec({ sorties: {
    "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "lisbon-rooftop-tejo": { jour: "2027-06-17" }, "lisbon-alfama-walk": { jour: null },
  } });
  const p = J.placerSorties(c, D);
  assert.ok(["2027-06-16", "2027-06-17"].includes(p["lisbon-alfama-walk"]), p["lisbon-alfama-walk"]);
});

test("a full-day or dawn outing avoids the day before a travel day, even when that day is the least busy", () => {
  // full day in Lisbon: Jun 17 is the eve of the trip to Comporta; Jun 16 already has an evening outing, it is still chosen
  const D2 = avecSortie(D, "lisbon-alfama-walk", { moment: "journee" });
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "lisbon-alfama-walk": { jour: null } } });
  assert.equal(J.placerSorties(c, D2)["lisbon-alfama-walk"], "2027-06-16");
  // dawn in Comporta: Jun 20 is the eve of the flight to Porto; Jun 19 already has the sunset boat, it is still chosen
  const c2 = avec({ sorties: { "comporta-sado-sunset-boat": { jour: "2027-06-19" }, "comporta-rice-field-cycle": { jour: null } } });
  assert.equal(J.placerSorties(c2, D)["comporta-rice-field-cycle"], "2027-06-19");
  // a light outing (morning) has no such rule: the least busy day, the eve of the trip
  const c3 = avec({ sorties: { "lisbon-tasca-miradouro": { jour: "2027-06-16" }, "lisbon-alfama-walk": { jour: null } } });
  assert.equal(J.placerSorties(c3, D)["lisbon-alfama-walk"], "2027-06-17");
});

test("a special evening outing stays on its date", () => {
  const p = J.placerSorties(avec({ speciales: { "sao-joao": "porto-fireworks-dinner" } }), D);
  assert.deepEqual(p, { "porto-fireworks-dinner": "2027-06-23" });
  const jours = J.jourParJour(avec({ speciales: { "sao-joao": "porto-fireworks-dinner" } }), D);
  assert.deepEqual(carte(jours, "2027-06-23").sorties, ["porto-fireworks-dinner"]);
});

test("days place sorties on stage dates", () => {
  const ids = ["lisbon-tasca-miradouro", "lisbon-alfama-walk", "lisbon-azulejo-workshop", "comporta-dune-grill",
    "comporta-rice-field-cycle", "comporta-sado-sunset-boat", "porto-cellar-tasting", "porto-douro-cruise"];
  const c = avec({ sorties: sorties(...ids) });
  const p = J.placementSorties(c, D);
  assert.deepEqual(Object.keys(p.jours).sort(), ids.slice().sort());
  assert.deepEqual(p.horsDates, []);
  for (const id of ids) {
    const st = D.trip.stages.find((s) => s.key === H.etapeDeSortie(D, id));
    assert.ok(p.jours[id] >= st.from && p.jours[id] <= st.to, `${id} on ${p.jours[id]}`);
  }
  assert.deepEqual(p.fenetres.lisbon, { du: "2027-06-15", au: "2027-06-18" });
  assert.deepEqual(p.fenetres.porto, { du: "2027-06-21", au: "2027-06-24" });
  // deterministic, whatever the key order
  const inverse = avec({ sorties: sorties(...ids.slice().reverse()) });
  assert.deepEqual(J.placerSorties(inverse, D), p.jours);
  assert.deepEqual(J.placerSorties(c, D), p.jours);
});

test("chosen days are kept; never a travel day without jour_trajet_ok", () => {
  const c = avec({ sorties: { "lisbon-alfama-walk": { jour: "2027-06-15" }, "lisbon-azulejo-workshop": { jour: null }, "comporta-sado-sunset-boat": { jour: null } } });
  const p = J.placerSorties(c, D);
  assert.equal(p["lisbon-alfama-walk"], "2027-06-15");
  assert.ok(!TRAJETS.includes(p["lisbon-azulejo-workshop"]), p["lisbon-azulejo-workshop"]);
  assert.ok(!TRAJETS.includes(p["comporta-sado-sunset-boat"]), p["comporta-sado-sunset-boat"]);
});

test("an outing that happens only on some days goes only there; otherwise horsDates", () => {
  const D2 = avecSortie(D, "lisbon-alfama-walk", { dates: ["2027-06-17"] });
  assert.equal(J.placerSorties(avec({ sorties: sorties("lisbon-alfama-walk") }), D2)["lisbon-alfama-walk"], "2027-06-17");
  const D3 = avecSortie(D, "lisbon-alfama-walk", { dates: ["2027-06-20"] });
  const p = J.placementSorties(avec({ sorties: sorties("lisbon-alfama-walk") }), D3);
  assert.equal(p.jours["lisbon-alfama-walk"], undefined);
  assert.deepEqual(p.horsDates, ["lisbon-alfama-walk"]);
  assert.deepEqual(p.impossibles, ["lisbon-alfama-walk"]);
});

test("a fixed date outside its stage: not placed, returned in horsDates", () => {
  const D2 = avecSortie(D, "porto-cellar-tasting", { date_fixe: "2027-06-19" });
  const c = avec({ sorties: sorties("porto-cellar-tasting") });
  assert.deepEqual(J.sortiesHorsDates(c, D2), ["porto-cellar-tasting"]);
  assert.deepEqual(J.placerSorties(c, D2), {});
});

test("inconsistent choices: unknown id, unticked outing, malformed day", () => {
  const c = avec({ sorties: { "no-such-outing": { jour: null }, "lisbon-tasca-miradouro": false, "lisbon-alfama-walk": { jour: "16 June" } } });
  const p = J.placerSorties(c, D);
  assert.deepEqual(Object.keys(p), ["lisbon-alfama-walk"]);
  assert.ok(p["lisbon-alfama-walk"] >= "2027-06-15" && p["lisbon-alfama-walk"] <= "2027-06-18");
});

test("the outings of a card follow the day: dawn, morning, afternoon, sunset, evening", () => {
  const c = avec({ sorties: {
    "lisbon-tasca-miradouro": { jour: "2027-06-17" }, "lisbon-rooftop-tejo": { jour: "2027-06-17" },
    "lisbon-azulejo-workshop": { jour: "2027-06-17" }, "lisbon-alfama-walk": { jour: "2027-06-17" },
  } });
  const s = carte(J.jourParJour(c, D), "2027-06-17").sorties;
  assert.deepEqual(s, ["lisbon-alfama-walk", "lisbon-azulejo-workshop", "lisbon-rooftop-tejo", "lisbon-tasca-miradouro"]);
});

test("free day: no trip and no outing", () => {
  const jours = J.jourParJour(defaut(), D);
  assert.equal(carte(jours, "2027-06-16").libre, true);
  assert.equal(carte(jours, "2027-06-15").libre, false);
});

test("JoursLogic.finMoment: the hour each moment is over, in the order of the day", () => {
  const m = ["aube", "matin", "journee", "coucher", "soir"].map(J.finMoment);
  assert.deepEqual(m, m.slice().sort((a, b) => a - b));
  assert.equal(J.finMoment("soir"), 22 * 60 + 30);
  assert.equal(J.finMoment("unknown"), null);
});

// ------------------------------------------------------------------------------------------------ arrival and return on other days

test("one traveler a day early: an extra night that names them; everyone late: a lost night", () => {
  const tot = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2027-06-14T07:10", "2027-06-14T19:00");
  const jours = J.jourParJour(copie(tot.defaut), tot);
  assert.equal(jours[0].date, "2027-06-14");
  assert.equal(jours[0].etape, "lisbon");
  assert.equal(jours[0].ecart, "extra night");
  assert.ok(jours[0].notes.some((n) => /Alex/.test(n) && /Jun 14/.test(n)), jours[0].notes.join(" | "));
  // Sam arrives a day late, Alex on time: no lost night, but a note for the night without Sam
  const unTard = avecHoraires(D, "arrive-b", D.defaut["arrive-b"], "2027-06-16T08:05", "2027-06-16T19:25");
  const j2 = J.jourParJour(copie(unTard.defaut), unTard);
  assert.equal(j2[0].date, "2027-06-15");
  assert.equal(j2[0].ecart, null);
  assert.ok(j2[0].notes.some((n) => /Sam/.test(n)), j2[0].notes.join(" | "));
  const tousTard = avecHoraires(unTard, "arrive-a", D.defaut["arrive-a"], "2027-06-16T07:10", "2027-06-16T19:00");
  const j3 = J.jourParJour(copie(tousTard.defaut), tousTard);
  assert.equal(j3[0].ecart, "lost night");
  // dawn outings: not the day after the last arrival
  assert.equal(J.placementSorties(copie(unTard.defaut), unTard).fenetres.lisbon.du, "2027-06-16");
});

test("the return leaves another day: extra nights at the last stage, or lost nights, from the day you leave the hotel", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  const jours = J.jourParJour(copie(D2.defaut), D2);
  assert.equal(jours[jours.length - 1].date, "2027-06-26");
  assert.equal(carte(jours, "2027-06-24").ecart, "extra night");
  assert.equal(carte(jours, "2027-06-25").ecart, "extra night");
  assert.equal(carte(jours, "2027-06-25").etape, "porto");
  assert.equal(carte(jours, "2027-06-24").dort, D.defaut.porto, "Alex still sleeps in Porto");
  // everyone leaves on the 23rd
  let D3 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-23T09:00", "2027-06-23T16:40");
  D3 = avecHoraires(D3, "return-b", D.defaut["return-b"], "2027-06-23T08:20", "2027-06-23T15:45");
  const j3 = J.jourParJour(copie(D3.defaut), D3);
  assert.equal(j3[j3.length - 1].date, "2027-06-23");
  assert.ok(j3[j3.length - 1].notes.some((n) => /1 planned night/.test(n)), j3[j3.length - 1].notes.join(" | "));
});

test("a return after midnight: you leave the hotel the evening before; transfer and flight on that evening's card", () => {
  const D2 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-25T00:30", "2027-06-25T08:10");
  const jours = J.jourParJour(copie(D2.defaut), D2);
  assert.equal(jours[jours.length - 1].date, "2027-06-24");
  const t = carte(jours, "2027-06-24").trajets;
  assert.ok(t.some((l) => l.includes("IB9033") && /Jun 25/.test(l)), t.join(" | "));
  assert.ok(transferts(t).some((l) => l.includes("22:35")), t.join(" | "));
  assert.ok(carte(jours, "2027-06-24").notes.some((n) => /22:35/.test(n)), "departure evening note");
});

test("the evening someone leaves the last lodging: only a fixed-date outing stays there in the evening", () => {
  // Sam leaves the hotel at 21:35 on the 23rd (return at 23:30)
  const D2 = avecHoraires(D, "return-b", D.defaut["return-b"], "2027-06-23T23:30", "2027-06-24T07:15");
  const c = Object.assign(copie(D2.defaut), { sorties: sorties("lisbon-tasca-miradouro"), speciales: { "sao-joao": "porto-fireworks-dinner" } });
  const D3 = avecCopies(D2, "porto-douro-cruise", 3, { moment: "soir" });
  const c3 = Object.assign(copie(D3.defaut), { sorties: sorties("porto-douro-cruise", "porto-douro-cruise-2", "porto-douro-cruise-3"), speciales: { "sao-joao": "porto-fireworks-dinner" } });
  assert.equal(J.placerSorties(c, D2)["porto-fireworks-dinner"], "2027-06-23");
  const p = J.placerSorties(c3, D3);
  // nor on the 24th: Alex leaves the hotel that morning (every departure counts, not only the first one)
  for (const id of ["porto-douro-cruise", "porto-douro-cruise-2", "porto-douro-cruise-3"]) assert.ok(!["2027-06-23", "2027-06-24"].includes(p[id]), `${id} on ${p[id]}`);
});

test("a chosen day outside your days (everyone arrives later): horsDates, not impossible when another day fits", () => {
  let D2 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2027-06-16T07:10", "2027-06-16T19:00");
  D2 = avecHoraires(D2, "arrive-b", D.defaut["arrive-b"], "2027-06-16T08:05", "2027-06-16T19:25");
  const c = Object.assign(copie(D2.defaut), { sorties: { "lisbon-alfama-walk": { jour: "2027-06-15" } } });
  const p = J.placementSorties(c, D2);
  assert.deepEqual(p.horsDates, ["lisbon-alfama-walk"]);
  assert.deepEqual(p.impossibles, []);
});

test("missing data: a vanished flight or lodging breaks nothing", () => {
  const jours = J.jourParJour(avec({ "arrive-a": "gone", comporta: "comporta-gone" }), D);
  assert.equal(jours.length, 10);
  assert.equal(carte(jours, "2027-06-19").dort, "comporta-gone", "the id is kept, without a name");
  assert.equal(carte(jours, "2027-06-19").dort_nom, null);
  for (const j of jours) H.propre(j.trajets, j.date);
  // a lodging without a full fiche has no road time: the card says so
  const autre = J.jourParJour(avec({ porto: "porto-02" }), D);
  const t = transferts(carte(autre, "2027-06-21").trajets);
  assert.ok(t.some((l) => /to check/.test(l)), t.join(" | "));
  // no data at all
  assert.ok(Array.isArray(J.jourParJour({}, { trip: D.trip })));
});
