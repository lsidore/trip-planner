// Translations and formats of the page (page/js/i18n.js, page/i18n/en.js, page/i18n/fr.js).
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { chargerDonnees, preparerI18n } = require("./helpers/donnees.js");
const I = require("../../page/js/i18n.js");
const { creerTrip } = require("../../page/js/logic/config.js");

const PAGE = path.join(__dirname, "..", "..", "page");
const D = chargerDonnees();

test.afterEach(() => preparerI18n(D, "en"));

test("i18n en and fr have the same keys", () => {
  const en = Object.keys(I.I18N.en).sort();
  const fr = Object.keys(I.I18N.fr).sort();
  assert.deepEqual(fr.filter((k) => !en.includes(k)), [], "keys only in fr");
  assert.deepEqual(en.filter((k) => !fr.includes(k)), [], "keys only in en");
  assert.ok(en.length > 100, "the four logic modules need many sentences");
});

test("i18n: the same placeholders and the same shape in both languages", () => {
  const vars = (v) => (typeof v === "string" ? v : JSON.stringify(v)).match(/\{[a-z_0-9]+\}/g) || [];
  for (const k of Object.keys(I.I18N.en)) {
    const a = I.I18N.en[k];
    const b = I.I18N.fr[k];
    assert.equal(Array.isArray(a), Array.isArray(b), k);
    assert.equal(typeof a, typeof b, k);
    if (Array.isArray(a)) assert.equal(a.length, b.length, k);
    else assert.deepEqual([...new Set(vars(b))].sort(), [...new Set(vars(a))].sort(), `placeholders of ${k}`);
  }
});

test("T falls back to en for missing key and reports it", () => {
  I.I18N.en.only_in_english_for_test = "Only {what} in English";
  try {
    I.setLang("fr");
    assert.equal(I.T("only_in_english_for_test", { what: "this" }), "Only this in English");
    assert.ok(I.T.missing.has("only_in_english_for_test"));
    // an unknown key everywhere: the key itself, reported too
    assert.equal(I.T("no_such_key_anywhere"), "no_such_key_anywhere");
    assert.ok(I.T.missing.has("no_such_key_anywhere"));
    // a key present in fr is not reported
    assert.equal(I.T("for_n_people", { n: 2 }), "pour 2 personnes");
    assert.ok(!I.T.missing.has("for_n_people"));
  } finally {
    delete I.I18N.en.only_in_english_for_test;
  }
});

test("T: placeholders, plural forms by n, language switch", () => {
  I.setLang("en");
  assert.equal(I.T("for_n_people", { n: 2 }), "for 2 people");
  assert.equal(I.T("for_n_people", { n: 1 }), "for 1 person");
  I.setLang("fr");
  assert.equal(I.T("for_n_people", { n: 1 }), "pour 1 personne");
  assert.equal(I.T("for_n_people", { n: 3 }), "pour 3 personnes");
  // an unknown language falls back to English, without reporting every key
  I.setLang("es");
  assert.equal(I.T("for_n_people", { n: 2 }), "for 2 people");
});

test("plural follows the language rule", () => {
  I.setLang("en");
  assert.equal(I.plural(1, "night", "nights"), "night");
  assert.equal(I.plural(0, "night", "nights"), "nights");
  assert.equal(I.plural(2, "night", "nights"), "nights");
  I.setLang("fr");
  assert.equal(I.plural(0, "nuit", "nuits"), "nuit");
  assert.equal(I.plural(1, "nuit", "nuits"), "nuit");
  assert.equal(I.plural(2, "nuit", "nuits"), "nuits");
});

test("fmtDate: short, long and weekday styles in en and fr; MOIS follows the language", () => {
  I.setLang("en");
  assert.equal(I.fmtDate("2027-06-15"), "Jun 15");
  assert.equal(I.fmtDate("2027-06-15", "long"), "June 15, 2027");
  assert.equal(I.fmtDate("2027-06-15", "weekday"), "Tue Jun 15");
  assert.equal(I.MOIS[5], "Jun");
  I.setLang("fr");
  assert.equal(I.fmtDate("2027-06-15"), "15 juin");
  assert.equal(I.fmtDate("2027-06-01"), "1er juin");
  assert.equal(I.fmtDate("2027-06-15", "long"), "15 juin 2027");
  assert.equal(I.fmtDate("2027-06-15", "weekday"), "mar. 15 juin");
  assert.equal(I.MOIS[11], "déc.");
  assert.equal(I.fmtDate("not a date"), "not a date");
  assert.equal(I.fmtDate(null), "");
});

test("fmtMoney: home currency in whole units, local converted with the rate", () => {
  I.setLang("en");
  assert.equal(I.fmtMoney(1234, "home"), "$1,234");
  assert.equal(I.fmtMoney(1234.4), "$1,234", "home by default, whole units");
  assert.equal(I.fmtMoney(-12, "home"), "-$12");
  const local = I.fmtMoney(100, "local"); // 100 USD × 0.92
  assert.ok(local.includes("€") && local.includes("92"), local);
  I.setLang("fr");
  const fr = I.fmtMoney(1234, "home");
  assert.ok(/^1\s234\s\$US$/u.test(fr), fr);
});

