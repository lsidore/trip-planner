// Budget of the trip (page/js/logic/budget.js), on the sample trip (tests/fixtures/sample-built).
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const B = require("../../page/js/logic/budget.js");

const { chargerDonnees, copie, variante, avecSortie, avecHoraires, sansVolsDe, somme, r2, propre } = H;
const D = chargerDonnees();
const defaut = () => copie(D.defaut);
const avec = (patch) => Object.assign(defaut(), patch);
const sorties = (...ids) => Object.fromEntries(ids.map((id) => [id, { jour: null }]));
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.001, `${msg || ""} ${a} != ${b}`.trim());
const montant = (lignes) => r2(somme(lignes.filter((l) => !l.hors_budget).map(B.montantLigne)));
const STAGES = D.trip.stages.map((s) => s.key);
const LEGS = D.trip.legs.map((l) => l.key);
const POSTES = ["vols", "trajets", "logements", "repas", "verres", "bienetre", "activites", "formalites"];

// What the defaults cost, computed here from the data: chosen options' lines, base lines, default lodgings' lines.
function attenduDefaut(D0) {
  let t = 0;
  for (const leg of LEGS) t += somme(H.option(D0, leg, D0.defaut[leg]).lignes.map((l) => l.n * l.u));
  t += somme(D0.bases.map((l) => l.n * l.u));
  for (const s of STAGES) t += somme(H.logement(D0, s, D0.defaut[s]).lignes.map((l) => l.n * l.u));
  return r2(t);
}

// ------------------------------------------------------------------------------------------------ TRIP (config.js), read by every logic module

test("creerTrip: stages, legs, travelers, currencies, specials and rules of the sample", () => {
  const { creerTrip } = require("../../page/js/logic/config.js");
  const avant = JSON.stringify(D);
  const T = creerTrip(D);
  assert.equal(JSON.stringify(D), avant, "pure: D unchanged");
  assert.deepEqual(T.stageKeys, ["lisbon", "comporta", "porto"]);
  assert.deepEqual(T.legs.map((l) => l.key), LEGS);
  assert.equal(T.legByKey["comporta-porto"].mode, "flight");
  assert.deepEqual(T.arrivals.map((l) => l.key), ["arrive-a", "arrive-b"]);
  assert.deepEqual(T.returns.map((l) => l.key), ["return-a", "return-b"]);
  assert.deepEqual(T.legsArrivingAt("comporta").map((l) => l.key), ["lisbon-comporta"]);
  assert.deepEqual(T.legsArrivingAt("lisbon"), [], "between legs only");
  assert.equal(T.legLeaving("comporta").key, "comporta-porto");
  assert.equal(T.legLeaving("porto"), null);
  assert.deepEqual(T.legsTo("lisbon").map((l) => l.key), ["arrive-a", "arrive-b"]);
  assert.deepEqual(T.legsFrom("porto").map((l) => l.key), ["return-a", "return-b"]);
  assert.equal(T.adults, 2);
  assert.deepEqual(T.travelers.map((t) => t.label), ["Alex", "Sam"]);
  assert.deepEqual(T.currency, { home: "USD", local: "EUR", rate: 0.92, rate_date: "2026-11-07" });
  assert.deepEqual(T.specialsAt("porto").map((s) => s.key), ["sao-joao"]);
  assert.deepEqual(T.specialsAt("lisbon"), []);
  assert.equal(T.rules.arrival_gap_min, 30, "default rule");
  assert.equal(T.rules.checkin_min, 90);
  assert.deepEqual([T.budgetCap, T.start, T.end, T.language], [6000, "2027-06-15", "2027-06-24", "en"]);
  assert.equal(T.stageAt("2027-06-20").key, "comporta");
  assert.equal(T.stageAt("2027-06-10").key, "lisbon", "before the first stage: the first");
  assert.equal(T.stageAt("2027-06-30").key, "porto");
  assert.equal(T.whoOf(T.legByKey["arrive-a"]), "Alex");
  assert.equal(T.whoOf(T.legByKey["lisbon-comporta"]), "", "everyone travels");
  assert.equal(T.labelsOf(T.legByKey["lisbon-comporta"]), "Alex + Sam");
  assert.equal(T.airportName("LIS"), "Lisbon (LIS)");
  assert.equal(T.airportName("JFK"), "New York (JFK)");
  assert.equal(T.airportName("MAD"), "Madrid (MAD)", "from the layovers");
  assert.equal(T.airportName("XYZ"), "XYZ");
  // a leg is out of the budget when every traveler on it keeps their flights out
  const D2 = variante(D, (x) => { x.trip.travelers[0].flights_in_budget = false; });
  const T2 = creerTrip(D2);
  assert.equal(T2.legByKey["arrive-a"].in_budget, false);
  assert.equal(T2.legByKey["lisbon-comporta"].in_budget, true);
  // nothing known: empty, no error
  const vide = creerTrip(undefined);
  assert.deepEqual([vide.stageKeys, vide.legs, vide.adults, vide.budgetCap], [[], [], 0, null]);
});

