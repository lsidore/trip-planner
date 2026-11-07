/* Saved choices of the page.
   - Store.choix: the saved choices, laid over the defaults (D.defaut). Each change writes ONE field (patchChoix): two
     people changing two things at the same time never overwrite each other.
   - Store.favs (♥ per lodging or place) and Store.resa ("booked" boxes of the plan).
   - Two adapters, in this order: (1) the local server (scripts/server.py, Store.mode "serveur") when the page is served
     by it on this computer (127.0.0.1, localhost, [::1]): everything is written in the trip's state file, one field at a time
     (PUT /api/etat), as "nous" (one shared screen); (2) otherwise everything stays in this browser (Store.mode "local"):
     localStorage, keys prefixed "tp-<trip slug>-" so that two trips never share their choices. If the server stops on
     the way, the page goes back to "local" without losing anything and says so.
   Wrapped classic script: exposes only Store, patchChoix, superposer, fusionProfonde, keySafe, lsGet, lsSet,
   cleFavoriLogement, cleFavoriLieu (on window; module.exports for node, tests/js/store.test.js). Messages through T(). */

(function () {
"use strict";

var CHOIX_CHEMIN = "parcours/choix";
var UID_SERVEUR = "nous";               // one shared screen: favorites and "booked" belong to "nous"
var CHAMPS_META = { v: 1 };             // technical fields of the state, never choices

/* Texts of the store (T() of page/js/i18n.js: a global in the page, require under node). */
function tr(cle, vars) {
  var f = typeof T === "function" ? T : require("../i18n.js").T;
  return f(cle, vars);
}

function keySafe(k) { return String(k).replace(/[^A-Za-z0-9_\-.~:@+]/g, "_").slice(0, 180); }
function lsGet(k, d) {
  try { if (typeof localStorage === "undefined") return d; var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
  catch (e) { return d; }
}
function lsSet(k, v) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  // Simple / Detailed (the shell's choice) is copied into the server's state: it follows the person from one browser to another
  if (k === cle("mode") && typeof v === "string" && Store.mode === "serveur") ecrireServeur(["mode"], v, false);
}

function estObjet(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function cloner(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* Merge like the server's "fusion": nested objects merge, everything else (arrays included) replaces. */
function fusionProfonde(a, b) {
  var out = estObjet(a) ? Object.assign({}, a) : {};
  Object.keys(b || {}).forEach(function (k) {
    var v = b[k];
    if (v === undefined) return;
    out[k] = estObjet(v) && estObjet(out[k]) ? fusionProfonde(out[k], v) : cloner(v);
  });
  return out;
}

/* The state without its technical fields. */
function nettoyer(doc) {
  var o = {};
  Object.keys(doc || {}).forEach(function (k) { if (!CHAMPS_META[k]) o[k] = cloner(doc[k]); });
  return o;
}

/* The update of one field of the choices. In the page (Store started) it is also applied and saved.
   Ticked outing: patchChoix("sorties", {"<id>": {jour: "2027-06-16"}}); unticked: {"<id>": false}.
   A special evening: patchChoix("speciales", {"<key>": "<outing id>" | false}); a leg in the budget:
   patchChoix("inclure", {"<leg>": true}). Emptied choice: false. */
function patchChoix(champ, valeur) {
  if (typeof champ !== "string" || !champ || CHAMPS_META[champ]) throw new TypeError("patchChoix: invalid field '" + champ + "'");
  if (valeur === undefined) throw new TypeError("patchChoix: missing value for '" + champ + "' (false to empty it)");
  var maj = {};
  maj[champ] = cloner(valeur);
  var p = { chemin: CHOIX_CHEMIN, maj: maj };
  if (Store.pret) Store.appliquer(p);
  return p;
}

/* Full choices = defaults + saved choices. A saved false empties the field (null), except for a boolean default; an
   object over an object of the defaults (speciales, inclure) merges key by key; in sorties, false or null = unticked,
   an object = ticked (merged with the default's entry). */
function superposer(defaut, enregistre) {
  defaut = estObjet(defaut) ? defaut : {};
  enregistre = estObjet(enregistre) ? enregistre : {};
  var c = cloner(defaut);
  Object.keys(enregistre).forEach(function (k) {
    var v = enregistre[k];
    if (CHAMPS_META[k] || k === "sorties" || v === undefined) return;
    if (estObjet(v) && estObjet(defaut[k])) c[k] = fusionProfonde(defaut[k], v);
    else c[k] = v === false && typeof defaut[k] !== "boolean" ? null : cloner(v);
  });
  var s = estObjet(defaut.sorties) ? cloner(defaut.sorties) : {};
  var e = estObjet(enregistre.sorties) ? enregistre.sorties : {};
  Object.keys(e).forEach(function (id) {
    if (estObjet(e[id])) s[id] = fusionProfonde(s[id], e[id]);
    else delete s[id];
  });
  c.sorties = s;
  return c;
}

/* ================= The store ================= */
var Store = {
  mode: "local", pret: false, uid: "moi", slug: "trip",
  D: null, choix: {}, favs: {}, resa: {}, resaPar: {},
  q: {}, ecouteurs: [], _planifie: false,
  _etat: {}, _sonde: false, _avant: [], modeAffichage: null,
  _ecritures: 0, _ops: 0, _derniereActu: 0, _actualisation: null,
  /* Messages for the person (the shell plugs its toast here). */
  avertir: function () {},
};

Store.reinitialiser = function () {
  Object.assign(Store, {
    mode: "local", pret: false, uid: "moi", slug: "trip",
    D: null, choix: {}, favs: {}, resa: {}, resaPar: {},
    q: {}, ecouteurs: [], _planifie: false,
    _etat: {}, _sonde: false, _avant: [], modeAffichage: null,
    _ecritures: 0, _ops: 0, _derniereActu: 0, _actualisation: null,
    avertir: function () {},
  });
};

/* The browser keys of this trip: "tp-<slug>-<name>" (choix, partage, mode, etape, tri-logement, server-seeded). */
function cle(nom) { return "tp-" + Store.slug + "-" + nom; }
Store.cle = cle;
function poserSlug(opts) {
  var s = opts && typeof opts.slug === "string" ? opts.slug.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60) : "";
  Store.slug = s || "trip";
}

/* Subscription to changes (choices, favorites, bookings, mode); several changes → one call. */
Store.surChangement = function (fn) {
  Store.ecouteurs.push(fn);
  return function () { Store.ecouteurs = Store.ecouteurs.filter(function (f) { return f !== fn; }); };
};
Store.notifier = function () {
  if (Store._planifie || !Store.ecouteurs.length) return;
  Store._planifie = true;
  Promise.resolve().then(function () {
    Store._planifie = false;
    Store.ecouteurs.slice().forEach(function (fn) {
      try { fn(); } catch (e) { if (typeof console !== "undefined") console.error(e); }
    });
  });
};

/* Writing queue: one write at a time, in order. Never rejects: {ok, r} or {ok: false, e}. */
function enfiler(chemin, fn) {
  var prec = Store.q[chemin] || Promise.resolve();
  Store._ecritures = (Store._ecritures || 0) + 1;      // writes waiting or running (see Store.actualiser)
  var fin = function () { Store._ecritures = Math.max(0, (Store._ecritures || 0) - 1); };
  var suite = prec.then(fn).then(function (r) { fin(); return { ok: true, r: r }; }, function (e) { fin(); gererErreur(e); return { ok: false, e: e }; });
  Store.q[chemin] = suite;
  return suite;
}
/* Wait until the writes in progress are done (tests). */
Store.attendre = function () {
  var avant = Object.keys(Store.q).map(function (k) { return Store.q[k]; });
  return Promise.all(avant).then(function () {
    var apres = Object.keys(Store.q).map(function (k) { return Store.q[k]; });
    return apres.length !== avant.length || apres.some(function (p, i) { return p !== avant[i]; }) ? Store.attendre() : undefined;
  });
};

function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* "unavailable" (network, 5xx): one more try after a short delay. */
function avecReprise(fn) {
  return fn().catch(function (e) {
    if (e && e.code === "unavailable") return pause(300 + Math.random() * 500).then(fn);
    throw e;
  });
}

function gererErreur(e) {
  if (e && e.serveur && e.code === "unavailable") {
    repliLocal();
    Store.avertir(tr("st_server_gone"));
  } else if (e && e.serveur) Store.avertir(tr("st_server_refused"));
  else Store.avertir(tr("st_not_saved"));
  Store.notifier();
}

/* Apply an update of the choices: at once in the page, then save it. */
Store.appliquer = function (p) {
  if (Store.mode === "serveur") {
    Object.keys(p.maj).forEach(function (champ) { operation(["choix", champ], p.maj[champ], true); });
    return;
  }
  Store.choix = fusionProfonde(Store.choix, p.maj);
  Store.notifier();
  lsSet(cle("choix"), Store.choix);
  Object.keys(p.maj).forEach(function (champ) { noterAvant(["choix", champ], p.maj[champ], true); });
};

/* The data of the trip is loaded (kept for the screens that ask the store). */
Store.donnees = function (D) { Store.D = D; };

/* ================= Favorites and bookings ================= */
/* Keys: "log:<slug>" for a lodging, "<stage>:<id>" for a place. */
function cleFavoriLogement(slug) { return "log:" + slug; }
function cleFavoriLieu(etape, id) { return etape + ":" + id; }

Store.favorisDe = function (k) {
  var u = Store.favs[keySafe(k)] || {};
  return Object.keys(u).filter(function (id) { return u[id]; });
};
Store.estFavori = function (k) { return Store.favorisDe(k).length > 0; };
Store.estMonFavori = function (k) { return !!(Store.favs[keySafe(k)] || {})[Store.uid]; };
Store.estReserve = function (k) { return !!Store.resa[keySafe(k)]; };

function sauverLocalPartage() {
  lsSet(cle("partage"), { favs: Store.favs, resa: Store.resa });
}

/* ♥ of the person: only their own box ({<their id>: true|false}). */
Store.basculerFavori = function (k0) {
  var k = keySafe(k0), cur = Object.assign({}, Store.favs[k] || {});
  cur[Store.uid] = !cur[Store.uid];
  if (Store.mode === "serveur") { operation(["favs", k, Store.uid], cur[Store.uid], false); return; }
  Store.favs[k] = cur;
  Store.notifier();
  sauverLocalPartage();
  noterAvant(["favs", k, UID_SERVEUR], cur[Store.uid], false);
};

/* "Booked" box of the plan, shared. */
Store.marquerResa = function (k0, fait) {
  var k = keySafe(k0);
  if (Store.mode === "serveur") { operation(["resa", k], { done: !!fait, by: Store.uid }, false); return; }
  Store.resa[k] = !!fait;
  Store.resaPar[k] = Store.uid;
  Store.notifier();
  sauverLocalPartage();
  noterAvant(["resa", k], { done: !!fait, by: UID_SERVEUR }, false);
};

/* ================= Local server (scripts/server.py) ================= */
/* The server's state = {v, choix, favs, resa, mode}. The page's memory derives from it: Store.choix = state.choix,
   Store.favs = state.favs, Store.resa / resaPar = state.resa. Each write changes ONE field. */

function serveurPossible() {
  if (typeof fetch !== "function" || typeof location === "undefined" || !location) return false;
  // the server listens on this computer only: the page is in server mode only if /api/etat answers (see initServeur)
  return /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(location.hostname);
}

function erreurServeur(code, detail, status) {
  var e = new Error(detail || "local server");
  e.serveur = true; e.code = code; e.status = status;
  return e;
}

/* One JSON call. Rejects with { serveur: true, code: "unavailable" (network, delay, 5xx, unreadable answer) | "refuse"
   (4xx), status, message } — message: the server's text ({"erreur": "…"}, 300 characters at most), else "HTTP 400". */
var MAX_TEXTE_ERREUR = 300;
function texteErreurServeur(corps, status) {
  var t = corps && typeof corps === "object" && typeof corps.erreur === "string" ? corps.erreur.replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, MAX_TEXTE_ERREUR) : "HTTP " + status;
}
function appelServeur(methode, chemin, corps, delaiMs) {
  var ctrl = typeof AbortController === "function" ? new AbortController() : null;
  var minuteur = ctrl ? setTimeout(function () { ctrl.abort(); }, delaiMs || 6000) : null;
  var fin = function () { if (minuteur) clearTimeout(minuteur); };
  var opts = { method: methode, cache: "no-store", headers: {} };
  if (ctrl) opts.signal = ctrl.signal;
  if (corps !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(corps); }
  return fetch(chemin, opts).then(function (r) {
    fin();
    if (!r.ok) {
      var code = r.status >= 500 ? "unavailable" : "refuse";
      return Promise.resolve().then(function () { return typeof r.json === "function" ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (b) { throw erreurServeur(code, texteErreurServeur(b, r.status), r.status); });
    }
    return r.json().catch(function () { throw erreurServeur("unavailable", "unreadable answer"); });
  }, function (e) { fin(); throw erreurServeur("unavailable", String((e && e.message) || e)); });
}

/* Write one field (single queue: the writes leave in order). A key holding a dot goes as a list. */
function ecrireServeur(segs, valeur, fusion) {
  var corps = { chemin: segs.some(function (s) { return s.indexOf(".") >= 0; }) ? segs : segs.join("."), valeur: valeur };
  if (fusion) corps.fusion = true;
  return enfiler("serveur", function () {
    if (Store.mode !== "serveur") return null;      // the server was left meanwhile: the rest is already in the browser
    return avecReprise(function () { return appelServeur("PUT", "/api/etat", corps); });
  });
}

/* Fallback: the server no longer answers. Everything on screen goes into the browser. */
function repliLocal() {
  if (Store.mode !== "serveur") return;
  Store.mode = "local";
  lsSet(cle("choix"), Store.choix);
  sauverLocalPartage();
}

function poserChamp(etat, segs, valeur, fusion) {
  var racine = estObjet(etat) ? cloner(etat) : {}, cur = racine;
  segs.slice(0, -1).forEach(function (s) { if (!estObjet(cur[s])) cur[s] = {}; cur = cur[s]; });
  var d = segs[segs.length - 1];
  cur[d] = fusion && estObjet(valeur) && estObjet(cur[d]) ? fusionProfonde(cur[d], valeur) : cloner(valeur);
  if (!racine.v) racine.v = 1;
  return racine;
}

/* The page's memory, derived from the server's state. */
function chargerEtat(etat) {
  Store._etat = etat;
  Store.choix = estObjet(etat.choix) ? nettoyer(etat.choix) : {};
  var f = {}, r = {}, par = {};
  Object.keys(estObjet(etat.favs) ? etat.favs : {}).forEach(function (k) { if (estObjet(etat.favs[k])) f[k] = Object.assign({}, etat.favs[k]); });
  Object.keys(estObjet(etat.resa) ? etat.resa : {}).forEach(function (k) { var x = etat.resa[k]; if (estObjet(x)) { r[k] = !!x.done; par[k] = x.by || null; } });
  Store.favs = f;
  Store.resa = r;
  Store.resaPar = par;
  Store.modeAffichage = etat.mode === "simple" || etat.mode === "detail" ? etat.mode : null;
}

/* A change in server mode: at once in the page, then a PUT of ONE field. */
function operation(segs, valeur, fusion) {
  Store._ops = (Store._ops || 0) + 1;
  chargerEtat(poserChamp(Store._etat, segs, valeur, fusion));
  Store.notifier();
  ecrireServeur(segs, valeur, fusion);
}

/* While connecting to the server (mode still "local"): remember the changes to replay them. */
function noterAvant(segs, valeur, fusion) {
  if (Store._sonde) Store._avant.push({ segs: segs, valeur: cloner(valeur), fusion: fusion });
}

function aDuContenu(o) { return estObjet(o) && Object.keys(o).length > 0; }
function etatVide(etat) { return !(aDuContenu(etat.choix) || aDuContenu(etat.favs) || aDuContenu(etat.resa)); }

/* The whole state as the page sees it (favorites as "nous", ticked "booked" boxes only). */
function etatDepuisMemoire() {
  var f = {}, r = {};
  Object.keys(Store.favs).forEach(function (k) {
    var u = Store.favs[k];
    if (estObjet(u) && Object.keys(u).some(function (id) { return u[id]; })) { f[k] = {}; f[k][UID_SERVEUR] = true; }
  });
  Object.keys(Store.resa).forEach(function (k) { if (Store.resa[k]) r[k] = { done: true, by: UID_SERVEUR }; });
  return { v: 1, choix: nettoyer(Store.choix), favs: f, resa: r };
}

/* First meeting: the server is empty, it takes the browser's state (once: "tp-<slug>-server-seeded"). */
function semer(complet) {
  Store._ops = (Store._ops || 0) + 1;
  chargerEtat(complet);
  Store.notifier();
  enfiler("serveur", function () {
    if (Store.mode !== "serveur") return null;
    return avecReprise(function () { return appelServeur("PUT", "/api/etat?remplacer=1", complet); }).then(function () { lsSet(cle("server-seeded"), true); });
  });
}

Store.brancherServeur = function (etat, avant) {
  Store.mode = "serveur";
  Store.uid = UID_SERVEUR;
  Store.pret = true;
  Store.resaPar = {};
  Store._derniereActu = Date.now();                    // the first refresh waits one minute after loading
  var local = etatDepuisMemoire();                     // what the page already has (browser, changes made while connecting)
  var mode = etat.mode;
  chargerEtat(etat);
  if (etatVide(etat) && !lsGet(cle("server-seeded"), false) && !etatVide(local)) {
    semer(Object.assign(local, mode ? { mode: mode } : {}));
  } else {
    // a server with a state, or emptied by hand after a first seeding (it stays empty): replay what was done meanwhile
    (avant || []).forEach(function (op) { operation(op.segs, op.valeur, op.fusion); });
  }
  Store.notifier();
  appliquerModeServeur();
};

/* Simple / Detailed saved in the state: the shell applies it (its button) when this browser stayed on the other one. */
function appliquerModeServeur() {
  var m = Store.modeAffichage;
  if (!m || typeof document === "undefined" || lsGet(cle("mode"), "simple") === m) return;
  var b = document.getElementById("mode-" + m);
  if (b && typeof b.click === "function") b.click();
}

/* true when /api/etat answers (page served by scripts/server.py); never rejects. */
Store.initServeur = function () {
  if (!serveurPossible()) return Promise.resolve(false);
  Store._sonde = true;
  Store._avant = [];
  return appelServeur("GET", "/api/etat", undefined, 2500).then(
    function (etat) { return estObjet(etat) ? etat : null; },
    function () { return null; }
  ).then(function (etat) {
    var avant = Store._avant;
    Store._sonde = false;
    Store._avant = [];
    if (!etat) return false;
    Store.brancherServeur(etat, avant);
    return true;
  });
};

Store.serveurActif = function () { return Store.mode === "serveur"; };

/* Two people, one state: when the tab becomes visible again (the shell calls this), read /api/etat again, at most once a
   minute (no timer). If the state differs from the page's, it applies as at start and the screen redraws. Nothing is
   overwritten while a write is waiting, running or left during the read. Resolves true when the page changed. */
var DELAI_ACTUALISATION = 60000;
function memeValeur(a, b) {
  if (a === b) return true;
  if (!estObjet(a) || !estObjet(b)) {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every(function (x, i) { return memeValeur(x, b[i]); });
    return false;
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(function (k) { return Object.prototype.hasOwnProperty.call(b, k) && memeValeur(a[k], b[k]); });
}
Store.actualiser = function () {
  if (Store.mode !== "serveur" || Store._sonde || Store._actualisation) return Promise.resolve(false);
  if (Store._ecritures > 0) return Promise.resolve(false);
  var t = Date.now();
  if (t - (Store._derniereActu || 0) < DELAI_ACTUALISATION) return Promise.resolve(false);
  Store._derniereActu = t;
  var ops = Store._ops || 0;
  var lecture = appelServeur("GET", "/api/etat", undefined, 4000).then(function (etat) {
    if (Store.mode !== "serveur" || !estObjet(etat)) return false;
    if (Store._ecritures > 0 || (Store._ops || 0) !== ops) return false;      // this page changed something meanwhile
    if (memeValeur(etat, Store._etat)) return false;
    chargerEtat(etat);
    Store.notifier();
    appliquerModeServeur();
    return true;
  }, function () { return false; });
  Store._actualisation = lecture.then(function (r) { Store._actualisation = null; return r; }, function () { Store._actualisation = null; return false; });
  return Store._actualisation;
};

/* Text of the sync badge when the local server saves (null otherwise: the shell keeps its own texts). */
Store.libelleSync = function () {
  if (Store.mode !== "serveur") return null;
  return { texte: tr("st_sync_computer"), titre: tr("st_sync_computer_title") };
};

/* ================= Start ================= */
/* In this browser: the trip's choices, favorites and bookings. opts.slug: the trip (keys "tp-<slug>-…"). */
Store.demarrerLocal = function (opts) {
  if (opts) poserSlug(opts);
  var part = lsGet(cle("partage"), {}) || {};
  Store.mode = "local";
  Store.favs = estObjet(part.favs) ? part.favs : {};
  Store.resa = estObjet(part.resa) ? part.resa : {};
  var c = lsGet(cle("choix"), null);
  Store.choix = estObjet(c) ? nettoyer(c) : {};
  Store.pret = true;
};

/* The local server first: the page starts at once on the browser's state (usable), then, if /api/etat answers, the
   server is the reference. The changes made meanwhile are replayed on its state. */
Store.demarrer = function (opts) {
  poserSlug(opts);
  Store.demarrerLocal();
  return Store.initServeur();
};

/* Public globals (the only ones): the screens and the shell use them. */
var api = {
  Store: Store, patchChoix: patchChoix, superposer: superposer, fusionProfonde: fusionProfonde,
  keySafe: keySafe, lsGet: lsGet, lsSet: lsSet, cleFavoriLogement: cleFavoriLogement, cleFavoriLieu: cleFavoriLieu,
};
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({ nettoyer: nettoyer, CHOIX_CHEMIN: CHOIX_CHEMIN }, api);
else if (typeof window !== "undefined") Object.keys(api).forEach(function (k) { window[k] = api[k]; });
})();
