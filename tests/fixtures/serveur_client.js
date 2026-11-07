// The real store.js (page/js/ui/store.js) against the real server.py: run by tests/test_server.py.
// Usage: node serveur_client.js <server url>; prints as JSON the warning messages, the final mode and the choices.
"use strict";
const path = require("path");
const base = process.argv[2];
const S = require(path.join(__dirname, "../../page/js/ui/store.js"));
const vrai = globalThis.fetch;
globalThis.fetch = (url, opts) => vrai(base + url, opts);
globalThis.location = { protocol: "http:", hostname: "127.0.0.1" };
const SLUG = "sample-portugal";
const K = (nom) => `tp-${SLUG}-${nom}`;
// what this browser had before the server: one lodging, a favorite and a "booked" box (sample trip keys)
const m = new Map(Object.entries({
  [K("choix")]: { lisbon: "lisbon-01" },
  [K("partage")]: { favs: { "log:a": { moi: true } }, resa: { r: true } },
}).map(([k, v]) => [k, JSON.stringify(v)]));
globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };

(async () => {
  const messages = [];
  S.Store.avertir = (t) => messages.push(t);
  await S.Store.demarrer({ slug: SLUG });
  await S.Store.attendre();                                   // the server takes the browser's state (first meeting)
  S.patchChoix("comporta", "comporta-02");
  S.patchChoix("sorties", { "porto-cellar-tasting": { jour: "2027-06-22" } });
  S.patchChoix("sorties", { "porto-cellar-tasting": { heure: "18:00" } });
  S.patchChoix("speciales", { "sao-joao": "porto-fireworks-dinner" });
  S.patchChoix("inclure", { "arrive-b": true });
  S.Store.basculerFavori("log:b");
  S.Store.basculerFavori("log:villa.vue");
  S.Store.marquerResa("logement:lisbon:lisbon-01", true);
  S.lsSet(K("mode"), "detail");
  await S.Store.attendre();
  console.log(JSON.stringify({ messages, mode: S.Store.mode, choix: S.Store.choix }));
})().catch((e) => { console.error(e); process.exit(1); });
