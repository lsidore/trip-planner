// The plan of the trip (page/js/logic/plan.js): what to book, before when, when the money leaves, what is paid on the
// spot. On the sample trip (tests/fixtures/sample-built); "today" is 2026-11-07.
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers/donnees.js");
const P = require("../../page/js/logic/plan.js");
const B = require("../../page/js/logic/budget.js");
const I = require("../../page/js/i18n.js");
const { creerTrip } = require("../../page/js/logic/config.js");

const { chargerDonnees, copie, variante, avecSortie, avecHoraires, sansVolsDe, somme, r2, plusJours, jours, propre, AUJ } = H;
const D = chargerDonnees();
const TRIP = creerTrip(D);
const defaut = () => copie(D.defaut);
const avec = (patch) => Object.assign(defaut(), patch);
const sorties = (...ids) => Object.fromEntries(ids.map((id) => [id, { jour: null }]));
const items = (choix, d, auj) => P.planItems(choix || defaut(), d || D, auj || AUJ);
const trouve = (liste, cle) => liste.find((i) => i.cle === cle);
const TYPES = ["vol", "trajet", "logement", "formalite", "sortie"];
const urgenceAttendue = (avant) => (jours(AUJ, avant) <= 7 ? "rouge" : jours(AUJ, avant) <= 30 ? "orange" : "vert");
const cleVol = (leg, c) => `vol:${leg}:${(c || D.defaut)[leg]}`;
const cleLogement = (s, c) => `logement:${s}:${(c || D.defaut)[s]}`;

// ------------------------------------------------------------------------------------------------ shape

test("shape: each line of the plan is complete, without NaN, sorted by deadline", () => {
  const liste = items(avec({ sorties: sorties("lisbon-tasca-miradouro", "lisbon-alfama-walk"), speciales: { "sao-joao": "porto-fireworks-dinner" } }));
  assert.ok(liste.length >= 12);
  for (const i of liste) {
    propre(i, i.cle);
    assert.ok(TYPES.includes(i.type), i.cle);
    assert.ok(typeof i.titre === "string" && i.titre.trim(), i.cle);
    assert.equal(typeof i.sous, "string");
    assert.ok(i.montant === null || Number.isFinite(i.montant), i.cle);
    assert.ok(["rouge", "orange", "vert"].includes(i.urgence), i.cle);
    assert.ok(i.avant === null || /^\d{4}-\d{2}-\d{2}$/.test(i.avant), i.cle);
    assert.ok(i.avant === null || i.avant >= AUJ, `${i.cle} deadline before today`);
    assert.ok(["avant", "place"].includes(i.quand), i.cle);
    assert.ok(Array.isArray(i.details) && i.details.every((d) => typeof d === "string" && d.length));
    assert.ok(Array.isArray(i.liens));
  }
  const avants = liste.map((i) => i.avant).filter(Boolean);
  assert.deepEqual(avants, avants.slice().sort());
  assert.ok(liste.findIndex((i) => i.avant === null) < 0 || liste.slice(liste.findIndex((i) => i.avant === null)).every((i) => i.avant === null));
  assert.equal(new Set(liste.map((i) => i.cle)).size, liste.length);
});

test("urgency: red within 7 days, orange within 30, otherwise green", () => {
  for (const i of items(avec({ sorties: sorties("lisbon-tasca-miradouro", "porto-cellar-tasting") }))) {
    if (i.avant) assert.equal(i.urgence, urgenceAttendue(i.avant), i.cle);
  }
});

test("D is never changed, the result is deterministic", () => {
  const avant = JSON.stringify(D);
  const a = items();
  assert.deepEqual(items(), a);
  assert.equal(JSON.stringify(D), avant);
});

// ------------------------------------------------------------------------------------------------ lodgings

