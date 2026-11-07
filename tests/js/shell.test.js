// The page shell (page/js/ui/shell.js): the screens and their groups come from the trip, every text through T().
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chargerDonnees, preparerI18n } = require("./helpers/donnees.js");
const { creerTrip } = require("../../page/js/logic/config.js");
const S = require("../../page/js/ui/shell.js");

const D = chargerDonnees();
const TRIP = creerTrip(D);
const PAGE = path.join(__dirname, "..", "..", "page");

test.afterEach(() => preparerI18n(D, "en"));

/** A trip with one stage and one traveler, as tripctx.py derives its legs. */
function tripSimple() {
  return creerTrip({
    trip: {
      slug: "solo", title: "Solo", language: "en", currency: { home: "EUR" }, budget_cap: 1000,
      travelers: [{ id: "a", label: "Alex", adults: 1, home_airport: "JFK", home_city: "New York" }],
      stages: [{ key: "s", title: "Seaside", from: "2027-06-15", to: "2027-06-18", file: "parcours-s.json" }],
      legs: [
        { key: "arrive-a", kind: "arrival", mode: "flight", travelers: ["a"], adults: 1, from_stage: null, to_stage: "s",
          from_airports: ["JFK"], to_airports: ["LIS"], date: "2027-06-15", in_budget: true },
        { key: "return-a", kind: "return", mode: "flight", travelers: ["a"], adults: 1, from_stage: "s", to_stage: null,
          from_airports: ["LIS"], to_airports: ["JFK"], date: "2027-06-18", in_budget: true },
      ],
      specials: [],
    },
  });
}

test("screens of sample", () => {
  assert.deepEqual(S.construireEcrans(TRIP).map((e) => e.cle),
    ["aller", "lisbon", "lisbon-sorties", "comporta", "comporta-sorties", "porto", "porto-sorties", "retour", "jours", "plan"]);
});

test("screens: type, stage and legs of each screen", () => {
  const e = {};
  S.construireEcrans(TRIP).forEach((x) => { e[x.cle] = x; });
  assert.deepEqual([e.aller.type, e.aller.legs], ["vols", ["arrive-a", "arrive-b"]]);
  assert.deepEqual([e.retour.type, e.retour.legs], ["vols", ["return-a", "return-b"]]);
  // a stage's lodging screen carries the between legs arriving there (ground or flight), shown at its top
  assert.deepEqual([e.lisbon.type, e.lisbon.stage, e.lisbon.legs], ["logement", "lisbon", []]);
  assert.deepEqual(e.comporta.legs, ["lisbon-comporta"]);
  assert.deepEqual(e.porto.legs, ["comporta-porto"]);
  assert.deepEqual([e["porto-sorties"].type, e["porto-sorties"].stage], ["sorties", "porto"]);
  assert.deepEqual([e.jours.type, e.plan.type], ["jours", "plan"]);
  assert.deepEqual(S.construireEcrans(TRIP).map((x) => x.groupe),
    ["aller", "lisbon", "lisbon", "comporta", "comporta", "porto", "porto", "retour", "plan", "plan"]);
});

test("screens single stage", () => {
  const t = tripSimple();
  assert.deepEqual(S.construireEcrans(t).map((e) => e.cle), ["aller", "s", "s-sorties", "retour", "jours", "plan"]);
  assert.equal(t.adults, 1);
  const g = S.construireGroupes(S.construireEcrans(t), t);
  assert.deepEqual(g.map((x) => x.cle), ["aller", "s", "retour", "plan"]);
  assert.equal(g[1].nom, "Seaside");
});

