/* The page shell: one screen at a time, the screens built from the trip (parcours.json's `trip` block).
   Sticky header: progress "Step n of N" (one dot per group of screens), Simple / Detailed, the total's badge (opens the
   trip's detail). Under the header: the alerts of the current group. Then the question, the screen, and at the bottom
   "← Back" / "Next: … →".

   Screens (construireEcrans(TRIP)): "aller" (every arrival leg), then for each stage "<stage>" (its lodging, with the
   between legs arriving there at its top) and "<stage>-sorties" (its outings and its special evenings), then "retour"
   (every return leg), "jours" (day by day) and "plan". Each screen = {cle, type, stage?, legs?, groupe}.

   Contract of the screens (files page/js/ui/<screen>.js, loaded after this one), registered by type:
     ECRANS[type] = function (racine, D, choix, ecran) { … ; return {maj: function (choix) {…}, quitter: function () {…}} };
     type ∈ "vols" | "logement" | "sorties" | "jours" | "plan"; ecran = the screen above.
   - racine: the element to fill (emptied before each render); D: parcours.json + D.lieux[<stage>] (parcours-<stage>.json);
     choix: the full choices (defaults + saved choices, checked by resoudreChoix).
   - The return value is optional. With maj(choix), a change of choices updates the screen in place; without it, the
     screen is drawn again (scroll kept). quitter() is called when leaving the screen.
   - To save a choice: patchChoix(field, value) (store.js); the shell refreshes by itself.
   - ECRANS.detail = function (racine, D, choix): the trip's detail, opened by the total's badge.
   The global TRIP (creerTrip(D), page/js/logic/config.js) is set once the data is loaded; every text goes through T().
   Under node only the pure functions are exported (tests/js/shell.test.js). */

