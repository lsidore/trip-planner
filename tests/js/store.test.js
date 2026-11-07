// Saved choices of the page (page/js/ui/store.js): the local server first, else this browser's localStorage, with keys
// namespaced by the trip's slug. Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../page/js/ui/store.js");

const SLUG = "sample-portugal";
const K = (nom) => `tp-${SLUG}-${nom}`;
// The default choices, in the shape of parcours.json (sample trip keys).
const D = {
  defaut: {
    "arrive-a": "a1", "arrive-b": "b1", "lisbon-comporta": "lc1", "comporta-porto": "cp1", "return-a": "ra1", "return-b": "rb1",
    lisbon: "lisbon-01", comporta: "comporta-01", porto: "porto-01", sorties: { "lisbon-alfama-walk": { jour: null } },
    speciales: { "sao-joao": null }, inclure: { "arrive-a": true, "arrive-b": false },
  },
};
const copie = (o) => JSON.parse(JSON.stringify(o));

test.beforeEach(() => S.Store.reinitialiser());

function fauxStockage(depart) {
  const m = new Map(Object.entries(depart || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    lire: (k) => (m.has(k) ? JSON.parse(m.get(k)) : undefined), cles: () => [...m.keys()],
  };
}

/** Installs fetch, location and localStorage for the test, then puts the environment back. */
async function avec(serveur, local, fn, hote = "127.0.0.1") {
  const avant = { fetch: globalThis.fetch, location: globalThis.location, localStorage: globalThis.localStorage };
  const ls = fauxStockage(local);
  if (serveur) globalThis.fetch = serveur.fetch;
  globalThis.location = { protocol: "http:", hostname: hote };
  globalThis.localStorage = ls;
  try { await fn(ls); } finally {
    for (const k of Object.keys(avant)) { if (avant[k] === undefined) delete globalThis[k]; else globalThis[k] = avant[k]; }
  }
}

test("patchChoix changes one field only, and refuses an empty field or a missing value", () => {
  // outside the page (Store not started): only the update, no side effect
  assert.deepEqual(S.patchChoix("lisbon", "lisbon-02"), { chemin: "parcours/choix", maj: { lisbon: "lisbon-02" } });
  assert.deepEqual(S.patchChoix("speciales", { "sao-joao": "porto-fireworks-dinner" }).maj, { speciales: { "sao-joao": "porto-fireworks-dinner" } });
  assert.throws(() => S.patchChoix("", "x"), TypeError);
  assert.throws(() => S.patchChoix("lisbon"), TypeError);
  assert.throws(() => S.patchChoix("v", 2), TypeError);
});

test("store keys are namespaced by slug", async () => {
  await avec(null, {}, async (ls) => {
    S.Store.demarrerLocal({ slug: SLUG });
    assert.equal(S.Store.cle("choix"), K("choix"));
    S.patchChoix("lisbon", "lisbon-02");
    S.patchChoix("inclure", { "arrive-b": true });
    S.Store.basculerFavori("log:lisbon-02");
    S.Store.marquerResa("logement:lisbon:lisbon-02", true);
    S.lsSet(S.Store.cle("mode"), "detail");
    assert.deepEqual(ls.lire(K("choix")), { lisbon: "lisbon-02", inclure: { "arrive-b": true } });
    assert.deepEqual(ls.lire(K("partage")).resa, { "logement:lisbon:lisbon-02": true });
    assert.equal(ls.lire(K("mode")), "detail");
    assert.ok(ls.cles().every((k) => k.startsWith(`tp-${SLUG}-`)), ls.cles().join(", "));
    // another trip in the same browser starts empty and never sees these choices
    S.Store.reinitialiser();
    S.Store.demarrerLocal({ slug: "other-trip" });
    assert.deepEqual(S.Store.choix, {});
    assert.equal(S.Store.estFavori("log:lisbon-02"), false);
    S.patchChoix("lisbon", "lisbon-03");
    assert.deepEqual(ls.lire("tp-other-trip-choix"), { lisbon: "lisbon-03" });
    assert.deepEqual(ls.lire(K("choix")).lisbon, "lisbon-02");
  });
});

test("a slug that is not a plain word is made safe; no slug: 'trip'", () => {
  S.Store.demarrerLocal({ slug: "My trip/2027" });
  assert.equal(S.Store.cle("choix"), "tp-My_trip_2027-choix");
  S.Store.reinitialiser();
  S.Store.demarrerLocal();
  assert.equal(S.Store.cle("choix"), "tp-trip-choix");
});

test("no Artifact storage and no migration of the old page's data", () => {
  assert.equal(typeof S.migrer, "undefined");
  assert.equal(typeof S.Store.brancherDb, "undefined");
  assert.equal(typeof S.Store.initPartage, "undefined");
  assert.equal(typeof S.Store.listerImports, "undefined");
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../page/js/ui/store.js"), "utf8");
  assert.doesNotMatch(src, /\bth-|window\.claude|picks|db\.doc/);
});

test("superposer: the defaults, then the saved choices; objects (speciales, inclure) merge key by key", () => {
  const c = S.superposer(D.defaut, {
    lisbon: "lisbon-02", porto: false, speciales: { "sao-joao": "porto-fireworks-dinner" }, inclure: { "arrive-b": true },
    sorties: { "lisbon-alfama-walk": false, "porto-douro-cruise": { jour: "2027-06-22" } },
  });
  assert.equal(c.lisbon, "lisbon-02");
  assert.equal(c.comporta, "comporta-01");
  assert.equal(c.porto, null, "false saved = emptied");
  assert.deepEqual(c.speciales, { "sao-joao": "porto-fireworks-dinner" });
  assert.deepEqual(c.inclure, { "arrive-a": true, "arrive-b": true }, "one leg ticked, the others keep their default");
  assert.deepEqual(c.sorties, { "porto-douro-cruise": { jour: "2027-06-22" } }, "an unticked outing disappears, even ticked by default");
  assert.deepEqual(S.superposer(D.defaut, {}).sorties, { "lisbon-alfama-walk": { jour: null } });
  assert.equal(D.defaut.sorties["lisbon-alfama-walk"].jour, null, "the defaults are not changed");
  assert.deepEqual(S.superposer(D.defaut, { speciales: { "sao-joao": false } }).speciales, { "sao-joao": false }, "'none' is kept");
});

test("local mode: the choices stay in this browser, one field merged at a time", async () => {
  await avec(null, { [K("choix")]: { comporta: "comporta-02" } }, async (ls) => {
    S.Store.demarrerLocal({ slug: SLUG });
    assert.equal(S.Store.mode, "local");
    assert.deepEqual(S.Store.choix, { comporta: "comporta-02" });
    S.patchChoix("porto", "porto-02");
    S.patchChoix("speciales", { "sao-joao": "porto-sao-joao-party" });
    S.patchChoix("speciales", { other: false });
    S.patchChoix("sorties", { "lisbon-alfama-walk": { jour: "2027-06-16" } });
    await S.Store.attendre();
    assert.deepEqual(ls.lire(K("choix")), {
      comporta: "comporta-02", porto: "porto-02", speciales: { "sao-joao": "porto-sao-joao-party", other: false },
      sorties: { "lisbon-alfama-walk": { jour: "2027-06-16" } },
    });
  });
});

/* ================= Local server (scripts/server.py), fetch simulated ================= */
// The fake server applies the rules of server.py: PUT of ONE field (dotted path or a list), merged when asked,
// PUT ?remplacer=1 for the whole state.
function poser(etat, segs, valeur, fusion) {
  const racine = copie(etat);
  let cur = racine;
  segs.slice(0, -1).forEach((s) => { if (!cur[s] || typeof cur[s] !== "object" || Array.isArray(cur[s])) cur[s] = {}; cur = cur[s]; });
  const d = segs[segs.length - 1];
  cur[d] = fusion && valeur && typeof valeur === "object" && !Array.isArray(valeur) && cur[d] && typeof cur[d] === "object"
    ? S.fusionProfonde(cur[d], valeur) : copie(valeur);
  racine.v = racine.v || 1;
  return racine;
}

function fauxServeur(depart, options = {}) {
  const sv = { etat: copie(depart || {}), appels: [], hors: !!options.horsLigne, refus: !!options.refus };
  const rep = (corps, status = 200) => ({ ok: status < 400, status, json: async () => copie(corps) });
  sv.fetch = async (url, opts = {}) => {
    const methode = (opts.method || "GET").toUpperCase();
    const corps = opts.body ? JSON.parse(opts.body) : undefined;
    sv.appels.push({ methode, url, corps, entetes: opts.headers });
    if (options.attente) await options.attente;
    if (sv.hors) throw new TypeError("fetch failed");
    if (options.html) return { ok: true, status: 200, json: async () => { throw new SyntaxError("not JSON"); } };
    if (url === "/api/etat" && methode === "GET") return rep(sv.etat);
    if (sv.refus && methode !== "GET") return rep({ erreur: "no" }, 400);
    if (url === "/api/etat?remplacer=1" && methode === "PUT") { sv.etat = Object.assign({ v: 1 }, copie(corps)); return rep({ ok: true }); }
    if (url === "/api/etat" && methode === "PUT") {
      const segs = Array.isArray(corps.chemin) ? corps.chemin : corps.chemin.split(".");
      sv.etat = poser(sv.etat, segs, corps.valeur, corps.fusion === true);
      return rep({ ok: true });
    }
    return rep({ erreur: "route" }, 404);
  };
  sv.puts = () => sv.appels.filter((a) => a.methode === "PUT");
  return sv;
}

const ETAT_SERVEUR = {
  v: 1, choix: { lisbon: "lisbon-02", comporta: "comporta-03" }, favs: { "log:lisbon-02": { nous: true }, "log:porto-01": { nous: false } },
  resa: { "logement:lisbon:lisbon-02": { done: true, by: "nous" } },
};

test("server: the state is read at start, the server wins over the browser", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, { [K("choix")]: { lisbon: "old" } }, async () => {
    const messages = [];
    S.Store.avertir = (m) => messages.push(m);
    assert.equal(await S.Store.demarrer({ slug: SLUG }), true);
    assert.equal(S.Store.mode, "serveur");
    assert.equal(S.Store.uid, "nous");
    assert.deepEqual(S.Store.choix, { lisbon: "lisbon-02", comporta: "comporta-03" });
    assert.equal(S.Store.estMonFavori("log:lisbon-02"), true);
    assert.equal(S.Store.estFavori("log:porto-01"), false);
    assert.equal(S.Store.estReserve("logement:lisbon:lisbon-02"), true);
    assert.ok(S.Store.libelleSync().texte);
    assert.deepEqual(sv.appels.map((a) => a.methode + " " + a.url), ["GET /api/etat"]);
    assert.deepEqual(messages, []);
  });
});

