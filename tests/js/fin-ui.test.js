// End screens (page/js/ui/detail.js, jours.js, plan-ecran.js) on the sample trip: pure helpers.
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const { bac } = require("./helpers/bac.js");
const F = require("../../page/js/ui/detail.js");
const J = require("../../page/js/ui/jours.js");
const P = require("../../page/js/ui/plan-ecran.js");
const B = require("../../page/js/logic/budget.js");
const Days = require("../../page/js/logic/days.js");
const Plan = require("../../page/js/logic/plan.js");
const { creerTrip } = require("../../page/js/logic/config.js");

const D = H.chargerDonnees();
const choix = (D2) => B.resoudreChoix({}, D2 || D).choix;

test.afterEach(() => H.preparerI18n(D, "en"));

test("formats: home currency with cents only when needed, dates of the trip's language", () => {
  assert.equal(F.argentPrecis(2076), "$2,076");
  assert.equal(F.argentPrecis(4.5), "$4.50");
  assert.equal(F.argentPrecis(null), "");
  assert.equal(F.argentRond(9238.52), "$9,239");
  assert.equal(F.dateCourte("2027-06-15"), "Jun 15");
  assert.equal(F.dateLongue("2027-06-15"), "Tue Jun 15");
  H.preparerI18n(D, "fr");
  assert.equal(F.dateCourte("2027-06-01"), "1er juin");
  assert.match(F.argentPrecis(4.5), /4,50/);
});

test("calcLigne: n × u = total, price to check, included, negative line", () => {
  assert.equal(F.calcLigne({ n: 3, u: 220, src: "direct", quand: "place" }).texte, "3 × $220 = $660");
  const inconnu = F.calcLigne({ n: 1, u: null, incomplet: true, quand: "avant" });
  assert.equal(inconnu.texte, "1 × price to check");
  assert.equal(inconnu.montant, null);
  assert.equal(F.calcLigne({ n: 0, u: 0, src: "inclus", quand: "inclus" }).texte, "included");
  assert.match(F.calcLigne({ n: -1, u: 100, src: "estime" }).texte, /^−1 × \$100 = -\$100$|^−1 × \$100 = −\$100$/);
  assert.equal(F.srcLibelle("releve"), "published price");
  assert.equal(F.srcLibelle("estime"), "estimated");
});

test("grouperLignes: the sum of the stages = the total of the badge; stage names from the trip", () => {
  const c = choix();
  const lignes = B.lignesVoyage(c, D);
  const t = B.totaux(lignes, 6000);
  const g = F.grouperLignes(lignes, D);
  assert.equal(g.avant.total, t.avant);
  assert.equal(g.place.total, t.place);
  assert.equal(g.total, t.total);
  const ordre = g.avant.etapes.map((e) => e.etape);
  assert.equal(ordre[0], "vols");
  assert.deepEqual(g.place.etapes.map((e) => e.nom), ["Lisbon", "Comporta", "Porto"]);
  assert.equal(g.avant.etapes[0].nom, "Travel and formalities");
  const n = g.avant.etapes.concat(g.place.etapes).reduce((x, e) => x + e.lignes.length, 0) + g.hors.lignes.length;
  assert.equal(n, lignes.length, "each line once");
});

test("out of the shared budget: one amount per leg, what its toggle adds, ticked or not", () => {
  const D2 = H.sansVolsDe(D, "b");
  const c = choix(D2);
  const lignes = B.lignesVoyage(c, D2);
  const t = B.totaux(lignes, 6000);
  const g = F.grouperLignes(lignes, D2);
  assert.equal(g.hors.total, t.horsBudget);
  assert.ok(g.hors.lignes.length >= 2);
  const a = F.horsBudgetDuTrajet(c, D2, "arrive-b");
  assert.ok(a && a.total > 0);
  const avec = Object.assign({}, c, { inclure: Object.assign({}, c.inclure, { "arrive-b": true }) });
  const t2 = B.totaux(B.lignesVoyage(avec, D2), 6000);
  assert.equal(Math.round((t2.total - t.total) * 100) / 100, a.total, "exactly what the toggle adds");
  assert.deepEqual(F.horsBudgetDuTrajet(avec, D2, "arrive-b"), a, "the same, ticked or not");
  assert.equal(F.horsBudgetDuTrajet(c, D2, "arrive-a"), null, "a leg in the budget");
});

test("infoLigne: site, link, cancellation, verification", () => {
  const c = choix();
  const lignes = B.lignesVoyage(c, D);
  const ch = lignes.find((l) => l.etape === "porto" && l.cle === "chambre");
  const i = F.infoLigne(ch, D, c);
  assert.equal(i.site, "Booking.com");
  assert.equal(i.verifie, "2026-11-07");
  assert.match(i.annulation, /free cancellation/);
  const vol = lignes.find((l) => l.cle === "vol" && l.trajet === "arrive-a");
  const iv = F.infoLigne(vol, D, c);
  assert.equal(iv.site, "Kiwi");
  assert.equal(iv.prelevement, "paid when booking");
  const ass = lignes.find((l) => l.cle === "insurance");
  assert.match(F.infoLigne(ass, D, c).url || "", /^https:/);
});