(function () {
"use strict";

/* ================= Pure part (page and node) ================= */
function I() {
  return typeof T === "function" && typeof fmtDate === "function" ? { T: T, fmtDate: fmtDate, fmtMoney: fmtMoney } : require("../i18n.js");
}
function tr(cle, vars) { return I().T(cle, vars); }

/* "Jun 18 → 21", "Jun 29 → Jul 3" (fr: "18 → 21 juin"). */
function plage(du, au) {
  var a = /^(\d{4})-(\d{2})-(\d{2})/.exec(du || ""), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(au || "");
  if (!a || !b) return "";
  if (du.slice(0, 10) === au.slice(0, 10)) return I().fmtDate(du);
  if (a[1] === b[1] && a[2] === b[2]) {
    var jour = function (d) { return Number(d) === 1 ? tr("date_first_day") : String(Number(d)); };
    var mois = tr("months_short");
    return tr("ui_range_same_month", { m: Array.isArray(mois) ? mois[Number(a[2]) - 1] : "", d1: jour(a[3]), d2: jour(b[3]) });
  }
  return tr("ui_range", { from: I().fmtDate(du), to: I().fmtDate(au) });
}

/** The screens of the trip, in order. */
function construireEcrans(trip) {
  var out = [{ cle: "aller", type: "vols", legs: trip.arrivals.map(function (l) { return l.key; }), groupe: "aller" }];
  trip.stages.forEach(function (s) {
    out.push({ cle: s.key, type: "logement", stage: s.key, legs: trip.legsArrivingAt(s.key).map(function (l) { return l.key; }), groupe: s.key });
    out.push({ cle: s.key + "-sorties", type: "sorties", stage: s.key, groupe: s.key });
  });
  out.push({ cle: "retour", type: "vols", legs: trip.returns.map(function (l) { return l.key; }), groupe: "retour" });
  out.push({ cle: "jours", type: "jours", groupe: "plan" });
  out.push({ cle: "plan", type: "plan", groupe: "plan" });
  return out;
}

/** One group per screen family (the progress dots): arrivals, one per stage, returns, the plan (with the days). */
function construireGroupes(ecrans, trip) {
  var out = [];
  var idx = {};
  ecrans.forEach(function (e) {
    var g = idx[e.groupe];
    if (!g) {
      var st = trip.stage(e.groupe);
      g = idx[e.groupe] = {
        cle: e.groupe, n: out.length + 1, ton: st ? st.tone : "accent",
        nom: st ? st.title : tr(e.groupe === "aller" ? "ui_group_arrivals" : e.groupe === "retour" ? "ui_group_returns" : "ui_group_plan"),
        ecrans: [],
      };
      out.push(g);
    }
    g.ecrans.push(e);
  });
  return out;
}

/* "Alex: New York → Lisbon; Sam: Montreal → Lisbon" */
function routes(trip, legs, sens) {
  return legs.map(function (l) {
    var de = sens === "aller" ? trip.cityOf(l.from_airports[0]) : (trip.stage(l.from_stage) || {}).title || "";
    var vers = sens === "aller" ? (trip.stage(l.to_stage) || {}).title || "" : trip.cityOf(l.to_airports[0]);
    var r = tr("ui_route", { from: de, to: vers });
    var qui = trip.labelsOf(l);
    return qui && trip.travelers.length > 1 ? tr("ui_route_who", { who: qui, route: r }) : r;
  }).join("; ");
}
function dateDe(legs) {
  var d = legs.map(function (l) { return l.date; }).filter(Boolean).sort()[0];
  return d ? I().fmtDate(d, "weekday") : "";
}

/** The texts of a screen: {titre (the question), sous, court (in "Next: …"), onglet (its tab in the group)}. */
function texteEcran(e, trip) {
  var st = e.stage ? trip.stage(e.stage) : null;
  if (e.type === "vols") {
    var legs = (e.legs || []).map(function (k) { return trip.legByKey[k]; }).filter(Boolean);
    var aller = e.cle === "aller";
    return {
      titre: tr(aller ? "ui_arrivals_title" : "ui_returns_title", { n: legs.length }),
      court: tr(aller ? "ui_arrivals_short" : "ui_returns_short"),
      sous: legs.length ? tr(aller ? "ui_arrivals_sub" : "ui_returns_sub", { routes: routes(trip, legs, e.cle), date: dateDe(legs) }) : "",
      onglet: "",
    };
  }
  if (e.type === "logement") {
    return {
      titre: tr("ui_stage_title", { stage: st.title }), court: st.title, onglet: tr("ui_tab_lodging"),
      sous: tr("ui_stage_sub", { n: st.nights, dates: plage(st.from, st.to) }),
    };
  }
  if (e.type === "sorties") {
    var sp = trip.specialsAt(st.key).map(function (x) { return x.title; });
    var noms = sp.length > 1 ? sp.slice(0, -1).join(", ") + tr("and_last") + sp[sp.length - 1] : sp[0];
    return {
      titre: tr("ui_outings_title", { stage: st.title }), court: tr("ui_outings_short"),
      onglet: sp.length ? tr("ui_tab_outings_special", { special: noms }) : tr("ui_tab_outings"),
      sous: tr("ui_outings_sub") + (sp.length ? " " + tr("ui_outings_sub_special", { special: noms }) : ""),
    };
  }
  if (e.type === "jours") {
    return { titre: tr("ui_days_title"), court: tr("ui_days_short"), onglet: tr("ui_tab_days"),
      sous: tr("ui_days_sub", { from: I().fmtDate(trip.start), to: I().fmtDate(trip.end) }) };
  }
  return { titre: tr("ui_plan_title"), court: tr("ui_plan_short"), onglet: tr("ui_tab_plan"), sous: tr("ui_plan_sub") };
}

/** "Comporta · Jun 18 → 21 · 3 nights" above the question. */
function surTitre(g, trip) {
  var parts = [g.nom];
  var st = trip.stage(g.cle);
  if (st) {
    parts.push(plage(st.from, st.to));
    if (st.nights) parts.push(tr("ui_nights", { n: st.nights }));
  } else if (g.cle === "aller") parts.push(dateDe(trip.arrivals));
  else if (g.cle === "retour") parts.push(dateDe(trip.returns));
  else parts.push(plage(trip.start, trip.end));
  return parts.filter(Boolean).join(" · ");
}

/** The group where a choice field is changed (to say a saved choice is no longer offered); null when none. */
function groupeDuChamp(champ, trip) {
  var k = String(champ || "");
  var leg = trip.legByKey[k];
  if (leg) return leg.kind === "arrival" ? "aller" : leg.kind === "return" ? "retour" : leg.to_stage;
  if (trip.stage(k)) return k;
  var m = /^speciales\.(.+)$/.exec(k);
  if (m) {
    var s = trip.specials.filter(function (x) { return x.key === m[1]; })[0];
    return s ? s.stage : null;
  }
  return null;
}

/* CSS tone of a group: stage tone n → "tone-1".."tone-5" (--tone-N in app.css, wraps after 5); "accent" for the other groups. */
var NB_TONS = 5;
function tonCss(ton) { return typeof ton === "number" && ton > 0 ? "tone-" + (((Math.floor(ton) - 1) % NB_TONS) + 1) : "accent"; }

var pur = { tonCss: tonCss, construireEcrans: construireEcrans, construireGroupes: construireGroupes, texteEcran: texteEcran, surTitre: surTitre,
  groupeDuChamp: groupeDuChamp, plage: plage };
if (typeof window === "undefined" || typeof document === "undefined") {
  if (typeof module !== "undefined" && module.exports) module.exports = pur;
  return;
}

/* ================= In the page ================= */
var ECRANS = window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
var ETAPES = [], GROUPES = [], INDEX_ETAPES = {}, INDEX_GROUPES = {};

/* The page's state, read by the screens. */
var Parcours = {
  etape: "", D: null, manquants: null, choix: null, lignes: null, totaux: null, alertes: [], remplaces: [], sortiesRetirees: [],
  poignee: null, panneau: null, mode: "simple", erreurs: {}, etapes: ETAPES, groupes: GROUPES,
};

/* ================= Tools shared by the screens ================= */
var UI = (function () {
  var u = {};
  u.$ = function (s, r) { return (r || document).querySelector(s); };
  u.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  u.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  u.safeUrl = function (x) { return typeof x === "string" && /^https?:\/\//i.test(x) ? x : ""; };
  /* $1,234 in the home currency; null, NaN or absent → "" (the screen then writes "price to check"). */
  u.argent = function (n) { return n == null || !isFinite(n) ? "" : fmtMoney(n, "home"); };
  /* +$1,200 / −$300 (difference with the current choice). */
  u.ecart = function (n) {
    if (n == null || !isFinite(n)) return "";
    var r = Math.round(n);
    return (r > 0 ? "+" : r < 0 ? "−" : "") + fmtMoney(Math.abs(r), "home");
  };
  /* The same amount in the local currency ("" without a local currency or a rate). */
  u.local = function (n) { return n == null || !isFinite(n) ? "" : fmtMoney(n, "local"); };
  u.date = function (iso) { return fmtDate(iso); };
  u.dateLongue = function (iso) { return fmtDate(iso, "weekday"); };
  u.plage = plage;
  u.ton = tonCss;
  u.detail = function () { return Parcours.mode === "detail"; };
  var toastT;
  u.toast = function (t) {
    var el = u.$("#toast");
    if (!el) return;
    el.textContent = t;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.hidden = true; }, 3800);
  };
  /* Replace the question at the top of the screen (title and the line under it). */
  u.titreEcran = function (titre, sous) {
    if (titre != null) u.$("#q-titre").textContent = titre;
    if (sous != null) { var s = u.$("#q-sous"); s.textContent = sous; s.hidden = !sous; }
  };
  /* Full-screen (phone) or centered (computer) panel. rendu: function(body) or HTML. If rendu returns {maj, quitter},
     maj follows the changes of choices while the panel is open. */
  u.ouvrirPanneau = function (titre, rendu) { return ouvrirPanneau(titre, rendu); };
  u.fermerPanneau = function () { fermerPanneau(); };
  u.icone = function (nom) { return ICONES[nom] || ""; };
  return u;
})();

var ICONES = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  bloquant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/></svg>',
  attention: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  chantier: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 40h36"/><path d="M10 40V22l14-10 14 10v18"/><path d="M19 40V29h10v11"/><path d="M33 9v6M30 12h6" opacity=".6"/></svg>',
};

