/* Day by day of the trip (pure logic, no DOM): where you sleep, trips, outings on the right days, sunrise and sunset.
   Inputs: choix (see budget.js) and D = parcours.json, each parcours-<stage>.json stored in D.lieux[<stage key>].
   TRIP comes from creerTrip(D) (config.js); texts from T() (i18n.js).

   API (globals):
     placerSorties(choix, D)      -> { <outing id>: "YYYY-MM-DD" }
     sortiesHorsDates(choix, D)   -> [id]   counted outings outside your days at their stage (fixed date, dates, or a
                                            chosen day that is no longer one of them): they are on no card
     placementSorties(choix, D)   -> { jours: <as placerSorties>, horsDates: [id], impossibles: [id],
                                       fenetres: { <stage>: { du, au } } }
                                     impossibles ⊂ horsDates: none of your days at the stage fits (fixed date or dates
                                     outside them); budget.js does not count them. A chosen day outside your days is not
                                     impossible when another day of the stage fits: the outing stays in the budget.
                                     fenetres: your days at each stage (everyone there; the last one until the last
                                     traveler leaves).
     jourParJour(choix, D)        -> [{ date, etape, dort, lever, coucher, trajets, sorties, libre, dort_nom, ecart, notes }]
                                     from the first landing (or the trip's start) to the day the last traveler leaves.
     JoursLogic.finMoment(moment) -> minutes when an outing of that moment is over, back at the lodging included
                                     (alerts.js reads the same table)

   The day you leave a lodging comes from departsEtape / jourDepartLogement (alerts.js), shared with budget.js: a flight
   leaving after midnight makes you leave the evening before; that card carries the transfer and the flight.

   Placement rules, deterministic (same input, same result, whatever the key order):
     1. a day chosen by you (sorties[id].jour) is kept when it is one of your days at the stage; otherwise horsDates;
     2. a fixed-date outing stays on its date, or, when that date is outside your days at the stage, is not placed;
     3. the others go to the day of their stage that respects, in this order: no travel day unless jour_trajet_ok, no dawn
        the day after the last landing, at most one "journee" per day and nothing else that day but an evening, and on a
        day someone leaves the stage's lodging nothing that ends after they leave (even with jour_trajet_ok); among the
        fitting days: not two outings at the same moment, not a travel day, not the day before a departure for a heavy
        outing (dawn, full day), the least busy, and finally the earliest;
     4. an outing that only happens on some days (dates YYYY-MM-DD) only goes to those days.
   Choices read: one field per leg and per stage, sorties, speciales. An absent field (undefined) takes the default
   D.defaut; null or false = nothing. */