test("server: the stored keys are choix.<leg>, choix.<stage>, choix.sorties, choix.speciales, choix.inclure", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async () => {
    await S.Store.demarrer({ slug: SLUG });
    S.patchChoix("arrive-b", "b2");
    S.patchChoix("porto", "porto-02");
    S.patchChoix("sorties", { "porto-douro-cruise": { jour: "2027-06-22" } });
    S.patchChoix("sorties", { "lisbon-alfama-walk": false });
    S.patchChoix("speciales", { "sao-joao": "porto-fireworks-dinner" });
    S.patchChoix("inclure", { "arrive-b": true });
    await S.Store.attendre();
    assert.deepEqual(sv.puts().map((a) => a.corps), [
      { chemin: "choix.arrive-b", valeur: "b2", fusion: true },
      { chemin: "choix.porto", valeur: "porto-02", fusion: true },
      { chemin: "choix.sorties", valeur: { "porto-douro-cruise": { jour: "2027-06-22" } }, fusion: true },
      { chemin: "choix.sorties", valeur: { "lisbon-alfama-walk": false }, fusion: true },
      { chemin: "choix.speciales", valeur: { "sao-joao": "porto-fireworks-dinner" }, fusion: true },
      { chemin: "choix.inclure", valeur: { "arrive-b": true }, fusion: true },
    ]);
    assert.ok(sv.puts().every((a) => a.entetes["Content-Type"] === "application/json"));
    assert.deepEqual(S.Store.choix, sv.etat.choix, "the page and the file say the same");
    assert.equal(sv.appels.some((a) => a.url.includes("remplacer")), false, "never the whole state");
  });
});

