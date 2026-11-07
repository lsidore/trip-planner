// Lodging screens (page/js/ui/logement.js, fiche.js, compare.js), on the sample trip: pure helpers under node, the
// screen in a sandbox (tests/js/helpers/bac.js). Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const { bac } = require("./helpers/bac.js");
const A = require("../../page/js/ui/logement.js");
const B = require("../../page/js/logic/budget.js");
const { creerTrip } = require("../../page/js/logic/config.js");
const { construireEcrans } = require("../../page/js/ui/shell.js");

const D = H.chargerDonnees();
const TRIP = creerTrip(D);
const choix = () => B.resoudreChoix({}, D).choix;
const ecran = (cle) => construireEcrans(TRIP).find((e) => e.cle === cle);
const porto1 = H.logement(D, "porto", "porto-01");

test.afterEach(() => H.preparerI18n(D, "en"));

test("stay budget: room + spending = stay, by item; a room paid at the hotel is paid on the spot", () => {
  const b = A.budgetSejour(porto1);
  assert.equal(b.chambre, 660);
  assert.deepEqual(b.postes, { repas: 108 + 185 + 260, verres: 80, trajets: 60 });
  assert.equal(b.extras, 693);
  assert.equal(b.total, 1353);
  assert.equal(b.avant, 0, "pay at the hotel");
  assert.equal(b.place, 1353);
  assert.equal(b.incomplet, false);
  const c1 = A.budgetSejour(H.logement(D, "comporta", "comporta-01"));
  assert.equal(c1.avant, 840, "a room paid when booking is paid before leaving");
});

test("stay budget: a missing price makes it incomplete, an 'other' lodging is the room only, never NaN", () => {
  const l = H.copie(porto1);
  l.lignes[1].u = null;
  const b = A.budgetSejour(l);
  assert.equal(b.incomplet, true);
  H.propre(b);
  const a = A.budgetSejour(H.logement(D, "porto", "porto-02"), 3);
  assert.deepEqual([a.chambre, a.extras, a.incomplet], [510, null, true]);
});

test("free cancellation: far, close, past, non-refundable, unknown — words from T()", () => {
  const p = { annulation: "free until Jun 1", annulation_date: "2027-06-01" };
  assert.equal(A.annulation(p, "2027-03-01").ton, "bon");
  assert.equal(A.annulation(p, "2027-05-25").ton, "urgent");
  assert.match(A.annulation(p, "2027-05-25").court, /in 7 days/);
  assert.match(A.annulation(p, "2027-05-31").court, /tomorrow/);
  assert.equal(A.annulation(p, "2027-06-02").ton, "non");
  assert.equal(A.annulation({ annulation: "non-refundable" }, "2027-01-01").ton, "non");
  assert.match(A.annulation({ annulation: "free cancellation until 7 days before" }, "2027-01-01").court, /date to check/);
  assert.match(A.annulation({}, "2027-01-01").court, /to check/);
  H.preparerI18n(D, "fr");
  assert.match(A.annulation(p, "2027-03-01").court, /Annulation gratuite/);
  assert.equal(A.annulation({ annulation: "non remboursable" }, "2027-01-01").ton, "non");
});

test("sort: stay budget, quality, room price, favorites first", () => {
  const l = D.lieux.porto.logements.concat(D.lieux.porto.autres);
  assert.deepEqual(A.trier(l, "chambre").map((x) => x.id), ["porto-03", "porto-02", "porto-01"]);
  assert.equal(A.trier(l, "budget")[0].id, "porto-01", "the only complete budget comes first");
  assert.deepEqual(A.trier(l, "favoris", { estFavori: (x) => x.id === "porto-03" }).map((x) => x.id)[0], "porto-03");
});

test("budget line: 'n × unit', published price / estimated / included / price to check", () => {
  assert.deepEqual(A.texteLigne({ n: 2, u: 130, lib: "gala", src: "releve" }).source, "published price");
  assert.equal(A.texteLigne({ n: 2, u: 130, lib: "gala", src: "releve" }).montant, 260);
  assert.equal(A.texteLigne({ n: 1, u: 10, lib: "x", src: "estime" }).source, "estimated");
  assert.equal(A.texteLigne({ n: 0, u: 0, lib: "breakfast", src: "inclus" }).source, "included");
  assert.equal(A.texteLigne({ n: 1, u: null, lib: "x", incomplet: true }).source, "price to check");
});

test("photos: only the files of the gallery, small or large", () => {
  const l = { galerie: { n: 2, petites: ["media/photos/a/01-s.jpg", "media/photos/a/02-s.jpg"], grandes: ["media/photos/a/01.jpg", "media/photos/a/02.jpg"] } };
  assert.equal(A.cheminPhoto(l, 0, "s"), "media/photos/a/01-s.jpg");
  assert.equal(A.cheminPhoto(l, 1, "l"), "media/photos/a/02.jpg");
  assert.equal(A.cheminPhoto(l, 2, "s"), null);
  assert.equal(A.cheminPhoto({ galerie: { petites: ["https://x/1.jpg"], grandes: ["https://x/1.jpg"] } }, 0, "s"), null);
  assert.equal(A.nbPhotosDe(porto1), 0);
});

test("access: airport, duration, mode words and the last public transport named by the mode (boat or not)", () => {
  const c = A.texteAcces(H.logement(D, "comporta", "comporta-01").acces, TRIP);
  assert.equal(c, "Lisbon (LIS) → 1 h 45 by car then by boat · private ≈ $140 · last public boat 20:30");
  const l = A.texteAcces({ aeroport: "OPO", duree_min: 40, mode: "bus", dernier_public: "23:10" }, TRIP);
  assert.match(l, /last public transport 23:10/);
  assert.doesNotMatch(l, /boat/);
  assert.equal(A.texteAcces(null), "");
  H.preparerI18n(D, "fr");
  assert.match(A.texteAcces(H.logement(D, "comporta", "comporta-01").acces, TRIP), /dernier bateau public 20:30/);
});