test("lodging: a valid offer sets the deadline and makes it red", () => {
  const D2 = variante(D, (x) => { H.logement(x, "porto", "porto-01").prix.offre = { texte: "10% off when booked before Nov 12 (invented)", avant: "2026-11-12" }; });
  const i = trouve(items(defaut(), D2), cleLogement("porto"));
  assert.equal(i.avant, "2026-11-12");
  assert.equal(i.urgence, "rouge");
  assert.ok(i.details.some((d) => /10% off/.test(d)));
  assert.ok(i.offre && i.offre.avant === "2026-11-12");
  // an offer that has already expired is ignored
  const D3 = variante(D, (x) => { H.logement(x, "porto", "porto-01").prix.offre = { texte: "old offer", avant: "2026-11-01" }; });
  const j = trouve(items(defaut(), D3), cleLogement("porto"));
  assert.equal(j.offre, null);
  assert.equal(j.avant, plusJours(AUJ, 14));
});

test("lodging: deadline = last day of free cancellation - 1; without a date, within 14 days", () => {
  const D2 = variante(D, (x) => { H.logement(x, "lisbon", "lisbon-01").prix.annulation_date = "2027-06-08"; });
  assert.equal(trouve(items(defaut(), D2), cleLogement("lisbon")).avant, "2027-06-07");
  assert.equal(trouve(items(), cleLogement("comporta")).avant, plusJours(AUJ, 14));
});

test("lodging: the 'best' link is the platform of the retained price, even without an address", () => {
  const i = trouve(items(), cleLogement("lisbon"));
  const best = i.liens.filter((l) => l.meilleur);
  assert.equal(best.length, 1);
  assert.equal(best[0].site, "Booking.com");
  assert.equal(best[0].url, null);
});

test("lodging: amount = what the budget makes you pay before leaving; a room paid at the hotel is not counted before", () => {
  const avantLogement = (s, c) => r2(somme(B.lignesVoyage(c || defaut(), D)
    .filter((l) => l.etape === s && !l.sortie && !l.trajet && l.poste !== "formalites" && l.quand === "avant").map(B.montantLigne)));
  assert.equal(trouve(items(), cleLogement("comporta")).montant, avantLogement("comporta"));
  assert.equal(avantLogement("comporta"), 840);
  // pay at the hotel: nothing leaves before, the room is paid there
  const lisbon = trouve(items(), cleLogement("lisbon"));
  assert.equal(lisbon.montant, 600);
  assert.equal(lisbon.quand, "place");
  assert.equal(lisbon.prixAVerifier, false);
  assert.equal(lisbon.paiement, "pay at the hotel");
});

test("lodging of an incomplete fiche: the room price, the rest to check", () => {
  const i = trouve(items(avec({ porto: "porto-02" })), "logement:porto:porto-02");
  assert.equal(i.montant, 510);
  assert.equal(i.prixAVerifier, true);
  assert.ok(i.details.some((d) => /incomplete/.test(d)));
});

// ------------------------------------------------------------------------------------------------ flights and ground trips

test("flights: deadline today + 14 with a price rise, else 45 days before departure; never after departure", () => {
  assert.equal(trouve(items(), cleVol("arrive-a")).avant, "2027-05-01");
  const D2 = variante(D, (x) => { H.option(x, "arrive-a", x.defaut["arrive-a"]).hausse = { texte: "fares may rise by 60 over the next 20 days", avant: "2026-11-27" }; });
  const h = trouve(items(defaut(), D2), cleVol("arrive-a"));
  assert.equal(h.avant, plusJours(AUJ, 14));
  assert.ok(h.details.some((d) => /rise/.test(d)));
  // a flight leaving in 8 days: never after its departure, never before today
  const D3 = avecHoraires(D2, "arrive-a", D.defaut["arrive-a"], "2026-11-15T07:10", "2026-11-15T19:00");
  assert.equal(trouve(items(defaut(), D3), cleVol("arrive-a")).avant, "2026-11-15");
  const D4 = avecHoraires(D, "arrive-a", D.defaut["arrive-a"], "2026-11-15T07:10", "2026-11-15T19:00");
  assert.equal(trouve(items(defaut(), D4), cleVol("arrive-a")).avant, AUJ);
});