test("server: favorites and 'booked' write their own box, as 'nous'", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async () => {
    await S.Store.demarrer({ slug: SLUG });
    S.Store.basculerFavori("log:porto-02");
    S.Store.basculerFavori("log:lisbon-02");               // already a favorite: removed
    S.Store.marquerResa("vol:arrive-a:a1", true);
    S.Store.basculerFavori("log:villa.view");              // a key with a dot: path as a list
    await S.Store.attendre();
    assert.deepEqual(sv.puts().map((a) => a.corps), [
      { chemin: "favs.log:porto-02.nous", valeur: true },
      { chemin: "favs.log:lisbon-02.nous", valeur: false },
      { chemin: "resa.vol:arrive-a:a1", valeur: { done: true, by: "nous" } },
      { chemin: ["favs", "log:villa.view", "nous"], valeur: true },
    ]);
    assert.equal(S.Store.estFavori("log:lisbon-02"), false);
    assert.equal(S.Store.estReserve("vol:arrive-a:a1"), true);
  });
});

test("server: an empty server takes what this browser had (once, flag namespaced by slug)", async () => {
  const sv = fauxServeur({});
  const local = { [K("choix")]: { lisbon: "lisbon-03" }, [K("partage")]: { favs: { "log:lisbon-03": { moi: true, x: false }, "log:y": { moi: false } }, resa: { r1: true, r2: false } } };
  await avec(sv, local, async (ls) => {
    await S.Store.demarrer({ slug: SLUG });
    await S.Store.attendre();
    const remplacements = sv.appels.filter((a) => a.url === "/api/etat?remplacer=1");
    assert.deepEqual(remplacements.map((a) => a.corps), [
      { v: 1, choix: { lisbon: "lisbon-03" }, favs: { "log:lisbon-03": { nous: true } }, resa: { r1: { done: true, by: "nous" } } },
    ]);
    assert.equal(ls.lire(K("server-seeded")), true);
    // emptied by hand: not seeded again
    S.Store.reinitialiser();
    sv.etat = {};
    sv.appels.length = 0;
    await S.Store.demarrer({ slug: SLUG });
    await S.Store.attendre();
    assert.equal(sv.puts().length, 0);
    assert.deepEqual(S.Store.choix, {});
  });
});

