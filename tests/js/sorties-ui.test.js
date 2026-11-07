// Outings screens (page/js/ui/sorties.js), on the sample trip: pure helpers under node, the screen in a sandbox
// (tests/js/helpers/bac.js). Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const { bac } = require("./helpers/bac.js");
const S = require("../../page/js/ui/sorties.js");
const B = require("../../page/js/logic/budget.js");
const { creerTrip } = require("../../page/js/logic/config.js");
const { construireEcrans } = require("../../page/js/ui/shell.js");

const D = H.chargerDonnees();
const TRIP = creerTrip(D);
const choix = () => B.resoudreChoix({}, D).choix;
const ecran = (cle) => construireEcrans(TRIP).find((e) => e.cle === cle);
const calc = { lignesVoyage: B.lignesVoyage, totaux: B.totaux };

test.afterEach(() => H.preparerI18n(D, "en"));

test("distance: one degree of longitude at the equator ≈ 111 km, a missing coordinate → null; nearest first", () => {
  assert.ok(Math.abs(S.distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111.19) < 0.1);
  assert.equal(S.distanceKm({ lat: 0 }, { lat: 0, lng: 1 }), null);
  const lg = H.logement(D, "porto", "porto-01");
  const t = S.trierParDistance(D.lieux.porto.sorties, lg);
  assert.equal(t[0].s.id, "porto-sao-joao-party");
  assert.ok(t.every((x, i) => i === 0 || x.km >= t[i - 1].km));
  assert.equal(S.texteDistance(0.3), "300 m");
  assert.equal(S.texteDistance(2.34, true), "≈ 2.3 km");
  H.preparerI18n(D, "fr");
  assert.equal(S.texteDistance(2.34), "2,3 km");
});

test("kinds and filters: every outing has a kind, counters add up, 'ticked' follows the choice", () => {
  const ent = S.trierParDistance(D.lieux.lisbon.sorties, null);
  const n = S.compterGenres(ent, { sorties: { "lisbon-alfama-walk": { jour: null } } });
  assert.equal(n.tout, 4);
  assert.equal(n.manger + n.boire + n.faire, 4);
  assert.equal(n.cochees, 1);
  assert.equal(S.filtrer(ent, "cochees", { sorties: { "lisbon-alfama-walk": { jour: null }, "lisbon-rooftop-tejo": false } }).length, 1);
});

test("special block only on porto sorties", () => {
  const c = choix();
  assert.deepEqual(S.blocsDeLEtape("lisbon", D, c).map((b) => b.cle), []);
  assert.deepEqual(S.blocsDeLEtape("comporta", D, c).map((b) => b.cle), []);
  const p = S.blocsDeLEtape("porto", D, c);
  assert.deepEqual(p.map((b) => b.cle), ["sao-joao"]);
  assert.match(p[0].titre, /São João night/);
  assert.match(p[0].sur, /Jun 23/);
  assert.deepEqual(p[0].options.map((s) => s.id).sort(), ["porto-fireworks-dinner", "porto-sao-joao-party"]);
  // the outings of the evening leave the ticking list
  const fen = S.fenetre(D, "porto", c);
  const r = S.repartirSorties(D.lieux.porto.sorties, fen, ["sao-joao"], {});
  assert.deepEqual(r.liste.map((s) => s.id).sort(), ["porto-cellar-tasting", "porto-douro-cruise"]);
  assert.deepEqual(r.blocs["sao-joao"].map((s) => s.id).sort(), ["porto-fireworks-dinner", "porto-sao-joao-party"]);
  // on the screens themselves (sandbox): one block on Porto, titled from the special, none elsewhere
  for (const k of ["lisbon", "comporta", "porto"]) {
    const b = bac(D, c, ["logement.js", "sorties.js"]);
    b.ctx.ECRANS.sorties(b.faux("ecran"), D, c, ecran(`${k}-sorties`));
    const h = b.html();
    assert.equal(/class="so-bloc"/.test(h), k === "porto", k);
    if (k === "porto") assert.match(h, /São João night/);
    assert.doesNotMatch(h, /NaN|undefined|\bnull\b/, k);
  }
});