/* The template's fixed texts: data-t (text), data-t-aria (aria-label), data-t-title (title), in the page's language. */
function traduireGabarit() {
  UI.$$("[data-t]").forEach(function (el) { el.textContent = tr(el.getAttribute("data-t")); });
  UI.$$("[data-t-aria]").forEach(function (el) { el.setAttribute("aria-label", tr(el.getAttribute("data-t-aria"))); });
  UI.$$("[data-t-title]").forEach(function (el) { el.setAttribute("title", tr(el.getAttribute("data-t-title"))); });
}

/* ================= Screens of the trip ================= */
function installerEcrans(trip) {
  ETAPES.length = 0;
  GROUPES.length = 0;
  INDEX_ETAPES = {};
  INDEX_GROUPES = {};
  construireEcrans(trip).forEach(function (e, i) {
    Object.assign(e, texteEcran(e, trip), { i: i });
    ETAPES.push(e);
    INDEX_ETAPES[e.cle] = e;
  });
  construireGroupes(ETAPES, trip).forEach(function (g) { GROUPES.push(g); INDEX_GROUPES[g.cle] = g; });
}

/* ================= Header, alerts, footer ================= */
function etapeCourante() { return INDEX_ETAPES[Parcours.etape] || ETAPES[0] || null; }
function groupeCourant() { var e = etapeCourante(); return e ? INDEX_GROUPES[e.groupe] : null; }