test("flight: amount = budget lines, a bag supplement unknown keeps the ticket and flags it", () => {
  const i = trouve(items(), cleVol("comporta-porto"));
  assert.equal(i.montant, 82);
  assert.equal(i.prixAVerifier, true);
  assert.ok(i.details.some((d) => /bag/i.test(d)));
  const j = trouve(items(), cleVol("arrive-a"));
  assert.equal(j.montant, 421);
  assert.equal(j.prixAVerifier, false);
  assert.ok(j.liens[0].meilleur);
});

test("flight without a price: amount null and 'price to check', never 0", () => {
  const D2 = variante(D, (x) => { H.option(x, "arrive-b", x.defaut["arrive-b"]).lignes = []; });
  const i = trouve(items(defaut(), D2), cleVol("arrive-b"));
  assert.equal(i.montant, null);
  assert.equal(i.prixAVerifier, true);
  assert.match(i.sous, /price to check/);
});

test("out-of-budget flight: listed, out of budget, not in 'when the money leaves' unless included", () => {
  const D2 = sansVolsDe(D, "a");
  const liste = items(copie(D2.defaut), D2);
  const i = trouve(liste, cleVol("arrive-a"));
  assert.equal(i.horsBudget, true);
  assert.equal(i.montant, 421);
  assert.ok(i.details.some((d) => /outside the shared budget/i.test(d)));
  assert.ok(!P.argentPart(liste, AUJ).some((g) => g.cles.includes(i.cle)));
  const c = Object.assign(copie(D2.defaut), { inclure: Object.assign({}, D2.defaut.inclure, { "arrive-a": true }) });
  const l2 = items(c, D2);
  assert.equal(trouve(l2, cleVol("arrive-a")).horsBudget, false);
  assert.ok(P.argentPart(l2, AUJ).some((g) => g.cles.includes(cleVol("arrive-a"))));
});

test("titles: travelers named on their own legs, stages on shared legs, 24 h times", () => {
  const liste = items();
  assert.match(trouve(liste, cleVol("arrive-a")).titre, /Alex/);
  assert.match(trouve(liste, cleVol("return-b")).titre, /Sam/);
  assert.match(trouve(liste, cleVol("comporta-porto")).titre, /Comporta → Porto/);
  assert.match(trouve(liste, cleVol("arrive-a")).sous, /07:10/);
  assert.doesNotMatch(liste.map((i) => i.sous).join(" "), /\b[ap]m\b/i);
});

test("ground trip: its own line, booked before the day it happens", () => {
  const i = trouve(items(), "trajet:lisbon-comporta:lisbon-comporta-1");
  assert.ok(i);
  assert.equal(i.type, "trajet");
  assert.equal(i.montant, 96);
  assert.equal(i.etape, "comporta");
  assert.ok(i.avant < "2027-06-18");
  assert.ok(i.details.some((d) => /a week ahead/.test(d)));
  assert.match(i.titre, /Lisbon → Comporta/);
});

// ------------------------------------------------------------------------------------------------ formalities

const TRANSIT = {
  code: "transit-x", qui: "all", titre: "Transit permit (invented)", cout_home: 30, delai_jours: 10, avant: "depart",
  condition: "transit-x", url_officielle: "https://www.example.com/transit", source: "test", verifie: "2026-11-07",
};

test("formalities of the trip are listed: insurance, eSIM, Alex's entry, Sam's passport check (free)", () => {
  const liste = items();
  for (const code of ["insurance", "esim", "entry-a", "passport-b"]) assert.ok(trouve(liste, `formalite:${code}`), code);
  assert.equal(trouve(liste, "formalite:insurance").montant, 192);
  assert.match(trouve(liste, "formalite:entry-a").sous, /Alex/);
  assert.match(trouve(liste, "formalite:insurance").sous, /everyone/i);
  const pass = trouve(liste, "formalite:passport-b");
  assert.equal(pass.montant, 0);
  assert.equal(pass.paiement, "free");
  // deadline: departure of the traveler's arrival flight - delay
  assert.equal(trouve(liste, "formalite:entry-a").avant, "2027-06-12");
});

