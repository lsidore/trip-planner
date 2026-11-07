// Translations and formats of the page. Loaded first, before page/i18n/en.js and the trip language's file.
//
// Globals (the page) and module.exports (node):
//   T(key, vars)           the sentence `key` in the active language, "{name}" placeholders replaced by vars.name.
//                          A value {one, other} is a plural form chosen by vars.n. A key missing in the active language
//                          falls back to English and is recorded in T.missing (a Set); missing everywhere: the key itself.
//   fmtMoney(amount, which, opts) "home" (default): the travelers' currency; "local": a home amount converted with
//                          TRIP.currency.rate into the local currency, "" when there is no local currency or no rate.
//                          opts.converted: the amount is already in the local currency (surPlace's `local`): formatted
//                          as is, never converted twice. Whole units; the currency symbol of the language ("$", "CA$",
//                          "€"), so home and local amounts are never confused.
//                          opts.exact: cents when the amount is not whole ("$4.50"), whole units otherwise.
//   fmtDate(iso, style)    "short" (default) "Jun 15" / "15 juin", "long" "June 15, 2027", "weekday" "Tue Jun 15".
//   plural(n, one, other)  the form for n in the active language.
//   MOIS                   short month names of the active language.
// The active language is the one given to setLang(), else the global TRIP's language (set by the page), else "en".
// The currencies come from setTrip(), else the global TRIP. Dictionaries: I18N.en, I18N.fr (page/i18n/*.js).
var I18N = typeof I18N !== "undefined" ? I18N : {};

var T = (function () {
  "use strict";

  var etat = { lang: null, trip: null };
  var missing = new Set();
  var MOIS_LIVE = [];

  function globalTrip() {
    return typeof TRIP !== "undefined" && TRIP ? TRIP : null;
  }
  function tripActif() {
    return etat.trip || globalTrip();
  }
  function langue() {
    var t = globalTrip();
    var l = etat.lang || (t && t.language) || "en";
    return I18N[l] ? l : "en";
  }
  function dico(l) {
    return I18N[l] || {};
  }

  function plural(n, one, other) {
    var x = Math.abs(Number(n));
    var unique = langue() === "fr" ? x < 2 : x === 1;
    return unique ? one : other;
  }

  function remplir(s, vars) {
    if (typeof s !== "string" || !vars) return s;
    return s.replace(/\{([a-z_0-9]+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
    });
  }

  function T(key, vars) {
    var l = langue();
    var v = dico(l)[key];
    if (v === undefined) {
      if (l !== "en" || !(key in dico("en"))) missing.add(key);
      v = dico("en")[key];
    }
    if (v === undefined) return key;
    if (v && typeof v === "object" && !Array.isArray(v) && "other" in v) {
      v = plural(vars && vars.n !== undefined ? vars.n : 2, v.one, v.other);
    }
    return remplir(v, vars);
  }

  /** The array value of a key (month names...), from the active language, else English. */
  function liste(key) {
    var v = dico(langue())[key];
    if (!Array.isArray(v)) v = dico("en")[key];
    return Array.isArray(v) ? v : [];
  }

  function fmtDate(iso, style) {
    if (iso === null || iso === undefined) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var jour = d === 1 ? T("date_first_day") : String(d);
    var vars = { d: jour, m: liste("months_short")[mo - 1], y: y };
    if (style === "long") {
      vars.m = liste("months_long")[mo - 1];
      return T("date_long", vars);
    }
    if (style === "weekday") {
      vars.w = liste("days_short")[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
      return T("date_weekday", vars);
    }
    return T("date_short", vars);
  }

  function devises() {
    var t = tripActif();
    return (t && t.currency) || {};
  }

  /** Whole units, Intl currency format of the active language; a simple form when Intl cannot format the code. */
  function formater(n, code, exact) {
    var l = langue();
    var cents = !!exact && Math.abs(n - Math.round(n)) >= 0.005;   // exact: cents only when the amount is not whole
    var x = cents ? Math.round(n * 100) / 100 + 0 : Math.round(n) + 0;
    var d = cents ? 2 : 0;
    try {
      return new Intl.NumberFormat(l, { style: "currency", currency: code, currencyDisplay: "symbol", minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
    } catch (e) {
      var s = (cents ? Math.abs(x).toFixed(2).replace(".", l === "fr" ? "," : ".") : String(Math.abs(x))).replace(/\B(?=(\d{3})+(?!\d))/g, l === "fr" ? " " : ",");
      return (x < 0 ? "-" : "") + (l === "fr" ? s + " " + code : code + " " + s);
    }
  }

  function fmtMoney(amount, which, opts) {
    if (typeof amount !== "number" || !isFinite(amount)) return "";
    var c = devises();
    if (which === "local") {
      if (!c.local || c.local === c.home) return "";
      if (opts && opts.converted) return formater(amount, c.local, opts.exact);
      if (typeof c.rate !== "number" || !isFinite(c.rate)) return "";
      return formater(amount * c.rate, c.local, opts && opts.exact);
    }
    if (!c.home) return String(Math.round(amount));
    return formater(amount, c.home, opts && opts.exact);
  }

  function rafraichirMois() {
    var m = liste("months_short");
    MOIS_LIVE.length = 0;
    for (var i = 0; i < m.length; i++) MOIS_LIVE.push(m[i]);
    return MOIS_LIVE;
  }

  T.missing = missing;
  T.setLang = function (l) {
    etat.lang = l || null;
    rafraichirMois();
  };
  T.setTrip = function (t) {
    etat.trip = t || null;
  };
  T.lang = langue;
  T.mois = rafraichirMois;
  T.fmtDate = fmtDate;
  T.fmtMoney = fmtMoney;
  T.plural = plural;
  return T;
})();

var fmtDate = T.fmtDate;
var fmtMoney = T.fmtMoney;
var plural = T.plural;

// MOIS follows the active language: a live getter in the page, refreshed on each read.
(function () {
  var racine = typeof globalThis !== "undefined" ? globalThis : this;
  if (typeof module === "undefined" && racine && !Object.getOwnPropertyDescriptor(racine, "MOIS")) {
    try {
      Object.defineProperty(racine, "MOIS", { get: function () { return T.mois(); }, set: function () {}, configurable: true });
    } catch (e) {
      racine.MOIS = T.mois();
    }
  }
})();

if (typeof module !== "undefined") {
  I18N.en = require("../i18n/en.js");
  I18N.fr = require("../i18n/fr.js");
  module.exports = {
    T: T, fmtMoney: fmtMoney, fmtDate: fmtDate, plural: plural, I18N: I18N,
    setLang: T.setLang, setTrip: T.setTrip,
    get MOIS() { return T.mois(); },
  };
}