test("server: a change made while connecting is replayed on the server's state", async () => {
  let libere;
  const sv = fauxServeur(ETAT_SERVEUR, { attente: new Promise((r) => { libere = r; }) });
  await avec(sv, {}, async () => {
    const demarrage = S.Store.demarrer({ slug: SLUG });
    S.patchChoix("porto", "porto-03");           // the page is already usable
    S.Store.basculerFavori("log:porto-03");
    assert.equal(S.Store.mode, "local");
    libere();
    await demarrage;
    await S.Store.attendre();
    assert.equal(S.Store.mode, "serveur");
    assert.deepEqual(S.Store.choix, { lisbon: "lisbon-02", comporta: "comporta-03", porto: "porto-03" });
    assert.deepEqual(sv.puts().map((a) => a.corps), [
      { chemin: "choix.porto", valeur: "porto-03", fusion: true },
      { chemin: "favs.log:porto-03.nous", valeur: true },
    ]);
  });
});

test("server absent, HTML or 404, or another host: back to this browser without any request elsewhere", async () => {
  await avec(fauxServeur({}, { horsLigne: true }), { [K("choix")]: { lisbon: "lisbon-03" } }, async (ls) => {
    assert.equal(await S.Store.demarrer({ slug: SLUG }), false);
    assert.equal(S.Store.mode, "local");
    assert.deepEqual(S.Store.choix, { lisbon: "lisbon-03" });
    S.patchChoix("porto", "porto-02");
    assert.deepEqual(ls.lire(K("choix")), { lisbon: "lisbon-03", porto: "porto-02" });
  });
  S.Store.reinitialiser();
  await avec(fauxServeur({}, { html: true }), {}, async () => {
    assert.equal(await S.Store.demarrer({ slug: SLUG }), false);
  });
  S.Store.reinitialiser();
  const sv404 = fauxServeur({});
  sv404.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await avec(sv404, {}, async () => { assert.equal(await S.Store.demarrer({ slug: SLUG }), false); });
  S.Store.reinitialiser();
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async () => {
    assert.equal(await S.Store.demarrer({ slug: SLUG }), false);
    assert.equal(sv.appels.length, 0);
  }, "example.org");
});

test("server: only this computer (127.0.0.1, localhost, [::1]) is the local server; calls carry no extra header", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async () => {
    await S.Store.demarrer({ slug: SLUG });
    S.patchChoix("lisbon", "lisbon-03");
    await S.Store.attendre();
    assert.ok(sv.appels.length > 1);
    assert.ok(sv.appels.every((a) => Object.keys(a.entetes || {}).every((k) => k === "Content-Type")), "no header but the JSON type");
    assert.deepEqual(S.Store.libelleSync(), { texte: "Saved by the local server", titre: "Your choices are saved by the local server, in the trip's folder." });
  });
  for (const hote of ["localhost", "[::1]"]) {
    S.Store.reinitialiser();
    await avec(fauxServeur(ETAT_SERVEUR), {}, async () => {
      assert.equal(await S.Store.demarrer({ slug: SLUG }), true, hote);
    }, hote);
  }
  for (const hote of ["abcd-1-2-3.tunnel.example.net", "127.0.0.1.example.com"]) {
    S.Store.reinitialiser();
    const sv2 = fauxServeur(ETAT_SERVEUR);
    await avec(sv2, {}, async () => {
      assert.equal(await S.Store.demarrer({ slug: SLUG }), false, hote);
      assert.equal(sv2.appels.length, 0, hote);
    }, hote);
  }
});