test("image: the first small photo of a lodging or an outing of any stage, a site file, nothing else", async () => {
  const D2 = H.variante(D, (x) => {
    H.logement(x, "porto", "porto-01").galerie = { n: 1, petites: ["media/photos/porto-01/01-s.jpg"], grandes: ["media/photos/porto-01/01.jpg"] };
  });
  assert.equal(await F.image("logement:porto-01", D2), "media/photos/porto-01/01-s.jpg");
  assert.equal(await F.image("logement:lisbon-01", D2), null);
  assert.equal(await F.image("https://www.example.com/x.jpg", D2), null);
  assert.equal(await F.image("media/photos/x/01-s.jpg", D2), "media/photos/x/01-s.jpg");
});

test("decouperTrajet: flight, transfer and ground trip lines of days.js, in the active language", () => {
  const v = J.decouperTrajet("Alex · TP9001 · New York (JFK) 07:10 → Lisbon (LIS) 19:00");
  assert.deepEqual(v, { type: "vol", principal: "Alex · New York (JFK) 07:10 → Lisbon (LIS) 19:00", details: ["TP9001"] });
  const t = J.decouperTrajet("Transfer Lisbon (LIS) → Casa · 25 min by car · private ≈ $35 · at the lodging around 20:50");
  assert.equal(t.type, "transfert");
  assert.equal(t.principal, "Transfer Lisbon (LIS) → Casa · at the lodging around 20:50");
  assert.deepEqual(t.details, ["25 min by car", "private ≈ $35"]);
  assert.equal(J.decouperTrajet("Alex + Sam · Lisbon 10:00 → Comporta 11:45 · Rental car").type, "autre");
  // the cards of the sample: every trip line is understood
  const cartes = Days.jourParJour(choix(), D);
  const lignes = cartes.flatMap((c) => c.trajets);
  assert.ok(lignes.filter((x) => J.decouperTrajet(x).type === "vol").length >= 5);
  assert.ok(lignes.filter((x) => J.decouperTrajet(x).type === "transfert").length >= 3);
});

test("alerts by day: by date, by outing named in the key, by leg named in the key; the rest apart", () => {
  const c = choix();
  const cartes = Days.jourParJour(c, D);
  const r = J.alertesParJour([
    { cle: "date-arrive-b", texte: "x" }, { cle: "depart-dernier-transport-comporta-porto", texte: "y" },
    { cle: "meme-moment-2027-06-16-soir", texte: "z" }, { cle: "unknown", texte: "w" },
  ], cartes, c, D);
  assert.deepEqual(Object.keys(r.parJour).sort(), ["2027-06-15", "2027-06-16", "2027-06-21"]);
  assert.deepEqual(r.autres.map((a) => a.texte), ["w"]);
});

test("movable outing: not a fixed date, not a special evening's choice, at least two possible days", () => {
  const s = H.sortie(D, "porto-cellar-tasting");
  const c = Object.assign(choix(), { sorties: { "porto-cellar-tasting": { jour: null } } });
  const cartes = Days.jourParJour(c, D);
  const poss = J.joursPossibles(s, cartes);
  assert.ok(poss.length >= 2);
  assert.equal(J.deplacable(s, c, poss), true);
  const sp = H.sortie(D, "porto-fireworks-dinner");
  assert.equal(J.deplacable(sp, Object.assign({}, c, { speciales: { "sao-joao": sp.id } }), poss), false);
});

test("days screen: stage sections titled from the trip, no French in English (sandbox)", () => {
  const c = choix();
  const b = bac(D, c, ["detail.js", "jours.js"]);
  b.ctx.ECRANS.jours(b.faux("ecran"), D, c, { cle: "jours", type: "jours" });
  const h = b.html();
  assert.match(h, /Lisbon/);
  assert.match(h, /Comporta/);
  assert.match(h, /You sleep at|Where you sleep/);
  assert.doesNotMatch(h, /[éèà]|vous deux|NaN|undefined/);
});

test("days screen on a trip without any lodging chosen: only the last card is the last day", () => {
  const D2 = H.variante(D, (x) => { for (const st of x.trip.stages) x.defaut[st.key] = null; });
  const c = choix(D2);
  for (const st of D2.trip.stages) assert.equal(c[st.key] || null, null, st.key);
  const b = bac(D2, c, ["detail.js", "jours.js"]);
  b.ctx.ECRANS.jours(b.faux("ecran"), D2, c, { cle: "jours", type: "jours" });
  const cartes = b.html().split('<article class="jr-jour').slice(1);
  assert.equal(cartes.length, 10);
  const derniere = cartes.pop();
  assert.match(derniere, /Last day/);
  assert.match(derniere, /no night here/);
  for (const x of cartes) {
    assert.doesNotMatch(x, /Last day|no night here/);
    assert.match(x, /lodging to choose/);
  }
});