function rendreTete() {
  var e = etapeCourante(), g = groupeCourant(), esc = UI.esc;
  if (!e || !g) {
    UI.$("#points").innerHTML = "";
    UI.$("#prog-t").textContent = "";
    UI.$("#q-sur").textContent = "";
    UI.$("#q-titre").textContent = tr("ui_loading");
    UI.$("#q-sous").hidden = true;
    UI.$("#sous-etapes").hidden = true;
    return;
  }
  UI.$("#points").innerHTML = GROUPES.map(function (x) {
    var etat = x.n < g.n ? "fait" : x.n === g.n ? "ici" : "";
    return '<li class="' + etat + '"><button type="button" data-groupe="' + esc(x.cle) + '" aria-label="' +
      esc(tr("ui_step_aria", { n: x.n, name: x.nom })) + '"' + (etat === "ici" ? ' aria-current="step"' : "") + "></button></li>";
  }).join("");
  UI.$("#prog-t").innerHTML = esc(tr("ui_step", { n: g.n })) + " <span>" + esc(tr("ui_step_of", { total: GROUPES.length })) + "</span>";
  var q = UI.$("#question");
  q.className = "question ton-" + tonCss(g.ton);
  UI.$("#q-sur").textContent = surTitre(g, TRIP);
  UI.$("#q-titre").textContent = e.titre;
  var s = UI.$("#q-sous");
  s.textContent = e.sous || "";
  s.hidden = !e.sous;
  var se = UI.$("#sous-etapes");
  if (g.ecrans.length > 1) {
    se.hidden = false;
    se.innerHTML = g.ecrans.map(function (x) {
      return '<button type="button" data-etape="' + esc(x.cle) + '"' + (x.cle === e.cle ? ' aria-current="step"' : "") + ">" + esc(x.onglet) + "</button>";
    }).join("");
  } else { se.hidden = true; se.innerHTML = ""; }
  document.documentElement.style.setProperty("--ton", "var(--" + tonCss(g.ton) + ")");
}

function rendreSync() {
  var el = UI.$("#sync");
  var l = Store.libelleSync && Store.libelleSync();
  el.classList.toggle("on", !!l);
  el.querySelector("span").textContent = l ? l.texte : tr("ui_sync_local");
  el.title = l ? l.titre : tr("ui_sync_local_title");
}

function rendrePastille() {
  var t = Parcours.totaux, b = UI.$("#pastille"), tot = UI.$("#p-tot"), sous = UI.$("#p-sous");
  var ok = t && isFinite(t.total);
  var marge = ok && typeof t.marge === "number" ? t.marge : null;
  b.classList.toggle("depasse", marge !== null && marge < 0);
  b.classList.toggle("incomplet", !!(ok && t.incomplet));
  if (!ok) {
    tot.textContent = "—";
    sous.textContent = "";
    b.setAttribute("aria-label", tr("ui_total_aria_none"));
    return;
  }
  tot.textContent = "≈ " + UI.argent(t.total);
  // one way to say it on every screen: "margin $X" under the cap, "$X over $6,000" beyond it, nothing without a cap
  var ecartPlafond = marge === null ? "" : marge >= 0 ? tr("ui_margin", { amount: UI.argent(marge) })
    : tr("ui_over_cap", { amount: UI.argent(-marge), cap: UI.argent(t.plafond) });
  sous.textContent = t.incomplet ? tr("ui_incomplete") : ecartPlafond;
  b.removeAttribute("title");
  // on a phone the whole sentence would hide "Step n of N": the short form, the whole sentence in the tooltip
  if (!t.incomplet && marge !== null && marge < 0 && pastilleCache()) {
    sous.textContent = tr("ui_over_short", { amount: UI.argent(-marge) });
    b.title = ecartPlafond;
  }
  b.setAttribute("aria-label", tr("ui_total_aria", {
    total: UI.argent(t.total), people: tr("for_n_people", { n: TRIP.adults }),
    state: t.incomplet ? ", " + tr("ui_incomplete") : ecartPlafond ? ", " + ecartPlafond : "",
  }));
}
/* Does the badge, on the progress line, cover "Step n of N"? */
function pastilleCache() {
  var p = UI.$("#pastille").getBoundingClientRect(), g = UI.$("#prog-t").getBoundingClientRect();
  if (!p.width || !g.width) return false;
  return p.top < g.bottom && g.top < p.bottom && p.left < g.right && g.left < p.right;
}