test("access by other modes: train, metro, walk and ferry are named; only boats and ferries say 'boat'", () => {
  H.preparerI18n(D, "en");
  const t = A.texteAcces({ aeroport: "OPO", duree_min: 50, mode: "train", dernier_public: "23:40" }, TRIP);
  assert.match(t, /by train/);
  assert.match(t, /last public transport 23:40/);
  assert.match(A.texteAcces({ aeroport: "OPO", duree_min: 30, mode: "metro+walk" }, TRIP), /by metro then on foot/);
  assert.match(A.texteAcces({ aeroport: "OPO", duree_min: 30, mode: "voiture+ferry", dernier_public: "20:00" }, TRIP),
    /by car then by boat · .*last public boat 20:00|by car then by boat · last public boat 20:00/);
  H.preparerI18n(D, "fr");
  assert.match(A.texteAcces({ aeroport: "OPO", duree_min: 50, mode: "train", dernier_public: "23:40" }, TRIP), /en train/);
  H.preparerI18n(D, "en");
});

test("mandatory gala dinner: a lodging line counted with its special evening, else the fiche's text", () => {
  const g = A.gala(porto1);
  assert.equal(g.impose, true);
  assert.equal(g.montant, 260);
  assert.equal(g.speciale, "sao-joao");
  assert.equal(A.gala(H.logement(D, "lisbon", "lisbon-01")), null);
});

test("video durations: seconds, minutes, hours through the dictionary", () => {
  assert.equal(A.dureeVideo(45), "45 s");
  assert.equal(A.dureeVideo(125), "2 min");
  assert.equal(A.dureeVideo(null), "");
});

test("videos: https on instagram.com or youtube.com only", () => {
  assert.equal(A.urlVideo("https://www.youtube.com/watch?v=x"), "https://www.youtube.com/watch?v=x");
  assert.equal(A.urlVideo("http://www.youtube.com/watch?v=x"), "");
  assert.equal(A.urlVideo("https://evil.example.com/youtube.com"), "");
  assert.equal(A.htmlVideos([]), "");
});

test("the legs shown at the top of a lodging screen: the between legs arriving at that stage", () => {
  assert.deepEqual(A.legsEnTete("lisbon", D), []);
  assert.deepEqual(A.legsEnTete("comporta", D), ["lisbon-comporta"]);
  assert.deepEqual(A.legsEnTete("porto", D), ["comporta-porto"]);
});

test("ground leg block on comporta screen", () => {
  const c = choix();
  const b = bac(D, c, ["vols.js", "logement.js"]);
  assert.equal(typeof b.ctx.ECRANS.logement, "function");
  b.ctx.ECRANS.logement(b.faux("ecran"), D, c, ecran("comporta"));
  const h = b.html();
  assert.match(h, /Rental car, pick-up in Lisbon/);
  assert.match(h, /Intercity bus to Setúbal/);
  assert.match(h, /Herdade do Sal Resort/, "and the lodging cards");
  assert.doesNotMatch(h, /NaN|undefined|\bnull\b/);
  // Lisbon: no leg arrives there between stages; Porto: the flight from Comporta
  const b2 = bac(D, c, ["vols.js", "logement.js"]);
  b2.ctx.ECRANS.logement(b2.faux("ecran"), D, c, ecran("lisbon"));
  assert.doesNotMatch(b2.html(), /vol-bloc|gd-bloc/);
  const b3 = bac(D, c, ["vols.js", "logement.js"]);
  b3.ctx.ECRANS.logement(b3.faux("ecran"), D, c, ecran("porto"));
  assert.match(b3.html(), /FR9022/);
});

test("lodging cards: prices for the trip's number of people, nights of the stage, no French in English", () => {
  const c = choix();
  const b = bac(D, c, ["vols.js", "logement.js"]);
  b.ctx.ECRANS.logement(b.faux("ecran"), D, c, ecran("porto"));
  const h = b.html();
  assert.match(h, /3 nights/);
  assert.match(h, /for 2 people/);
  assert.match(h, /\$1,353/);
  assert.doesNotMatch(h, /[éèà]|pour deux|nuits/);
});

test("choosing refuses an id that is not a lodging of the stage", () => {
  const c = choix();
  const b = bac(D, c, ["vols.js", "logement.js"]);
  b.ctx.Parcours.choix = c;
  assert.equal(b.ctx.LogementsUI.choisir("porto", "porto-fireworks-dinner"), false);
  assert.equal(b.ctx.LogementsUI.choisir("porto", "lisbon-02"), false);
  assert.equal(b.ctx.LogementsUI.choisir("porto", "porto-02"), true);
  assert.deepEqual(b.ecrits, [["porto", "porto-02"]]);
});

test("the effect of a lodging on the total: '+$X to the budget · margin', the cap from the trip", () => {
  const c = choix();
  const b = bac(D, c, ["vols.js", "logement.js"]);
  const lignes = B.lignesVoyage(c, D);
  b.ctx.Parcours.choix = c;
  b.ctx.Parcours.totaux = B.totaux(lignes, 6000);
  const h = b.ctx.LogementsUI.htmlEcart("porto", "porto-03");
  assert.match(h, /to the budget/);
  assert.match(h, /over \$6,000|margin \$/);
  assert.match(b.ctx.LogementsUI.htmlEcart("porto", "porto-01"), /Your choice/);
});