test("a conditional formality appears with the flight that asks for it, on that flight's departure", () => {
  const D2 = variante(D, (x) => {
    x.formalites.push(Object.assign({}, TRANSIT));
    H.option(x, "comporta-porto", "comporta-porto-20270621-TP9021").formalites = ["transit-x"];
  });
  assert.equal(trouve(items(defaut(), D2), "formalite:transit-x"), undefined);
  const i = trouve(items(avec({ "comporta-porto": "comporta-porto-20270621-TP9021" }), D2), "formalite:transit-x");
  assert.ok(i);
  assert.equal(i.avant, "2027-06-11");
  assert.equal(i.montant, 60);
});

test("a formality asked by a flight but without a fiche: a line to check, on that flight's departure", () => {
  const D2 = variante(D, (x) => { H.option(x, "comporta-porto", x.defaut["comporta-porto"]).formalites = ["mystery-visa"]; });
  const i = trouve(items(defaut(), D2), "formalite:mystery-visa");
  assert.ok(i);
  assert.equal(i.montant, null);
  assert.equal(i.prixAVerifier, true);
  assert.equal(i.avant, "2027-06-07");
});

test("a paid formality without a budget line: amount shown, outside the totals (dansBudget false)", () => {
  const D2 = variante(D, (x) => { x.formalites.push({ code: "museum-pass", qui: "all", titre: "City museum pass (invented)", cout_home: 40, delai_jours: 0, avant: "arrivee", condition: null }); });
  const i = trouve(items(defaut(), D2), "formalite:museum-pass");
  assert.equal(i.montant, 40);
  assert.equal(i.dansBudget, false);
  assert.equal(i.quand, "place");
});

test("a formality with an opening window: the deadline is the arrival, the window opens N days before", () => {
  const D2 = variante(D, (x) => { x.formalites.push({ code: "arrival-card", qui: "all", titre: "Digital arrival card (invented)", cout_home: 0, delai_jours: 3, avant: "arrivee", fenetre: true, condition: null }); });
  const i = trouve(items(defaut(), D2), "formalite:arrival-card");
  assert.equal(i.avant, "2027-06-15");
  assert.ok(i.details.some((d) => /Jun 12/.test(d)), i.details.join(" | "));
});

test("a formality without a known reference date: date to confirm, orange, no invented date", () => {
  const D2 = variante(D, (x) => { x.formalites.push({ code: "stay-extension", qui: "a", titre: "Stay extension (invented)", cout_home: 50, delai_jours: 5, avant: "on-site", condition: null }); });
  const i = trouve(items(defaut(), D2), "formalite:stay-extension");
  assert.equal(i.avant, null);
  assert.equal(i.dateAConfirmer, true);
  assert.equal(i.urgence, "orange");
});

// ------------------------------------------------------------------------------------------------ outings

test("outings: one line per ticked outing to book; 'no booking' and unticked ones are absent", () => {
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: null }, "lisbon-rooftop-tejo": { jour: null }, "lisbon-alfama-walk": false } });
  const liste = items(c);
  assert.ok(trouve(liste, "sortie:lisbon-tasca-miradouro"));
  assert.equal(trouve(liste, "sortie:lisbon-rooftop-tejo"), undefined, "no booking, price known, paid there");
  assert.equal(trouve(liste, "sortie:lisbon-alfama-walk"), undefined);
});

test("outings: now -> +14 days, soon -> +30, the day before -> the day before the outing", () => {
  const c = avec({ sorties: { "lisbon-tasca-miradouro": { jour: null }, "lisbon-alfama-walk": { jour: "2027-06-16" }, "porto-cellar-tasting": { jour: null } }, speciales: { "sao-joao": "porto-fireworks-dinner" } });
  const liste = items(c);
  assert.equal(trouve(liste, "sortie:lisbon-tasca-miradouro").avant, plusJours(AUJ, 30));
  assert.equal(trouve(liste, "sortie:lisbon-alfama-walk").avant, "2027-06-15");
  assert.equal(trouve(liste, "sortie:porto-fireworks-dinner").avant, plusJours(AUJ, 14));
  const cellar = trouve(liste, "sortie:porto-cellar-tasting");
  assert.ok(cellar.avant >= "2027-06-20" && cellar.avant <= "2027-06-23", cellar.avant);
  assert.match(cellar.sous, /suggested day/);
});

