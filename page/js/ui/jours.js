/* Screen "jours": the trip day by day, built from the choices (jourParJour, days.js).
   One card per day, by stage: where you sleep (the lodging's photo), trips, outings (photo, moment, price), sunrise and
   sunset, "free day", extra / lost night, the day's alerts, and under each outing a "Change day" menu
   (patchChoix("sorties", {id: {jour}}): writes only that outing).
   Images: FinUI.image (detail.js), the one function to change for the photos. Exposed: ECRANS["jours"]; pure functions
   exported for tests/js/fin-ui.test.js. Texts through T(). */

(function () {
"use strict";

/* ================= Other modules (globals in the page, require under node) ================= */
function I18() {
  return typeof T === "function" && typeof fmtMoney === "function" ? { T: T, fmtMoney: fmtMoney, fmtDate: fmtDate } : require("../i18n.js");
}
function tr(cle, vars) { return I18().T(cle, vars); }
function F() {
  if (typeof FinUI !== "undefined" && FinUI) return FinUI;
  if (typeof module !== "undefined" && typeof require === "function") return require("./detail.js");
  return null;
}

// the moment of an outing (research data) → the shared moment_* keys
function escTexte(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
var MOMENTS = { aube: "moment_dawn", matin: "moment_morning", journee: "moment_all_day", "apres-midi": "moment_afternoon", coucher: "moment_sunset", soir: "moment_evening" };
function libMoment(m) { return MOMENTS[m] ? tr(MOMENTS[m]) : ""; }

/* ================= Pure functions ================= */

/* The start of a transfer line in the active language ("Transfer ", "Transfert "): the text of days_transfer before
   its first placeholder. */
function prefixeTransfert() {
  var MARQUE = "\u0001";
  var t = tr("days_transfer", { from: MARQUE, to: MARQUE });
  var i = t.indexOf(MARQUE);
  return i > 0 ? t.slice(0, i) : null;
}
var RE_VOL = /^[A-Z0-9]{2}\d{1,4}(\s*\+\s*[A-Z0-9]{2}\d{1,4})*$/;
var RE_NUMERO = /\b[A-Z0-9]{2}\d{2,4}\b/;

/* A trip line (days.js) → {type: "vol"|"transfert"|"autre", principal, details: [..]}.
   "Alex · TP9001 · New York (JFK) 07:10 → Lisbon (LIS) 19:00" → principal "Alex · New York … 19:00", details ["TP9001"];
   "Transfer A → B · 25 min by car · private ≈ $35 · at the lodging around 20:50" → principal "Transfer A → B · at the
   lodging around 20:50", details ["25 min by car", "private ≈ $35"]; a ground trip between stages → "autre". */
function decouperTrajet(texte) {
  var t = String(texte || ""), parts = t.split(" · ");
  var pre = prefixeTransfert();
  if (pre && t.indexOf(pre) === 0) {
    if (parts.length <= 2) return { type: "transfert", principal: t, details: [] };
    return { type: "transfert", principal: parts[0] + " · " + parts[parts.length - 1], details: parts.slice(1, -1) };
  }
  if (parts.length >= 3 && RE_VOL.test(parts[1])) {
    return { type: "vol", principal: [parts[0]].concat(parts.slice(2)).join(" · "), details: [parts[1]] };
  }
  if (parts.length >= 2 && RE_NUMERO.test(parts.slice(1).join(" · "))) return { type: "vol", principal: t, details: [] };   // a landing
  return { type: "autre", principal: t, details: [] };
}

/* Days an outing can go to: the cards of its stage (where you sleep at that stage), limited to its dates
   (YYYY-MM-DD "dates") when it happens only some days. → [{date, trajet: bool}] */
function joursPossibles(s, cartes) {
  if (!s) return [];
  var seulement = Array.isArray(s.dates) && s.dates.length && s.dates.every(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }) ? s.dates : null;
  return (cartes || []).filter(function (c) {
    return c && c.etape === s.etape && c.dort && (!seulement || seulement.indexOf(c.date) >= 0);
  }).map(function (c) { return { date: c.date, trajet: !!(c.trajets && c.trajets.length) }; });
}

/* Is the outing the choice of a special evening (choix.speciales)? */
function estSpeciale(s, choix) {
  var sp = choix && choix.speciales;
  return !!(s && sp && typeof sp === "object" && Object.keys(sp).some(function (k) { return sp[k] === s.id; }));
}
/* An outing that can move: not at a fixed date, not a special evening's choice, ticked, at least 2 possible days. */
function deplacable(s, choix, possibles) {
  if (!s || s.date_fixe) return false;
  if (estSpeciale(s, choix)) return false;
  if (!(choix && choix.sorties && choix.sorties[s.id])) return false;
  return (possibles || []).length > 1;
}

/* The day of an alert: field jour/date, ligne.jour, a date in its key, an outing named in its key (placed that day), or
   a leg named in its key (an arrival: its landing day; another leg: its departure day).
   → {parJour: {date: [alert]}, autres: [alert]} */
function alertesParJour(liste, cartes, choix, D) {
  var dates = {}, sortieJour = {}, out = { parJour: {}, autres: [] };
  (cartes || []).forEach(function (c) { dates[c.date] = true; (c.sorties || []).forEach(function (id) { sortieJour[id] = c.date; }); });
  var fin = F(), trip = D && D.trip ? fin.cfg(D) : null;
  var legs = trip ? trip.legs : [];
  function jourLeg(leg) {
    var o = fin.volChoisi(D, choix, leg.key);
    var seg = o && o.segments && o.segments.length ? o.segments : null;
    if (!seg) return leg.date || null;
    return String(leg.kind === "arrival" ? seg[seg.length - 1].arr_local : seg[0].dep_local || "").slice(0, 10);
  }
  /* "jour-trajet-porto-01" names porto-01; "date-arrive-b" names arrive-b (the whole word, not "arrive-b1"). */
  function cite(cle, mot) {
    var i = cle.indexOf(mot);
    while (i >= 0) {
      var av = i === 0 ? "" : cle.charAt(i - 1), ap = cle.charAt(i + mot.length);
      if (!/[A-Za-z0-9]/.test(av) && !/[A-Za-z0-9]/.test(ap)) return true;
      i = cle.indexOf(mot, i + 1);
    }
    return false;
  }
  var ids = Object.keys(sortieJour).sort(function (x, y) { return y.length - x.length; });
  var parLongueur = legs.slice().sort(function (x, y) { return y.key.length - x.key.length; });
  (liste || []).forEach(function (a) {
    if (!a) return;
    var d = null, cle = typeof a.cle === "string" ? a.cle : "";
    var iso = /\d{4}-\d{2}-\d{2}/.exec(cle);   // "meme-moment-2027-06-16-soir"
    [a.jour, a.date, a.ligne && a.ligne.jour, iso && iso[0]].some(function (x) { if (typeof x === "string" && dates[x.slice(0, 10)]) { d = x.slice(0, 10); } return !!d; });
    if (!d && cle) ids.some(function (id) { if (cite(cle, id)) d = sortieJour[id]; return !!d; });
    if (!d && cle) parLongueur.some(function (leg) { if (cite(cle, leg.key)) { var j = jourLeg(leg); if (j && dates[j]) d = j; } return !!d; });
    if (d) (out.parJour[d] = out.parJour[d] || []).push(a);
    else out.autres.push(a);
  });
  return out;
}

/* Consecutive cards of the same stage → [{etape, cartes}]. */
function grouperCartes(cartes) {
  var out = [];
  (cartes || []).forEach(function (c) {
    var dernier = out[out.length - 1];
    if (dernier && dernier.etape === c.etape) dernier.cartes.push(c);
    else out.push({ etape: c.etape, cartes: [c] });
  });
  return out;
}

/* ================= Rendering ================= */
function iconeShell(nom) { return typeof window !== "undefined" && window.UI && typeof UI.icone === "function" ? UI.icone(nom) : ""; }
function htmlAlerte(a, esc) {
  var bloq = a.niveau === "bloquant", fin = F();
  var l = a.ligne, m = l && isFinite(l.n * l.u) ? l.n * l.u : 0;
  var plus = m > 0 ? " " + tr("jr_alert_adds", { amount: fin.argentRond(m) }) : "";
  return '<div class="alerte ' + (bloq ? "bloquant" : "attention") + ' jr-al">' + iconeShell(bloq ? "bloquant" : "attention") +
    '<div class="al-t"><p><b>' + esc(tr(bloq ? "ui_alert_blocking" : "ui_alert_warning")) + "</b> " + esc(a.texte) + "</p>" +
    (a.solution ? '<p class="al-sol">' + esc(tr("ui_alert_solution", { text: a.solution })) + esc(plus) + "</p>" : "") + "</div></div>";
}

function htmlSortie(id, carte, D, choix, cartes) {
  var fin = F(), esc = fin.esc, s = fin.trouverSortie(D, id);
  if (!s) return "";
  var ph = s.galerie && s.galerie.n ? "sortie:" + s.id : "";   // the place's 1st small photo, resolved by FinUI.image
  var prix = fin.fini(s.prix_couple_home)
    ? (s.prix_couple_home === 0 ? tr("so_free") : fin.argentRond(s.prix_couple_home) + " " + tr("for_n_people", { n: fin.cfg(D).adults }))
    : tr("price_to_check");
  var infos = [libMoment(s.moment), s.depart ? tr("so_departure_at", { time: s.depart }) : "", prix].filter(Boolean);
  var possibles = joursPossibles(s, cartes);
  var menu = "";
  if (deplacable(s, choix, possibles)) {
    var fixe = choix.sorties[id] && choix.sorties[id].jour;
    menu = '<label class="jr-dep"><span>' + esc(tr("jr_change_day")) + '</span><select name="jour-sortie" data-sortie="' + esc(id) + '" data-k="dep-' + esc(id) + '">' +
      possibles.map(function (p) {
        return '<option value="' + p.date + '"' + (p.date === carte.date ? " selected" : "") + ">" + esc(fin.dateLongue(p.date)) +
          (p.trajet ? " · " + esc(tr("jr_travel_day")) : "") + "</option>";
      }).join("") + (fixe ? '<option value="auto">' + esc(tr("jr_let_page_choose")) + "</option>" : "") + "</select></label>";
  } else if (s.date_fixe || estSpeciale(s, choix)) {
    menu = '<span class="jr-fixe">' + fin.icone("calendrier") + esc(tr("jr_fixed_date")) + "</span>";
  }
  return '<li class="jr-s" data-id="' + esc(id) + '"><span class="jr-ph" data-img="' + esc(ph || "") + '">' + fin.icone("etoile") + "</span>" +
    '<div class="jr-s-t"><b>' + esc(s.nom) + "</b><span>" + esc(infos.join(" · ")) + "</span>" +
    (s.duree ? '<span class="d-only jr-duree">' + esc(s.duree) + "</span>" : "") + menu + "</div></li>";
}

function htmlCarte(c, n, D, choix, cartes, alertesDuJour) {
  var fin = F(), esc = fin.esc;
  var lg = c.dort ? fin.trouverLogement(D, c.etape, c.dort) : null;
  var cls = "jr-jour" + (c.libre ? " libre" : "") + (c.trajets && c.trajets.length ? " trajet" : "") + (c.ecart ? " ecart" : "");
  var soleil = (c.lever ? '<span title="' + esc(tr("jr_sunrise")) + '">' + fin.icone("lever") + esc(c.lever) + "</span>" : "") +
    (c.coucher ? '<span title="' + esc(tr("jr_sunset")) + '">' + fin.icone("coucher") + esc(c.coucher) + "</span>" : "");
  var h = '<article class="' + cls + '" id="jour-' + esc(c.date) + '" aria-label="' + esc(fin.dateLongue(c.date)) + '">' +
    '<header class="jr-tete"><h3><span class="jr-j">' + esc(fin.dateLongue(c.date)) + '</span><span class="jr-n">' + esc(tr("jr_day_n", { n: n })) + "</span></h3>" +
    (soleil ? '<p class="jr-soleil">' + soleil + "</p>" : "") + "</header>";
  if (c.ecart) {
    h += '<p class="jr-ecart">' + esc(c.ecart) + "</p>" +
      (c.notes || []).map(function (x) { return '<p class="jr-note">' + esc(x) + "</p>"; }).join("");
  } else if (c.notes && c.notes.length) {
    h += c.notes.map(function (x) { return '<p class="jr-note">' + esc(x) + "</p>"; }).join("");
  }
  h += (alertesDuJour || []).map(function (a) { return htmlAlerte(a, esc); }).join("");
  // no lodging on a card: the trip's last day (you go home), or a stage whose lodging is not chosen yet
  var dernier = !!(cartes && cartes.length) && c.date === cartes[cartes.length - 1].date;
  if (c.dort) {
    h += '<div class="jr-dort"><span class="jr-cov" data-img="' + (lg && lg.slug ? "logement:" + esc(lg.slug) : "") + '">' + fin.icone("lit") + "</span>" +
      '<div><span class="jr-lbl">' + esc(tr("jr_you_sleep_at")) + "</span><b>" + esc(c.dort_nom || (lg && lg.nom) || tr("jr_lodging_to_choose")) + "</b></div></div>";
  } else if (!dernier) {
    h += '<div class="jr-dort a-choisir"><span class="jr-cov">' + fin.icone("lit") + "</span>" +
      '<div><span class="jr-lbl">' + esc(tr("jr_you_sleep_at")) + "</span><b>" + esc(tr("jr_lodging_to_choose")) + "</b></div></div>";
  } else {
    h += '<div class="jr-dort fin"><span class="jr-cov">' + fin.icone("avion") + '</span><div><span class="jr-lbl">' + esc(tr("jr_last_day")) +
      "</span><b>" + esc(tr("jr_no_night")) + "</b></div></div>";
  }
  if (c.trajets && c.trajets.length) {
    h += '<ul class="jr-trajets">' + c.trajets.map(function (t) {
      var x = decouperTrajet(t);
      return '<li class="jr-t ' + x.type + '">' + fin.icone(x.type === "vol" ? "avion" : x.type === "transfert" ? "voiture" : "fleche") +
        "<span>" + esc(x.principal) + (x.details.length ? '<span class="d-only"> · ' + esc(x.details.join(" · ")) + "</span>" : "") + "</span></li>";
    }).join("") + "</ul>";
  }
  if (c.sorties && c.sorties.length) {
    h += '<ul class="jr-sorties">' + c.sorties.map(function (id) { return htmlSortie(id, c, D, choix, cartes); }).join("") + "</ul>";
  }
  if (c.libre) h += '<p class="jr-libre">' + fin.icone("feuille") + "<span>" + esc(tr("jr_free_day")) + "</span></p>";
  return h + "</article>";
}

function htmlJours(D, choix, cartes, horsDates, alertesListe) {
  var fin = F(), esc = fin.esc, trip = fin.cfg(D);
  var al = alertesParJour(alertesListe, cartes, choix, D);
  var nSorties = cartes.reduce(function (s, c) { return s + (c.sorties ? c.sorties.length : 0); }, 0);
  var nLibres = cartes.filter(function (c) { return c.libre; }).length;
  var h = '<p class="jr-resume"><span>' + esc(tr("jr_n_days", { n: cartes.length })) + "</span><span>" + esc(tr("jr_n_outings", { n: nSorties })) +
    "</span><span>" + esc(tr("jr_n_free", { n: nLibres })) + "</span>" +
    '<span class="jr-aide">' + esc(tr("jr_help")) + "</span></p>";
  if (al.autres.length) h += '<div class="jr-autres">' + al.autres.map(function (a) { return htmlAlerte(a, esc); }).join("") + "</div>";
  if (horsDates && horsDates.length) {
    h += '<div class="alerte info jr-al">' + iconeShell("info") + '<div class="al-t"><p>' + esc(tr("jr_out_of_dates")) + " " +
      horsDates.map(function (id) { var s = fin.trouverSortie(D, id); return "<b>" + esc(s ? s.nom : id) + "</b>"; }).join(", ") + ".</p></div></div>";
  }
  var n = 0;
  grouperCartes(cartes).forEach(function (g) {
    var st = trip.stage(g.etape);
    var nom = st ? st.title : g.etape, ton = fin.tonCss(st ? st.tone : null);
    var du = g.cartes[0].date, au = g.cartes[g.cartes.length - 1].date;
    h += '<section class="jr-etape ton-' + esc(ton) + '"><h2 class="jr-et-t"><i aria-hidden="true"></i>' + esc(nom) +
      " <span>" + esc(du === au ? fin.dateLongue(du) : tr("ui_range", { from: fin.dateCourte(du), to: fin.dateCourte(au) })) + "</span></h2>" +
      '<div class="jr-grille">' + g.cartes.map(function (c) { n++; return htmlCarte(c, n, D, choix, cartes, al.parJour[c.date]); }).join("") + "</div></section>";
  });
  return h;
}

function ecranJours(racine, D, choix) {
  var boite = document.createElement("div");
  boite.className = "jr";
  racine.appendChild(boite);
  var aMontrer = null;   // a moved outing: show it at its new place after the rendering
  boite.addEventListener("change", function (ev) {
    var sel = ev.target;
    if (!sel || !sel.getAttribute || !sel.getAttribute("data-sortie") || typeof patchChoix !== "function") return;
    var id = sel.getAttribute("data-sortie"), v = sel.value, maj = {};
    maj[id] = { jour: v === "auto" ? null : v };
    aMontrer = id;
    patchChoix("sorties", maj);
    if (window.UI && UI.toast) UI.toast(v === "auto" ? tr("jr_toast_auto") : tr("jr_toast_moved", { date: F().dateLongue(v) }));
  });
  function rendre(c) {
    if (typeof jourParJour !== "function" || !F()) {
      boite.innerHTML = '<div class="attente calme"><p class="attente-t">' + escTexte(tr("jr_not_ready")) + "</p><p>" + escTexte(tr("jr_not_ready_how")) + "</p></div>";
      return;
    }
    var cartes = jourParJour(c, D) || [];
    var hors = typeof sortiesHorsDates === "function" ? sortiesHorsDates(c, D) || [] : [];
    var al = window.Parcours && Array.isArray(Parcours.alertes) ? Parcours.alertes
      : typeof alertes === "function" ? (function () { try { return alertes(c, D) || []; } catch (e) { return []; } })() : [];
    F().redessiner(boite, htmlJours(D, c, cartes, hors, al));
    if (aMontrer) {
      var li = boite.querySelector('.jr-s[data-id="' + aMontrer + '"]');
      aMontrer = null;
      if (li) {
        if (li.classList) li.classList.add("vient");
        try { li.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
        var s = li.querySelector("select");
        if (s) { try { s.focus({ preventScroll: true }); } catch (e) {} }
      }
    }
  }
  rendre(choix);
  return { maj: rendre, quitter: function () { if (F() && F().oublierImages) F().oublierImages(boite); } };
}

var api = { decouperTrajet: decouperTrajet, joursPossibles: joursPossibles, deplacable: deplacable, alertesParJour: alertesParJour, grouperCartes: grouperCartes };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") {
  var ECRANS = window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
  ECRANS["jours"] = ecranJours;
}
})();