// ------------------------------------------------------------------------------------------------ totals

test("budget totals sample defaults", () => {
  const t = B.totaux(B.lignesVoyage(defaut(), D), D.trip.budget_cap);
  assert.ok(t.total > 0 && t.plafond === 6000);
  assert.equal(t.total, attenduDefaut(D));
  assert.equal(t.marge, r2(6000 - t.total));
  assert.equal(r2(t.avant + t.place), t.total);
  assert.equal(t.horsBudget, 0);
  // three default flights have a checked bag whose supplement is unknown: "price to check", never 0
  assert.equal(t.incomplet, true);
});

test("every line has a valid shape, without NaN or empty label", () => {
  const lignes = B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro", "comporta-dune-grill"), speciales: { "sao-joao": "porto-fireworks-dinner" } }), D);
  assert.ok(lignes.length > 20);
  for (const l of lignes) {
    assert.ok(typeof l.lib === "string" && l.lib.trim(), JSON.stringify(l));
    assert.ok(POSTES.includes(l.poste), `poste ${l.poste}`);
    assert.ok(["avant", "place", "inclus"].includes(l.quand), `quand ${l.quand}`);
    assert.ok(l.etape === "vols" || STAGES.includes(l.etape), `etape ${l.etape}`);
    assert.ok(Number.isFinite(B.montantLigne(l)));
    if (l.u === null) assert.equal(l.incomplet, true);
    propre(l, l.lib);
  }
});

test("lignesVoyage never changes D and returns copies", () => {
  const avant = JSON.stringify(D);
  const lignes = B.lignesVoyage(defaut(), D);
  lignes.forEach((l) => { l.u = 999999; l.lib = "changed"; });
  assert.equal(JSON.stringify(D), avant);
  assert.equal(B.totaux(B.lignesVoyage(defaut(), D)).total, attenduDefaut(D));
});

test("totaux: total, before / on the spot, margin, out-of-budget part, cap", () => {
  const l = [
    { n: 2, u: 100, quand: "avant" },
    { n: 1, u: 50, quand: "place" },
    { n: 1, u: 400, quand: "avant", hors_budget: true },
  ];
  assert.deepEqual(B.totaux(l, 1000), {
    total: 250, avant: 200, place: 50, marge: 750, plafond: 1000, horsBudget: 400, incomplet: false, horsBudgetIncomplet: false,
  });
  const sans = B.totaux(l);
  assert.equal(sans.plafond, null, "no cap: no invented one");
  assert.equal(sans.marge, null);
});

test("totaux: a line without price makes the total incomplete, never NaN", () => {
  const t = B.totaux([{ n: 1, u: null, quand: "avant", incomplet: true }, { n: 1, u: 10, quand: "place" }], 100);
  assert.equal(t.total, 10);
  assert.equal(t.incomplet, true);
  for (const k of ["total", "avant", "place", "marge"]) assert.ok(Number.isFinite(t[k]), k);
});

// ------------------------------------------------------------------------------------------------ legs

test("out-of-budget leg excluded unless included", () => {
  const D2 = sansVolsDe(D, "a");
  const base = B.totaux(B.lignesVoyage(defaut(), D), 6000);
  const lignes = B.lignesVoyage(copie(D2.defaut), D2);
  const t = B.totaux(lignes, 6000);
  const prix = (leg) => somme(H.option(D, leg, D.defaut[leg]).lignes.map((l) => l.n * l.u));
  assert.equal(t.total, r2(base.total - prix("arrive-a") - prix("return-a")));
  assert.equal(t.horsBudget, r2(prix("arrive-a") + prix("return-a")));
  assert.equal(t.horsBudgetIncomplet, true, "return-a's bag supplement is unknown");
  assert.ok(lignes.filter((l) => l.trajet === "arrive-a").every((l) => l.hors_budget === true));
  assert.ok(lignes.filter((l) => l.trajet === "arrive-b" || l.trajet === "comporta-porto").every((l) => !l.hors_budget));
  // ticked "add it to see": counted, and its note no longer says it is outside the budget
  const choix = Object.assign(copie(D2.defaut), { inclure: Object.assign({}, D2.defaut.inclure, { "arrive-a": true }) });
  const l2 = B.lignesVoyage(choix, D2);
  assert.equal(B.totaux(l2, 6000).total, r2(t.total + prix("arrive-a")));
  const vol = l2.filter((l) => l.trajet === "arrive-a");
  assert.ok(vol.length && vol.every((l) => !l.hors_budget));
  assert.ok(vol.every((l) => !/outside the shared budget/.test(l.note || "")), vol.map((l) => l.note).join(" | "));
  // a stale "false" never drops a leg that is in the budget
  const l3 = B.lignesVoyage(avec({ inclure: { "comporta-porto": false } }), D);
  assert.equal(B.totaux(l3).total, base.total);
});