test("an outing with a price rise: at the latest 7 days before it", () => {
  const D2 = avecSortie(D, "porto-fireworks-dinner", { hausse: { avant: "2026-11-20", prix_apres_home: 150 } });
  const i = trouve(items(avec({ speciales: { "sao-joao": "porto-fireworks-dinner" } }), D2), "sortie:porto-fireworks-dinner");
  assert.equal(i.avant, "2026-11-13");
  assert.ok(i.details.some((d) => /\$150/.test(d)));
});

test("outings: the price is said for the whole group, with links and the best price", () => {
  const i = trouve(items(avec({ sorties: sorties("lisbon-tasca-miradouro") })), "sortie:lisbon-tasca-miradouro");
  assert.equal(i.montant, 85);
  assert.ok(i.details.some((d) => /for 2 people/.test(d)), i.details.join(" | "));
  assert.ok(i.liens.some((l) => l.meilleur));
  assert.match(i.sous, /Lisbon/);
});

test("a special evening outing is listed once, even when ticked in the list too", () => {
  const c = avec({ speciales: { "sao-joao": "porto-fireworks-dinner" }, sorties: sorties("porto-fireworks-dinner") });
  assert.equal(items(c).filter((i) => i.cle === "sortie:porto-fireworks-dinner").length, 1);
});

test("outing without a price: amount null, 'price to check'; a 'no booking' one stays then", () => {
  const D2 = avecSortie(D, "lisbon-rooftop-tejo", { prix_couple_home: null });
  const i = trouve(items(avec({ sorties: sorties("lisbon-rooftop-tejo") }), D2), "sortie:lisbon-rooftop-tejo");
  assert.ok(i);
  assert.equal(i.montant, null);
  assert.equal(i.prixAVerifier, true);
});

test("an outing the budget does not count (none of your days fits) is not in the plan", () => {
  const D2 = avecSortie(D, "porto-cellar-tasting", { date_fixe: "2027-06-19" });
  assert.equal(trouve(items(avec({ sorties: sorties("porto-cellar-tasting") }), D2), "sortie:porto-cellar-tasting"), undefined);
});

// ------------------------------------------------------------------------------------------------ sections

test("sections: red = 'to do now', the rest can wait, without out-of-budget amounts", () => {
  const D2 = sansVolsDe(D, "a");
  const liste = items(Object.assign(copie(D2.defaut), { speciales: { "sao-joao": "porto-fireworks-dinner" } }), D2);
  const s = P.sections(liste);
  assert.ok(s.maintenant.every((i) => i.urgence === "rouge"));
  assert.ok(s.attendre.every((i) => i.urgence !== "rouge"));
  assert.equal(s.maintenant.length + s.attendre.length, liste.length);
  const total = (l, q) => r2(somme(l.filter((i) => !i.horsBudget && i.dansBudget !== false && i.quand === q && Number.isFinite(i.montant)).map((i) => i.montant)));
  assert.equal(s.totaux.attendre.avant, total(s.attendre, "avant"));
  assert.deepEqual(P.sections([]), { maintenant: [], attendre: [], totaux: { maintenant: { avant: 0, place: 0, incomplet: false }, attendre: { avant: 0, place: 0, incomplet: false } } });
});

test("sections: an outing that replaces a lodging dinner counts its effect (price - replaced dinner)", () => {
  const liste = items(avec({ sorties: sorties("lisbon-tasca-miradouro") }));
  const i = trouve(liste, "sortie:lisbon-tasca-miradouro");
  assert.deepEqual(i.credit, { montant: -100, quand: "place" });
  const sans = P.sections(items());
  const avecS = P.sections(liste);
  const place = (s) => s.totaux.maintenant.place + s.totaux.attendre.place;
  assert.equal(r2(place(avecS) - place(sans)), -15);
});