var JoursLogic = (function () {
  "use strict";

  var MOMENTS = { aube: 0, matin: 1, journee: 2, "apres-midi": 3, coucher: 4, soir: 5 };
  /* When an outing of this moment is over, back at the lodging included (minutes): on a day someone leaves the lodging
     of its stage, an outing that ends after they leave cannot happen. */
  var FIN_MOMENT = { aube: 9 * 60, matin: 12 * 60 + 30, journee: 18 * 60, "apres-midi": 18 * 60, coucher: 19 * 60 + 30, soir: 22 * 60 + 30 };
  var LOURDES = { aube: true, journee: true }; // to avoid the day before a departure

  /* ---------- other modules (globals in the page, require under node) ---------- */
  function cfg(D) {
    var f = typeof creerTrip === "function" ? creerTrip : require("./config.js").creerTrip;
    return f(D);
  }
  function i18n() {
    return typeof T === "function" && typeof fmtDate === "function" ? { T: T, fmtDate: fmtDate, fmtMoney: fmtMoney } : require("../i18n.js");
  }
  function tr(cle, vars) { return i18n().T(cle, vars); }
  function dateCourte(iso) { return i18n().fmtDate(iso); }
  function argent(n) { return i18n().fmtMoney(n, "home"); }
  function comptees(choix, D) {
    var f = typeof sortiesComptees === "function" ? sortiesComptees : require("./budget.js").sortiesComptees;
    return f(choix, D);
  }
  /* Departures from a stage's lodging, earliest first (alerts.js); [] without alerts.js. */
  function departs(choix, D, etape) {
    var f = typeof departsEtape === "function" ? departsEtape
      : typeof require === "function" ? require("./alerts.js").departsEtape : null;
    return f ? f(choix, D, etape) || [] : [];
  }

  /* ---------- dates and times ---------- */
  function estDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function jourPlus(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function ecartJours(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function deux(n) { return (n < 10 ? "0" : "") + n; }
  function minutes(local) { return +local.slice(11, 13) * 60 + +local.slice(14, 16); } // "2027-06-15T09:30" -> 570
  function minutesHeure(h) { var m = /^(\d{1,2}):(\d{2})/.exec(h || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function hhmm(min) { var m = ((min % 1440) + 1440) % 1440; return deux(Math.floor(m / 60)) + ":" + deux(m % 60); }
  function heureLocale(local) { return local.slice(11, 16); }
  function duree(min) {
    if (min < 60) return tr("dur_min", { m: min });
    return min % 60 ? tr("dur_h_min", { h: Math.floor(min / 60), mm: deux(min % 60) }) : tr("dur_h", { h: Math.floor(min / 60) });
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function cmpCles(a, b) {
    for (var i = 0; i < a.length; i++) { var r = cmp(a[i], b[i]); if (r) return r; }
    return 0;
  }
  function majuscule(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- reading choices and data ---------- */
  function champ(choix, D, cle) {
    var v = choix ? choix[cle] : undefined;
    if (v === undefined) v = D && D.defaut ? D.defaut[cle] : undefined;
    return typeof v === "string" && v ? v : null;
  }
  function option(choix, D, cle) {
    var id = champ(choix, D, cle);
    var options = D && D.vols && D.vols[cle] && D.vols[cle].options;
    if (!id || !Array.isArray(options)) return null;
    for (var i = 0; i < options.length; i++) if (options[i].id === id) return options[i];
    return null;
  }
  function volChoisi(choix, D, cle) {
    var o = option(choix, D, cle);
    return o && o.segments && o.segments.length && o.segments[0].dep_local && o.segments[o.segments.length - 1].arr_local ? o : null;
  }
  function logement(D, cle, id) {
    var L = D && D.lieux && D.lieux[cle];
    if (!L || !id) return null;
    var listes = [L.logements || [], L.autres || []];
    for (var k = 0; k < listes.length; k++) for (var i = 0; i < listes[k].length; i++) if (listes[k][i].id === id) return listes[k][i];
    return null;
  }
  function indexSorties(D, trip) {
    var idx = {};
    trip.stageKeys.forEach(function (cle) {
      var L = D && D.lieux && D.lieux[cle];
      ((L && L.sorties) || []).forEach(function (s) { if (s && s.id && !idx[s.id]) idx[s.id] = { s: s, etape: s.etape || cle }; });
    });
    return idx;
  }

  /* Dates, stages and travel days of the trip as chosen. */
  function contexte(choix, D) {
    var trip = cfg(D);
    var bornes = {};
    trip.stages.forEach(function (s) { bornes[s.key] = [s.from, s.to]; });
    var dernier = trip.stageKeys[trip.stageKeys.length - 1];
    var debut = trip.start;
    var fin = trip.end;
    var dep = {};
    trip.stageKeys.forEach(function (k) { dep[k] = departs(choix, D, k); });
    var retours = dernier ? dep[dernier].filter(function (q) { var l = trip.legByKey[q.trajet]; return l && l.kind === "return"; }) : [];
    // the last day: the day the last traveler leaves the last hotel (the evening before for a flight after midnight)
    var jourR = null;
    var qr = null;
    retours.forEach(function (q) {
      if (!qr || q.jour > qr.jour || (q.jour === qr.jour && q.minutes > qr.minutes)) qr = q;
    });
    if (qr) jourR = qr.jour;
    if (jourR && debut && jourR < debut) { jourR = null; qr = null; }
    var finCartes = jourR || fin;
    var arrivees = [];
    trip.arrivals.forEach(function (leg) {
      var v = volChoisi(choix, D, leg.key);
      if (!v) return;
      var jour = v.segments[v.segments.length - 1].arr_local.slice(0, 10);
      if (estDate(jour) && (!finCartes || jour <= finCartes)) arrivees.push({ leg: leg, jour: jour });
    });
    arrivees.sort(function (a, b) { return cmp(a.jour, b.jour) || cmp(a.leg.key, b.leg.key); });
    var jourAmin = arrivees.length ? arrivees[0].jour : null;
    var jourAmax = arrivees.length ? arrivees[arrivees.length - 1].jour : null;
    var debutCartes = jourAmin && jourAmin < debut ? jourAmin : debut;
    var groupeDu = jourAmax && jourAmax > debut ? jourAmax : debut; // first day everyone is there

    // travel days: the first day of each stage, the real landing days, the days someone leaves the last hotel
    // (its last day when no return flight is chosen); the same days as rule 3 of alerts.js
    var trajet = {};
    trip.stages.forEach(function (s) { trajet[s.from] = true; });
    arrivees.forEach(function (a) { trajet[a.jour] = true; });
    retours.forEach(function (q) { trajet[q.jour] = true; });
    if (!retours.length && dernier) trajet[bornes[dernier][1]] = true;

    function etapeDu(date) {
      var s = trip.stageAt(date);
      return s ? s.key : null;
    }
    function fenetre(etape) {
      var b = bornes[etape] || [debut, fin];
      var du = b[0] > groupeDu ? b[0] : groupeDu;
      var au = etape === dernier ? finCartes : (b[1] < finCartes ? b[1] : finCartes);
      return { du: du, au: au };
    }
    return {
      trip: trip, bornes: bornes, debut: debut, fin: fin, dernier: dernier, arrivees: arrivees, jourAmin: jourAmin,
      jourAmax: jourAmax, jourR: jourR, qr: qr, retours: retours, finCartes: finCartes, debutCartes: debutCartes,
      groupeDu: groupeDu, trajet: trajet, etapeDu: etapeDu, fenetre: fenetre, departs: dep,
      pasAube: !jourAmax || jourAmax >= debut ? jourPlus(jourAmax || debut, 1) : null, // the day after the last landing
    };
  }

  /* Does an outing of this stage, that day, end after someone leaves the stage's lodging? */
  function pendantDepart(m, etape, date, ctx) {
    var f = FIN_MOMENT[m];
    return f !== undefined && (ctx.departs[etape] || []).some(function (q) { return q.jour === date && f > q.minutes; });
  }
  /* Can an outing happen on a day of this window (its fixed date, its dates)? */
  function placable(s, w) {
    if (!w || w.du > w.au) return false;
    if (estDate(s.date_fixe)) return s.date_fixe >= w.du && s.date_fixe <= w.au;
    var seulement = datesDisponibles(s);
    return !seulement || seulement.some(function (d) { return d >= w.du && d <= w.au; });
  }

  /* ---------- placing the outings ---------- */
  function sortiesChoisies(choix, D, idx) {
    var out = {};
    var so = (choix && choix.sorties) || {};
    comptees(choix || {}, D).forEach(function (id) {
      if (!idx[id] || out[id]) return;
      var v = so[id];
      out[id] = { jour: v && typeof v === "object" && estDate(v.jour) ? v.jour : null };
    });
    return out;
  }
  function datesDisponibles(s) { // only when every date is written YYYY-MM-DD
    var d = s.dates;
    if (!d || !d.length) return null;
    var out = [];
    for (var i = 0; i < d.length; i++) {
      if (typeof d[i] !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(d[i])) return null;
      out.push(d[i].slice(0, 10));
    }
    return out;
  }
  function plage(du, au) {
    var out = [];
    if (!estDate(du) || !estDate(au)) return out;
    for (var d = du; d <= au; d = jourPlus(d, 1)) out.push(d);
    return out;
  }
  function entreesDuJour(occupants, date) { return occupants[date] || []; }

  /* Hard rules: number of rules broken on that date (0 = the day fits). */
  function infractions(s, etape, date, ctx, occupants) {
    var n = 0;
    var m = s.moment;
    var autres = entreesDuJour(occupants, date);
    if (ctx.trajet[date] && !s.jour_trajet_ok) n++;
    if (pendantDepart(m, etape, date, ctx)) n++;
    if (m === "aube" && date === ctx.pasAube) n++;
    if (m === "journee") { if (autres.some(function (x) { return x !== "soir"; })) n++; }
    else if (m !== "soir" && autres.indexOf("journee") >= 0) n++;
    return n;
  }

  function placerAvec(choix, D, ctx) {
    var idx = indexSorties(D, ctx.trip);
    var choisies = sortiesChoisies(choix, D, idx);
    var ids = Object.keys(choisies).sort(cmp);
    var jours = {};
    var hors = [];
    var occupants = {}; // date -> moments of the outings already placed that day
    function poser(id, date) {
      jours[id] = date;
      (occupants[date] = occupants[date] || []).push(idx[id].s.moment);
    }

    ids.forEach(function (id) { // 1. chosen days
      var j = choisies[id].jour;
      if (!j) return;
      var w = ctx.fenetre(idx[id].etape);
      if (j >= w.du && j <= w.au) poser(id, j); else hors.push(id); // outside your days (a later landing, an earlier return)
    });

    var libres = [];
    ids.forEach(function (id) { // 2. fixed dates
      if (choisies[id].jour) return;
      var s = idx[id].s;
      if (!estDate(s.date_fixe)) { libres.push(id); return; }
      var w = ctx.fenetre(idx[id].etape);
      if (s.date_fixe >= w.du && s.date_fixe <= w.au) poser(id, s.date_fixe); else hors.push(id);
    });

    libres.sort(function (a, b) { // 3. the others
      function rang(id) {
        var s = idx[id].s;
        return [datesDisponibles(s) ? 0 : 1, s.moment === "journee" ? 0 : s.moment === "aube" ? 1 : 2, id];
      }
      return cmpCles(rang(a), rang(b));
    });
    libres.forEach(function (id) {
      var s = idx[id].s;
      var w = ctx.fenetre(idx[id].etape);
      var possibles = plage(w.du, w.au);
      var seulement = datesDisponibles(s);
      if (seulement) possibles = possibles.filter(function (d) { return seulement.indexOf(d) >= 0; });
      if (!possibles.length) { hors.push(id); return; }
      var meilleur = null;
      var meilleureCle = null;
      possibles.forEach(function (d) {
        var autres = entreesDuJour(occupants, d);
        var cle = [
          infractions(s, idx[id].etape, d, ctx, occupants),
          autres.indexOf(s.moment) >= 0 ? 1 : 0, // two outings at the same moment
          ctx.trajet[d] ? 1 : 0, // a travel day allowed, but as a last resort
          LOURDES[s.moment] && ctx.trajet[jourPlus(d, 1)] ? 1 : 0, // the day before a departure, for a heavy outing
          autres.length, // the least busy
          d, // the earliest
        ];
        if (!meilleureCle || cmpCles(cle, meilleureCle) < 0) { meilleureCle = cle; meilleur = d; }
      });
      poser(id, meilleur);
    });

    var tries = {};
    Object.keys(jours).sort(cmp).forEach(function (id) { tries[id] = jours[id]; });
    var fenetres = {};
    ctx.trip.stageKeys.forEach(function (e) { fenetres[e] = ctx.fenetre(e); });
    hors.sort(cmp);
    var impossibles = hors.filter(function (id) { return !placable(idx[id].s, fenetres[idx[id].etape]); });
    return { jours: tries, horsDates: hors, impossibles: impossibles, fenetres: fenetres };
  }

  function placementSorties(choix, D) { return placerAvec(choix, D, contexte(choix, D)); }
  function placerSorties(choix, D) { return placementSorties(choix, D).jours; }
  function sortiesHorsDates(choix, D) { return placementSorties(choix, D).horsDates; }

  /* ---------- trips of each day ---------- */
  /* Words of a transport mode of the data ("voiture+bateau", "train", "metro+walk"): "by car then by boat"; an unknown
     word is shown as it is. */
  var MODES = [[/voiture|car\b|drive/i, "mode_car"], [/bateau|boat|ferry/i, "mode_boat"], [/bus|coach|minivan/i, "mode_bus"],
    [/train|rail/i, "mode_train"], [/metro|subway/i, "mode_metro"], [/tram/i, "mode_tram"], [/taxi/i, "mode_taxi"],
    [/pied|walk|foot/i, "mode_walk"]];
  function modeTexte(mode) {
    if (!mode) return "";
    return String(mode).split("+").map(function (m) { return m.trim(); }).filter(Boolean).map(function (m) {
      for (var i = 0; i < MODES.length; i++) if (MODES[i][0].test(m)) return tr(MODES[i][1]);
      return m;
    }).join(" " + tr("then") + " ");
  }

  /* dateCarte: the card that carries the line; a flight after midnight kept on the card of the evening before says its date. */
  function ligneVol(trip, qui, v, arriveeSeule, dateCarte) {
    var s0 = v.segments[0];
    var sN = v.segments[v.segments.length - 1];
    var dd = s0.dep_local.slice(0, 10);
    var da = sN.arr_local.slice(0, 10);
    var plus = ecartJours(dd, da);
    var numeros = v.segments.map(function (s) { return s.vol; }).join(" + ");
    if (arriveeSeule) {
      return tr("days_landing", { who: qui, airport: trip.airportName(sN.vers), time: heureLocale(sN.arr_local), flights: numeros, from: trip.airportName(s0.de), date: dateCourte(dd) });
    }
    var autreJour = dateCarte && dateCarte !== dd;
    var texte = qui + " · " + numeros + " · " + trip.airportName(s0.de) + " " + (autreJour ? dateCourte(dd) + " " : "") + heureLocale(s0.dep_local) +
      " → " + trip.airportName(sN.vers) + " " + (plus > 0 ? dateCourte(da) + " " : "") + heureLocale(sN.arr_local) + (plus > 0 ? " (+" + plus + ")" : "");
    var via = (v.escales || []).map(function (e) { return e.ville || e.iata; }).filter(Boolean);
    return texte + (via.length ? " · " + tr("days_via", { places: via.join(", ") }) : "");
  }

  function ligneSol(trip, leg, o) {
    var de = trip.stage(leg.from_stage);
    var vers = trip.stage(leg.to_stage);
    var a = (de ? de.title : leg.from_stage || "") + (o.depart ? " " + o.depart : "");
    var b = (vers ? vers.title : leg.to_stage || "") + (o.arrivee ? " " + o.arrivee : "");
    return [trip.labelsOf(leg), a + " → " + b, o.operateur || modeTexte(o.mode)].filter(Boolean).join(" · ");
  }

  function accesTexte(a, pour) { // pieces common to both ways
    var parts = [];
    if (a.duree_min != null) parts.push(duree(a.duree_min) + (a.mode ? " " + modeTexte(a.mode) : ""));
    if (a.prive_home != null) parts.push(tr("days_private", { price: argent(a.prive_home) }));
    var quoi = tr(a.mode && /bateau|boat|ferry/i.test(String(a.mode)) ? "nature_boat" : "nature_transport");
    if (pour === "arrivee" && a.dernier_public) parts.push(tr("days_last_public", { what: quoi, time: a.dernier_public }));
    if (pour === "depart" && a.premier_public) parts.push(tr("days_first_public", { what: quoi, time: a.premier_public }));
    return parts;
  }

  function texteArrivee(ctx, groupe, lg) {
    var trip = ctx.trip;
    var apt = groupe.aeroports.map(trip.airportName).join(" / ");
    var parts = [tr("days_transfer", { from: apt, to: lg ? lg.nom : tr("days_the_lodging") })];
    var a = lg && lg.acces;
    if (a && a.duree_min != null) {
      parts = parts.concat(accesTexte(a, "arrivee"));
      var chez = groupe.t + trip.rules.airport_exit_min + a.duree_min;
      parts.push(tr("days_at_lodging", { time: hhmm(chez) }) + (chez >= 1440 ? " (+1)" : ""));
      if (a.aeroport && groupe.aeroports.indexOf(a.aeroport) < 0) parts.push(tr("days_duration_for", { airport: trip.airportName(a.aeroport) }));
    } else parts.push(tr("days_duration_to_check"));
    return parts.join(" · ");
  }

  /* Transfer from the lodging to the airport, on the card of the day you leave it (q: jourDepartLogement; for a flight
     after midnight, the card of the evening before). { date, t, texte }. */
  function texteDepart(ctx, leg, lg, v, q) {
    var trip = ctx.trip;
    var s0 = v.segments[0];
    var dd = s0.dep_local.slice(0, 10);
    var parts = [tr("days_transfer", { from: lg ? lg.nom : tr("days_the_lodging"), to: trip.airportName(s0.de) })];
    var qui = trip.whoOf(leg);
    if (qui) parts.push(qui);
    var a = lg && lg.acces;
    var date = q ? q.jour : dd;
    var t = null;
    var vol = date !== dd ? tr("days_flight_on", { date: dateCourte(dd), time: heureLocale(s0.dep_local) }) : tr("days_flight_at", { time: heureLocale(s0.dep_local) });
    if (a && a.duree_min != null) {
      parts = parts.concat(accesTexte(a, "depart"));
      var enreg = trip.rules.checkin_min;
      var heure;
      if (q && !q.estime) {
        enreg = q.enregistrement;
        heure = q.heure;
        t = q.minutes;
      } else { // without alerts.js: the same computation, here
        var partir = minutes(s0.dep_local) - enreg - a.duree_min;
        heure = hhmm(partir) + (partir < 0 ? " " + tr("days_the_day_before") : "");
        t = Math.max(partir, 0);
      }
      parts.push(tr("days_leave_lodging", { time: heure, flight: vol, checkin: enreg }));
      if (a.aeroport && a.aeroport !== s0.de) parts.push(tr("days_duration_for", { airport: trip.airportName(a.aeroport) }));
    } else {
      if (date !== dd) parts.push(vol);
      parts.push(tr("days_duration_to_check"));
    }
    return { date: date, texte: parts.join(" · "), t: t === null ? (q && q.veille ? q.minutes : minutes(s0.dep_local) - 1) : t };
  }

  /* date -> [{t, n, texte}]: flights (on departure, and on landing when it is another day), ground trips and transfers.
     A flight after midnight, for which you leave the lodging the evening before, goes with its transfer on that card. */
  function evenements(choix, D, ctx) {
    var trip = ctx.trip;
    var ev = {};
    var n = 0;
    function ajouter(date, t, texte) { (ev[date] = ev[date] || []).push({ t: t, n: n++, texte: texte }); }
    var arrivees = {}; // "stage|date" -> grouped landings: one transfer per lodging and per day
    trip.legs.forEach(function (leg) {
      if (leg.mode !== "flight") {
        var o = option(choix, D, leg.key);
        if (o && estDate(leg.date)) ajouter(leg.date, minutesHeure(o.depart) || 0, ligneSol(trip, leg, o));
        return;
      }
      var v = volChoisi(choix, D, leg.key);
      if (!v) return;
      var qui = trip.labelsOf(leg);
      var s0 = v.segments[0];
      var sN = v.segments[v.segments.length - 1];
      var dd = s0.dep_local.slice(0, 10);
      var da = sN.arr_local.slice(0, 10);
      var q = null;
      if (leg.from_stage) (ctx.departs[leg.from_stage] || []).forEach(function (x) { if (x.trajet === leg.key) q = x; });
      if (q && q.veille) ajouter(q.jour, minutes(s0.dep_local) + 1440, ligneVol(trip, qui, v, false, q.jour));
      else ajouter(dd, minutes(s0.dep_local), ligneVol(trip, qui, v, false));
      if (da !== dd) ajouter(da, minutes(sN.arr_local), ligneVol(trip, qui, v, true));
      if (leg.from_stage) {
        var d = texteDepart(ctx, leg, logement(D, leg.from_stage, champ(choix, D, leg.from_stage)), v, q);
        ajouter(d.date, d.t, d.texte);
      }
      if (leg.to_stage) {
        var k = leg.to_stage + "|" + da;
        var g = arrivees[k] = arrivees[k] || { etape: leg.to_stage, date: da, t: 0, aeroports: [] };
        g.t = Math.max(g.t, minutes(sN.arr_local));
        if (g.aeroports.indexOf(sN.vers) < 0) g.aeroports.push(sN.vers);
      }
    });
    Object.keys(arrivees).sort().forEach(function (k) {
      var g = arrivees[k];
      ajouter(g.date, g.t, texteArrivee(ctx, g, logement(D, g.etape, champ(choix, D, g.etape))));
    });
    return ev;
  }

  /* ---------- the cards ---------- */
  function rangMoment(id, idx) { return MOMENTS[idx[id].s.moment] === undefined ? 9 : MOMENTS[idx[id].s.moment]; }

  function jourParJour(choix, D) {
    var ctx = contexte(choix, D);
    var trip = ctx.trip;
    if (!ctx.debutCartes || !ctx.finCartes) return [];
    var placement = placerAvec(choix, D, ctx);
    var idx = indexSorties(D, trip);
    var ev = evenements(choix, D, ctx);
    var qr = ctx.qr;
    var titreFin = trip.stage(ctx.dernier) ? trip.stage(ctx.dernier).title : "";
    // "the last return flight leaves on Jun 26" or, after midnight, "the hotel is left on the evening of Jun 24 (flight of Jun 25 at 00:30)"
    var departRetour = qr && qr.veille
      ? tr("days_leave_hotel_evening", { date: dateCourte(ctx.finCartes), day: dateCourte(qr.jour_vol), time: qr.dep })
      : tr("days_last_return_leaves", { date: dateCourte(ctx.finCartes) });
    var soleil = {};
    ((D && D.jours) || []).forEach(function (j) { soleil[j.date] = j; });
    var parJour = {};
    Object.keys(placement.jours).forEach(function (id) { (parJour[placement.jours[id]] = parJour[placement.jours[id]] || []).push(id); });
    var premiere = ctx.arrivees[0] || null;

    var cartes = [];
    plage(ctx.debutCartes, ctx.finCartes).forEach(function (date) {
      var etape = ctx.etapeDu(date);
      var idDort = date === ctx.finCartes ? null : champ(choix, D, etape); // the last day, you go home
      var lg = idDort ? logement(D, etape, idDort) : null;
      var trajets = (ev[date] || []).slice().sort(function (a, b) { return a.t - b.t || a.n - b.n; }).map(function (e) { return e.texte; });
      var liste = (parJour[date] || []).slice().sort(function (a, b) { return rangMoment(a, idx) - rangMoment(b, idx) || cmp(a, b); });
      var s = soleil[date];
      var titre = trip.stage(etape) ? trip.stage(etape).title : etape;

      var ecart = null;
      var notes = [];
      if (date < ctx.debut) {
        ecart = tr("days_extra_night");
        var qui = premiere ? trip.whoOf(premiere.leg) : "";
        notes.push(qui
          ? tr("days_note_early", { stage: titre, who: qui, date: dateCourte(ctx.jourAmin), start: dateCourte(ctx.debut) })
          : tr("days_note_early_all", { stage: titre, date: dateCourte(ctx.jourAmin), start: dateCourte(ctx.debut) }));
      } else if (ctx.jourAmin && date < ctx.jourAmin) {
        ecart = tr("days_lost_night");
        notes.push(tr("days_note_nobody", { date: dateCourte(ctx.jourAmin) }));
      } else if (date < ctx.groupeDu) {
        ctx.arrivees.forEach(function (a) {
          if (a.jour > date) notes.push(tr("days_note_without", { who: trip.labelsOf(a.leg), date: dateCourte(a.jour) }));
        });
      } else if (date >= ctx.fin && date < ctx.finCartes) {
        ecart = tr("days_extra_night");
        notes.push(tr("days_note_extra_end", { stage: titreFin, what: departRetour }));
      }
      if (date === ctx.finCartes && ctx.finCartes < ctx.fin) {
        notes.push(tr("days_note_lost_end", { what: majuscule(departRetour), n: ecartJours(ctx.finCartes, ctx.fin) }));
      }
      if (date === ctx.finCartes) {
        ctx.retours.forEach(function (q) {
          if (!q.veille || q.jour !== date) return;
          var leg = trip.legByKey[q.trajet];
          var w = leg ? trip.whoOf(leg) : "";
          notes.push(w ? tr("days_note_departure_evening", { who: w, time: q.heure, dep: q.dep }) : tr("days_note_departure_evening_all", { time: q.heure, dep: q.dep }));
        });
      }
      cartes.push({
        date: date, etape: etape, dort: idDort, lever: s ? s.lever : null, coucher: s ? s.coucher : null,
        trajets: trajets, sorties: liste, libre: !liste.length && !trajets.length,
        dort_nom: lg ? lg.nom : null, ecart: ecart, notes: notes,
      });
    });
    return cartes;
  }

  function finMoment(m) { return FIN_MOMENT[m] === undefined ? null : FIN_MOMENT[m]; }

  return {
    placementSorties: placementSorties, placerSorties: placerSorties, sortiesHorsDates: sortiesHorsDates, jourParJour: jourParJour,
    finMoment: finMoment,
  };
})();

function placementSorties(choix, D) { return JoursLogic.placementSorties(choix, D); }
function placerSorties(choix, D) { return JoursLogic.placerSorties(choix, D); }
function sortiesHorsDates(choix, D) { return JoursLogic.sortiesHorsDates(choix, D); }
function jourParJour(choix, D) { return JoursLogic.jourParJour(choix, D); }

if (typeof module !== "undefined") {
  module.exports = {
    placerSorties: placerSorties, sortiesHorsDates: sortiesHorsDates, placementSorties: placementSorties, jourParJour: jourParJour,
    finMoment: JoursLogic.finMoment,
  };
}