function rendreAlertes() {
  var box = UI.$("#alertes"), e = etapeCourante(), esc = UI.esc;
  if (!e) { box.innerHTML = ""; box.hidden = true; return; }
  var g = e.groupe;
  var liste = (Parcours.alertes || []).filter(function (a) { return a && a.etape === g; });
  liste.sort(function (a, b) { return (a.niveau === "bloquant" ? 0 : 1) - (b.niveau === "bloquant" ? 0 : 1); });
  var html = liste.map(function (a) {
    var niv = a.niveau === "bloquant" ? "bloquant" : "attention";
    var l = a.ligne, plus = l && isFinite(l.n * l.u) && l.n * l.u > 0 ? " " + tr("ui_alert_budget", { amount: UI.ecart(l.n * l.u) }) : "";
    return '<div class="alerte ' + niv + '">' + ICONES[niv] + '<div class="al-t"><p><b>' + esc(tr(niv === "bloquant" ? "ui_alert_blocking" : "ui_alert_warning")) +
      "</b> " + esc(a.texte) + "</p>" + (a.solution ? '<p class="al-sol">' + esc(tr("ui_alert_solution", { text: a.solution })) + esc(plus) + "</p>" : "") + "</div></div>";
  });
  var perdus = (Parcours.remplaces || []).filter(function (k) { return groupeDuChamp(k, TRIP) === g; });
  if (perdus.length) html.push('<div class="alerte info">' + ICONES.info + '<div class="al-t"><p>' + esc(tr("ui_choice_gone")) + "</p></div></div>");
  // a ticked outing gone from the data has no stage any more: said on every outings screen
  var retirees = Parcours.sortiesRetirees || [];
  if (retirees.length && e.type === "sorties") {
    html.push('<div class="alerte info">' + ICONES.info + '<div class="al-t"><p>' + esc(tr("ui_outings_gone", { n: retirees.length })) + "</p></div></div>");
  }
  box.innerHTML = html.join("");
  box.hidden = !html.length;
}

function rendrePied() {
  var e = etapeCourante(), prec = e ? ETAPES[e.i - 1] : null, suiv = e ? ETAPES[e.i + 1] : null;
  var r = UI.$("#retour"), s = UI.$("#suivant");
  r.disabled = !prec;
  r.title = prec ? tr("ui_back_to", { name: prec.court }) : "";
  s.hidden = !suiv;
  if (suiv) {
    UI.$("#suivant-lib").textContent = suiv.court;
    s.setAttribute("aria-label", tr("ui_next_aria", { name: suiv.court }));
  }
}

/* ================= The current screen ================= */
function signalerErreur(cle, e) {
  if (!Parcours.erreurs[cle]) { Parcours.erreurs[cle] = 1; if (typeof console !== "undefined") console.error("[page] " + cle, e); }
}

function quitterEcran() {
  var p = Parcours.poignee;
  Parcours.poignee = null;
  if (p && typeof p.quitter === "function") { try { p.quitter(); } catch (e) { signalerErreur("quitter-" + Parcours.etape, e); } }
}