test("between legs and returns count, with one line per chosen option at the leg's adults", () => {
  const lignes = B.lignesVoyage(defaut(), D);
  const vol = lignes.find((l) => l.trajet === "comporta-porto" && l.cle === "vol");
  assert.equal(vol.n, 2);
  assert.equal(vol.u, 41);
  const sol = lignes.filter((l) => l.trajet === "lisbon-comporta");
  assert.equal(sol.length, 1);
  assert.equal(sol[0].poste, "trajets");
  assert.equal(sol[0].etape, "comporta");
  assert.ok(lignes.some((l) => l.trajet === "return-b" && l.cle === "vol" && l.u === 372));
});

test("flight without price or bag supplement unknown: a 'price to check' line, never 0", () => {
  const lignes = B.lignesVoyage(defaut(), D);
  const valise = lignes.find((l) => l.trajet === "comporta-porto" && l.cle === "valise");
  assert.ok(valise && valise.u === null && valise.incomplet === true && valise.n === 2);
  assert.match(valise.note, /price to check/);
  // a flight whose ticket price is missing
  const D2 = variante(D, (x) => { H.option(x, "arrive-b", x.defaut["arrive-b"]).lignes = []; });
  const l2 = B.lignesVoyage(copie(D2.defaut), D2).filter((l) => l.trajet === "arrive-b");
  assert.equal(l2.length, 1);
  assert.equal(l2[0].u, null);
  assert.equal(l2[0].cle, "vol");
  assert.match(l2[0].lib, /Sam/);
  // an option id lost from the data
  const l3 = B.lignesVoyage(avec({ "return-a": "gone" }), D).filter((l) => l.trajet === "return-a");
  assert.equal(l3.length, 1);
  assert.equal(l3[0].incomplet, true);
});

test("ground leg: the chosen option's line; without price, a line to check", () => {
  const e = B.ecart(defaut(), D, { "lisbon-comporta": "lisbon-comporta-2" });
  assert.equal(e.montant, 52 - 96);
  assert.equal(e.incomplet, false);
  const D2 = variante(D, (x) => { x.vols["lisbon-comporta"].options[0].lignes = []; });
  const l = B.lignesVoyage(copie(D2.defaut), D2).filter((x) => x.trajet === "lisbon-comporta");
  assert.equal(l.length, 1);
  assert.equal(l[0].u, null);
  assert.equal(l[0].poste, "trajets");
  assert.equal(l[0].etape, "comporta");
});

// ------------------------------------------------------------------------------------------------ formalities

const TRANSIT = {
  code: "transit-x", qui: "all", titre: "Transit permit (invented)", cout_home: 30, delai_jours: 10, avant: "depart",
  condition: "transit-x", url_officielle: "https://www.example.com/transit", source: "test", verifie: "2026-11-07",
};
const IB = "arrive-a-20270615-IB9002-IB9003";
const avecTransit = (D0, fiche) => variante(D0, (x) => {
  x.formalites.push(Object.assign({}, TRANSIT, fiche || {}));
  H.option(x, "arrive-a", IB).formalites = ["transit-x"];
  H.option(x, "return-a", "return-a-20270624-TP9031-TP9032").formalites = ["transit-x"];
});

test("formalities asked by the chosen flights: counted once, for every traveler, out of budget with their leg", () => {
  const D2 = avecTransit(D);
  assert.equal(B.lignesVoyage(defaut(), D2).filter((l) => l.cle === "transit-x").length, 0, "no flight asks for it");
  const deux = B.lignesVoyage(avec({ "arrive-a": IB, "return-a": "return-a-20270624-TP9031-TP9032" }), D2).filter((l) => l.cle === "transit-x");
  assert.equal(deux.length, 1);
  assert.equal(deux[0].n, 2, "qui all = every adult of the trip");
  assert.equal(deux[0].u, 30);
  assert.equal(deux[0].poste, "formalites");
  assert.match(deux[0].note, /example\.com\/transit/);
  // for one traveler: 1 adult, named
  const D3 = avecTransit(D, { qui: "a" });
  const un = B.lignesVoyage(avec({ "arrive-a": IB }), D3).find((l) => l.cle === "transit-x");
  assert.equal(un.n, 1);
  assert.match(un.lib, /^Alex · /);
  // only out-of-budget legs ask for it: out of budget too
  const D4 = sansVolsDe(avecTransit(D), "a");
  const hors = B.lignesVoyage(Object.assign(copie(D4.defaut), { "arrive-a": IB }), D4).find((l) => l.cle === "transit-x");
  assert.equal(hors.hors_budget, true);
});