test("the mandatory gala dinner of the chosen lodging belongs to its special evening", () => {
  const g = S.galaDuLogement(H.logement(D, "porto", "porto-01"), "sao-joao");
  assert.deepEqual([g.n, g.u, g.total, g.inclus], [2, 130, 260, false]);
  assert.equal(S.galaDuLogement(H.logement(D, "porto", "porto-01"), "other"), null);
  assert.equal(S.galaDuLogement(H.logement(D, "porto", "porto-02"), "sao-joao"), null);
});

test("a block choice writes choix.speciales[key] only; ticking writes one outing", () => {
  assert.deepEqual(S.patchBloc("sao-joao", "porto-fireworks-dinner"), ["speciales", { "sao-joao": "porto-fireworks-dinner" }]);
  assert.deepEqual(S.patchBloc("sao-joao", null), ["speciales", { "sao-joao": false }]);
  assert.deepEqual(S.patchSortie("porto-cellar-tasting", true, "2027-06-22"), ["sorties", { "porto-cellar-tasting": { jour: "2027-06-22" } }]);
  assert.deepEqual(S.patchSortie("porto-cellar-tasting", false), ["sorties", { "porto-cellar-tasting": false }]);
});

test("outside your dates: a fixed date or all dates outside the stage; free text = no constraint", () => {
  const fen = ["2027-06-21", "2027-06-23"];
  assert.equal(S.horsDates({ date_fixe: "2027-06-25" }, fen), true);
  assert.equal(S.horsDates({ dates: ["2027-06-20", "2027-06-24"] }, fen), true);
  assert.equal(S.horsDates({ dates: ["2027-06-22"] }, fen), false);
  assert.equal(S.horsDates({ dates: ["every evening"] }, fen), false);
  assert.match(S.raisonHorsDates({ date_fixe: "2027-06-25" }, "Porto", fen), /Jun 25.*Porto.*Jun 21 → 23/);
});

test("effect of an outing: the budget's total, the 'replaces' sentence shows the computation", () => {
  const c = choix();
  const s = H.sortie(D, "lisbon-tasca-miradouro");
  const e = S.effetSortie(s, c, D, calc);
  assert.equal(e.montant, 85 - 100);
  assert.equal(e.remplace.n, 1);
  assert.equal(S.phraseRemplace(e.remplace, s.prix_couple_home), "replaces 1 dinner planned at the lodging: +$85 − $100 = −$15");
  // without the budget module: the lodging's lines
  const sans = S.effetSortie(s, c, D, null);
  assert.equal(sans.montant, -15);
  // an unknown price: incomplete, never NaN or 0
  const inc = S.effetSortie(Object.assign({}, s, { prix_couple_home: null }), c, D, calc);
  assert.deepEqual([inc.montant, inc.incomplet], [null, true]);
  H.preparerI18n(D, "fr");
  assert.match(S.phraseRemplace(e.remplace, s.prix_couple_home), /^remplace 1 dîner du budget du logement : \+85\s?\$US − 100\s?\$US = −15\s?\$US$/,
    "the colon and its spacing come from the dictionary");
});

test("effect wording: '+$X to the budget · margin $Y', the cap of the trip; without a cap, no margin", () => {
  assert.equal(S.texteEffetBudget(149, { marge: 500, plafond: 6000 }), "+$149 to the budget · margin $351");
  assert.equal(S.texteEffetBudget(600, { marge: 500, plafond: 6000 }), "+$600 to the budget · $100 over $6,000");
  assert.equal(S.texteEffetBudget(0, null), "same budget");
  assert.equal(S.texteEffetBudget(20, { marge: null, plafond: null }), "+$20 to the budget");
  assert.equal(S.texteEffetBudget(null, null), "");
});

test("summary of the ticked outings of a stage, replacements included", () => {
  const c = Object.assign(choix(), { sorties: { "lisbon-tasca-miradouro": { jour: null }, "lisbon-alfama-walk": { jour: null } } });
  const r = S.resumeSorties(B.lignesVoyage(c, D), "lisbon", D.lieux.lisbon.sorties.map((s) => s.id));
  assert.deepEqual(r, { n: 2, total: 85 - 100 + 70, incomplet: false });
});

