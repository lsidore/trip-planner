// Flight and ground-leg screens (page/js/ui/vols.js), on the sample trip: pure helpers under node, the screens in a
// sandbox (tests/js/helpers/bac.js). Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const { bac } = require("./helpers/bac.js");
const V = require("../../page/js/ui/vols.js");
const B = require("../../page/js/logic/budget.js");
const { creerTrip } = require("../../page/js/logic/config.js");

const D = H.chargerDonnees();
const TRIP = creerTrip(D);
const choix = () => B.resoudreChoix({}, D).choix;
const opt = (leg, id) => H.option(D, leg, id);
const ecran = (cle) => require("../../page/js/ui/shell.js").construireEcrans(TRIP).find((e) => e.cle === cle);

test.afterEach(() => H.preparerI18n(D, "en"));

test("durations and dates: hours and minutes, never NaN", () => {
  assert.equal(V.duree(410), "6 h 50");
  assert.equal(V.duree(120), "2 h");
  assert.equal(V.duree(45), "45 min");
  assert.equal(V.duree(null), "");
  assert.equal(V.duree(NaN), "");
  assert.equal(V.jourCourt("2027-06-15T07:10"), "Tue 15");
  assert.equal(V.heure("2027-06-15T07:10"), "07:10");
  assert.equal(V.plusJours(opt("arrive-a", "arrive-a-20270615-TP9001")), 0);
});

test("prixSites: the cheapest site read, blocked sites apart and never counted", () => {
  const o = H.copie(opt("arrive-a", "arrive-a-20270615-TP9001"));
  o.prix_par_site.push({ site: "Blocked", prix_home: 1, bloque: true, note: "robot check" }, { site: "Other", prix_home: 400, url: "https://www.example.com/x" });
  const p = V.prixSites(o);
  assert.deepEqual(p.lus.map((s) => s.site), ["Other", "Kiwi"]);
  assert.equal(p.min.prix, 400);
  assert.deepEqual(p.bloques.map((s) => s.site), ["Blocked"]);
  assert.equal(V.prixMin({ prix_par_site: [] }), null);
});

test("checked bag: included, priced supplement, or unknown (never 0)", () => {
  assert.deepEqual(V.valise(opt("arrive-a", "arrive-a-20270615-TP9001")), { etat: "comprise" });
  assert.deepEqual(V.valise(opt("arrive-a", "arrive-a-20270615-IB9002-IB9003")), { etat: "inconnu" });
  assert.deepEqual(V.valise({ valise: { ajout_home: 60 } }), { etat: "ajout", montant: 60 });
  assert.equal(V.prixAvecValise(opt("arrive-a", "arrive-a-20270615-IB9002-IB9003")).total, null);
  assert.equal(V.cabine({}).etat, "inconnu", "absent cabin bag: to check, never included");
});

test("sort and filter: cheapest, shortest, fewest stops; daytime arrival, bag included, direct", () => {
  const o = D.vols["arrive-a"].options;
  assert.deepEqual(V.trier(o, "prix").map((x) => x.id.split("-").pop()), ["IB9003", "TP9001", "AF9005"]);
  assert.deepEqual(V.trier(o, "court").map((x) => x.id.split("-").pop()), ["TP9001", "IB9003", "AF9005"]);
  assert.deepEqual(V.filtrer(o, { arrivee: true }).map((x) => x.id), ["arrive-a-20270615-TP9001"]);
  assert.equal(V.filtrer(o, { valise: true }).length, 2);
  assert.equal(V.filtrer(o, { escalesMax: 0 }).length, 1);
  assert.equal(V.filtrer(o, {}).length, 3);
  assert.deepEqual(V.extremes(o), { moinsCher: "arrive-a-20270615-IB9002-IB9003", plusCourt: "arrive-a-20270615-TP9001" });
});