test("unknown formality asked by a flight: a line to check, total incomplete", () => {
  const D2 = variante(D, (x) => { H.option(x, "comporta-porto", x.defaut["comporta-porto"]).formalites = ["mystery-visa"]; });
  const l = B.lignesVoyage(copie(D2.defaut), D2).find((x) => x.cle === "mystery-visa");
  assert.ok(l && l.u === null && l.incomplet === true);
  assert.match(l.lib, /mystery-visa/);
});

// ------------------------------------------------------------------------------------------------ lodgings

test("each lodging of each stage gives a finite total; incomplete fiches are flagged", () => {
  for (const s of STAGES) {
    for (const lg of D.lieux[s].logements.concat(D.lieux[s].autres)) {
      const lignes = B.lignesVoyage(avec({ [s]: lg.id }), D);
      const t = B.totaux(lignes, 6000);
      assert.ok(Number.isFinite(t.total) && t.total > 0, lg.id);
      const siennes = lignes.filter((l) => l.etape === s && l.poste !== "trajets");
      if (lg.lignes) assert.ok(siennes.every((l) => l.cle !== "fiche-incomplete"), lg.id);
      else {
        const ch = siennes.find((l) => l.cle === "chambre");
        assert.equal(r2(ch.n * ch.u), lg.prix.total_home, lg.id);
        assert.equal(ch.n, D.trip.stages.find((x) => x.key === s).nights);
        assert.ok(siennes.some((l) => l.cle === "fiche-incomplete" && l.incomplet), lg.id);
      }
    }
  }
});

test("a stage whose data is not loaded, or a lost lodging id: a line to check, nothing breaks", () => {
  const D2 = variante(D, (x) => { delete x.lieux.porto; });
  const l = B.lignesVoyage(defaut(), D2).filter((x) => x.etape === "porto");
  assert.ok(l.length >= 1 && l.every((x) => x.incomplet));
  const l2 = B.lignesVoyage(avec({ lisbon: "lisbon-gone" }), D).filter((x) => x.etape === "lisbon");
  assert.equal(l2.length, 1);
  assert.match(l2[0].lib, /lisbon-gone/);
  assert.ok(Number.isFinite(B.totaux(B.lignesVoyage(defaut(), D2)).total));
});

test("ecart: difference of totals, zero without patch; changing lodging", () => {
  assert.deepEqual(B.ecart(defaut(), D), { montant: 0, incomplet: false });
  const tout = somme(H.logement(D, "lisbon", "lisbon-01").lignes.map((l) => l.n * l.u));
  const e = B.ecart(defaut(), D, { lisbon: "lisbon-02" });
  assert.equal(e.montant, r2(540 - tout));
  assert.equal(e.incomplet, true, "lisbon-02 has no full fiche: meals and drinks to check");
});

// ------------------------------------------------------------------------------------------------ outings and "remplace"

test("replaces a dinner: an outing at 85 for the group costs 85 minus a lodging dinner", () => {
  const lignes = B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro") }), D);
  const pos = lignes.filter((l) => l.cle === "lisbon-tasca-miradouro");
  assert.equal(pos.length, 1);
  assert.equal(pos[0].u, 85);
  assert.equal(pos[0].poste, "repas");
  assert.equal(pos[0].quand, "place");
  const neg = lignes.filter((l) => l.sortie === "lisbon-tasca-miradouro" && l.n < 0);
  assert.equal(neg.length, 1);
  assert.equal(neg[0].u, 100);
  assert.match(neg[0].lib, /dinner/);
  assert.deepEqual(B.ecart(defaut(), D, { sorties: sorties("lisbon-tasca-miradouro") }), { montant: -15, incomplet: false });
});