test("plan: three lists, formalities apart, booked items last; deadline pills from T()", () => {
  const items = [
    { cle: "a", urgence: "rouge", type: "vol" }, { cle: "b", urgence: "vert", type: "logement" },
    { cle: "c", urgence: "vert", type: "formalite" }, { cle: "d", urgence: "rouge", type: "trajet" },
  ];
  const r = P.repartir(items, null, (k) => k === "a");
  assert.deepEqual(r.maintenant.map((x) => x.cle), ["d", "a"]);
  assert.deepEqual(r.attendre.map((x) => x.cle), ["b"]);
  assert.deepEqual(r.demarches.map((x) => x.cle), ["c"]);
  assert.deepEqual(P.echeance({ avant: "2026-11-20", urgence: "orange" }, "2026-11-07", false), { cls: "o", texte: "before Nov 20", jours: 13 });
  assert.equal(P.echeance({ avant: null }, "2026-11-07", false).texte, "date to confirm");
  assert.equal(P.echeance({}, "2026-11-07", true).texte, "done");
  assert.equal(P.texteMontant({ montant: null }).texte, "price to check");
});

test("plan: an item out of the shared budget is marked, a ground trip has its icon; on-the-spot per stage in both currencies", () => {
  const D2 = H.sansVolsDe(D, "b");
  const c = choix(D2);
  const items = Plan.planItems(c, D2, H.AUJ);
  const vb = items.find((i) => i.cle.startsWith("vol:arrive-b:"));
  assert.equal(P.estHors(vb), true);
  assert.equal(P.estHors(items.find((i) => i.cle.startsWith("vol:arrive-a:"))), false);
  assert.ok(items.some((i) => i.type === "trajet"));
  const groupes = Plan.surPlace(B.lignesVoyage(c, D2), creerTrip(D2).currency);
  const h = P.htmlSurPlace(groupes, D2);
  assert.match(h, /Lisbon/);
  assert.match(h, /€/, "the local amount, already converted");
  assert.match(h, /\$/);
});

test("plan screen: sections, 'when the money goes', no French in English (sandbox)", () => {
  const c = choix();
  const b = bac(D, c, ["detail.js", "plan-ecran.js"]);
  b.ctx.ECRANS.plan(b.faux("ecran"), D, c, { cle: "plan", type: "plan" });
  const h = b.html();
  assert.match(h, /Book now|To do now/);
  assert.match(h, /When the money goes/);
  assert.doesNotMatch(h, /[éèà]|vous deux|THB|NaN|undefined/);
});

test("detail screen: the trip's budget for its people, no French in English (sandbox)", () => {
  const c = choix();
  const b = bac(D, c, ["detail.js"]);
  const lignes = B.lignesVoyage(c, D);
  b.ctx.Parcours.lignes = lignes;
  b.ctx.Parcours.totaux = B.totaux(lignes, 6000);
  b.ctx.ECRANS.detail(b.faux("ecran"), D, c);
  const h = b.html();
  assert.match(h, /for 2 people/);
  assert.match(h, /\$6,129/);
  assert.match(h, /over \$6,000/);
  assert.doesNotMatch(h, /[éèà]|pour deux|NaN|undefined/);
});

test("exchange rate: shown with its date in the detail panel and the plan's on-the-spot block, hidden without a local currency", () => {
  assert.equal(F.texteTaux(D), "1 USD = 0.92 EUR · rate of November 7, 2026");
  const c = choix();
  const lignes = B.lignesVoyage(c, D);
  const t = B.totaux(lignes, 6000);
  assert.match(F.htmlDetail(D, c, lignes, t, {}), /1 USD = 0\.92 EUR · rate of November 7, 2026/);
  const groupes = Plan.surPlace(lignes, creerTrip(D).currency);
  assert.match(P.htmlSurPlace(groupes, D), /class="discret pl-taux">1 USD = 0\.92 EUR · rate of November 7, 2026</);

  H.preparerI18n(D, "fr");
  assert.equal(F.texteTaux(D), "1 USD = 0,92 EUR · taux du 7 novembre 2026");
  H.preparerI18n(D, "en");

  const sansDate = H.variante(D, (D2) => { D2.trip.currency.rate_date = null; });
  assert.equal(F.texteTaux(sansDate), "1 USD = 0.92 EUR");

  const sansLocale = H.variante(D, (D2) => { D2.trip.currency = { home: "USD", local: null, rate: null, rate_date: null }; });
  H.preparerI18n(sansLocale, "en");
  assert.equal(F.texteTaux(sansLocale), "");
  const l2 = B.lignesVoyage(B.resoudreChoix({}, sansLocale).choix, sansLocale);
  assert.doesNotMatch(F.htmlDetail(sansLocale, c, l2, B.totaux(l2, 6000), {}), /dt-taux|rate of/);
  assert.doesNotMatch(P.htmlSurPlace(Plan.surPlace(l2, creerTrip(sansLocale).currency), sansLocale), /pl-taux|rate of/);
  const sansTaux = H.variante(D, (D2) => { D2.trip.currency.rate = null; });
  assert.equal(F.texteTaux(sansTaux), "", "no rate: no local amount, no rate line");
});