// ------------------------------------------------------------------------------------------------ when the money leaves

test("argentPart: grouped by debit date (else deadline), 'this week' first", () => {
  const D2 = variante(D, (x) => { H.logement(x, "comporta", "comporta-01").prix.prelevement_date = "2027-05-20"; });
  const liste = items(avec({ sorties: sorties("lisbon-alfama-walk") }), D2);
  const g = P.argentPart(liste, AUJ);
  assert.ok(g.length >= 3);
  const dates = g.filter((x) => !x.semaine).map((x) => x.libelle);
  assert.deepEqual(dates, dates.slice().sort());
  for (const x of g) {
    assert.ok(Number.isFinite(x.montant) && x.montant >= 0);
    assert.equal(r2(somme(x.cles.map((c) => trouve(liste, c).montant || 0))), x.montant, x.libelle);
  }
  assert.equal(g.find((x) => x.cles.includes(cleLogement("comporta"))).libelle, "2027-05-20");
  const cles = g.flatMap((x) => x.cles);
  assert.equal(new Set(cles).size, cles.length);
  assert.ok(!cles.includes(cleLogement("lisbon")), "paid at the hotel");
  assert.ok(!cles.includes("formalite:passport-b"), "free");
});

test("argentPart: 'this week' = up to today + 7 days, a past date included", () => {
  const mk = (cle, avant, prelevement) => ({ cle, type: "sortie", montant: 10, horsBudget: false, quand: "avant", avant, prelevement: prelevement || null, prixAVerifier: false });
  const g = P.argentPart([mk("a", "2026-11-01"), mk("b", "2026-11-14"), mk("c", "2026-11-15"), mk("d", "2027-01-01", "2026-11-10")], AUJ);
  assert.deepEqual(g.map((x) => x.semaine), [true, false]);
  assert.equal(g[0].libelle, "this week");
  assert.equal(g[1].libelle, "2026-11-15");
  assert.deepEqual(g[0].cles.sort(), ["a", "b", "d"]);
  assert.equal(g[0].montant, 30);
  assert.deepEqual(P.argentPart([], AUJ), []);
});

test("argentPart: the sum = 'before leaving' of the budget, to the cent, for all kinds of choices", () => {
  const verifie = (choix, D0, nom) => {
    const t = B.totaux(B.lignesVoyage(choix, D0), 6000);
    const g = P.argentPart(P.planItems(choix, D0, AUJ), AUJ);
    assert.equal(r2(somme(g.map((x) => x.montant))), t.avant, nom);
  };
  verifie(defaut(), D, "defaults");
  verifie(avec({ sorties: sorties("lisbon-alfama-walk", "lisbon-azulejo-workshop", "comporta-sado-sunset-boat", "porto-cellar-tasting"), speciales: { "sao-joao": "porto-fireworks-dinner" } }), D, "outings");
  verifie(avec({ "lisbon-comporta": "lisbon-comporta-2" }), D, "bus and ferry");
  for (const s of D.trip.stages) {
    for (const l of D.lieux[s.key].logements.concat(D.lieux[s.key].autres)) verifie(avec({ [s.key]: l.id }), D, l.id);
  }
  const D2 = sansVolsDe(D, "b");
  verifie(copie(D2.defaut), D2, "Sam's flights out");
  verifie(Object.assign(copie(D2.defaut), { inclure: { "arrive-b": true } }), D2, "Sam's arrival included");
  const D3 = avecHoraires(D, "return-a", D.defaut["return-a"], "2027-06-26T09:00", "2027-06-26T16:40");
  verifie(copie(D3.defaut), D3, "return later");
  const porto = trouve(P.planItems(copie(D3.defaut), D3, AUJ), cleLogement("porto"));
  assert.equal(porto.montant, 440, "the extra nights are paid before leaving, in the lodging's line");
});

