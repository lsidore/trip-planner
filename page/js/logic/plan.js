/* The plan of the trip (pure logic, no DOM, no network): what to book now, what can wait, when the money leaves, what is
   paid on the spot, the formalities with their deadline. Tested by tests/js/plan.test.js.

   Inputs: choix (see budget.js), D = parcours.json with each parcours-<stage>.json in D.lieux[<stage key>],
   aujourdhui = "YYYY-MM-DD". Amounts come from the budget lines (lignesVoyage of budget.js): the plan and the budget say
   the same thing. TRIP comes from creerTrip(D) (config.js); texts from T() (i18n.js).

   API (globals):
     planItems(choix, D, aujourdhui) -> [Item] sorted by deadline (no date: at the end)
     sections(items)                 -> { maintenant: [Item], attendre: [Item], totaux: { maintenant|attendre: { avant, place, incomplet } } }
     argentPart(items, aujourdhui)   -> [{ libelle: "this week" (semaine: true) | "YYYY-MM-DD", semaine, montant, cles, incomplet }]
     surPlace(lignes, monnaie)       -> [{ etape, montant, local, postes: [{ poste, montant, incomplet }], incomplet }]

   Item = { cle, type: "vol"|"trajet"|"logement"|"sortie"|"formalite", titre, sous, image, imageType, montant, horsBudget,
            avant, urgence: "rouge"|"orange"|"vert", prelevement, paiement, annulation, liens, details, quand, etape,
            prixAVerifier, dansBudget, dateAConfirmer, verifie, hausse, offre, credit? }
     cle        : "vol:<leg>:<id>", "trajet:<leg>:<id>" (ground), "logement:<stage>:<id>", "sortie:<id>", "formalite:<code>"
                  (changes when the choice changes: the "booked" box of an old choice does not carry over).
     montant    : home currency (n × u of the budget lines), null when the price is missing: the page writes "price to
                  check", never 0. prixAVerifier: at least one line of the item has no price.
     dansBudget : false for a formality without any budget line: its amount shows but enters neither the totals of the
                  sections nor "when the money leaves".
     horsBudget : a flight kept out of the shared budget (and the formalities only it asks for), unless included.
     avant      : deadline "YYYY-MM-DD"; null = "date to confirm" (dateAConfirmer, orange urgency, no invented date).
     urgence    : red when avant ≤ today + 7 days, orange ≤ + 30, else green.
     quand      : "avant" (paid before leaving) or "place" (paid there); prelevement: known date of the debit or null.
     image      : data URI of an airline logo ("logo"), first small photo of the lodging ("cover") or of the outing
                  ("photo"); null without photo and for formalities.
     liens      : a lodging's first link carries `meilleur` = the platform of the retained price (`retenu` in the data),
                  even without an address (url: null).

   Deadlines (counted from today, never before it):
     flight     : today + 14 when a price rise is noted, else 45 days before departure; at the latest the departure day.
     ground trip: 14 days before the day it happens.
     lodging    : the earliest of (last day of free cancellation − 1) and of the date of a still valid offer; without any
                  date (non-refundable...): today + 14.
     outing     : "maintenant" → + 14 days, "vite" → + 30, "veille" → the day before the outing (chosen day, fixed date,
                  else the day the day by day gives it); "sans" → no line, unless paid in advance or its price is still
                  to check (then as "veille"). With a price rise: at the latest 7 days before it. Never after the day
                  before a fixed date or a chosen day. An outing the budget does not count has no line. credit:
                  { montant (negative), quand } = what the outing removes from the lodging's budget ("remplace" lines).
     formality  : departure (or arrival) − delai_jours. A formality with `fenetre: true` opens delai_jours before the
                  arrival ("not earlier") and its deadline is the arrival. Without a reference date: "date to confirm".
   Private names live inside the anonymous function: the file can be concatenated with the other logic/ files. */