test("airline names come from the data, never from a built-in table", () => {
  assert.equal(V.nomsCompagnies(opt("return-b", "return-b-20270624-TP9041-AC9042")), "TAP Air Portugal (example) + Air Canada (example)");
  assert.equal(V.nomsCompagnies({ compagnies: ["ZZ"] }), "ZZ");
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../page/js/ui/vols.js"), "utf8");
  assert.doesNotMatch(src, /["']?\b[A-Z0-9]{2}\b["']?\s*:\s*["'][^"']*\b(?:Air|Airways|Airlines)\b/, "no table of airline names");
});

test("pills: gap with the other traveler's arrival, generic and named by label", () => {
  const c = choix();
  const ctx = V.contexte(TRIP.legByKey["arrive-a"], D, c, {});
  const texte = (o) => V.puces(o, ctx).find((p) => p.cle === "ecart-arrivee");
  const tp = texte(opt("arrive-a", "arrive-a-20270615-TP9001"));
  assert.match(tp.texte, /Sam/);
  assert.match(tp.texte, /25 min/);
  assert.equal(tp.ton, "info");
  const ib = texte(opt("arrive-a", "arrive-a-20270615-IB9002-IB9003"));
  assert.match(ib.texte, /1 h 45/);
  assert.equal(ib.ton, "warn", "more than rules.arrival_gap_min (30 min)");
  // a return leg has no such pill
  const r = V.contexte(TRIP.legByKey["return-a"], D, c, {});
  assert.equal(V.puces(opt("return-a", "return-a-20270624-IB9033-IB9034"), r).some((p) => p.cle === "ecart-arrivee"), false);
});

test("pills: an arrival on another day than the trip's start gives extra or lost nights", () => {
  const D2 = H.avecHoraires(D, "arrive-a", "arrive-a-20270615-TP9001", "2027-06-14T07:10", "2027-06-14T19:00");
  const dd = V.decalageDates(TRIP.legByKey["arrive-a"], H.option(D2, "arrive-a", "arrive-a-20270615-TP9001"), D2, choix());
  assert.equal(dd.sens, "plus");
  assert.equal(dd.k, 1);
  assert.match(dd.texte, /Jun 14/);
  assert.match(dd.texte, /1 extra night/);
  assert.match(dd.texte, /Lisbon/);
  assert.equal(V.decalageDates(TRIP.legByKey["arrive-a"], opt("arrive-a", "arrive-a-20270615-TP9001"), D, choix()), null);
});

test("effect on the budget: '+$X to the budget' and the margin under the cap; out of budget; no cap: no margin", () => {
  const leg = TRIP.legByKey["arrive-a"];
  const c = choix();
  const tot = { marge: 500, incomplet: false, plafond: 6000 };
  assert.deepEqual(V.libelleEcart(leg, { montant: 120, incomplet: false }, c, tot, false).map((x) => x.texte),
    ["+$120 to the budget", "after: margin $380"]);
  assert.deepEqual(V.libelleEcart(leg, { montant: -45, incomplet: false }, c, tot, false)[0], { ton: "good", texte: "−$45 to the budget" });
  assert.deepEqual(V.libelleEcart(leg, { montant: 600, incomplet: false }, c, tot, false)[1].texte, "after: $100 over $6,000");
  assert.deepEqual(V.libelleEcart(leg, null, c, tot, false), [], "no computation: nothing written");
  assert.deepEqual(V.libelleEcart(leg, { montant: 120 }, c, { marge: null, plafond: null }, false).map((x) => x.texte), ["+$120 to the budget"]);
  const D2 = H.sansVolsDe(D, "b");
  const legB = creerTrip(D2).legByKey["arrive-b"];
  const cB = B.resoudreChoix({}, D2).choix;
  assert.deepEqual(V.libelleEcart(legB, null, cB, tot, true, D2).map((x) => x.texte), ["outside the shared budget"]);
});

test("flight cards: never NaN, undefined or an empty price, for every flight of every leg", () => {
  const c = choix();
  for (const leg of TRIP.legs.filter((l) => l.mode === "flight")) {
    const ctx = V.contexte(leg, D, c, {});
    for (const o of D.vols[leg.key].options) {
      const h = V.htmlCarte(o, ctx, { choisi: false, ecart: [] });
      assert.doesNotMatch(h, /NaN|undefined|null|\[object/, o.id);
      assert.match(h, /\$\d/, o.id);
      assert.match(h, /Choose this flight/);
      for (const s of o.segments) assert.ok(h.includes(s.vol), s.vol);
    }
  }
});

test("arrival screen shows one block per arrival leg", () => {
  const html = V.htmlEcranVols(ecran("aller"), D, choix(), {});
  const blocs = [...html.matchAll(/<section class="vol-leg" data-leg="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(blocs, ["arrive-a", "arrive-b"]);
  assert.match(html, /Alex/);
  assert.match(html, /Sam/);
  assert.match(html, /New York/);
  assert.match(html, /Montreal/);
  // the return screen: the two return legs
  const r = V.htmlEcranVols(ecran("retour"), D, choix(), {});
  assert.deepEqual([...r.matchAll(/data-leg="([^"]+)"/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i), ["return-a", "return-b"]);
});

test("the flights screen registers by type and renders every leg of its screen (sandbox)", () => {
  const c = choix();
  const b = bac(D, c, ["vols.js"]);
  assert.equal(typeof b.ctx.ECRANS.vols, "function");
  assert.equal(b.ctx.ECRANS.aller, undefined, "no screen registered under a fixed key");
  b.ctx.ECRANS.vols(b.faux("ecran"), D, c, ecran("aller"));
  const h = b.html();
  assert.ok(h.includes('data-leg="arrive-a"') && h.includes('data-leg="arrive-b"'));
  assert.doesNotMatch(h, /NaN|undefined|\bnull\b/);
});

test("out-of-budget leg: 'include in the budget' toggle stored in choix.inclure[leg]", () => {
  const D2 = H.sansVolsDe(D, "b");
  const c = B.resoudreChoix({}, D2).choix;
  const T2 = creerTrip(D2);
  const html = V.htmlEcranVols(require("../../page/js/ui/shell.js").construireEcrans(T2)[0], D2, c, {});
  const parLeg = (k) => html.split('<section class="vol-leg"').find((x) => x.includes(`data-leg="${k}"`));
  assert.match(parLeg("arrive-b"), /data-va="inclure"/);
  assert.match(parLeg("arrive-b"), /outside the shared budget/i);
  assert.doesNotMatch(parLeg("arrive-a"), /data-va="inclure"/, "a leg in the budget has no toggle");
  // the click writes one key of choix.inclure
  const b = bac(D2, c, ["vols.js"]);
  const racine = b.faux("ecran");
  b.ctx.ECRANS.vols(racine, D2, c, require("../../page/js/ui/shell.js").construireEcrans(T2)[0]);
  const wraps = b.crees.filter((e) => e.ecouteurs.some((x) => x.type === "change"));
  const wrapB = wraps.find((w) => w.innerHTML.includes('data-leg="arrive-b"'));
  const cible = { checked: true, getAttribute: (k) => (k === "data-va" ? "inclure" : k === "data-vleg" ? "arrive-b" : null) };
  wrapB.ecouteurs.filter((x) => x.type === "change").forEach((x) => x.fn({ target: cible }));
  assert.deepEqual(JSON.parse(JSON.stringify(b.ecrits)), [["inclure", { "arrive-b": true }]]);
});

test("ground leg block: both options as cards (mode, operator, duration, price), one choice per leg", () => {
  const c = choix();
  const h = V.htmlBlocTrajet("lisbon-comporta", D, c, {});
  assert.match(h, /Rental car, pick-up in Lisbon/);
  assert.match(h, /Intercity bus to Setúbal/);
  assert.match(h, /1 h 45/);
  assert.match(h, /3 h 30/);
  assert.match(h, /\$96/);
  assert.match(h, /\$52/);
  assert.match(h, /by car/);
  assert.match(h, /by bus then by boat/);
  assert.match(h, /Lisbon → Comporta/);
  assert.match(h, /data-vid="lisbon-comporta-2"/, "the other option can be chosen");
  assert.match(h, /Your choice/);
  assert.doesNotMatch(h, /NaN|undefined|\bnull\b/);
  // choosing writes choix.<leg>
  const b = bac(D, c, ["vols.js"]);
  const box = b.faux("box");
  b.ctx.blocTrajet(box, "lisbon-comporta", D, c);
  const wrap = box.enfants[0];
  const bouton = { getAttribute: (k) => ({ "data-va": "choisir", "data-vid": "lisbon-comporta-2" }[k] || null) };
  wrap.ecouteurs.filter((x) => x.type === "click").forEach((x) => x.fn({ target: { closest: () => bouton } }));
  assert.deepEqual(b.ecrits, [["lisbon-comporta", "lisbon-comporta-2"]]);
});

test("flight leg block between stages: the chosen flight, then 'Change flight', titled from the stages", () => {
  const h = V.htmlBlocTrajet("comporta-porto", D, choix(), {});
  assert.match(h, /Comporta → Porto/);
  assert.match(h, /FR9022/);
  assert.match(h, /Change flight \(2 others\)/);
  const ouvert = V.htmlBlocTrajet("comporta-porto", D, choix(), { ouvert: true });
  assert.match(ouvert, /TP9021/);
  assert.match(ouvert, /TP9023/);
  assert.equal(V.htmlBlocTrajet("no-such-leg", D, choix(), {}), "");
});

test("a ground leg out of the shared budget has the same 'Add it to see' toggle (every traveler out of budget)", () => {
  const D2 = H.sansVolsDe(H.sansVolsDe(D, "a"), "b");
  const T2 = creerTrip(D2);
  assert.equal(T2.legByKey["lisbon-comporta"].mode, "ground");
  assert.equal(T2.legByKey["lisbon-comporta"].in_budget, false);
  const c = B.resoudreChoix({}, D2).choix;
  const h = V.htmlBlocTrajet("lisbon-comporta", D2, c, {});
  assert.match(h, /data-va="inclure" data-vleg="lisbon-comporta"/);
  assert.match(h, /outside the shared budget/i);
  assert.match(h, /\(\$96\)/, "the amount the toggle adds");
  assert.doesNotMatch(V.htmlBlocTrajet("lisbon-comporta", D, choix(), {}), /data-va="inclure"/, "in the budget: no toggle");
  // on the lodging screen of the arriving stage, a change writes one key of choix.inclure
  const b = bac(D2, c, ["vols.js", "logement.js"]);
  b.ctx.ECRANS.logement(b.faux("ecran"), D2, c, require("../../page/js/ui/shell.js").construireEcrans(T2).find((e) => e.cle === "comporta"));
  const wrap = b.crees.find((e) => e.ecouteurs.some((x) => x.type === "change") && e.innerHTML.includes('data-vleg="lisbon-comporta"'));
  assert.ok(wrap, "the ground block listens to its toggle");
  const cible = { checked: true, getAttribute: (k) => (k === "data-va" ? "inclure" : k === "data-vleg" ? "lisbon-comporta" : null) };
  wrap.ecouteurs.filter((x) => x.type === "change").forEach((x) => x.fn({ target: cible }));
  assert.deepEqual(JSON.parse(JSON.stringify(b.ecrits)), [["inclure", { "lisbon-comporta": true }]]);
});

test("escaping: nothing from the data reaches the HTML raw", () => {
  const D2 = H.variante(D, (x) => {
    x.vols["arrive-a"].options[1].compagnies_noms.TP = "<b>x</b>";
    x.vols["lisbon-comporta"].options[0].operateur = "<img src=x onerror=1>";
  });
  const c = B.resoudreChoix({}, D2).choix;
  const t = V.htmlEcranVols(require("../../page/js/ui/shell.js").construireEcrans(creerTrip(D2))[0], D2, c, {});
  assert.ok(!t.includes("<b>x</b>"));
  assert.ok(!V.htmlBlocTrajet("lisbon-comporta", D2, c, {}).includes("<img src=x"));
});

test("label and value: '<site>: <price>' in English, '<site> : <price>' in French", () => {
  const en = V.htmlEcranVols(ecran("aller"), D, choix(), {});
  assert.match(en, /Kiwi ↗<\/a>: <b>\$/);
  assert.doesNotMatch(en, /\S : <b>/);
  H.preparerI18n(D, "fr");
  const fr = V.htmlEcranVols(ecran("aller"), D, choix(), {});
  assert.match(fr, /Kiwi ↗<\/a> : <b>/);
});

test("French: the same screen reads in French, no English key left", () => {
  H.preparerI18n(D, "fr");
  const h = V.htmlEcranVols(ecran("aller"), D, choix(), {});
  assert.match(h, /Choisir ce vol/);
  assert.doesNotMatch(h, /\b(?:fl|gd|ui)_[a-z_]+/);
});

test("a leg never researched says 'not researched yet'; a leg searched without result keeps 'run the search again'", () => {
  const ecrans = require("../../page/js/ui/shell.js");
  const jamais = H.variante(D, (D2) => { D2.vols["arrive-a"] = { mode: "flight", grille: [], options: [] }; delete D2.vols["comporta-porto"]; });
  const c = B.resoudreChoix({}, jamais).choix;
  const T2 = creerTrip(jamais);
  const html = V.htmlEcranVols(ecrans.construireEcrans(T2)[0], jamais, c, {});
  const parLeg = (h, k) => h.split('<section class="vol-leg"').find((x) => x.includes(`data-leg="${k}"`));
  assert.match(parLeg(html, "arrive-a"), /Not researched yet\./);
  assert.doesNotMatch(parLeg(html, "arrive-a"), /Run the flight search again/);
  assert.equal(V.jamaisCherche(jamais, "arrive-a"), true);
  assert.equal(V.jamaisCherche(jamais, "arrive-b"), false);
  assert.match(V.htmlBlocTrajet("comporta-porto", jamais, c, {}), /Not researched yet\./);

  const vide = H.variante(D, (D2) => { D2.vols["arrive-a"].options = []; });   // searched: a grid, no option kept
  const h2 = V.htmlEcranVols(ecrans.construireEcrans(creerTrip(vide))[0], vide, B.resoudreChoix({}, vide).choix, {});
  assert.match(parLeg(h2, "arrive-a"), /Run the flight search again/);

  H.preparerI18n(jamais, "fr");
  assert.match(parLeg(V.htmlEcranVols(ecrans.construireEcrans(T2)[0], jamais, c, {}), "arrive-a"), /Pas encore cherché\./);
  H.preparerI18n(D, "en");
});