function rendreEcran() {
  var racine = UI.$("#ecran"), e = etapeCourante();
  quitterEcran();
  racine.innerHTML = "";
  racine.className = "ecran" + (e ? " ecran-" + e.type : "");
  if (!Parcours.D || !e) { racine.innerHTML = Parcours.manquants ? htmlManque() : htmlChargement(); return; }
  var f = ECRANS[e.type];
  if (typeof f !== "function") { racine.innerHTML = htmlAttente(); return; }
  try {
    var r = f(racine, Parcours.D, Parcours.choix, e);
    Parcours.poignee = r && typeof r === "object" ? r : null;
  } catch (err) {
    signalerErreur("ecran-" + e.cle, err);
    racine.innerHTML = '<div class="attente"><p class="attente-t">' + UI.esc(tr("ui_screen_failed")) + "</p><p>" + UI.esc(tr("ui_screen_failed_more")) + "</p></div>";
  }
}

/* After a change of choices: update in place when the screen can, else a new render at the same place. */
function majEcran() {
  var p = Parcours.poignee;
  if (p && typeof p.maj === "function" && Parcours.D) {
    try { p.maj(Parcours.choix); return; } catch (e) { signalerErreur("maj-" + Parcours.etape, e); }
  }
  var y = window.scrollY;
  rendreEcran();
  window.scrollTo(0, y);
}

function htmlChargement() {
  return '<div class="attente calme"><p class="attente-t">' + UI.esc(tr("ui_loading")) + "</p></div>";
}
function htmlManque() {
  var esc = UI.esc, m = Parcours.manquants || [];
  return '<div class="attente manque">' + ICONES.chantier + '<p class="attente-t">' + esc(tr("ui_missing_title")) + "</p>" +
    "<p>" + esc(tr("ui_missing_files", { n: m.length })) + "</p><ul>" +
    m.map(function (x) { return "<li><code>media/" + esc(x.f) + "</code> : " + esc(x.err) + "</li>"; }).join("") + "</ul>" +
    "<p>" + esc(tr("ui_missing_how")) + "</p>" +
    '<button type="button" class="btn" id="reessayer">' + esc(tr("ui_retry")) + "</button></div>";
}
function htmlAttente() {
  return '<div class="attente">' + ICONES.chantier + '<p class="attente-t">' + UI.esc(tr("ui_screen_missing")) + "</p><p>" +
    UI.esc(tr("ui_screen_missing_more")) + "</p></div>";
}

/* ================= Refresh: choices → total, alerts, screen ================= */
function choixCourant(D) {
  var c = superposer(D.defaut || {}, Store.choix);
  Parcours.remplaces = [];
  Parcours.sortiesRetirees = [];
  if (typeof resoudreChoix === "function") {
    try {
      var r = resoudreChoix(c, D);
      if (r && r.choix) {
        c = r.choix;
        Parcours.remplaces = r.remplaces || [];
        Parcours.sortiesRetirees = Array.isArray(r.sortiesRetirees) ? r.sortiesRetirees : [];
      }
    } catch (e) { signalerErreur("resoudreChoix", e); }
  }
  return c;
}

function rafraichir() {
  rendreSync();
  var D = Parcours.D;
  Parcours.lignes = null;
  Parcours.totaux = null;
  Parcours.alertes = [];
  if (D) {
    Parcours.choix = choixCourant(D);
    if (typeof lignesVoyage === "function" && typeof totaux === "function") {
      try {
        Parcours.lignes = lignesVoyage(Parcours.choix, D);
        Parcours.totaux = totaux(Parcours.lignes, TRIP.budgetCap);
      } catch (e) { signalerErreur("budget", e); Parcours.lignes = null; Parcours.totaux = null; }
    }
    if (typeof alertes === "function") {
      try { Parcours.alertes = alertes(Parcours.choix, D) || []; } catch (e) { signalerErreur("alertes", e); }
    }
  }
  rendrePastille();
  rendreAlertes();
  majEcran();
  var pn = Parcours.panneau;
  if (pn && pn.poignee && typeof pn.poignee.maj === "function") {
    try { pn.poignee.maj(Parcours.choix); } catch (e) { signalerErreur("maj-panneau", e); }
  }
}