test("argentPart: an unknown price is listed without amount and marks its group incomplete", () => {
  const D2 = avecSortie(D, "lisbon-alfama-walk", { prix_couple_home: null });
  const liste = items(avec({ sorties: { "lisbon-alfama-walk": { jour: "2027-06-16" } } }), D2);
  const g = P.argentPart(liste, AUJ).find((x) => x.cles.includes("sortie:lisbon-alfama-walk"));
  assert.ok(g);
  assert.equal(g.incomplet, true);
  assert.ok(Number.isFinite(g.montant));
});

// ------------------------------------------------------------------------------------------------ on the spot

test("plan lists local money in EUR when home is USD", () => {
  const lignes = B.lignesVoyage(defaut(), D);
  const sp = P.surPlace(lignes, TRIP.currency);
  assert.deepEqual(sp.map((x) => x.etape).filter((e) => e !== "vols"), ["lisbon", "comporta", "porto"]);
  const lisbon = sp.find((x) => x.etape === "lisbon");
  const attendu = r2(somme(lignes.filter((l) => l.etape === "lisbon" && l.quand === "place" && !l.hors_budget).map(B.montantLigne)));
  assert.equal(lisbon.montant, attendu);
  assert.equal(lisbon.local, Math.round(attendu * 0.92));
  const texte = I.fmtMoney(lisbon.montant, "local");
  assert.ok(texte.includes("€"), texte);
  assert.ok(I.fmtMoney(lisbon.montant, "home").includes("$"));
  // `local` is already converted: shown as is (grouped digits of the converted value), a second conversion would fail
  assert.ok(lisbon.local >= 1000, "a value large enough to be grouped");
  const groupe = lisbon.local.toLocaleString("en-US");
  const affiche = I.fmtMoney(lisbon.local, "local", { converted: true });
  assert.ok(affiche.includes(groupe) && affiche.includes("€"), `${affiche} / ${groupe}`);
  assert.ok(!I.fmtMoney(lisbon.local, "local").includes(groupe), "converted twice gives another number");
  // the rate alone gives the same result
  assert.deepEqual(P.surPlace(lignes, 0.92), sp);
  for (const e of sp) assert.equal(r2(somme(e.postes.map((p) => p.montant))), e.montant, e.etape);
});

test("surPlace: the sum of all stages = 'on the spot' of the budget", () => {
  for (const c of [defaut(), avec({ sorties: sorties("lisbon-tasca-miradouro", "comporta-dune-grill", "lisbon-rooftop-tejo") })]) {
    const lignes = B.lignesVoyage(c, D);
    assert.equal(r2(somme(P.surPlace(lignes, TRIP.currency).map((x) => x.montant))), B.totaux(lignes).place);
  }
});

test("surPlace: a price to check is flagged; no rate -> local null; no line -> empty list", () => {
  const D2 = avecSortie(D, "lisbon-tasca-miradouro", { prix_couple_home: null });
  const sp = P.surPlace(B.lignesVoyage(avec({ sorties: sorties("lisbon-tasca-miradouro") }), D2), null);
  const lisbon = sp.find((x) => x.etape === "lisbon");
  assert.equal(lisbon.incomplet, true);
  assert.equal(lisbon.local, null);
  propre(sp);
  assert.deepEqual(P.surPlace([], 0.92), []);
});

// ------------------------------------------------------------------------------------------------ robustness

test("every option of every leg, every lodging: the plan builds, without NaN", () => {
  for (const leg of D.trip.legs) for (const o of D.vols[leg.key].options) propre(items(avec({ [leg.key]: o.id })));
  for (const s of D.trip.stages) for (const l of D.lieux[s.key].logements.concat(D.lieux[s.key].autres)) propre(items(avec({ [s.key]: l.id })));
});

test("empty choice or partial data: no crash", () => {
  assert.ok(Array.isArray(P.planItems({}, { trip: D.trip }, AUJ)));
  assert.ok(Array.isArray(P.planItems(null, D, AUJ)));
  const D2 = variante(D, (x) => { delete x.lieux.porto; });
  propre(items(defaut(), D2));
});
