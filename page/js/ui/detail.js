/* The trip's detail (opened by the total badge) and the tools shared by the end screens (day by day, the plan).

   Screen "detail" (ECRANS.detail, function (racine, D, choix)): rendered in the badge's panel (shell.js).
     Before leaving / on the spot, each stage folds open down to the lines "n × u = total", with "published price" or
     "estimated", the source (site, link), the cancellation, the charge and the date checked; the legs out of the shared
     budget apart, each with its "Add it to see" toggle (choix.inclure[<leg>]). The sum of the stages = the badge's total.

   FinUI (the only global of this file, besides ECRANS["detail"]): pure functions (formats, groupings, bars), icons, and
   the resolution of images. Used also by jours.js and plan-ecran.js, always at render time (the loading order of the
   files does not matter). Exported for tests/js/fin-ui.test.js. Texts through T(), money through fmtMoney. */

(function () {
"use strict";

/* ================= Other modules (globals in the page, require under node) ================= */
function I18() {
  return typeof T === "function" && typeof fmtMoney === "function" ? { T: T, fmtMoney: fmtMoney, fmtDate: fmtDate } : require("../i18n.js");
}
function tr(cle, vars) { return I18().T(cle, vars); }
var trips = typeof WeakMap === "function" ? new WeakMap() : null;
function cfg(D) {
  if (trips && D && trips.has(D)) return trips.get(D);
  var f = typeof creerTrip === "function" ? creerTrip : require("../logic/config.js").creerTrip;
  var t = f(D || {});
  if (trips && D) trips.set(D, t);
  return t;
}
function peutRequire() { return typeof module !== "undefined" && typeof require === "function"; }
function fnLignesVoyage() {
  if (typeof lignesVoyage === "function") return lignesVoyage;
  if (peutRequire()) { try { return require("../logic/budget.js").lignesVoyage; } catch (e) { return null; } }
  return null;
}
function fnTotaux() {
  if (typeof totaux === "function") return totaux;
  if (peutRequire()) { try { return require("../logic/budget.js").totaux; } catch (e) { return null; } }
  return null;
}

/* ================= Images: one place to find the address of an image =================
   image(ref, D?) → Promise<address | null>. Forms of ref:
   - "logement:<slug>"                      → the 1st small photo of the lodging (its gallery), of any stage; none: null;
   - "sortie:<id>"                          → the 1st small photo of the outing;
   - "media/photos/…" or "media/videos/…"   → as is (a file of the site);
   - "data:image/…"                         → as is (an airline's logo, D.logos).
   Anything else (an external address…) → null. D: the trip's data; by default window.Parcours.D. */
var RE_FICHIER = /^media\/(photos|videos)\/[\w.\/-]+\.(jpg|jpeg|png|webp)$/;
function premierePetite(x) {
  var u = x && x.galerie && Array.isArray(x.galerie.petites) ? x.galerie.petites[0] : null;
  return typeof u === "string" && RE_FICHIER.test(u) && u.indexOf("..") < 0 ? u : null;
}
function etapesDe(D) {
  var k = D && D.trip ? cfg(D).stageKeys : [];
  return k.length ? k : Object.keys((D && D.lieux) || {});
}
function image(ref, D) {
  if (typeof ref !== "string" || !ref) return Promise.resolve(null);
  if (!D && typeof window !== "undefined" && window.Parcours) D = window.Parcours.D;
  var lg = /^logement:([\w-]+)$/.exec(ref);
  if (lg) {
    var trouve = null;
    etapesDe(D).some(function (e) {
      var L = D && D.lieux && D.lieux[e];
      trouve = L ? [].concat(L.logements || [], L.autres || []).filter(function (x) { return x && x.slug === lg[1]; })[0] || null : null;
      return !!trouve;
    });
    return Promise.resolve(premierePetite(trouve));
  }
  var so = /^sortie:([\w-]+)$/.exec(ref);
  if (so) return Promise.resolve(premierePetite(trouverSortie(D, so[1])));
  if (/^data:image\//.test(ref) || (RE_FICHIER.test(ref) && ref.indexOf("..") < 0)) return Promise.resolve(ref);
  return Promise.resolve(null);
}

/* ================= Formats ================= */
function fini(x) { return typeof x === "number" && isFinite(x); }
function r2(x) { return Math.round(x * 100) / 100 + 0; }
function estIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function langue() { var t = I18().T; return typeof t.lang === "function" ? t.lang() : "en"; }

/* $2,076; $4.50; −$50 (cents only when there are some). null / NaN → "". */
function argentPrecis(x) {
  if (!fini(x)) return "";
  return (x <= -0.005 ? "−" : "") + I18().fmtMoney(Math.abs(x), "home", { exact: true });
}
/* $2,076 rounded to the unit (sums, key figures). */
function argentRond(x) {
  if (!fini(x)) return "";
  var r = Math.round(x);
  return (r < 0 ? "−" : "") + I18().fmtMoney(Math.abs(r), "home");
}
/* The same amount in the local currency ("" without a local currency or a rate). */
function argentLocal(x) { return fini(x) ? I18().fmtMoney(x, "local") : ""; }
function nombre(n) {
  if (!fini(n)) return "";
  var a = Math.abs(n), entier = Math.abs(a - Math.round(a)) < 0.005;
  var s;
  try {
    s = new Intl.NumberFormat(langue(), { minimumFractionDigits: entier ? 0 : 2, maximumFractionDigits: entier ? 0 : 2 }).format(entier ? Math.round(a) : a);
  } catch (e) { s = entier ? String(Math.round(a)) : a.toFixed(2); }
  return (n < 0 ? "−" : "") + s;
}
/* "Jun 15", "1er juin" */
function dateCourte(iso) { return estIso(iso) ? I18().fmtDate(iso) : ""; }
/* The rate behind the local amounts: "1 USD = 0.92 EUR · rate of November 7, 2026" (the date when known); "" when the
   trip has no local currency or no rate (then no local amount is shown either). */
function texteTaux(D) {
  var c = cfg(D).currency || {};
  if (!c.home || !c.local || c.local === c.home || !fini(c.rate)) return "";
  var n;
  try { n = new Intl.NumberFormat(langue(), { maximumSignificantDigits: 4 }).format(c.rate); } catch (e) { n = String(c.rate); }
  var vars = { home: c.home, rate: n, local: c.local };
  if (!estIso(c.rate_date)) return tr("rate_line", vars);
  vars.date = I18().fmtDate(c.rate_date, "long");
  return tr("rate_line_dated", vars);
}
/* "Tue Jun 15" */
function dateLongue(iso) { return estIso(iso) ? I18().fmtDate(iso, "weekday") : ""; }
/* Days between two ISO dates (b − a). */
function joursEntre(a, b) {
  if (!estIso(a) || !estIso(b)) return NaN;
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function aujourdhui() {
  var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* ================= Budget lines ================= */
var GROUPE_VOLS = "vols";      // the flights and the formalities: one group before the stages
var ORDRE_POSTES = ["vols", "logements", "formalites", "trajets", "repas", "verres", "bienetre", "activites"];
var CLES_POSTES = {
  vols: "dt_item_vols", logements: "dt_item_logements", formalites: "dt_item_formalites", trajets: "dt_item_trajets",
  repas: "dt_item_repas", verres: "dt_item_verres", bienetre: "dt_item_bienetre", activites: "dt_item_activites",
};
function libPoste(p) { return CLES_POSTES[p] ? tr(CLES_POSTES[p]) : p; }
/* The groups of the lines, in order: "Travel and formalities", then the trip's stages. */
function ordreEtapes(D) { return [GROUPE_VOLS].concat(etapesDe(D)); }
function infoEtape(D, e) {
  if (e === GROUPE_VOLS) return { nom: tr("dt_travel"), ton: "accent" };
  var st = D && D.trip ? cfg(D).stage(e) : null;
  return st ? { nom: st.title, ton: st.tone != null ? st.tone : "accent" } : { nom: e, ton: "accent" };
}

function montant(l) { return l && fini(l.n) && fini(l.u) ? l.n * l.u : 0; }
function estIncomplete(l) { return !!l && (l.incomplet === true || !fini(l.n) || !fini(l.u)); }
function estInclus(l) { return !!l && (l.src === "inclus" || l.quand === "inclus") && montant(l) === 0 && !estIncomplete(l); }

/* ================= One wording per idea, on every screen =================
   Effect of an option: "+$120 to the budget" / "−$45 to the budget"; margin: "margin $642" or, over the cap,
   "$138 over $6,000"; the toggle of a leg out of the budget: "Add it to see". vols.js, logement.js and sorties.js write
   the same words. */
function effetBudget(montantH) {
  if (!fini(montantH)) return "";
  var r = Math.round(montantH);
  return r === 0 ? tr("ui_same_budget") : tr("ui_to_budget", { amount: (r > 0 ? "+" : "−") + argentRond(Math.abs(r)) });
}
function margeApres(marge, plafond) {
  if (!fini(marge) || !fini(plafond)) return "";
  return marge >= 0 ? tr("ui_margin", { amount: argentRond(marge) }) : tr("ui_over_cap", { amount: argentRond(-marge), cap: argentRond(plafond) });
}

/* ================= A leg out of the shared budget: one amount everywhere =================
   What its "Add it to see" toggle adds to the total: the lines of budget.js that count only when it is ticked (ticket,
   bag, and the formalities only this leg asks for). The same amount and the same sum on the flights screen, in the
   plan and in the trip's detail, ticked or not. lv: lignesVoyage (budget.js); by default the global function.
   null without the computation, for a leg in the budget, or without such lines.
   { termes: [{cle, lib, montant|null}], total, incomplet, texte: "$859 + bag $94 + entry $4.50 = $957.50" } */
function horsBudgetDuTrajet(choix, D, legKey, lv) {
  var f = typeof lv === "function" ? lv : fnLignesVoyage();
  if (!f || !D || !D.trip) return null;
  var leg = cfg(D).legs.filter(function (l) { return l.key === legKey; })[0];
  if (!leg || leg.in_budget) return null;
  var avecInclure = function (v) {
    var inc = Object.assign({}, choix && choix.inclure);
    inc[legKey] = v;
    return Object.assign({}, choix || {}, { inclure: inc });
  };
  var sans, avec;
  try { sans = f(avecInclure(false), D) || []; avec = f(avecInclure(true), D) || []; } catch (e) { return null; }
  var compteAvec = {};
  avec.forEach(function (l) { if (l && !l.hors_budget && l.poste === "formalites") compteAvec[l.cle] = true; });
  var hors = sans.filter(function (l) {
    return l && l.hors_budget && (l.trajet === legKey || (l.poste === "formalites" && !l.trajet && compteAvec[l.cle]));
  });
  if (!hors.length) return null;
  var total = 0, incomplet = false;
  var termes = hors.map(function (l) {
    var inc = estIncomplete(l), m = inc ? null : r2(montant(l));
    if (inc) incomplet = true; else total += m;
    var lib = l.cle === "vol" || l.cle === "trajet" ? "" : l.cle === "valise" ? tr("dt_bag") : l.poste === "formalites" ? tr("dt_formality") : String(l.lib || l.cle);
    return { cle: l.cle, lib: lib, montant: m };
  });
  total = r2(total);
  var morceaux = termes.map(function (t) { return (t.lib ? t.lib + " " : "") + (t.montant === null ? tr("price_to_check") : argentPrecis(t.montant)); });
  var texte = morceaux.length > 1
    ? morceaux.join(" + ") + " = " + argentPrecis(total) + (incomplet ? " + " + tr("price_to_check") : "")
    : morceaux[0];
  return { termes: termes, total: total, incomplet: incomplet, texte: texte };
}

/* "published price" (read on a site), "estimated", "included". */
function srcLibelle(src) {
  if (src === "direct" || src === "releve") return tr("lg_src_published");
  if (src === "estime") return tr("lg_src_estimated");
  if (src === "inclus") return tr("lg_src_included");
  return "";
}

/* A line's computation: "6 × $346 = $2,076"; unknown price → "1 × price to check" (never $0, never NaN). */
function calcLigne(l) {
  if (estInclus(l)) return { texte: tr("lg_src_included"), montant: 0, aVerifier: false, inclus: true };
  var n = l && fini(l.n) ? l.n : 1;
  if (!l || !fini(l.u)) return { texte: nombre(n) + " × " + tr("price_to_check"), montant: null, aVerifier: true, inclus: false };
  return { texte: nombre(n) + " × " + argentPrecis(l.u) + " = " + argentPrecis(n * l.u), montant: n * l.u, aVerifier: false, inclus: false };
}

function nouveauCote() { return { total: 0, incomplet: false, etapes: [] }; }

/* Lines → { avant: {total, incomplet, etapes: [{etape, nom, ton, total, incomplet, lignes}]}, place: {…},
   hors: {total, incomplet, lignes}, total }. The same rule as totaux() (budget.js): hors_budget apart; "avant" =
   quand === "avant" (plus the "included" lines at 0, shown with their lodging); everything else = on the spot.
   So avant.total = totaux().avant, place.total = totaux().place, total = totaux().total. Names from the trip. */
function grouperLignes(lignes, D) {
  var g = { avant: nouveauCote(), place: nouveauCote(), hors: { total: 0, incomplet: false, lignes: [] }, total: 0 };
  var idx = { avant: {}, place: {} };
  (lignes || []).forEach(function (l) {
    if (!l) return;
    var m = montant(l), inc = estIncomplete(l);
    if (l.hors_budget) { g.hors.lignes.push(l); g.hors.total += m; if (inc) g.hors.incomplet = true; return; }
    var cote = l.quand === "avant" || estInclus(l) ? "avant" : "place";
    var e = l.etape || GROUPE_VOLS;
    var grp = idx[cote][e];
    if (!grp) {
      var info = infoEtape(D, e);
      grp = idx[cote][e] = { etape: e, nom: info.nom, ton: info.ton, total: 0, incomplet: false, lignes: [] };
      g[cote].etapes.push(grp);
    }
    grp.lignes.push(l);
    grp.total += m;
    g[cote].total += m;
    if (inc) { grp.incomplet = true; g[cote].incomplet = true; }
  });
  var ordre = ordreEtapes(D);
  ["avant", "place"].forEach(function (c) {
    g[c].etapes.sort(function (a, b) { return rang(ordre, a.etape) - rang(ordre, b.etape); });
    g[c].etapes.forEach(function (x) { x.total = r2(x.total); });
    g[c].total = r2(g[c].total);
  });
  g.hors.total = r2(g.hors.total);
  g.total = r2(g.avant.total + g.place.total);
  return g;
}
function rang(ordre, k) { var i = ordre.indexOf(k); return i < 0 ? ordre.length : i; }

/* A stage's lines by item (lodging, meals, drinks…), in the order of ORDRE_POSTES. */
function parPoste(lignes) {
  var idx = {}, out = [];
  (lignes || []).forEach(function (l) {
    var p = l.poste || "activites";
    if (!idx[p]) { idx[p] = { poste: p, lib: libPoste(p), total: 0, lignes: [] }; out.push(idx[p]); }
    idx[p].lignes.push(l);
    idx[p].total += montant(l);
  });
  out.sort(function (a, b) { return rang(ORDRE_POSTES, a.poste) - rang(ORDRE_POSTES, b.poste); });
  out.forEach(function (x) { x.total = r2(x.total); });
  return out;
}

/* Bars "When the money goes": width in % of the largest amount (at least 2 % when positive). */
function barres(rangs) {
  var max = 0;
  (rangs || []).forEach(function (r) { if (r && fini(r.montant) && r.montant > max) max = r.montant; });
  return (rangs || []).map(function (r) {
    var m = r && fini(r.montant) ? r.montant : 0;
    var pct = max > 0 && m > 0 ? Math.max(2, Math.round((m / max) * 100)) : 0;
    return Object.assign({}, r, { pct: pct });
  });
}
function somme(rangs, champ) {
  return r2((rangs || []).reduce(function (s, r) { var v = r && r[champ || "montant"]; return s + (fini(v) ? v : 0); }, 0));
}

/* ================= D: find a lodging, an outing, a flight, a formality ================= */
function trouverLogement(D, etape, id) {
  var L = D && D.lieux && D.lieux[etape];
  if (!L || typeof id !== "string") return null;
  return [].concat(L.logements || [], L.autres || []).filter(function (x) { return x && x.id === id; })[0] || null;
}
function trouverSortie(D, id) {
  if (!D || !D.lieux || typeof id !== "string") return null;
  var out = null;
  etapesDe(D).some(function (k) {
    var L = D.lieux[k];
    out = ((L && L.sorties) || []).filter(function (s) { return s && s.id === id; })[0] || null;
    if (out && !out.etape) out = Object.assign({ etape: k }, out);
    return !!out;
  });
  return out;
}
/* The chosen option of a leg (a flight or a ground trip), or null. */
function volChoisi(D, choix, legKey) {
  var v = D && D.vols && D.vols[legKey], id = choix && choix[legKey];
  return v && Array.isArray(v.options) ? v.options.filter(function (o) { return o && o.id === id; })[0] || null : null;
}
function moinsCher(prixParSite) {
  return (prixParSite || []).filter(function (p) { return p && !p.bloque && fini(p.prix_home); })
    .sort(function (a, b) { return a.prix_home - b.prix_home; })[0] || null;
}

/* What is known about a line: site and link, date checked, cancellation, charge, delay.
   → {site, url, verifie, annulation, prelevement, paiement, delai, source, liens: [{site, url, prix}]} */
var CLES_FICHE = { chambre: 1, petits_dej: 1, dejeuners: 1, diners: 1, gala: 1, verres: 1, spa: 1, transferts: 1, "fiche-incomplete": 1, "nuit-en-plus": 1, "nuit-perdue": 1 };
function infoLigne(l, D, choix) {
  var i = { liens: [] };
  if (!l) return i;
  var f = ((D && D.formalites) || []).filter(function (x) { return x && x.code === l.cle; })[0];
  if (l.sortie) {
    var s = trouverSortie(D, l.sortie);
    if (l.cle === "remplace") { i.source = tr("dt_src_replaces"); return i; }
    if (s) {
      i.verifie = s.verifie || null;
      (s.liens || []).forEach(function (x) { if (x && x.url) i.liens.push({ site: courtSite(x.site), url: x.url, prix: fini(x.prix_home) ? x.prix_home : null }); });
      if (!i.liens.length && s.lien_reservation) i.liens.push({ site: tr("so_book"), url: s.lien_reservation, prix: null });
      if (s.prix_estime) i.source = tr(s.source_lieu === "carte" ? "dt_src_estimated_menu" : "dt_src_estimated_sources");
    }
    return i;
  }
  if (l.trajet) {
    var o = volChoisi(D, choix, l.trajet);
    if (o && (l.cle === "vol" || l.cle === "valise")) {
      var p = moinsCher(o.prix_par_site);
      if (l.cle === "vol" && p) { i.site = p.site; i.url = p.url; i.verifie = p.verifie || null; }
      if (l.cle === "vol") {
        (o.prix_par_site || []).forEach(function (x) { if (x && x.url && !x.bloque && fini(x.prix_home)) i.liens.push({ site: x.site, url: x.url, prix: x.prix_home }); });
        i.prelevement = tr("dt_paid_when_booking");
      }
      return i;
    }
    if (o && l.cle === "trajet") {
      i.site = o.operateur || null;
      i.url = l.url || o.lien || null;
      if (o.reserver) i.source = tr("dt_book_when", { text: o.reserver });
      return i;
    }
  }
  if (f) {
    i.site = tr("dt_official_site");
    i.url = f.url_officielle || l.url || null;
    i.verifie = f.verifie || l.verifie || null;
    if (fini(f.delai_jours) && f.delai_jours > 0) i.delai = f.delai_jours;
    return i;
  }
  if (l.poste === "formalites" && l.url) {   // a base line of the trip (insurance, eSIM…) without a formality
    i.site = tr("dt_official_site");
    i.url = l.url;
    i.verifie = l.verifie || null;
    return i;
  }
  if (l.etape && l.etape !== GROUPE_VOLS && CLES_FICHE[l.cle]) {
    var lg = trouverLogement(D, l.etape, choix && choix[l.etape]);
    var px = (lg && lg.prix) || {};
    if (l.cle === "chambre") {
      i.site = px.plateforme || null;
      i.url = (lg && lg.url) || null;   // the address of the retained price; none read: "link to find"
      if (i.site && !i.url) i.sansLien = true;
      i.verifie = px.verifie || null;
      i.annulation = px.annulation || null;
      i.annulationDate = px.annulation_date || null;
      i.prelevement = estIso(px.prelevement_date) ? tr("dt_charged_on", { date: dateCourte(px.prelevement_date) }) : null;
      i.paiement = px.paiement || null;
    } else if (lg) {
      i.source = l.cle === "nuit-en-plus" ? tr("dt_src_extra_night", { name: lg.nom })
        : px.verifie ? tr("dt_src_fiche_checked", { date: dateCourte(px.verifie) }) : tr("dt_src_fiche");
    }
  }
  return i;
}
/* "site.com / Booking (early bird …)" → "site.com / Booking". */
function courtSite(s) { return String(s || tr("dt_link")).replace(/\s*\(.*$/, "").trim() || tr("dt_link"); }

/* ================= Icons (inline SVG) ================= */
function svg(corps, epais) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (epais || 2) +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + corps + "</svg>";
}
var ICONES = {
  avion: svg('<path d="M10.5 13.5 3 11l1.5-1.5 8 1L17 6a2 2 0 0 1 3 3l-4.5 4.5 1 8L15 23l-2.5-7.5L9 19v3l-1.5 1-1-3.5L3 18.5l1-1.5h3l3.5-3.5z"/>'),
  voiture: svg('<path d="M5 16h14M6 16l1.5-5h9L18 16"/><rect x="3.5" y="13" width="17" height="5" rx="2"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/>'),
  lit: svg('<path d="M3 18v-8M3 14h18v4M21 18v-3a3 3 0 0 0-3-3h-7v2"/><circle cx="7" cy="12" r="1.8"/>'),
  lever: svg('<path d="M4 18h16M7 14a5 5 0 0 1 10 0"/><path d="M12 3v4M9.5 5.5 12 3l2.5 2.5"/>'),
  coucher: svg('<path d="M4 18h16M7 14a5 5 0 0 1 10 0"/><path d="M12 3v4M9.5 4.5 12 7l2.5-2.5"/>'),
  horloge: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  carte: svg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>'),
  ok: svg('<path d="M5 12l5 5L20 7"/>', 2.4),
  calendrier: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
  document: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  etoile: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  hausse: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  valise: svg('<rect x="6" y="7" width="12" height="14" rx="2"/><path d="M9 7V4h6v3"/>'),
  lien: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  urgent: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5"/><path d="M12 16h.01"/>', 2.4),
  feuille: svg('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/>'),
  fleche: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  pieces: svg('<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3"/>'),
};
function icone(nom) { return ICONES[nom] || ""; }

/* The CSS tone of a stage tone (1…5, or a name): the shell's mapping when the page has it. */
function tonCss(ton) {
  if (typeof window !== "undefined" && window.UI && typeof window.UI.ton === "function") {
    try { var t = window.UI.ton(ton); if (t) return t; } catch (e) { /* the raw tone */ }
  }
  return typeof ton === "number" ? "tone-" + ton : ton == null ? "accent" : String(ton);
}

/* ================= Small rendering tools (browser) ================= */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
function safeUrl(x) { return typeof x === "string" && /^https?:\/\//i.test(x) ? x : ""; }
function lienExterne(url, texte, cls) {
  var u = safeUrl(url);
  return u ? '<a class="' + (cls || "fin-lien") + '" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(texte) + ' <span aria-hidden="true">↗</span></a>' : "";
}

/* Load the images marked data-img (when they come close to the screen). The element's content (an icon) stays when
   the image is missing. */
function chargerImages(racine) {
  if (!racine || typeof racine.querySelectorAll !== "function") return;
  // one observer per box: the old one is disconnected before another is created
  if (racine._finIo) { racine._finIo.disconnect(); racine._finIo = null; }
  var els = Array.prototype.slice.call(racine.querySelectorAll("[data-img]:not([data-img-fait])"));
  if (!els.length) return;
  var poser = function (el) {
    el.setAttribute("data-img-fait", "1");
    image(el.getAttribute("data-img")).then(function (src) {
      if (!src) return;
      var img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.onload = function () { el.innerHTML = ""; el.appendChild(img); el.classList.add("img-ok"); };
      img.src = src;
    });
  };
  if (typeof IntersectionObserver !== "function") { els.forEach(poser); return; }
  var io = racine._finIo = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); poser(e.target); } });
  }, { rootMargin: "300px 0px" });
  els.forEach(function (el) { io.observe(el); });
}
/* Disconnect a box's observer (when leaving the screen). */
function oublierImages(racine) { if (racine && racine._finIo) { racine._finIo.disconnect(); racine._finIo = null; } }