/* ================= Navigation ================= */
function allerA(etape) {
  if (!ETAPES.length) return;
  if (!INDEX_ETAPES[etape]) etape = ETAPES[0].cle;
  var change = etape !== Parcours.etape;
  Parcours.etape = etape;
  lsSet(Store.cle("etape"), etape);
  if (location.hash.slice(1) !== etape) { try { history.replaceState(null, "", "#" + etape); } catch (e) {} }
  rendreTete();
  rendreAlertes();
  rendrePied();
  rendreEcran();
  if (change) {
    window.scrollTo(0, 0);
    var h = UI.$("#q-titre");
    if (h && document.body.classList.contains("navigue")) { try { h.focus({ preventScroll: true }); } catch (e) {} }
  }
}
function etapeVoisine(d) {
  var e = etapeCourante(), s = e ? ETAPES[e.i + d] : null;
  if (s) { document.body.classList.add("navigue"); allerA(s.cle); }
}

/* ================= Simple / Detailed (each person's own) ================= */
function appliquerMode(m) {
  Parcours.mode = m === "detail" ? "detail" : "simple";
  document.body.classList.toggle("mode-detail", Parcours.mode === "detail");
  UI.$("#mode-simple").setAttribute("aria-pressed", String(Parcours.mode === "simple"));
  UI.$("#mode-detail").setAttribute("aria-pressed", String(Parcours.mode === "detail"));
  lsSet(Store.cle("mode"), Parcours.mode);
  try { document.dispatchEvent(new CustomEvent("parcours:mode", { detail: Parcours.mode })); } catch (e) {}
}

/* ================= Panel (trip's detail, full-screen fiches) ================= */
function ouvrirPanneau(titre, rendu) {
  var dlg = UI.$("#panneau"), corps = UI.$("#pan-corps");
  fermerPanneau(true);
  UI.$("#pan-titre").textContent = titre || "";
  corps.innerHTML = "";
  var poignee = null;
  try {
    if (typeof rendu === "function") poignee = rendu(corps) || null;
    else if (rendu != null) corps.innerHTML = String(rendu);
  } catch (e) {
    signalerErreur("panneau-" + titre, e);
    corps.innerHTML = '<div class="attente"><p class="attente-t">' + UI.esc(tr("ui_panel_failed")) + "</p></div>";
  }
  Parcours.panneau = { poignee: poignee && typeof poignee === "object" ? poignee : null, retour: document.activeElement };
  document.body.classList.add("panneau-ouvert");
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
  // scroll back to the top once the panel is open and filled: a closed panel (display: none) keeps its old position
  corps.scrollTop = 0;
  dlg.scrollTop = 0;
  try { UI.$(".pan-x", dlg).focus({ preventScroll: true }); } catch (e) {}
  return corps;
}
function fermerPanneau(silencieux) {
  var dlg = UI.$("#panneau"), pn = Parcours.panneau;
  Parcours.panneau = null;
  if (pn && pn.poignee && typeof pn.poignee.quitter === "function") { try { pn.poignee.quitter(); } catch (e) { signalerErreur("quitter-panneau", e); } }
  document.body.classList.remove("panneau-ouvert");
  if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); }
  if (!silencieux && pn && pn.retour && typeof pn.retour.focus === "function") { try { pn.retour.focus({ preventScroll: true }); } catch (e) {} }
}

/* The total's badge: the trip's detail (screen "detail"). */
function ouvrirDetailVoyage() {
  ouvrirPanneau(tr("ui_detail_title"), function (corps) {
    if (typeof ECRANS.detail === "function" && Parcours.D) return ECRANS.detail(corps, Parcours.D, Parcours.choix);
    corps.innerHTML = '<div class="attente calme"><p class="attente-t">' + UI.esc(tr("ui_loading")) + "</p></div>";
    return null;
  });
}

