// Loads the sample trip's page data the way the page does: parcours.json, then each trip.stages[].file stored in
// D.lieux[<stage key>]. Every call returns a fresh copy that a test may change.
// Loading this helper also sets the i18n state of the test process: English, and the sample trip's currencies
// (fmtMoney reads them), unless a test calls preparerI18n again.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const I18n = require("../../../page/js/i18n.js");
const { creerTrip } = require("../../../page/js/logic/config.js");

const DIR = path.join(__dirname, "..", "..", "fixtures", "sample-built");
const AUJ = "2026-11-07"; // "today" of the sample data (all prices checked that day)
let texte = null;

function lire() {
  if (!texte) {
    texte = { D: fs.readFileSync(path.join(DIR, "parcours.json"), "utf8") };
    for (const s of JSON.parse(texte.D).trip.stages) texte[s.key] = fs.readFileSync(path.join(DIR, s.file), "utf8");
  }
  return texte;
}

function chargerDonnees() {
  const t = lire();
  const D = JSON.parse(t.D);
  D.lieux = {};
  for (const s of D.trip.stages) D.lieux[s.key] = JSON.parse(t[s.key]);
  return D;
}

function copie(o) {
  return JSON.parse(JSON.stringify(o));
}

function preparerI18n(D, lang) {
  I18n.setLang(lang || "en");
  I18n.setTrip(creerTrip(D || chargerDonnees()));
}

// ------------------------------------------------------------------ variants of D (deep copies, D is never changed)

/** The stage holding this outing. */
function etapeDeSortie(D, id) {
  return D.trip.stages.map((s) => s.key).find((k) => D.lieux[k].sorties.some((s) => s.id === id)) || null;
}

function sortie(D, id) {
  const k = etapeDeSortie(D, id);
  return k ? D.lieux[k].sorties.find((s) => s.id === id) : null;
}

function logement(D, stage, id) {
  return D.lieux[stage].logements.concat(D.lieux[stage].autres).find((l) => l.id === id) || null;
}

function option(D, leg, id) {
  return D.vols[leg].options.find((o) => o.id === id) || null;
}

/** Copy of D with fn applied to the copy (fn may change it in place). */
function variante(D, fn) {
  const D2 = copie(D);
  fn(D2);
  return D2;
}

/** Copy of D where this lodging's access is patched. */
function avecAcces(D, stage, id, patch) {
  return variante(D, (D2) => Object.assign(logement(D2, stage, id).acces, patch));
}

/** Copy of D where this outing is patched. */
function avecSortie(D, id, patch) {
  return variante(D, (D2) => Object.assign(sortie(D2, id), patch));
}

/**
 * Copy of D where an option's segments are moved: dep / arr are "YYYY-MM-DDTHH:MM" local times for the first departure
 * and the last arrival; UTC times shift by the same amount.
 */
function avecHoraires(D, leg, id, dep, arr) {
  return variante(D, (D2) => {
    const o = option(D2, leg, id);
    const decale = (local, utc, nouveau) => {
      const delta = Date.parse(nouveau + ":00Z") - Date.parse(local + ":00Z");
      return new Date(Date.parse(utc.replace("Z", ":00Z")) + delta).toISOString().slice(0, 16) + "Z";
    };
    const s0 = o.segments[0];
    const sN = o.segments[o.segments.length - 1];
    if (dep) {
      s0.dep_utc = decale(s0.dep_local, s0.dep_utc, dep);
      s0.dep_local = dep;
    }
    if (arr) {
      sN.arr_utc = decale(sN.arr_local, sN.arr_utc, arr);
      sN.arr_local = arr;
    }
  });
}

/** Copy of D as page_data.py writes it when a traveler's own flights stay out of the shared budget. */
function sansVolsDe(D, voyageur) {
  return variante(D, (D2) => {
    D2.trip.travelers.find((t) => t.id === voyageur).flights_in_budget = false;
    for (const l of D2.trip.legs) {
      const dans = l.travelers.some((id) => D2.trip.travelers.find((t) => t.id === id).flights_in_budget !== false);
      l.in_budget = dans;
      D2.defaut.inclure[l.key] = dans;
      for (const o of D2.vols[l.key].options) {
        for (const x of o.lignes || []) {
          if (dans) delete x.hors_budget;
          else {
            x.hors_budget = true;
            x.note = (x.note ? x.note + " · " : "") + "outside the shared budget";
          }
        }
      }
    }
  });
}

// ------------------------------------------------------------------ checks

const somme = (liste) => liste.reduce((s, x) => s + x, 0);
const r2 = (x) => Math.round(x * 100) / 100;
const plusJours = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const jours = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** No NaN / Infinity / undefined value, no "NaN", "undefined", "null" or "[object" inside a text. */
function propre(x, chemin) {
  const ici = chemin || "value";
  if (x === undefined) throw new Error(`${ici} is undefined`);
  if (typeof x === "number" && !Number.isFinite(x)) throw new Error(`${ici} = ${x}`);
  if (typeof x === "string" && !x.startsWith("data:") && /\bNaN\b|\bundefined\b|\bnull\b|Infinity|\[object/.test(x)) {
    throw new Error(`${ici}: "${x}"`);
  }
  if (Array.isArray(x)) x.forEach((v, k) => propre(v, `${ici}[${k}]`));
  else if (x && typeof x === "object") for (const k of Object.keys(x)) propre(x[k], `${ici}.${k}`);
}

preparerI18n();

module.exports = {
  DIR, AUJ, chargerDonnees, copie, preparerI18n, etapeDeSortie, sortie, logement, option, variante, avecAcces, avecSortie,
  avecHoraires, sansVolsDe, somme, r2, plusJours, jours, propre,
};
