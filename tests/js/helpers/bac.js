// A sandbox for the page's screens under node, without a browser: the real scripts (i18n, dictionaries, config, logic,
// then the asked UI files) run as classic scripts in one vm context, with a fake document and a minimal shell (UI,
// Parcours, patchChoix). Every element the screens create is kept, so a test can read the HTML they wrote.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { creerTrip } = require("../../../page/js/logic/config.js");

const PAGE = path.join(__dirname, "..", "..", "..", "page");

/** A fake element: keeps its listeners and children; every search gives another fake element. */
function faux(nom, crees) {
  const el = {
    nom: nom || "div", ecouteurs: [], enfants: [], style: {}, dataset: {}, hidden: false, disabled: false, innerHTML: "",
    textContent: "", className: "", isConnected: true, scrollTop: 0, scrollLeft: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { el.ecouteurs.push({ type, fn }); },
    removeEventListener() {},
    appendChild(c) { el.enfants.push(c); return c; },
    querySelector() { return faux("x", crees); },
    querySelectorAll() { return []; },
    contains() { return true; },
    closest() { return null; },
    setAttribute(k, v) { el["@" + k] = v; }, removeAttribute() {}, getAttribute(k) { return el["@" + k] || null; },
    hasAttribute() { return false; },
    focus() {}, scrollIntoView() {},
    get firstChild() { return el.enfants[0] || null; },
    get lastChild() { return faux("x", crees); },
  };
  if (crees) crees.push(el);
  return el;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * bac(D, choix, fichiers) -> { ctx, ecrits, crees, html() }. fichiers: names under page/js/ui/ ("vols.js"...).
 * ecrits: the patchChoix calls [field, value]; html(): every HTML written in the created elements, joined.
 */
function bac(D, choix, fichiers, lang) {
  const ecrits = [];
  const crees = [];
  const ctx = {
    console, setTimeout, clearTimeout, URL, Intl, WeakMap, Promise, Set, Map,
    fetch: () => Promise.reject(new Error("no network in the test")),
    Image: function () { return faux("img", crees); },
    IntersectionObserver: undefined,
    ECRANS: {},
    patchChoix: (champ, valeur) => { ecrits.push([champ, valeur]); return { maj: { [champ]: valeur } }; },
    document: { createElement: (n) => faux(n, crees), body: faux("body"), activeElement: null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const charger = (rel) => vm.runInContext(fs.readFileSync(path.join(PAGE, rel), "utf8"), ctx, { filename: rel });
  charger("js/i18n.js");
  charger("i18n/en.js");
  if (lang && lang !== "en") charger(`i18n/${lang}.js`);
  charger("js/logic/config.js");
  for (const f of fs.readdirSync(path.join(PAGE, "js", "logic")).sort()) if (f !== "config.js") charger(`js/logic/${f}`);
  ctx.TRIP = creerTrip(D);
  ctx.Parcours = { D, choix, totaux: null, lignes: null, alertes: [] };
  ctx.UI = {
    esc,
    safeUrl: (x) => (typeof x === "string" && /^https?:\/\//.test(x) ? x : ""),
    $: () => faux("x", crees), $$: () => [], toast() {}, icone: () => "", detail: () => false,
    ouvrirPanneau(titre, rendu) { const c = faux("pan-corps", crees); rendu(c); return c; },
    fermerPanneau() {},
  };
  for (const f of fichiers || []) charger(`js/ui/${f}`);
  const html = () => crees.map((e) => e.innerHTML).join("\n");
  return { ctx, ecrits, crees, html, faux: (n) => faux(n, crees) };
}

module.exports = { bac, faux, esc };