test("replaces is capped: six restaurants for three lodging dinners give three negative lines at most", () => {
  const D2 = variante(D, (x) => {
    const base = H.sortie(x, "lisbon-tasca-miradouro");
    for (let i = 2; i <= 6; i++) x.lieux.lisbon.sorties.push(Object.assign(copie(base), { id: `tasca-${i}` }));
  });
  const ids = ["lisbon-tasca-miradouro", "tasca-2", "tasca-3", "tasca-4", "tasca-5", "tasca-6"];
  const lignes = B.lignesVoyage(avec({ sorties: sorties(...ids) }), D2);
  assert.equal(lignes.filter((l) => l.cle === "remplace").length, 3);
  assert.equal(r2(somme(lignes.filter((l) => l.cle === "remplace").map(B.montantLigne))), -285);
});

test("replaces: a line keyed as dinners that is not a dinner (a taxi) is not a unit", () => {
  const D2 = variante(D, (x) => {
    H.logement(x, "lisbon", "lisbon-01").lignes.unshift({ n: 4, u: 12, lib: "taxi to the restaurants", src: "estime", quand: "place", etape: "lisbon", poste: "trajets", cle: "diners" });
  });
  const neg = B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro") }), D2).filter((l) => l.cle === "remplace");
  assert.equal(neg.length, 1);
  assert.equal(neg[0].u, 100);
});

test("replaces: lodging lines written in French count as units too (dîner, verre)", () => {
  const D2 = variante(D, (x) => {
    const l = H.logement(x, "lisbon", "lisbon-01");
    l.lignes = l.lignes.filter((y) => y.cle !== "diners").concat([{ n: 3, u: 90, lib: "dîner au restaurant de l'hôtel", src: "releve", quand: "place", etape: "lisbon", poste: "repas", cle: "diners" }]);
  });
  const neg = B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro") }), D2).filter((l) => l.cle === "remplace");
  assert.equal(neg.length, 1);
  assert.equal(neg[0].u, 90);
});

test("replaces drinks: a bar replaces two drinks of the lodging", () => {
  const lignes = B.lignesVoyage(avec({ sorties: sorties("lisbon-rooftop-tejo") }), D);
  const neg = lignes.filter((l) => l.sortie === "lisbon-rooftop-tejo" && l.cle === "remplace");
  assert.equal(neg.length, 2);
  assert.ok(neg.every((l) => l.u === 16 && l.poste === "verres"));
  assert.equal(B.ecart(defaut(), D, { sorties: sorties("lisbon-rooftop-tejo") }).montant, 38 - 32);
});

test("replaces: without a known price for the outing, the lodging dinner stays counted", () => {
  const D2 = avecSortie(D, "lisbon-tasca-miradouro", { prix_couple_home: null });
  const lignes = B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro") }), D2);
  assert.equal(lignes.filter((l) => l.cle === "remplace").length, 0);
  const l = lignes.find((x) => x.cle === "lisbon-tasca-miradouro");
  assert.ok(l.u === null && l.incomplet === true);
  assert.match(l.note, /price to check/);
  assert.deepEqual(B.ecart(defaut(), D2, { sorties: sorties("lisbon-tasca-miradouro") }), { montant: 0, incomplet: true });
});

test("estimated outing: src estime; published price: releve", () => {
  const lignes = B.lignesVoyage(avec({ sorties: sorties("lisbon-rooftop-tejo", "lisbon-alfama-walk") }), D);
  assert.equal(lignes.find((l) => l.cle === "lisbon-rooftop-tejo").src, "estime");
  assert.equal(lignes.find((l) => l.cle === "lisbon-alfama-walk").src, "releve");
  assert.equal(lignes.find((l) => l.cle === "lisbon-alfama-walk").quand, "avant", "booked online: paid before leaving");
});

test("unticked outings (false) do not count, nor their 'remplace' lines; { jour } objects count", () => {
  const c = avec({ sorties: { "lisbon-tasca-miradouro": false, "lisbon-alfama-walk": { jour: "2027-06-16" } } });
  const lignes = B.lignesVoyage(c, D);
  assert.equal(lignes.filter((l) => l.sortie === "lisbon-tasca-miradouro").length, 0);
  assert.equal(lignes.filter((l) => l.sortie === "lisbon-alfama-walk").length, 1);
});

test("an outing that can happen on none of your days at its stage (fixed date outside) is not counted", () => {
  const D2 = avecSortie(D, "porto-cellar-tasting", { date_fixe: "2027-06-19" });
  const lignes = B.lignesVoyage(avec({ sorties: sorties("porto-cellar-tasting") }), D2);
  assert.equal(lignes.filter((l) => l.sortie === "porto-cellar-tasting").length, 0);
});

// ------------------------------------------------------------------------------------------------ special evenings