test("refresh: back on the tab, the other person's state applies, at most once a minute, never over a change of this page", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async () => {
    await S.Store.demarrer({ slug: SLUG });
    let redessins = 0;
    S.Store.surChangement(() => { redessins++; });
    const gets = () => sv.appels.filter((a) => a.methode === "GET").length;
    assert.equal(await S.Store.actualiser(), false, "less than a minute after loading");
    assert.equal(gets(), 1);
    sv.etat = Object.assign({}, sv.etat, { choix: { lisbon: "lisbon-03" } });
    S.Store._derniereActu = Date.now() - 61000;
    assert.equal(await S.Store.actualiser(), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(S.Store.choix, { lisbon: "lisbon-03" });
    assert.equal(redessins, 1);
    // a write in progress: no read
    let lache;
    const attente = new Promise((r) => { lache = r; });
    const base = sv.fetch;
    globalThis.fetch = async (url, opts = {}) => { if ((opts.method || "GET") === "PUT") await attente; return base(url, opts); };
    S.patchChoix("porto", "porto-02");
    sv.etat = Object.assign({}, sv.etat, { choix: { lisbon: "lisbon-01" } });
    S.Store._derniereActu = 0;
    const avant = gets();
    assert.equal(await S.Store.actualiser(), false);
    assert.equal(gets(), avant);
    lache();
    await S.Store.attendre();
    assert.equal(S.Store.choix.porto, "porto-02");
  });
});

test("server stops on the way: choices kept in this browser, one message; a refused change is reported without leaving", async () => {
  const sv = fauxServeur(ETAT_SERVEUR);
  await avec(sv, {}, async (ls) => {
    const messages = [];
    S.Store.avertir = (m) => messages.push(m);
    await S.Store.demarrer({ slug: SLUG });
    sv.hors = true;
    S.patchChoix("porto", "porto-02");
    S.patchChoix("comporta", "comporta-02");
    await S.Store.attendre();
    assert.equal(S.Store.mode, "local");
    assert.equal(messages.length, 1, "one message, not a burst");
    assert.deepEqual(ls.lire(K("choix")), S.Store.choix);
    S.patchChoix("lisbon", "lisbon-01");
    assert.equal(ls.lire(K("choix")).lisbon, "lisbon-01");
  });
  S.Store.reinitialiser();
  const sv2 = fauxServeur(ETAT_SERVEUR, { refus: true });
  await avec(sv2, {}, async () => {
    const messages = [];
    S.Store.avertir = (m) => messages.push(m);
    await S.Store.demarrer({ slug: SLUG });
    S.patchChoix("porto", "porto-02");
    await S.Store.attendre();
    assert.equal(S.Store.mode, "serveur");
    assert.equal(messages.length, 1);
    assert.equal(sv2.puts().length, 1, "no retry for a refusal");
  });
});

test("server: the display mode follows the server (its key namespaced too)", async () => {
  const sv = fauxServeur(Object.assign({}, ETAT_SERVEUR, { mode: "detail" }));
  const clics = [];
  globalThis.document = { getElementById: (id) => ({ click: () => clics.push(id) }) };
  try {
    await avec(sv, { [K("mode")]: "simple" }, async () => {
      await S.Store.demarrer({ slug: SLUG });
      assert.equal(S.Store.modeAffichage, "detail");
      assert.deepEqual(clics, ["mode-detail"]);
      S.lsSet(S.Store.cle("mode"), "simple");
      S.lsSet(S.Store.cle("etape"), "porto");
      await S.Store.attendre();
      assert.deepEqual(sv.puts().map((a) => a.corps), [{ chemin: "mode", valeur: "simple" }]);
    });
  } finally {
    delete globalThis.document;
  }
});

test("messages of the store go through T(): English by default, French with the trip in French", async () => {
  const I = require("../../page/js/i18n.js");
  const lire = async () => {
    const messages = [];
    S.Store.reinitialiser();
    await avec(fauxServeur(ETAT_SERVEUR, { refus: true }), {}, async () => {
      S.Store.avertir = (m) => messages.push(m);
      await S.Store.demarrer({ slug: SLUG });
      S.patchChoix("porto", "porto-02");
      await S.Store.attendre();
    });
    return messages[0];
  };
  I.setLang("en");
  const en = await lire();
  I.setLang("fr");
  const fr = await lire();
  I.setLang("en");
  assert.ok(en && fr && en !== fr, `${en} / ${fr}`);
  assert.doesNotMatch(en, /[éèà]/);
});