/* Replace a box's content keeping the keyboard focus (element marked data-k) and the scroll. */
function redessiner(boite, html) {
  var actif = document.activeElement, k = actif && boite.contains(actif) ? actif.getAttribute("data-k") : null;
  oublierImages(boite);
  boite.innerHTML = html;
  if (k) {
    var el = boite.querySelector('[data-k="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(k) : k) + '"]');
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  }
  chargerImages(boite);
}

/* ================= The "detail" screen ================= */
function htmlLigne(l, D, choix) {
  var c = calcLigne(l), i = infoLigne(l, D, choix), src = srcLibelle(l.src);
  var meta = [];
  if (i.site && i.url) meta.push(lienExterne(i.url, i.site));
  else if (i.site) meta.push(esc(i.site) + (i.sansLien ? " (" + esc(tr("fi_link_missing")) + ")" : ""));
  if (i.liens.length && !(i.site && i.liens.length === 1)) {
    i.liens.slice(0, 4).forEach(function (x) {
      if (x.url === i.url) return;
      meta.push(lienExterne(x.url, x.site + (fini(x.prix) ? " " + argentRond(x.prix) : "")));
    });
  }
  if (i.annulation) meta.push(esc(tr("dt_cancellation", { text: i.annulation })));
  if (i.prelevement) meta.push(esc(i.prelevement));
  else if (l.quand === "avant" && !c.inclus) meta.push(esc(tr("dt_paid_before")));
  else if (l.quand === "place") meta.push(esc(tr("dt_paid_on_spot")));
  if (i.delai) meta.push(esc(tr("dt_to_do_before", { n: i.delai })));
  if (i.source) meta.push(esc(i.source));
  if (i.verifie) meta.push(esc(tr("so_checked_on", { date: dateCourte(String(i.verifie).slice(0, 10)) })));
  var cls = "dt-l" + (c.aVerifier ? " a-verifier" : "") + (l.n < 0 ? " moins" : "") + (c.inclus ? " inclus" : "");
  return '<li class="' + cls + '"><div class="dt-l-h"><span class="dt-lib">' + esc(l.lib) +
    (src ? ' <span class="dt-src s-' + esc(l.src) + '">' + esc(src) + "</span>" : "") + "</span>" +
    '<span class="dt-calc">' + esc(c.texte) + "</span></div>" +
    (meta.length ? '<p class="dt-meta">' + meta.join('<span class="dt-sep" aria-hidden="true"> · </span>') + "</p>" : "") +
    (noteUtile(l, i) ? '<p class="dt-note">' + esc(l.note) + "</p>" : "") + "</li>";
}

/* A line's note, except when the details already say the same (the room's cancellation, the flight's site, the
   official link of a formality) or when it only repeats "price to check". */
function noteUtile(l, i) {
  var n = l && l.note;
  if (!n || n === tr("price_to_check")) return false;
  if (l.cle === "chambre" && i.annulation) return false;
  if (l.cle === "vol" && i.site) return false;
  if (i.url && n.indexOf(i.url) >= 0) return false;
  return true;
}

function htmlEtape(cote, e, D, choix, ouverts) {
  var k = cote + ":" + e.etape, n = e.lignes.length;
  var postes = parPoste(e.lignes);
  return '<details class="dt-e ton-' + esc(tonCss(e.ton)) + '" data-g="' + esc(k) + '"' + (ouverts[k] ? " open" : "") + ">" +
    '<summary><i class="dt-pt" aria-hidden="true"></i><span class="dt-e-n">' + esc(e.nom) +
    " <small>" + esc(tr("dt_lines", { n: n })) + "</small></span>" +
    (e.incomplet ? '<em class="tag-incomplet">' + esc(tr("price_to_check")) + "</em>" : "") +
    '<b class="dt-e-t">' + esc(argentPrecis(e.total)) + "</b>" + icone("fleche").replace("<svg", '<svg class="dt-chev"') + "</summary>" +
    '<div class="dt-e-in">' + postes.map(function (p) {
      return '<div class="dt-p"><h5><span>' + esc(p.lib) + "</span><span>" + esc(argentPrecis(p.total)) + "</span></h5>" +
        '<ul class="dt-ls">' + p.lignes.map(function (l) { return htmlLigne(l, D, choix); }).join("") + "</ul></div>";
    }).join("") + "</div></details>";
}

/* The legs out of the shared budget: one toggle each (choix.inclure[<leg>]), with what it adds. */
function htmlHors(g, D, choix) {
  var trip = cfg(D);
  var legs = trip.legs.filter(function (l) { return !l.in_budget; });
  if (!legs.length) return "";
  var h = '<section class="dt-g dt-hors"><h3>' + icone("avion") + "<span>" + esc(tr("dt_out_title")) + "</span><b>" +
    (g.hors.lignes.length ? esc(argentPrecis(g.hors.total)) : "—") + "</b></h3>" +
    '<p class="discret">' + esc(tr("dt_out_text")) + "</p>";
  legs.forEach(function (leg) {
    var inclus = !!(choix && choix.inclure && choix.inclure[leg.key] === true);
    var a = horsBudgetDuTrajet(choix, D, leg.key);
    var nom = tr("ui_route_who", { who: trip.labelsOf(leg), route: libRoute(trip, leg) });
    h += '<div class="dt-hors-leg"><p><b>' + esc(nom) + "</b>" + (a ? " · " + esc(a.texte) : "") + " · " +
      esc(tr(inclus ? "dt_out_counted" : "dt_out_apart")) + "</p>" +
      '<label class="dt-incl"><input type="checkbox" name="inclure-' + esc(leg.key) + '" data-k="inclure-' + esc(leg.key) + '" data-inclure="' + esc(leg.key) + '"' +
      (inclus ? " checked" : "") + "> " + esc(tr("fl_add_to_see")) + "</label></div>";
  });
  if (g.hors.lignes.length) h += '<ul class="dt-ls">' + g.hors.lignes.map(function (l) { return htmlLigne(l, D, choix); }).join("") + "</ul>";
  if (g.hors.incomplet) h += '<p class="discret">' + esc(tr("dt_out_incomplete")) + "</p>";
  return h + "</section>";
}
function libRoute(trip, leg) {
  var nom = function (k) { var s = trip.stage(k); return s ? s.title : k || ""; };
  var de = leg.from_stage ? nom(leg.from_stage) : (leg.from_airports || []).map(trip.airportName).join(" / ");
  var vers = leg.to_stage ? nom(leg.to_stage) : (leg.to_airports || []).map(trip.airportName).join(" / ");
  return tr("ui_route", { from: de, to: vers });
}

function htmlDetail(D, choix, lignes, t, ouverts) {
  if (!lignes || !t || !fini(t.total)) {
    return '<div class="attente calme"><p class="attente-t">' + esc(tr("dt_not_ready")) + "</p><p>" + esc(tr("dt_not_ready_how")) + "</p></div>";
  }
  var trip = cfg(D);
  var g = grouperLignes(lignes, D), plafond = fini(t.plafond) ? t.plafond : trip.budgetCap;
  var loc = argentLocal(t.place);
  var marge = fini(t.marge) && fini(plafond)
    ? (t.marge >= 0
      ? '<span class="dt-marge ok">' + esc(tr("dt_margin_under", { amount: argentRond(t.marge), cap: argentRond(plafond) })) + "</span>"
      : '<span class="dt-marge trop">' + esc(margeApres(t.marge, plafond)) + "</span>")
    : "";
  var html = '<div class="dt-tete">' +
    '<div class="dt-k dt-k-tot"><span>' + esc(tr("dt_budget_title", { people: tr("for_n_people", { n: trip.adults }) })) + "</span><b>≈ " + esc(argentRond(t.total)) + "</b>" +
    (t.incomplet ? '<em class="tag-incomplet">' + esc(tr("ui_incomplete")) + "</em>" : "") + marge + "</div>" +
    '<div class="dt-k"><span>' + esc(tr("dt_before")) + "</span><b>" + esc(argentPrecis(t.avant)) + "</b></div>" +
    '<div class="dt-k"><span>' + esc(tr("dt_on_spot")) + "</span><b>" + esc(argentPrecis(t.place)) + "</b>" + (loc ? "<small>≈ " + esc(loc) + "</small>" : "") + "</div></div>" +
    '<p class="discret dt-aide">' + esc(tr("dt_help")) + "</p>" +
    (texteTaux(D) ? '<p class="discret dt-taux">' + esc(texteTaux(D)) + "</p>" : "");
  [["avant", "dt_before", "carte"], ["place", "dt_on_spot", "pieces"]].forEach(function (x) {
    var cote = g[x[0]];
    html += '<section class="dt-g"><h3>' + icone(x[2]) + "<span>" + esc(tr(x[1])) + "</span><b>" + esc(argentPrecis(cote.total)) + "</b></h3>" +
      (cote.etapes.length ? cote.etapes.map(function (e) { return htmlEtape(x[0], e, D, choix, ouverts); }).join("")
        : '<p class="discret">' + esc(tr("dt_nothing_yet")) + "</p>") + "</section>";
  });
  html += htmlHors(g, D, choix);
  var juste = Math.abs(g.total - t.total) < 0.01;
  html += '<p class="dt-somme">' + esc(tr("dt_sum", { before: argentPrecis(g.avant.total), spot: argentPrecis(g.place.total) })) +
    " <b>" + esc(argentPrecis(g.total)) + "</b>" + (juste ? esc(tr("dt_sum_ok", { total: argentRond(t.total) })) : "") + "</p>" +
    (juste ? "" : '<p class="dt-ecart">' + esc(tr("dt_sum_wrong", { total: argentPrecis(t.total) })) + "</p>");
  return html;
}

function ecranDetail(racine, D, choix) {
  var boite = document.createElement("div");
  boite.className = "dt";
  racine.appendChild(boite);
  var ouverts = {};
  boite.addEventListener("toggle", function (ev) {
    var d = ev.target;
    if (d && d.getAttribute && d.getAttribute("data-g")) ouverts[d.getAttribute("data-g")] = d.open;
  }, true);
  boite.addEventListener("change", function (ev) {
    var x = ev.target, leg = x && x.getAttribute ? x.getAttribute("data-inclure") : null;
    if (leg && typeof patchChoix === "function") { var o = {}; o[leg] = !!x.checked; patchChoix("inclure", o); }
  });
  function rendre(c) {
    var P = (typeof window !== "undefined" && window.Parcours) || {};
    var lignes = P.lignes, t = P.totaux;
    var lv = fnLignesVoyage(), tot = fnTotaux();
    if (!lignes && lv && tot) {
      lignes = lv(c, D);
      t = tot(lignes, cfg(D).budgetCap);
    }
    redessiner(boite, htmlDetail(D, c, lignes, t, ouverts));
  }
  rendre(choix);
  return { maj: rendre, quitter: function () { oublierImages(boite); } };
}

/* ================= Exposure ================= */
var FinUI = {
  image: image, chargerImages: chargerImages, oublierImages: oublierImages, redessiner: redessiner,
  argentPrecis: argentPrecis, argentRond: argentRond, argentLocal: argentLocal, nombre: nombre, dateCourte: dateCourte, dateLongue: dateLongue,
  texteTaux: texteTaux,
  joursEntre: joursEntre, aujourdhui: aujourdhui, estIso: estIso, fini: fini, r2: r2,
  montant: montant, estIncomplete: estIncomplete, estInclus: estInclus, srcLibelle: srcLibelle, calcLigne: calcLigne,
  grouperLignes: grouperLignes, parPoste: parPoste, barres: barres, somme: somme, infoLigne: infoLigne,
  trouverLogement: trouverLogement, trouverSortie: trouverSortie, volChoisi: volChoisi, courtSite: courtSite,
  ordreEtapes: ordreEtapes, infoEtape: infoEtape, libPoste: libPoste, libRoute: libRoute, tonCss: tonCss,
  icone: icone, esc: esc, safeUrl: safeUrl, lienExterne: lienExterne, htmlDetail: htmlDetail, horsBudgetDuTrajet: horsBudgetDuTrajet,
  margeApres: margeApres, effetBudget: effetBudget, cfg: cfg,
};
if (typeof module !== "undefined" && module.exports) module.exports = FinUI;
if (typeof window !== "undefined") {
  window.FinUI = FinUI;
  var ECRANS = window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
  ECRANS["detail"] = ecranDetail;
}
})();