test("special evening single choice", () => {
  // both São João outings ticked in the list: only the last one counts
  const c = avec({ sorties: sorties("porto-fireworks-dinner", "porto-sao-joao-party") });
  assert.deepEqual(B.sortiesComptees(c, D), ["porto-sao-joao-party"]);
  const lignes = B.lignesVoyage(c, D);
  assert.equal(lignes.filter((l) => l.sortie === "porto-fireworks-dinner").length, 0);
  assert.equal(lignes.filter((l) => l.cle === "porto-sao-joao-party").length, 1);
  // saved that way, the choice is normalised: one outing in speciales, none left in the list
  const r = B.resoudreChoix(c, D);
  assert.equal(r.choix.speciales["sao-joao"], "porto-sao-joao-party");
  assert.deepEqual(Object.keys(r.choix.sorties), []);
  // the special block's own choice wins over a ticked one
  const c2 = avec({ speciales: { "sao-joao": "porto-fireworks-dinner" }, sorties: sorties("porto-sao-joao-party") });
  assert.deepEqual(B.sortiesComptees(c2, D), ["porto-fireworks-dinner"]);
  // chosen in the block and ticked in the list: counted once
  const c3 = avec({ speciales: { "sao-joao": "porto-fireworks-dinner" }, sorties: sorties("porto-fireworks-dinner") });
  assert.equal(B.lignesVoyage(c3, D).filter((l) => l.cle === "porto-fireworks-dinner").length, 1);
});

test("gala line replaces dinner on sao-joao", () => {
  // the Porto hotel serves a mandatory gala dinner that evening: its regular dinners do not cover it, nothing to replace
  const lg = H.logement(D, "porto", "porto-01");
  assert.ok(lg.lignes.some((l) => l.cle === "gala" && l.speciale === "sao-joao"), "fixture: gala line");
  const c = avec({ speciales: { "sao-joao": "porto-fireworks-dinner" } });
  const lignes = B.lignesVoyage(c, D);
  const pos = lignes.filter((l) => l.cle === "porto-fireworks-dinner");
  assert.equal(pos.length, 1);
  assert.equal(pos[0].u, 120);
  assert.equal(pos[0].etape, "porto");
  assert.equal(lignes.filter((l) => l.sortie === "porto-fireworks-dinner" && l.n < 0).length, 0);
  assert.ok(lignes.some((l) => l.cle === "gala" && l.u === 130), "the gala stays counted (mandatory)");
  assert.equal(B.ecart(defaut(), D, { speciales: { "sao-joao": "porto-fireworks-dinner" } }).montant, 120);
  // a hotel without a gala that evening: the special dinner replaces one of its dinners
  const D2 = variante(D, (x) => {
    const l = H.logement(x, "porto", "porto-01");
    l.lignes = l.lignes.filter((y) => y.cle !== "gala");
  });
  assert.equal(B.ecart(copie(D2.defaut), D2, { speciales: { "sao-joao": "porto-fireworks-dinner" } }).montant, 120 - 100);
});

test("sample data: every evening of a lodging is counted once (regular dinners + gala evenings = nights)", () => {
  // Porto: 3 nights = 2 regular dinners + the São João gala; a third regular dinner would count Jun 23 twice
  for (const st of D.trip.stages) {
    for (const lg of D.lieux[st.key].logements) {
      const lignes = lg.lignes || [];
      const diners = somme(lignes.filter((l) => l.cle === "diners").map((l) => l.n));
      const galas = new Set(lignes.filter((l) => l.cle === "gala").map((l) => l.speciale)).size;
      if (diners || galas) assert.equal(diners + galas, st.nights, lg.id);
    }
  }
  assert.equal(somme(H.logement(D, "porto", "porto-01").lignes.filter((l) => l.cle === "diners").map((l) => l.n)), 2);
});

test("a special outing on the evening someone leaves the last lodging, ending after they leave, is not counted", () => {
  // Sam's return leaves at 23:30 on the 23rd: Sam leaves the hotel at 21:35, the São João dinner ends after
  const D2 = avecHoraires(D, "return-b", D.defaut["return-b"], "2027-06-23T23:30", "2027-06-24T07:15");
  const c = Object.assign(copie(D2.defaut), { speciales: { "sao-joao": "porto-fireworks-dinner" } });
  assert.equal(B.lignesVoyage(c, D2).filter((l) => l.sortie === "porto-fireworks-dinner").length, 0);
  // an outing that can move to another day stays counted
  const c2 = Object.assign(copie(D2.defaut), { sorties: { "porto-douro-cruise": { jour: "2027-06-23" } } });
  assert.equal(B.lignesVoyage(c2, D2).filter((l) => l.cle === "porto-douro-cruise").length, 1);
});