test("price: home currency for the trip's people, free, 'price to check' (never 0 for an unknown price), estimated", () => {
  assert.deepEqual(S.prixSortie(H.sortie(D, "porto-sao-joao-party")).etat, "gratuit");
  assert.deepEqual(S.prixSortie({ prix_couple_home: null }), { etat: "inconnu", montant: null, estime: false });
  assert.equal(S.prixSortie(H.sortie(D, "lisbon-rooftop-tejo")).estime, true);
  const h = S.htmlCarte(H.sortie(D, "lisbon-alfama-walk"), { km: 0.4 }, D);
  assert.match(h, /\$70/);
  assert.match(h, /for 2 people/);
  assert.match(h, /Must-see/);
  assert.doesNotMatch(h, /pour deux|carte\.html|NaN|undefined/);
});

test("label and value: the colon and its spacing come from the language (reviews in the details)", () => {
  const s = H.sortie(D, "lisbon-alfama-walk");
  assert.match(S.htmlDetails(s, null), /Example Reviews: 4\.6/);
  assert.doesNotMatch(S.htmlDetails(s, null), / : /);
  H.preparerI18n(D, "fr");
  assert.match(S.htmlDetails(s, null), /Example Reviews : 4,6/);
});

test("when to book: deadline and price rise, else the right moment, from T()", () => {
  assert.equal(S.echeance(H.sortie(D, "porto-fireworks-dinner")).texte, "book now");
  assert.equal(S.echeance(H.sortie(D, "porto-fireworks-dinner")).urgent, true);
  const h = S.echeance({ hausse: { avant: "2027-05-01", prix_apres_home: 150 } });
  assert.equal(h.texte, "book before May 1 (then $150)");
  assert.equal(S.echeance({}).texte, "");
});

test("booking links: cheapest first, unknown prices last, fallback on the fiche's links, http only", () => {
  const l = S.liensReservation({ liens: [{ site: "A", url: "https://www.example.com/a" }, { site: "B", url: "https://www.example.com/b", prix_home: 9 }, { site: "C", url: "javascript:x" }] });
  assert.deepEqual(l.map((x) => x.site), ["B", "A"]);
  assert.equal(l[0].meilleur, true);
  const f = S.liensReservation({ lien_reservation: "https://www.example.com/r", lien: "https://www.example.com/i" });
  assert.deepEqual(f.map((x) => x.site), ["Book", "More info"]);
});

test("days: the days of the stage, or only the dates the outing exists; the chosen day, else placed, else fixed", () => {
  const fen = ["2027-06-21", "2027-06-23"];
  assert.deepEqual(S.joursProposables({}, fen), ["2027-06-21", "2027-06-22", "2027-06-23"]);
  assert.deepEqual(S.joursProposables({ dates: ["2027-06-22"] }, fen), ["2027-06-22"]);
  assert.deepEqual(S.joursProposables({ date_fixe: "2027-06-23" }, fen), []);
  assert.deepEqual(S.jourDe("x", {}, { sorties: { x: { jour: "2027-06-22" } } }, {}), { jour: "2027-06-22", choisi: true, fixe: false });
  assert.deepEqual(S.jourDe("x", {}, { sorties: { x: { jour: null } } }, { x: "2027-06-21" }), { jour: "2027-06-21", choisi: false, fixe: false });
});

test("your days at a stage follow the chosen flights (days.js); without choices, the stage's dates", () => {
  assert.deepEqual(S.fenetre(D, "porto", null), ["2027-06-21", "2027-06-24"]);
  assert.deepEqual(S.fenetre(D, "lisbon", choix())[0], "2027-06-15");
});

test("the outings screen registers by type, its texts go through T()", () => {
  const c = choix();
  const b = bac(D, c, ["logement.js", "sorties.js"], "fr");
  b.ctx.T.setLang("fr");
  b.ctx.ECRANS.sorties(b.faux("ecran"), D, c, ecran("lisbon-sorties"));
  const h = b.html();
  assert.match(h, /Les sorties/);
  assert.doesNotMatch(h, /\bso_[a-z_]+|\bui_[a-z_]+/);
});