test("fmtMoney: USD at home and CAD on the spot render two different symbols", () => {
  const t = creerTrip(D);
  I.setTrip(Object.assign({}, t, { currency: { home: "USD", local: "CAD", rate: 1.37, rate_date: null } }));
  const symbole = (s) => s.replace(/[\d\s.,  -]/gu, "");
  for (const lang of ["en", "fr"]) {
    I.setLang(lang);
    const home = I.fmtMoney(100, "home");
    const local = I.fmtMoney(100, "local");
    assert.ok(home.includes("100") && local.includes("137"), `${lang}: ${home} / ${local}`);
    assert.ok(symbole(home) && symbole(local), `${lang}: ${home} / ${local}`);
    assert.notEqual(symbole(home), symbole(local), `${lang}: ${home} / ${local}`);
  }
  I.setLang("en");
  assert.equal(I.fmtMoney(100, "home"), "$100");
  assert.equal(I.fmtMoney(100, "local"), "CA$137");
});

test("fmtMoney: an amount already in the local currency is formatted as is, never converted twice", () => {
  I.setLang("en");
  assert.equal(I.fmtMoney(1024, "local", { converted: true }), "€1,024");
  assert.equal(I.fmtMoney(1024, "local"), "€942", "a home amount is converted with the rate 0.92");
  const t = creerTrip(D);
  I.setTrip(Object.assign({}, t, { currency: { home: "USD", local: null, rate: null, rate_date: null } }));
  assert.equal(I.fmtMoney(1024, "local", { converted: true }), "", "no local currency: nothing to show");
  I.setTrip(Object.assign({}, t, { currency: { home: "USD", local: "EUR", rate: null, rate_date: null } }));
  assert.equal(I.fmtMoney(1024, "local", { converted: true }), "€1,024", "already converted: the rate is not needed");
});

test("fmtMoney: no local block when local is null or the rate is unknown", () => {
  const t = creerTrip(D);
  I.setTrip(Object.assign({}, t, { currency: { home: "EUR", local: null, rate: null, rate_date: null } }));
  assert.equal(I.fmtMoney(50, "local"), "");
  assert.ok(I.fmtMoney(50, "home").includes("€"));
  I.setTrip(Object.assign({}, t, { currency: { home: "USD", local: "EUR", rate: null, rate_date: null } }));
  assert.equal(I.fmtMoney(50, "local"), "");
});

test("loaded as classic scripts (the page): globals T, fmtMoney, fmtDate, plural, MOIS; language from the global TRIP", () => {
  const ctx = vm.createContext({ console });
  for (const f of ["js/i18n.js", "i18n/en.js", "i18n/fr.js"]) {
    vm.runInContext(fs.readFileSync(path.join(PAGE, f), "utf8"), ctx, { filename: f });
  }
  for (const nom of ["T", "fmtMoney", "fmtDate", "plural"]) assert.equal(vm.runInContext(`typeof ${nom}`, ctx), "function", nom);
  assert.equal(vm.runInContext("T('for_n_people', {n: 2})", ctx), "for 2 people");
  ctx.TRIP = { language: "fr", currency: { home: "EUR", local: null, rate: null } };
  assert.equal(vm.runInContext("T('for_n_people', {n: 2})", ctx), "pour 2 personnes");
  assert.equal(vm.runInContext("fmtDate('2027-06-01')", ctx), "1er juin");
  assert.equal(vm.runInContext("MOIS[5]", ctx), "juin");
  assert.ok(vm.runInContext("fmtMoney(10)", ctx).includes("€"));
});

test("every literal key used in page/js exists in en (T() calls and key-like strings of the logic)", () => {
  const fichiers = [];
  const parcourir = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) parcourir(p);
      else if (n.endsWith(".js")) fichiers.push(p);
    }
  };
  parcourir(path.join(PAGE, "js"));
  const manquantes = [];
  for (const f of fichiers) {
    const src = fs.readFileSync(f, "utf8");
    const cles = new Set();
    // T and its aliases in the logic modules (alerts.js alrT, budget.js budT, days.js and plan.js tr): unprefixed keys too
    for (const m of src.matchAll(/\b(?:T|alrT|budT|tr)\(\s*["']([^"']+)["']/g)) cles.add(m[1]);
    for (const m of src.matchAll(/["']((?:bud|alr|days|plan|mode|nature|moment|dur)_[a-z0-9_]+)["']/g)) cles.add(m[1]);
    for (const k of cles) if (!(k in I.I18N.en)) manquantes.push(`${path.relative(PAGE, f)}: ${k}`);
  }
  assert.deepEqual(manquantes, []);
});

test("no traveler pronoun logic and no fixed stage or leg keys left in the logic modules", () => {
  // "aller" and "retour" remain as the shell's screen names (all arrival legs, all return legs), never as legs
  for (const f of ["budget.js", "days.js", "alerts.js", "plan.js", "config.js"]) {
    const src = fs.readFileSync(path.join(PAGE, "js", "logic", f), "utf8");
    assert.doesNotMatch(src, /\b(elle|lui|inclureAller|reveillon|noel)\b/i, f);
    assert.doesNotMatch(src, /["'](mer-nord|nord-bkk|mer|nord|lui)["']/, f);
    assert.doesNotMatch(src, /choix\.(aller|retour)\b|\[["'](aller|retour)["']\]/, f);
  }
});