// ------------------------------------------------------------------------------------------------ dates of the first arrival and the last return

const RETURN_A = "return-a-20270624-IB9033-IB9034";

test("return later: extra nights at the last lodging at its average night price, from the day you leave the hotel", () => {
  const D2 = avecHoraires(D, "return-a", RETURN_A, "2027-06-26T09:00", "2027-06-26T16:40");
  const l = B.ajustementsDates(copie(D2.defaut), D2);
  assert.equal(l.length, 1);
  assert.equal(l[0].cle, "nuit-en-plus");
  assert.equal(l[0].n, 2);
  assert.equal(l[0].u, 220);
  assert.equal(l[0].etape, "porto");
  assert.equal(l[0].jour, "2027-06-26");
  assert.equal(l[0].sens, "retour");
  assert.equal(l[0].cause, "return-a");
  assert.match(l[0].lib, /Casa da Ribeira/);
  assert.ok(B.lignesVoyage(copie(D2.defaut), D2).some((x) => x.cle === "nuit-en-plus"));
});

test("return earlier for everyone: lost night (n = 0); one traveler earlier: nothing", () => {
  let D2 = avecHoraires(D, "return-a", RETURN_A, "2027-06-23T09:00", "2027-06-23T16:40");
  assert.deepEqual(B.ajustementsDates(copie(D2.defaut), D2), [], "Sam still leaves on the 24th");
  D2 = avecHoraires(D2, "return-b", D.defaut["return-b"], "2027-06-23T08:20", "2027-06-23T15:45");
  const l = B.ajustementsDates(copie(D2.defaut), D2);
  assert.equal(l.length, 1);
  assert.equal(l[0].cle, "nuit-perdue");
  assert.equal(l[0].n, 0);
  assert.equal(l[0].nuits, 1);
  assert.ok(l[0].note.length > 10);
});

test("first arrival: one day early = an extra night; everyone late = a lost night; one late only = nothing", () => {
  const tot = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2027-06-14T07:10", "2027-06-14T19:00");
  const l = B.ajustementsDates(copie(tot.defaut), tot);
  assert.equal(l.length, 1);
  assert.equal(l[0].cle, "nuit-en-plus");
  assert.equal(l[0].etape, "lisbon");
  assert.equal(l[0].u, 200);
  assert.equal(l[0].sens, "arrivee");
  assert.equal(l[0].cause, "arrive-a");
  assert.match(l[0].lib, /Alex/);
  const unTard = avecHoraires(D, "arrive-b", D.defaut["arrive-b"], "2027-06-16T08:05", "2027-06-16T19:25");
  assert.deepEqual(B.ajustementsDates(copie(unTard.defaut), unTard), []);
  const tousTard = avecHoraires(unTard, "arrive-a", D.defaut["arrive-a"], "2027-06-16T07:10", "2027-06-16T19:00");
  const p = B.ajustementsDates(copie(tousTard.defaut), tousTard);
  assert.equal(p.length, 1);
  assert.equal(p[0].cle, "nuit-perdue");
  assert.equal(p[0].n, 0);
});

test("a return after midnight: you leave the hotel the evening before, no extra night", () => {
  const D2 = avecHoraires(D, "return-a", RETURN_A, "2027-06-25T00:30", "2027-06-25T08:10");
  assert.deepEqual(B.ajustementsDates(copie(D2.defaut), D2), []);
});

test("ajustementsDates: unknown flight or missing data, no line and no error", () => {
  assert.deepEqual(B.ajustementsDates(avec({ "arrive-a": "gone", "return-a": "gone", "arrive-b": null, "return-b": null }), D), []);
  assert.deepEqual(B.ajustementsDates({}, {}), []);
  assert.deepEqual(B.ajustementsDates(null, null), []);
});

// ------------------------------------------------------------------------------------------------ resoudreChoix

test("resoudreChoix: unknown id, the stage takes the default back and says so", () => {
  const r = B.resoudreChoix(avec({ lisbon: "lisbon-gone" }), D);
  assert.equal(r.choix.lisbon, D.defaut.lisbon);
  assert.deepEqual(r.remplaces, ["lisbon"]);
});