var PlanLogic = (function () {
  "use strict";

  var SEUIL_ROUGE = 7;
  var SEUIL_ORANGE = 30;
  var J_VOL_HAUSSE = 14; // flight with a price rise: today + 14
  var J_VOL_SANS_HAUSSE = 45; // else: 45 days before departure
  var J_TRAJET_SOL = 14; // ground trip: 14 days before
  var J_MAINTENANT = 14; // outing "maintenant"
  var J_VITE = 30; // outing "vite"
  var J_DEFAUT = 14; // nothing else to rely on (non-refundable lodging, outing without a day)
  var MARGE_HAUSSE = 7; // book at the latest one week before a fare ends
  var J_INCONNU = 14; // assumed delay of a formality without a fiche
  var ORDRE_TYPE = { vol: 0, trajet: 1, logement: 2, formalite: 3, sortie: 4 };
  var ORDRE_POSTE = ["repas", "verres", "bienetre", "activites", "trajets", "formalites", "logements", "vols"];

  // ---------------------------------------------------------------------------------------------- other modules

  function budget() {
    if (typeof lignesVoyage === "function") return { lignesVoyage: lignesVoyage, montantLigne: montantLigne, sortiesComptees: sortiesComptees };
    if (typeof require === "function") return require("./budget.js");
    throw new Error("plan.js: budget.js must be loaded before plan.js");
  }
  function cfg(D) {
    var f = typeof creerTrip === "function" ? creerTrip : require("./config.js").creerTrip;
    return f(D);
  }
  function i18n() {
    return typeof T === "function" && typeof fmtDate === "function" ? { T: T, fmtDate: fmtDate, fmtMoney: fmtMoney } : require("../i18n.js");
  }
  function tr(cle, vars) { return i18n().T(cle, vars); }
  function dateTxt(iso) { return i18n().fmtDate(iso); }
  function argent(x) { return i18n().fmtMoney(x, "home"); }

  /* placementSorties of days.js (the day by day): the day each outing is placed; null without days.js. */
  function placement(choix, D) {
    var f = typeof placementSorties === "function" ? placementSorties
      : typeof require === "function" ? require("./days.js").placementSorties : null;
    return f ? f(choix, D) : null;
  }

  // ---------------------------------------------------------------------------------------------- tools

  function num(x) { return typeof x === "number" && isFinite(x); }
  function r2(x) { return Math.round(x * 100) / 100 + 0; }
  function estObjet(o) { return o !== null && typeof o === "object" && !Array.isArray(o); }
  function estDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s); }
  function jourDe(s) { return estDate(s) ? s.slice(0, 10) : null; }
  function jourPlus(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function ecart(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  /** Ends a sentence with a period, without doubling it after an abbreviation or another stop. */
  function fin(t) {
    t = String(t);
    return /[.!?…]$/.test(t) ? t : t + ".";
  }
  function heure(local) { return typeof local === "string" ? local.slice(11, 16) : ""; }
  function aujourdhuiPar(a) { return estDate(a) ? a.slice(0, 10) : new Date().toISOString().slice(0, 10); }
  /** Puts a deadline between today (never before) and an optional maximum (never after). */
  function borne(avant, aujourdhui, max) {
    if (max && avant > max) avant = max;
    return avant < aujourdhui ? aujourdhui : avant;
  }
  function plusTot(a, b) { return a === null ? b : b === null ? a : a < b ? a : b; }

  function urgenceDe(avant, aujourdhui) {
    if (!avant) return "orange"; // date to confirm
    var d = ecart(aujourdhui, avant);
    return d <= SEUIL_ROUGE ? "rouge" : d <= SEUIL_ORANGE ? "orange" : "vert";
  }

  /** The known part of a set of lines: { montant (null when no price is known), inconnu (a line without price) }. */
  function sommeLignes(lignes) {
    var total = 0;
    var connu = false;
    var inconnu = false;
    lignes.forEach(function (l) {
      if (l && num(l.n) && num(l.u) && l.incomplet !== true) {
        total += l.n * l.u;
        connu = true;
      } else {
        inconnu = true;
      }
    });
    return { montant: connu ? r2(total) : null, inconnu: inconnu };
  }

  function titreEtape(trip, k) { return trip.stage(k) ? trip.stage(k).title : k || ""; }
  function optionDe(D, leg, id) {
    var t = D && D.vols && D.vols[leg];
    return t && Array.isArray(t.options) && typeof id === "string" ? t.options.filter(function (o) { return o.id === id; })[0] || null : null;
  }
  function logementDe(D, cle, id) {
    var p = D && D.lieux && D.lieux[cle];
    if (!p || typeof id !== "string") return null;
    var l = (p.logements || []).filter(function (x) { return x.id === id; })[0];
    if (l) return { l: l, complet: true };
    var a = (p.autres || []).filter(function (x) { return x.id === id; })[0];
    return a ? { l: a, complet: false } : null;
  }
  function sortieDe(D, trip, id) {
    if (typeof id !== "string") return null;
    for (var i = 0; i < trip.stageKeys.length; i++) {
      var p = D && D.lieux && D.lieux[trip.stageKeys[i]];
      var s = p && Array.isArray(p.sorties) ? p.sorties.filter(function (x) { return x.id === id; })[0] : null;
      if (s) return s.etape ? s : Object.assign({}, s, { etape: trip.stageKeys[i] });
    }
    return null;
  }
  function premierSeg(o) { return o && o.segments && o.segments.length ? o.segments[0] : null; }
  function dernierSeg(o) { return o && o.segments && o.segments.length ? o.segments[o.segments.length - 1] : null; }
  function departDe(o) { var s = premierSeg(o); return s ? jourDe(s.dep_local) : null; }
  function arriveeDe(o) { var s = dernierSeg(o); return s ? jourDe(s.arr_local) : null; }

  /** Departure (or landing) day of the arrival flights of a traveler ("all": every arrival), the earliest; else the trip's start. */
  function reperesArrivee(trip, choix, D, qui, quoi) {
    var t = trip.traveler(qui);
    var jours = trip.arrivals
      .filter(function (l) { return !t || l.travelers.indexOf(qui) >= 0; })
      .map(function (l) { var o = optionDe(D, l.key, choix[l.key]); return o ? (quoi === "depart" ? departDe(o) : arriveeDe(o)) : null; })
      .filter(Boolean)
      .sort();
    return jours[0] || (estDate(trip.start) ? trip.start : null);
  }

  /** First small photo of a lodging or an outing (gallery of page_data.py); null without photo. */
  function premierePhoto(x) {
    var u = x && x.galerie && Array.isArray(x.galerie.petites) ? x.galerie.petites[0] : null;
    return typeof u === "string" && /^media\/photos\/[\w.\/-]+\.jpg$/.test(u) ? u : null;
  }

  function lienDe(l) {
    var o = {};
    Object.keys(l).forEach(function (k) { if (l[k] !== undefined) o[k] = l[k]; });
    return o;
  }

  function nomFormalite(code, titre) {
    return String(titre || code).split(/ \(| : |: |, /)[0];
  }

  /** "Alex's flight to Lisbon", "Return flight", "Flight Comporta → Porto", "Lisbon → Comporta". */
  function titreTrajet(trip, leg) {
    var qui = trip.whoOf(leg);
    if (leg.kind === "arrival") return qui ? tr("plan_title_arrival_who", { who: qui, to: titreEtape(trip, leg.to_stage) }) : tr("plan_title_arrival", { to: titreEtape(trip, leg.to_stage) });
    if (leg.kind === "return") return qui ? tr("plan_title_return_who", { who: qui }) : tr("plan_title_return");
    return tr(leg.mode === "flight" ? "plan_title_flight" : "plan_title_ground", { from: titreEtape(trip, leg.from_stage), to: titreEtape(trip, leg.to_stage) });
  }

  // ---------------------------------------------------------------------------------------------- flights and ground trips

  /** "TAP Air Portugal (example) + Iberia": the airline names of the option, else their codes. */
  function compagnies(o) {
    var noms = o.compagnies_noms || {};
    return (o.compagnies || []).map(function (c) { return noms[c] || c; }).join(" + ");
  }

  function horaires(o) {
    var a = premierSeg(o);
    var z = dernierSeg(o);
    if (!a || !z) return "";
    var dep = jourDe(a.dep_local);
    var arr = jourDe(z.arr_local);
    return dateTxt(dep) + " " + heure(a.dep_local) + " → " + (arr !== dep ? dateTxt(arr) + " " : "") + heure(z.arr_local);
  }

  function liensVol(o) {
    var prix = [];
    var autres = [];
    (o.prix_par_site || []).forEach(function (p) {
      var l = { site: p.site, url: p.url, prix_home: num(p.prix_home) ? p.prix_home : null, verifie: p.verifie };
      if (p.bloque) {
        l.bloque = true;
        if (p.note) l.note = p.note;
      }
      (l.prix_home !== null && !p.bloque ? prix : autres).push(lienDe(l));
    });
    prix.sort(function (a, b) { return a.prix_home - b.prix_home; });
    if (prix.length) prix[0].meilleur = true;
    return prix.concat(autres);
  }

  function itemVol(trip, leg, choix, D, lignes, aujourdhui) {
    var o = optionDe(D, leg.key, choix[leg.key]);
    if (!o) return null;
    var siennes = lignes.filter(function (l) { return l.trajet === leg.key; });
    var horsBudget = siennes.length > 0 && siennes.every(function (l) { return l.hors_budget === true; });
    var olignes = Array.isArray(o.lignes) ? o.lignes : [];
    var vol = olignes.filter(function (l) { return l.cle === "vol"; })[0];
    var valiseLigne = olignes.filter(function (l) { return l.cle === "valise"; })[0];
    var s = sommeLignes(olignes);
    var prixVol = !!vol && num(vol.n) && num(vol.u) && vol.incomplet !== true;
    var v = o.valise;
    var valiseInconnue = !!v && v.comprise !== true && !num(v.ajout_home) && !valiseLigne;
    var montant = prixVol ? s.montant : null;
    var prixAVerifier = !prixVol || s.inconnu || valiseInconnue;

    var dep = departDe(o);
    var avant = o.hausse ? jourPlus(aujourdhui, J_VOL_HAUSSE) : dep ? jourPlus(dep, -J_VOL_SANS_HAUSSE) : jourPlus(aujourdhui, J_DEFAUT);
    avant = borne(avant, aujourdhui, dep);

    var liens = liensVol(o);
    var meilleur = liens.filter(function (l) { return l.meilleur; })[0];
    var a = premierSeg(o);
    var z = dernierSeg(o);
    var sous = [compagnies(o), a && z ? a.de + " → " + z.vers : "", horaires(o)].filter(Boolean).join(" · ");
    if (prixAVerifier) sous += " · " + tr("price_to_check");

    var details = [];
    if (!prixVol) details.push(tr("plan_ticket_to_check"));
    else if (meilleur) details.push(tr("plan_lowest_price", { site: meilleur.site, price: argent(meilleur.prix_home), checked: meilleur.verifie ? tr("plan_checked_on", { date: dateTxt(meilleur.verifie) }) : "" }));
    if (v && v.comprise === true) details.push(tr("plan_bag_included"));
    else if (valiseLigne && num(valiseLigne.n) && num(valiseLigne.u)) details.push(tr("plan_bag_added", { price: argent(valiseLigne.n * valiseLigne.u) }));
    else if (valiseInconnue) details.push(tr("plan_bag_unknown"));
    if (o.hausse) details.push(fin(tr("plan_price_rise", { text: o.hausse.texte || "" })));
    if (o.note) details.push(fin(o.note));
    (o.formalites || []).forEach(function (code) {
      details.push(tr("plan_flight_formality", { name: nomFormalite(code, code) }));
    });
    details.push(tr("plan_flight_paid_at_booking"));
    if (!leg.in_budget) details.push(tr(horsBudget ? "plan_flight_out_of_budget" : "plan_counted_in_budget"));

    return {
      cle: "vol:" + leg.key + ":" + o.id,
      type: "vol",
      titre: titreTrajet(trip, leg),
      sous: sous,
      image: (D && D.logos && (o.compagnies || []).length && D.logos[o.compagnies[0]]) || null,
      imageType: "logo",
      montant: montant,
      horsBudget: horsBudget,
      avant: avant,
      prelevement: null,
      paiement: tr("plan_pay_at_booking"),
      annulation: null,
      liens: liens,
      details: details,
      quand: "avant",
      etape: null,
      prixAVerifier: prixAVerifier,
      dansBudget: true,
      dateAConfirmer: false,
      verifie: (meilleur && meilleur.verifie) || null,
      hausse: o.hausse ? { texte: o.hausse.texte, avant: o.hausse.avant } : null,
      offre: null,
    };
  }

  function itemTrajetSol(trip, leg, choix, D, lignes, aujourdhui) {
    var o = optionDe(D, leg.key, choix[leg.key]);
    if (!o) return null;
    var siennes = lignes.filter(function (l) { return l.trajet === leg.key; });
    var s = sommeLignes(siennes);
    var horsBudget = siennes.length > 0 && siennes.every(function (l) { return l.hors_budget === true; });
    var jour = jourDe(leg.date);
    var avant = jour ? borne(jourPlus(jour, -J_TRAJET_SOL), aujourdhui, jour) : jourPlus(aujourdhui, J_DEFAUT);
    var sous = [o.operateur || o.mode || "", jour ? dateTxt(jour) + (o.depart ? " " + o.depart : "") : "", o.duree || ""].filter(Boolean).join(" · ");
    if (s.montant === null || s.inconnu) sous += " · " + tr("price_to_check");
    var details = [];
    if (o.reserver) details.push(fin(tr("plan_when_to_book", { text: o.reserver })));
    if (o.remarque) details.push(fin(o.remarque));
    if (horsBudget) details.push(tr("plan_flight_out_of_budget"));
    var liens = o.lien ? [{ site: o.operateur || tr("plan_booking"), url: o.lien, prix_home: s.montant, meilleur: true }] : [];
    return {
      cle: "trajet:" + leg.key + ":" + o.id,
      type: "trajet",
      titre: titreTrajet(trip, leg),
      sous: sous,
      image: null,
      imageType: null,
      montant: s.montant,
      horsBudget: horsBudget,
      avant: avant,
      prelevement: null,
      paiement: tr("plan_pay_at_booking"),
      annulation: null,
      liens: liens,
      details: details,
      quand: siennes.length && siennes[0].quand === "place" ? "place" : "avant",
      etape: leg.to_stage,
      prixAVerifier: s.montant === null || s.inconnu,
      dansBudget: true,
      dateAConfirmer: false,
      verifie: null,
      hausse: null,
      offre: null,
    };
  }

  // ---------------------------------------------------------------------------------------------- lodgings

  function itemLogement(trip, cle, choix, D, lignes, aujourdhui) {
    var r = logementDe(D, cle, choix[cle]);
    if (!r) return null;
    var l = r.l;
    var p = l.prix || {};
    // what is paid before leaving for this lodging: the room, the extra nights, the transfers booked in advance; when
    // nothing is, the room paid there
    var siennes = lignes.filter(function (x) { return x.etape === cle && !x.sortie && !x.trajet && x.poste !== "formalites"; });
    var payees = siennes.filter(function (x) { return x.quand === "avant"; });
    var quand = "avant";
    if (!payees.length) {
      payees = siennes.filter(function (x) { return x.cle === "chambre"; });
      quand = "place";
    }
    var s = sommeLignes(payees);
    var inconnu = siennes.some(function (x) { return x.incomplet === true || (x.src !== "inclus" && !(num(x.n) && num(x.u))); });
    var incompleteFiche = !r.complet || l.incomplet === true;

    var offre = p.offre && estDate(p.offre.avant) && p.offre.avant >= aujourdhui ? p.offre : null;
    var dates = [];
    if (offre) dates.push(offre.avant.slice(0, 10));
    if (estDate(p.annulation_date)) dates.push(jourPlus(p.annulation_date.slice(0, 10), -1));
    var avant = dates.length ? dates.reduce(plusTot, null) : jourPlus(aujourdhui, J_DEFAUT);
    avant = borne(avant, aujourdhui, null);

    var nonRemboursable = !estDate(p.annulation_date) && /non.?refundable|non.?remboursable/i.test(p.annulation || "");
    var prelevement = estDate(p.prelevement_date) ? p.prelevement_date.slice(0, 10) : null;
    var chambres = payees.filter(function (x) { return x.cle === "chambre"; });
    var nuits = chambres.reduce(function (t, x) { return t + (num(x.n) ? x.n : 0); }, 0) || (num(l.nuits) ? l.nuits : 0);

    var sous = [nuits ? tr("plan_nights", { n: nuits }) : "", p.plateforme || "", offre ? tr("plan_offer_before", { date: dateTxt(offre.avant) }) : ""].filter(Boolean).join(" · ");

    var details = [];
    payees.forEach(function (x) {
      if (!num(x.u) || !num(x.n)) details.push(tr("plan_line_to_check", { lib: x.lib }));
      else if (x.cle === "chambre") details.push(tr("plan_room_line", { n: x.n, unit: argent(x.u), total: argent(x.n * x.u), platform: p.plateforme || tr("plan_price_found") }));
      else details.push(tr("plan_line", { lib: x.lib, n: x.n, unit: argent(x.u) }));
    });
    if (offre) details.push(tr("plan_offer", { text: offre.texte }));
    if (p.annulation) details.push(tr("plan_cancellation", { text: fin(p.annulation) }));
    if (p.paiement) details.push(tr("plan_payment", { text: fin(p.paiement) }));
    else if (nonRemboursable) details.push(tr("plan_paid_at_booking_nonref"));
    if (p.dispo) details.push(tr("plan_availability", { text: fin(p.dispo) }));
    if (p.detail) details.push(tr("plan_price_detail", { text: fin(p.detail) }));
    siennes.forEach(function (x) { if (x.cle === "nuit-perdue" && x.note) details.push(fin(tr("plan_line_note", { lib: x.lib, note: x.note }))); });
    if (incompleteFiche) details.push(tr("plan_incomplete_fiche"));
    if (p.verifie) details.push(tr("plan_price_checked", { date: dateTxt(p.verifie) }));

    var liens = (l.liens || []).map(lienDe);
    // the platform of the retained price (`retenu`, page_data.py), even without an address; else the first link
    var retenu = liens.filter(function (x) { return x.retenu === true; })[0] || (liens.some(function (x) { return "retenu" in x; }) ? null : liens[0]);
    if (retenu) retenu.meilleur = true;

    return {
      cle: "logement:" + cle + ":" + l.id,
      type: "logement",
      titre: l.nom || l.id,
      sous: sous + (s.montant === null ? " · " + tr("price_to_check") : ""),
      image: premierePhoto(l),
      imageType: premierePhoto(l) ? "cover" : null,
      montant: s.montant,
      horsBudget: false,
      avant: avant,
      prelevement: prelevement,
      paiement: p.paiement || (nonRemboursable ? tr("plan_pay_at_booking") : null),
      annulation: p.annulation || null,
      liens: liens,
      details: details,
      quand: quand,
      etape: cle,
      prixAVerifier: s.montant === null || s.inconnu || inconnu || incompleteFiche,
      dansBudget: true,
      dateAConfirmer: false,
      verifie: p.verifie || null,
      hausse: null,
      offre: offre ? { texte: offre.texte, avant: offre.avant } : null,
    };
  }

  // ---------------------------------------------------------------------------------------------- outings

  /* pl: placementSorties(choix, D) (days.js) or null. */
  function itemSortie(trip, id, choix, D, lignes, aujourdhui, pl) {
    var s = sortieDe(D, trip, id);
    if (!s) return null;
    var ligne = lignes.filter(function (x) { return x.sortie === id && x.cle === id; })[0];
    // the budget does not count it (none of your days fits: "hors-dates" alert): nothing to book
    if (!ligne) return null;
    var remplace = lignes.filter(function (x) { return x.sortie === id && x.cle === "remplace"; });
    var rempl = remplace[0];
    var connu = num(ligne.n) && num(ligne.u) && ligne.incomplet !== true;
    var montant = connu ? r2(ligne.n * ligne.u) : null;
    var surPlaceGroupe = s.groupe === "manger" || s.groupe === "boire" || s.groupe === "bienetre";
    var quand = ligne.quand ? ligne.quand : s.a_reserver && !surPlaceGroupe ? "avant" : "place";
    // "no booking": nothing to do before, unless it is paid in advance or its price is still to check
    if (s.quand_reserver === "sans" && quand !== "avant" && connu) return null;

    // the day of the outing: the chosen day (when it is one of your days), its fixed date, else the day the day by day gives it
    var hors = pl && Array.isArray(pl.horsDates) && pl.horsDates.indexOf(id) >= 0;
    var choisie = !hors && estObjet(choix.sorties) && estObjet(choix.sorties[id]) ? jourDe(choix.sorties[id].jour) : null;
    var fixe = jourDe(s.date_fixe);
    var placee = !choisie && !fixe && pl && pl.jours ? jourDe(pl.jours[id]) : null;
    var jourSortie = choisie || fixe;
    var fen = pl && pl.fenetres && pl.fenetres[s.etape];
    var etape = trip.stage(s.etape);
    var debutEtape = fen ? jourDe(fen.du) : etape ? jourDe(etape.from) : null;

    var q = s.quand_reserver;
    var avant;
    if (q === "maintenant") avant = jourPlus(aujourdhui, J_MAINTENANT);
    else if (q === "vite") avant = jourPlus(aujourdhui, J_VITE);
    else {
      // "veille" (and "sans" to check): the day before the outing, else before the first of your days at the stage
      var j = jourSortie || placee || debutEtape;
      avant = j ? jourPlus(j, -1) : jourPlus(aujourdhui, J_DEFAUT);
    }
    if (s.hausse && estDate(s.hausse.avant)) avant = plusTot(avant, jourPlus(s.hausse.avant.slice(0, 10), -MARGE_HAUSSE));
    avant = borne(avant, aujourdhui, jourSortie ? jourPlus(jourSortie, -1) : null);

    var quandTexte = fixe ? dateTxt(fixe) + (s.depart ? " " + s.depart : "") : choisie ? dateTxt(choisie)
      : placee ? tr("plan_suggested_day", { date: dateTxt(placee) }) : tr("plan_day_to_choose");
    var sous = [titreEtape(trip, s.etape), quandTexte].join(" · ") + (montant === null ? " · " + tr("price_to_check") : "");
    var pour = tr("for_n_people", { n: trip.adults || 1 });

    var details = [];
    details.push(montant === null
      ? tr("plan_outing_price_to_check")
      : tr("plan_outing_price", { people: pour, price: argent(montant), kind: tr(ligne.src === "estime" ? "plan_estimated" : "plan_published") }));
    if (s.hausse && estDate(s.hausse.avant)) {
      var h = s.hausse;
      details.push(tr("plan_outing_rise", {
        current: connu ? " (" + argent(montant) + ")" : "", date: dateTxt(h.avant),
        after: num(h.prix_apres_home) ? tr("plan_then_price", { price: argent(h.prix_apres_home), people: pour }) : tr("plan_then_more"),
      }));
    }
    if (s.reserver_quand) details.push(fin(tr("plan_when_to_book", { text: s.reserver_quand })));
    // what the outing removes from the lodging's budget ("remplace" lines): counted in the totals of the sections
    var credit = null;
    remplace.forEach(function (x) {
      if (!num(x.n) || !num(x.u)) return;
      credit = credit || { montant: 0, quand: x.quand === "avant" ? "avant" : "place" };
      credit.montant += x.n * x.u;
    });
    if (credit) credit.montant = r2(credit.montant);
    if (rempl && num(rempl.u)) {
      details.push(tr("plan_outing_replaces", { lib: rempl.lib, times: remplace.length > 1 ? " × " + remplace.length : "", amount: argent(Math.abs(credit ? credit.montant : rempl.n * rempl.u)) }));
    }
    if (q === "sans") details.push(tr(connu ? "plan_no_booking" : "plan_no_booking_check"));
    details.push(tr(quand === "avant" ? "plan_paid_when_booking" : "plan_paid_on_site"));

    var liens = [];
    (s.liens || []).forEach(function (x) {
      liens.push(lienDe({ site: x.site, url: x.url, prix_home: num(x.prix_home) ? x.prix_home : null, verifie: x.verifie }));
    });
    if (s.lien_reservation && !liens.some(function (x) { return x.url === s.lien_reservation; })) {
      liens.push({ site: tr("plan_booking"), url: s.lien_reservation, prix_home: null });
    }
    var best = null;
    liens.forEach(function (x) { if (x.prix_home !== null && (best === null || x.prix_home < best.prix_home)) best = x; });
    if (best) best.meilleur = true;

    return {
      cle: "sortie:" + id,
      type: "sortie",
      titre: s.nom || id,
      sous: sous,
      image: premierePhoto(s),
      imageType: premierePhoto(s) ? "photo" : null,
      montant: montant,
      horsBudget: false,
      avant: avant,
      prelevement: null,
      paiement: tr(quand === "avant" ? "plan_pay_at_booking" : "plan_pay_on_site"),
      annulation: null,
      liens: liens,
      details: details,
      quand: quand,
      etape: s.etape,
      prixAVerifier: montant === null,
      dansBudget: true,
      dateAConfirmer: false,
      verifie: s.verifie || null,
      hausse: s.hausse ? { avant: s.hausse.avant, prix_apres_home: num(s.hausse.prix_apres_home) ? s.hausse.prix_apres_home : null } : null,
      offre: null,
      credit: credit,
    };
  }

  // ---------------------------------------------------------------------------------------------- formalities

  function refTexte(f) {
    return tr(f.avant === "arrivee" ? "plan_ref_arrival" : "plan_ref_departure");
  }

  function delaiTexte(f, avant) {
    var n = f.delai_jours;
    if (f.fenetre === true) return tr("plan_window_short", { n: n });
    if (!avant) return tr("plan_date_to_confirm");
    return n > 0 ? tr("plan_at_least_before", { n: n, ref: refTexte(f) }) : tr("plan_before", { ref: refTexte(f) });
  }

  function itemFormalite(trip, f, porteurs, choix, D, lignes, aujourdhui) {
    var code = f.code;
    var siennes = lignes.filter(function (l) { return l.poste === "formalites" && l.cle === code; });
    var s = sommeLignes(siennes);
    var montant;
    var prixAVerifier;
    if (siennes.length) {
      montant = s.montant;
      prixAVerifier = s.inconnu;
    } else {
      montant = num(f.cout_home) ? f.cout_home : null;
      prixAVerifier = montant === null;
    }
    var horsBudget = siennes.length > 0 && siennes.every(function (l) { return l.hors_budget === true; });
    var quand = siennes.length ? siennes[0].quand : num(f.cout_home) && f.cout_home > 0 && f.avant === "arrivee" ? "place" : "avant";

    // reference date: the departure of the flight asking for it, else the traveler's arrival flight
    var ref = null;
    if (f.avant === "depart") {
      var deps = (porteurs || []).map(function (t) { return departDe(optionDe(D, t, choix[t])); }).filter(Boolean).sort();
      ref = deps.length ? deps[0] : reperesArrivee(trip, choix, D, f.qui, "depart");
    } else if (f.avant === "arrivee") {
      ref = reperesArrivee(trip, choix, D, f.qui, "arrivee");
    }
    var delai = num(f.delai_jours) ? f.delai_jours : 0;
    var avant = null;
    var ouvre = null;
    if (ref) {
      if (f.fenetre === true) {
        avant = ref;
        ouvre = jourPlus(ref, -delai);
      } else {
        avant = jourPlus(ref, -delai);
      }
      avant = borne(avant, aujourdhui, null);
    }

    var details = [fin(f.titre || code)];
    if (avant) {
      details.push(ouvre
        ? tr("plan_window", { open: dateTxt(ouvre), n: delai, date: dateTxt(avant) })
        : tr("plan_at_latest", {
          date: dateTxt(avant),
          delay: delai > 0 ? tr("plan_delay_before", { n: delai, ref: refTexte(f) }) : tr(f.avant === "arrivee" ? "plan_delay_day_of_arrival" : "plan_delay_day_of_departure"),
        }));
    } else {
      details.push(tr("plan_date_to_confirm_no_ref"));
    }
    if (prixAVerifier) details.push(tr("plan_price_to_check_line"));
    if (horsBudget) details.push(tr("plan_formality_out_of_budget"));
    if (f.verifie) details.push(tr("plan_checked", { date: dateTxt(f.verifie) }));

    var t = trip.traveler(f.qui);
    var qui = t ? tr("plan_for_who", { who: t.label }) : tr("plan_for_everyone");
    var sous = [qui, delaiTexte(f, avant)].filter(Boolean).join(" · ") + (prixAVerifier ? " · " + tr("price_to_check") : "");

    return {
      cle: "formalite:" + code,
      type: "formalite",
      titre: f.nom || nomFormalite(code, f.titre),
      sous: sous,
      image: null,
      imageType: null,
      montant: montant,
      horsBudget: horsBudget,
      avant: avant,
      prelevement: null,
      paiement: tr(quand === "place" ? "plan_pay_on_site" : montant === 0 ? "plan_pay_free" : "plan_pay_on_request"),
      annulation: null,
      liens: f.url_officielle ? [{ site: tr("plan_official_site"), url: f.url_officielle, prix_home: null }] : [],
      details: details,
      quand: quand,
      etape: null,
      prixAVerifier: prixAVerifier,
      dansBudget: siennes.length > 0 || !(montant > 0),
      dateAConfirmer: !avant,
      verifie: f.verifie || null,
      hausse: null,
      offre: null,
    };
  }

  /** A formality asked by a chosen flight but missing from D.formalites: a line "to check". */
  function formaliteInconnue(code) {
    return {
      code: code,
      nom: tr("plan_unknown_formality", { code: code }),
      qui: "all",
      titre: tr("plan_unknown_formality_text", { code: code }),
      cout_home: null,
      delai_jours: J_INCONNU,
      avant: "depart",
      condition: code,
      url_officielle: "",
      verifie: null,
    };
  }

  function itemsFormalites(trip, choix, D, lignes, aujourdhui) {
    var porteurs = {};
    trip.legs.forEach(function (leg) {
      var o = optionDe(D, leg.key, choix[leg.key]);
      ((o && o.formalites) || []).forEach(function (code) {
        (porteurs[code] = porteurs[code] || []).push(leg.key);
      });
    });
    var defs = D && Array.isArray(D.formalites) ? D.formalites : [];
    var out = [];
    defs.forEach(function (f) {
      if (f.condition && !porteurs[f.condition]) return; // conditional: only when a chosen flight asks for it
      out.push(itemFormalite(trip, f, f.condition ? porteurs[f.condition] : null, choix, D, lignes, aujourdhui));
    });
    Object.keys(porteurs).forEach(function (code) {
      var connue = defs.some(function (f) { return f.code === code || f.condition === code; });
      if (!connue) out.push(itemFormalite(trip, formaliteInconnue(code), porteurs[code], choix, D, lignes, aujourdhui));
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------- API

  function planItems(choix, D, aujourdhui) {
    var c = estObjet(choix) ? choix : {};
    var trip = cfg(D);
    var auj = aujourdhuiPar(aujourdhui);
    var B = budget();
    var lignes = B.lignesVoyage(c, D);
    var liste = [];

    trip.legs.forEach(function (leg) {
      var i = leg.mode === "flight" ? itemVol(trip, leg, c, D, lignes, auj) : itemTrajetSol(trip, leg, c, D, lignes, auj);
      if (i) liste.push(i);
    });
    trip.stageKeys.forEach(function (cle) {
      var i = itemLogement(trip, cle, c, D, lignes, auj);
      if (i) liste.push(i);
    });
    itemsFormalites(trip, c, D, lignes, auj).forEach(function (i) { liste.push(i); });

    // the outings that count (ticked ones, one per special evening), each once
    var ids = B.sortiesComptees(c, D);
    var pl = ids.length ? placement(c, D) : null;
    ids.forEach(function (id) {
      var i = itemSortie(trip, id, c, D, lignes, auj, pl);
      if (i) liste.push(i);
    });

    liste.forEach(function (i) { i.urgence = urgenceDe(i.avant, auj); });
    return liste
      .map(function (item, k) { return { item: item, k: k }; })
      .sort(function (a, b) {
        var x = a.item.avant;
        var y = b.item.avant;
        if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
        return ORDRE_TYPE[a.item.type] - ORDRE_TYPE[b.item.type] || a.k - b.k;
      })
      .map(function (e) { return e.item; });
  }

  function totauxSection(liste) {
    var avant = 0;
    var place = 0;
    var incomplet = false;
    liste.forEach(function (i) {
      if (i.horsBudget || i.dansBudget === false) return;
      if (num(i.montant)) {
        if (i.quand === "avant") avant += i.montant;
        else place += i.montant;
      }
      // an outing that replaces a dinner (or drinks, a massage) of the lodging: the budget removes what it replaces
      if (i.credit && num(i.credit.montant)) {
        if (i.credit.quand === "avant") avant += i.credit.montant;
        else place += i.credit.montant;
      }
      if (i.prixAVerifier) incomplet = true;
    });
    return { avant: r2(avant), place: r2(place), incomplet: incomplet };
  }

  /** "To do now" = red urgency; "can wait" = orange and green. The totals ignore what is out of the budget. */
  function sections(items) {
    var liste = Array.isArray(items) ? items : [];
    var maintenant = liste.filter(function (i) { return i.urgence === "rouge"; });
    var attendre = liste.filter(function (i) { return i.urgence !== "rouge"; });
    return { maintenant: maintenant, attendre: attendre, totaux: { maintenant: totauxSection(maintenant), attendre: totauxSection(attendre) } };
  }

  /**
   * When the money leaves: what is paid before leaving, by debit date (else by deadline). "This week" gathers everything
   * leaving by today + 7 days (a past date included). Without out-of-budget items, without what is paid on the spot,
   * without free items. An unknown price is listed (cles) without amount and marks its group incomplete.
   */
  function argentPart(items, aujourdhui) {
    var auj = aujourdhuiPar(aujourdhui);
    var groupes = {};
    (Array.isArray(items) ? items : []).forEach(function (i) {
      if (!i || i.horsBudget || i.dansBudget === false || i.quand !== "avant") return;
      var m = num(i.montant) ? i.montant : null;
      if (m === null ? !i.prixAVerifier : m <= 0 && !i.prixAVerifier) return; // free: nothing leaves
      var date = estDate(i.prelevement) ? i.prelevement.slice(0, 10) : estDate(i.avant) ? i.avant.slice(0, 10) : null;
      if (!date) return;
      var semaine = ecart(auj, date) <= SEUIL_ROUGE;
      var k = semaine ? "" : date;
      var g = groupes[k] || (groupes[k] = { libelle: semaine ? tr("plan_this_week") : date, semaine: semaine, montant: 0, cles: [], incomplet: false });
      g.montant += m === null ? 0 : m;
      g.cles.push(i.cle);
      if (i.prixAVerifier) g.incomplet = true;
    });
    return Object.keys(groupes)
      .sort()
      .map(function (k) {
        var g = groupes[k];
        g.montant = r2(g.montant);
        return g;
      });
  }

  /**
   * What is paid there, stage by stage (in the order of the lines: the stages of the trip, then "vols": common lines).
   * monnaie: the rate home → local (a number), TRIP.currency ({ rate }) or TRIP; local = montant × rate in whole units,
   * null without a rate. Items at 0 are left out unless their price is to check.
   * `local` is ALREADY CONVERTED: display it with fmtMoney(local, "local", { converted: true }), never with
   * fmtMoney(local, "local") (that converts it a second time). `montant` is in the home currency: fmtMoney(montant).
   */
  function surPlace(lignes, monnaie) {
    var t = num(monnaie) ? monnaie
      : estObjet(monnaie) && num(monnaie.rate) ? monnaie.rate
        : estObjet(monnaie) && estObjet(monnaie.currency) && num(monnaie.currency.rate) ? monnaie.currency.rate : null;
    var montantLigne = budget().montantLigne;
    var etapes = {};
    var ordre = [];
    (Array.isArray(lignes) ? lignes : []).forEach(function (l) {
      if (!l || l.hors_budget || l.quand !== "place") return;
      var e = l.etape || "vols";
      if (!etapes[e]) {
        etapes[e] = { etape: e, postes: {}, incomplet: false };
        ordre.push(e);
      }
      var g = etapes[e];
      var nom = l.poste || "activites";
      var p = g.postes[nom] || (g.postes[nom] = { poste: nom, montant: 0, incomplet: false });
      p.montant += montantLigne(l);
      if (l.incomplet === true || !num(l.n) || !num(l.u)) {
        p.incomplet = true;
        g.incomplet = true;
      }
    });
    var tri = ordre.filter(function (e) { return e !== "vols"; }).concat(ordre.filter(function (e) { return e === "vols"; }));
    return tri.map(function (e) {
      var g = etapes[e];
      var postes = Object.keys(g.postes)
        .map(function (k) { var p = g.postes[k]; return { poste: p.poste, montant: r2(p.montant), incomplet: p.incomplet }; })
        .filter(function (p) { return p.montant !== 0 || p.incomplet; })
        .sort(function (a, b) {
          var x = ORDRE_POSTE.indexOf(a.poste);
          var y = ORDRE_POSTE.indexOf(b.poste);
          return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
        });
      var total = r2(postes.reduce(function (s, p) { return s + p.montant; }, 0));
      return { etape: e, montant: total, local: t === null ? null : Math.round(total * t), postes: postes, incomplet: g.incomplet };
    });
  }

  return { planItems: planItems, sections: sections, argentPart: argentPart, surPlace: surPlace };
})();

function planItems(choix, D, aujourdhui) { return PlanLogic.planItems(choix, D, aujourdhui); }
function sections(items) { return PlanLogic.sections(items); }
function argentPart(items, aujourdhui) { return PlanLogic.argentPart(items, aujourdhui); }
function surPlace(lignes, monnaie) { return PlanLogic.surPlace(lignes, monnaie); }

if (typeof module !== "undefined") {
  module.exports = { planItems: planItems, sections: sections, argentPart: argentPart, surPlace: surPlace };
}
