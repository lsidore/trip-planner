// Theme, fonts, language rules of the page sources and the money display.
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const I = require("../../page/js/i18n.js");
const { chargerDonnees, preparerI18n } = require("./helpers/donnees.js");
const { creerTrip } = require("../../page/js/logic/config.js");
const S = require("../../page/js/ui/shell.js");

const PAGE = path.join(__dirname, "..", "..", "page");
const D = chargerDonnees();

test.afterEach(() => preparerI18n(D, "en"));

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

/** The string literals of a JS source (comments skipped, regex literals skipped). */
function literals(src) {
  const out = [];
  let i = 0, prev = "";
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out.push(src.slice(i + 1, j));
      i = j + 1; prev = "x"; continue;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{};+".includes(prev))) {
      let j = i + 1, cls = false;
      while (j < src.length && (src[j] !== "/" || cls)) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j++;
      }
      i = j + 1; prev = "x"; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const FRENCH = /[éèêàùçôîœ]|\s(?:le|la|les|pour|avec)\s/i;

test("no French literal outside fr.js", () => {
  const found = [];
  for (const f of walk(path.join(PAGE, "js"), ".js")) {
    for (const s of literals(fs.readFileSync(f, "utf8"))) if (FRENCH.test(s)) found.push(`${path.relative(PAGE, f)}: ${s.slice(0, 60)}`);
  }
  const tpl = fs.readFileSync(path.join(PAGE, "template.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  if (FRENCH.test(tpl)) found.push("template.html: " + tpl.match(FRENCH)[0]);
  assert.deepEqual(found, []);
  assert.ok(literals('x = "é"; // "à"\n/* "ç" */ y = /["é]/;').join("|") === "é", "the scanner skips comments and regexes");
});

test("theme: tone tokens 1..5 in light and dark, no destination colours or fonts", () => {
  const css = [path.join(PAGE, "app.css"), ...walk(path.join(PAGE, "css"), ".css")].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const app = fs.readFileSync(path.join(PAGE, "app.css"), "utf8");
  const blocs = app.match(/:root\{[^}]*\}|:root:not\(\[data-theme="light"\]\)\{[^}]*\}|:root\[data-theme="dark"\]\{[^}]*\}/g) || [];
  assert.ok(blocs.length >= 3, "light, prefers-color-scheme dark and [data-theme=dark]");
  for (const b of blocs) for (let n = 1; n <= 5; n++) assert.ok(b.includes(`--tone-${n}:`), `--tone-${n} in ${b.slice(0, 30)}`);
  assert.doesNotMatch(css, /--(?:sea|jungle|city)\b|\.ton-(?:sea|jungle|city)\b/);
  for (let n = 1; n <= 5; n++) assert.ok(css.includes(`.ton-tone-${n}{--ton:var(--tone-${n})}`), `class for tone ${n}`);
  const tpl = fs.readFileSync(path.join(PAGE, "template.html"), "utf8");
  assert.doesNotMatch(css + tpl, /Chonburi|Sarabun/);
  assert.match(tpl, /fonts\.googleapis\.com/);
  assert.match(css, /--display:[^;]*serif/);
  assert.match(css, /--body:[^;]*sans-serif/);
});

test("no single-side accent border on a card", () => {
  const css = walk(path.join(PAGE, "css"), ".css").concat(path.join(PAGE, "app.css")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) || [];
  const bad = rules.filter((r) => /border-(?:left|right|top|bottom)\s*:\s*[2-9]px/.test(r) || /border-inline-(?:start|end)\s*:\s*[2-9]px/.test(r));
  assert.deepEqual(bad, []);
});

test("tone class: stage tone 1..5 maps to --tone-N, other groups to the accent", () => {
  assert.equal(S.tonCss(1), "tone-1");
  assert.equal(S.tonCss(5), "tone-5");
  assert.equal(S.tonCss(6), "tone-1", "wraps after 5");
  assert.equal(S.tonCss("accent"), "accent");
  assert.equal(S.tonCss(null), "accent");
  assert.equal(S.tonCss(0), "accent");
});

test("money uses the trip currency and language", () => {
  const t = creerTrip(D);
  I.setTrip(Object.assign({}, t, { language: "en", currency: { home: "USD", local: "EUR", rate: 0.92, rate_date: null } }));
  I.setLang("en");
  assert.equal(I.fmtMoney(1234, "home"), "$1,234");
  assert.equal(I.fmtMoney(1000, "local"), "€920");
  I.setTrip(Object.assign({}, t, { currency: { home: "EUR", local: null, rate: null, rate_date: null } }));
  assert.equal(I.fmtMoney(1234, "home"), "€1,234");
});

test("no local block when home == local", () => {
  const t = creerTrip(D);
  I.setTrip(Object.assign({}, t, { currency: { home: "USD", local: "USD", rate: 1, rate_date: null } }));
  I.setLang("en");
  assert.equal(I.fmtMoney(100, "local"), "");
  assert.equal(I.fmtMoney(100, "local", { converted: true }), "");
  assert.equal(I.fmtMoney(100, "home"), "$100");
});