test("resoudreChoix: valid choices kept, absent = default silently, vanished options and outings reported", () => {
  const saved = { comporta: "comporta-02", "arrive-a": "gone", "return-b": "return-b-20270624-TP9041-AC9042", sorties: { "lisbon-alfama-walk": { jour: "2027-06-16" }, "vanished": { jour: null } } };
  const r = B.resoudreChoix(saved, D);
  assert.equal(r.choix.comporta, "comporta-02");
  assert.equal(r.choix["return-b"], "return-b-20270624-TP9041-AC9042");
  assert.equal(r.choix["arrive-a"], D.defaut["arrive-a"]);
  assert.equal(r.choix.porto, D.defaut.porto);
  assert.deepEqual(r.choix.sorties, { "lisbon-alfama-walk": { jour: "2027-06-16" } });
  assert.deepEqual(r.sortiesRetirees, ["vanished"]);
  assert.deepEqual(r.remplaces.sort(), ["arrive-a", "sorties"]);
  assert.deepEqual(r.choix.inclure, D.defaut.inclure);
});

test("resoudreChoix: nothing saved = defaults without message", () => {
  const r = B.resoudreChoix(undefined, D);
  for (const k of LEGS.concat(STAGES)) assert.equal(r.choix[k], D.defaut[k], k);
  assert.deepEqual(r.choix.speciales, { "sao-joao": null });
  assert.deepEqual(r.choix.sorties, {});
  assert.deepEqual(r.remplaces, []);
});

test("resoudreChoix: special evenings, 'none' kept, a vanished or foreign outing replaced", () => {
  assert.equal(B.resoudreChoix({ speciales: { "sao-joao": false } }, D).choix.speciales["sao-joao"], false);
  assert.equal(B.resoudreChoix({ speciales: { "sao-joao": null } }, D).choix.speciales["sao-joao"], null);
  const ok = B.resoudreChoix({ speciales: { "sao-joao": "porto-sao-joao-party" } }, D);
  assert.equal(ok.choix.speciales["sao-joao"], "porto-sao-joao-party");
  assert.deepEqual(ok.remplaces, []);
  const perdu = B.resoudreChoix({ speciales: { "sao-joao": "gone" } }, D);
  assert.equal(perdu.choix.speciales["sao-joao"], null);
  assert.deepEqual(perdu.remplaces, ["speciales.sao-joao"]);
  const autre = B.resoudreChoix({ speciales: { "sao-joao": "porto-cellar-tasting" } }, D);
  assert.equal(autre.choix.speciales["sao-joao"], null, "an outing of no special evening");
});

test("resoudreChoix: inclure keeps saved booleans, the rest from the defaults", () => {
  const r = B.resoudreChoix({ inclure: { "arrive-a": false, "return-b": "yes" } }, D);
  assert.equal(r.choix.inclure["arrive-a"], false);
  assert.equal(r.choix.inclure["return-b"], true);
  assert.deepEqual(Object.keys(r.choix.inclure).sort(), LEGS.slice().sort());
});

test("resoudreChoix: an unticked outing (false) is kept, without message even when it vanished", () => {
  const r = B.resoudreChoix({ sorties: { "lisbon-tasca-miradouro": false, vanished: false } }, D);
  assert.deepEqual(r.choix.sorties, { "lisbon-tasca-miradouro": false });
  assert.deepEqual(r.remplaces, []);
});

test("resoudreChoix: a stage not loaded yet keeps the saved choice", () => {
  const D2 = variante(D, (x) => { delete x.lieux.porto; });
  const r = B.resoudreChoix({ porto: "porto-from-yesterday", sorties: { "porto-other": { jour: null } } }, D2);
  assert.equal(r.choix.porto, "porto-from-yesterday");
  assert.ok("porto-other" in r.choix.sorties);
  assert.deepEqual(r.remplaces, []);
});

// ------------------------------------------------------------------------------------------------ one stage, one traveler

test("one stage, one traveler: shared formalities count 1 adult", () => {
  const D1 = variante(D, (x) => {
    x.trip.travelers = [x.trip.travelers[0]];
    x.trip.stages = [x.trip.stages[0]];
    x.trip.end = x.trip.stages[0].to;
    x.trip.legs = x.trip.legs.filter((l) => l.key === "arrive-a" || l.key === "return-a");
    x.trip.legs[1].from_stage = "lisbon";
    x.trip.specials = [];
    delete x.lieux.comporta;
    delete x.lieux.porto;
    x.formalites.push(TRANSIT);
    H.option(x, "arrive-a", IB).formalites = ["transit-x"];
  });
  const c = { "arrive-a": IB, "return-a": RETURN_A, lisbon: "lisbon-01", sorties: {}, speciales: {}, inclure: {} };
  const lignes = B.lignesVoyage(c, D1);
  assert.equal(lignes.find((l) => l.cle === "transit-x").n, 1);
  assert.ok(lignes.every((l) => l.etape === "vols" || l.etape === "lisbon"));
  assert.ok(Number.isFinite(B.totaux(lignes, D1.trip.budget_cap).total));
});