/* ================= Data ================= */
/* media/parcours.json, then each trip.stages[].file, stored in D.lieux[<stage key>]. */
function lireJson(f) {
  return fetch("media/" + f, { cache: "no-cache" }).then(function (r) {
    if (!r.ok) return { f: f, err: r.status === 404 ? tr("ui_file_not_found") : tr("ui_file_error", { status: r.status }) };
    return r.json().then(function (j) { return { f: f, j: j }; }, function () { return { f: f, err: tr("ui_file_unreadable") }; });
  }, function () { return { f: f, err: tr("ui_file_unreachable") }; });
}
function chargerDonnees() {
  Parcours.manquants = null;
  if (!Parcours.D) rendreEcran();
  return lireJson("parcours.json").then(function (p) {
    if (p.err) return [p];
    var stages = (p.j && p.j.trip && Array.isArray(p.j.trip.stages)) ? p.j.trip.stages : [];
    return Promise.all(stages.map(function (s) { return lireJson(s.file || "parcours-" + s.key + ".json"); })).then(function (res) { return [p].concat(res); });
  }).then(function (res) {
    var manque = res.filter(function (x) { return x.err; });
    if (manque.length) { Parcours.D = null; Parcours.manquants = manque; rendreTete(); rafraichir(); return; }
    var D = res[0].j || {};
    D.lieux = D.lieux || {};
    (D.trip.stages || []).forEach(function (s, i) { D.lieux[s.key] = res[i + 1].j; });
    window.TRIP = creerTrip(D);
    Parcours.D = D;
    installerEcrans(TRIP);
    // an error here (Store.donnees, a computation) must not leave the page on "Loading…"
    try { Store.donnees(D); } catch (e) { signalerErreur("store-donnees", e); }
    var h = location.hash.slice(1);
    try {
      Parcours.etape = "";
      allerA(INDEX_ETAPES[h] ? h : lsGet(Store.cle("etape"), ETAPES[0].cle));
      rafraichir();
    } catch (e) { signalerErreur("rafraichir", e); try { rendreEcran(); } catch (e2) { signalerErreur("ecran", e2); } }
  }).catch(function (e) {
    signalerErreur("chargement", e);
    Parcours.D = null;
    Parcours.manquants = [{ f: "parcours.json", err: tr("ui_file_interrupted", { error: e && e.message ? e.message : "" }) }];
    try { rendreEcran(); } catch (e2) {}
  });
}

/* ================= Start ================= */
function demarrer() {
  var html = document.documentElement;
  if (typeof T === "function" && typeof T.setLang === "function" && html.lang) T.setLang(html.lang);
  traduireGabarit();
  Store.avertir = UI.toast;
  Store.demarrer({ slug: html.getAttribute("data-trip") || "" }).then(function () { rendreSync(); });
  Store.surChangement(rafraichir);
  appliquerMode(lsGet(Store.cle("mode"), "simple"));
  rendreTete();
  rendreSync();
  rendrePastille();
  rendreEcran();

  UI.$("#points").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-groupe]");
    if (b && INDEX_GROUPES[b.dataset.groupe]) { document.body.classList.add("navigue"); allerA(INDEX_GROUPES[b.dataset.groupe].ecrans[0].cle); }
  });
  UI.$("#sous-etapes").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-etape]");
    if (b) { document.body.classList.add("navigue"); allerA(b.dataset.etape); }
  });
  UI.$("#retour").addEventListener("click", function () { etapeVoisine(-1); });
  UI.$("#suivant").addEventListener("click", function () { etapeVoisine(1); });
  UI.$("#mode-simple").addEventListener("click", function () { appliquerMode("simple"); });
  UI.$("#mode-detail").addEventListener("click", function () { appliquerMode("detail"); });
  UI.$("#pastille").addEventListener("click", ouvrirDetailVoyage);
  UI.$("#ecran").addEventListener("click", function (ev) { if (ev.target.closest("#reessayer")) chargerDonnees(); });
  var dlg = UI.$("#panneau");
  UI.$(".pan-x", dlg).addEventListener("click", function () { fermerPanneau(); });
  dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); fermerPanneau(); });
  dlg.addEventListener("click", function (ev) { if (ev.target === dlg) fermerPanneau(); });   // a click on the backdrop
  // a page shared by several people: back on the tab, read the server's state again (at most once a minute)
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") Store.actualiser();
  });
  window.addEventListener("hashchange", function () {
    var k = location.hash.slice(1);
    if (INDEX_ETAPES[k] && k !== Parcours.etape) allerA(k);
  });
  // the badge's place depends on the width and the fonts: its text is computed again when they change
  var pastilleAFaire = false;
  window.addEventListener("resize", function () {
    if (pastilleAFaire) return;
    pastilleAFaire = true;
    var faire = function () { pastilleAFaire = false; rendrePastille(); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(faire); else setTimeout(faire, 50);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { rendrePastille(); });
  chargerDonnees();
}

Parcours.recharger = chargerDonnees;   // read parcours*.json again (after the data is rebuilt)
window.allerA = allerA;
window.rafraichir = rafraichir;
window.Parcours = Parcours;
window.UI = UI;

/* Start once every script (screens included) is loaded. */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
else setTimeout(demarrer, 0);
})();