test("groups: one per screen family, numbered, titles from the data and T()", () => {
  const g = S.construireGroupes(S.construireEcrans(TRIP), TRIP);
  assert.deepEqual(g.map((x) => x.cle), ["aller", "lisbon", "comporta", "porto", "retour", "plan"]);
  assert.deepEqual(g.map((x) => x.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(g.slice(1, 4).map((x) => x.nom), ["Lisbon", "Comporta", "Porto"]);
  assert.deepEqual(g.find((x) => x.cle === "plan").ecrans.map((e) => e.cle), ["jours", "plan"]);
  // stage groups take the stage tone, the others the accent
  assert.deepEqual(g.map((x) => x.ton), ["accent", 1, 2, 3, "accent", "accent"]);
  for (const x of g) assert.ok(x.nom && !/^ui_/.test(x.nom), x.cle);
  preparerI18n(D, "fr");
  const fr = S.construireGroupes(S.construireEcrans(TRIP), TRIP);
  assert.notEqual(fr[0].nom, g[0].nom, "the arrivals group is translated");
  assert.equal(fr[1].nom, "Lisbon", "a stage title comes from the data");
});

test("screen texts: question, short label and tab from T() and the trip, never a key or a French word in English", () => {
  for (const e of S.construireEcrans(TRIP)) {
    const t = S.texteEcran(e, TRIP);
    for (const k of ["titre", "court"]) assert.ok(t[k] && !/^ui_/.test(t[k]), `${e.cle}.${k}`);
    assert.doesNotMatch(JSON.stringify(t), /[éèàù]| pour | deux |elle|lui/, e.cle);
  }
  const porto = S.texteEcran(S.construireEcrans(TRIP).find((e) => e.cle === "porto"), TRIP);
  assert.match(porto.titre, /Porto/);
  const sorties = S.texteEcran(S.construireEcrans(TRIP).find((e) => e.cle === "porto-sorties"), TRIP);
  assert.match(sorties.onglet + " " + sorties.sous, /São João night/, "the special evening is named on its stage's outings screen");
  const lis = S.texteEcran(S.construireEcrans(TRIP).find((e) => e.cle === "lisbon-sorties"), TRIP);
  assert.doesNotMatch(lis.onglet + " " + lis.sous, /São João/);
});

test("over-title: group name, dates and nights of the stage", () => {
  const g = S.construireGroupes(S.construireEcrans(TRIP), TRIP);
  assert.equal(S.surTitre(g.find((x) => x.cle === "comporta"), TRIP), "Comporta · Jun 18 → 21 · 3 nights");
  assert.match(S.surTitre(g.find((x) => x.cle === "plan"), TRIP), /Jun 15 → 24/);
});

test("a saved choice is reported on the screen where it changes", () => {
  assert.equal(S.groupeDuChamp("arrive-b", TRIP), "aller");
  assert.equal(S.groupeDuChamp("return-a", TRIP), "retour");
  assert.equal(S.groupeDuChamp("lisbon-comporta", TRIP), "comporta", "a between leg: its arriving stage");
  assert.equal(S.groupeDuChamp("comporta-porto", TRIP), "porto");
  assert.equal(S.groupeDuChamp("lisbon", TRIP), "lisbon");
  assert.equal(S.groupeDuChamp("speciales.sao-joao", TRIP), "porto");
  assert.equal(S.groupeDuChamp("sorties", TRIP), null);
  assert.equal(S.groupeDuChamp("nothing-known", TRIP), null);
});

test("template: doctype, language and title filled at build time, texts through data-t keys", () => {
  const t = fs.readFileSync(path.join(PAGE, "template.html"), "utf8");
  assert.match(t, /^<!doctype html>\s*<html lang="%%LANG%%" data-trip="%%SLUG%%">/i);
  assert.match(t, /<title>%%TITLE%%<\/title>/);
  assert.match(t, /<\/html>\s*$/);
  assert.ok(t.indexOf("%%APPCSS%%") > t.indexOf("<html") && t.indexOf("%%APPJS%%") < t.lastIndexOf("</html>"));
  assert.doesNotMatch(t, /[éèêàùçï]|carte\.html/, "no French text, no link to the old map page");
  const en = require("../../page/i18n/en.js");
  const cles = [...t.matchAll(/data-t(?:-aria|-title)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(cles.length >= 8, "the visible texts of the template are keys");
  for (const k of cles) assert.ok(k in en, k);
});
