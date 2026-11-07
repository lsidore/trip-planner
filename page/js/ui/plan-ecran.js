/* Screen "plan": what to book now, what can wait, when the money goes, what is paid on the spot.
   - Three figures: the trip's budget and margin; before leaving, of which this week; on the spot, in both currencies.
   - "To do now", "Can wait, but not too long", "Formalities, with their delays": one line per thing to book (photo or
     logo, icon pills, colored deadline, amount or "price to check", small lines on click, shared "booked" box =
     Store.marquerResa(item.cle)).
   - A leg out of the shared budget: marked "outside the shared budget", not added unless choix.inclure[<leg>].
   - "When the money goes" in bars; "On the spot" by stage.
   Logic: planItems, sections, argentPart, surPlace (plan.js), totaux (budget.js); each guarded by typeof.
   Global names: none (everything is in this wrapper), except ECRANS["plan"]. Images: FinUI.image (detail.js).
   Pure functions exported for tests/js/fin-ui.test.js. Texts through T(). */

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

var ICONE_TYPE = { vol: "avion", trajet: "voiture", logement: "lit", sortie: "etoile", formalite: "document" };

/* ================= Pure functions ================= */
function estIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function fini(x) { return typeof x === "number" && isFinite(x); }
function moisJour(iso) { return estIso(iso) ? I18().fmtDate(iso) : ""; }
function jours(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }

/* The three lists of the screen. sec = sections(items) of plan.js (else: red = now). The formalities that are not urgent
   have their own list; in each list, what is already booked goes last (order of the dates kept). */
function repartir(items, sec, estReserve) {
  var s = sec && Array.isArray(sec.maintenant) && Array.isArray(sec.attendre) ? sec : {
    maintenant: (items || []).filter(function (x) { return x && x.urgence === "rouge"; }),
    attendre: (items || []).filter(function (x) { return x && x.urgence !== "rouge"; }),
  };
  var r = typeof estReserve === "function" ? estReserve : function () { return false; };
  var ordonner = function (l) {
    return l.map(function (x, i) { return { x: x, i: i, f: r(x.cle) ? 1 : 0 }; })
      .sort(function (a, b) { return a.f - b.f || a.i - b.i; }).map(function (o) { return o.x; });
  };
  return {
    maintenant: ordonner(s.maintenant.filter(Boolean)),
    attendre: ordonner(s.attendre.filter(function (x) { return x && x.type !== "formalite"; })),
    demarches: ordonner(s.attendre.filter(function (x) { return x && x.type === "formalite"; })),
  };
}

/* The deadline pill: {cls: "r"|"o"|"g"|"n"|"fait", texte, jours}. */
function echeance(item, auj, fait) {
  if (fait) return { cls: "fait", texte: tr("pl_done"), jours: null };
  var a = item && item.avant;
  if (!estIso(a)) return { cls: "n", texte: tr("pl_date_to_confirm"), jours: null };
  var d = estIso(auj) ? jours(auj, a) : null;
  var cls = item.urgence === "rouge" ? "r" : item.urgence === "orange" ? "o" : item.urgence === "vert" ? "g" : d != null && d <= 7 ? "r" : d != null && d <= 30 ? "o" : "g";
  if (d != null && d <= 0) return { cls: "r", texte: tr("pl_right_now"), jours: d };
  return { cls: cls, texte: tr("pl_before_date", { date: moisJour(a) }), jours: d };
}

/* Icon pills: cancellation, charge or payment, announced price rise, delay of a formality ("outside the shared budget"
   is written under the amount). */
function puces(item) {
  var out = [];
  if (!item) return out;
  var an = item.annulation;
  if (estIso(an)) out.push({ icone: "ok", texte: tr("pl_cancel_until", { date: moisJour(an) }) });
  else if (typeof an === "string" && an) out.push({ icone: /non[\s-]?(?:rembours|refund)/i.test(an) ? "info" : "ok", texte: an });
  var pr = item.prelevement, pa = item.paiement;
  if (estIso(pr)) out.push({ icone: "carte", texte: tr("pl_charged_on", { date: moisJour(pr) }) });
  else if (typeof pr === "string" && pr) out.push({ icone: "carte", texte: pr });
  else if (typeof pa === "string" && pa && pa !== "gratuit" && pa !== "free") out.push({ icone: "carte", texte: pa });
  var h = item.hausse;
  if (h && (typeof h === "string" || h.court || h.texte || fini(h.prix_apres_home))) {
    out.push({ icone: "hausse", texte: fini(h.prix_apres_home) ? tr("pl_then_price", { price: F().argentRond(h.prix_apres_home), date: moisJour(h.avant) })
      : h.court ? String(h.court) : tr("pl_price_rise") });
  }
  if (fini(item.delai_jours) && item.delai_jours > 0) out.push({ icone: "horloge", texte: tr("pl_delay_days", { n: item.delai_jours }) });
  return out;
}
/* An item out of the shared budget (planItems already counts the legs ticked "Add it to see"). */
function estHors(item) { return !!(item && item.horsBudget); }

/* The amount of a plan line: "$2,076" or "price to check" (never $0 for an unknown price). */
function texteMontant(item) {
  if (!item || !fini(item.montant)) return { texte: tr("price_to_check"), aVerifier: true };
  return { texte: Math.round(item.montant) === 0 ? tr("so_free") : null, aVerifier: false, valeur: item.montant };
}

/* The amount "this week" of argentPart. */
function cetteSemaine(rangs) {
  return (rangs || []).filter(function (r) { return r && r.semaine; })
    .reduce(function (s, r) { return s + (fini(r.montant) ? r.montant : 0); }, 0);
}
function libelleArgent(r) { return r && r.semaine ? tr("plan_this_week") : estIso(r && r.libelle) ? moisJour(r.libelle) : String((r && r.libelle) || ""); }

/* ================= Rendering ================= */
function visuel(item, D) {
  var fin = F(), esc = fin.esc;
  var img = Array.isArray(item.image) ? item.image[0] : item.image;
  var ic = fin.icone(ICONE_TYPE[item.type] || "document");
  if (typeof img === "string" && D && D.logos && D.logos[img]) return '<span class="pl-vis logo"><img src="' + esc(D.logos[img]) + '" alt=""></span>';
  if (typeof img === "string" && /^data:image\//.test(img) && (item.imageType === "logo" || item.type === "vol")) {
    return '<span class="pl-vis logo"><img src="' + esc(img) + '" alt=""></span>';
  }
  if (item.type === "vol" && Array.isArray(item.compagnies) && D && D.logos && D.logos[item.compagnies[0]]) {
    return '<span class="pl-vis logo"><img src="' + esc(D.logos[item.compagnies[0]]) + '" alt=""></span>';
  }
  if (typeof img === "string" && img) return '<span class="pl-vis photo" data-img="' + esc(img) + '">' + ic + "</span>";
  return '<span class="pl-vis icone">' + ic + "</span>";
}

function estReserve(cle) { return !!(typeof window !== "undefined" && window.Store && Store.estReserve && Store.estReserve(String(cle || ""))); }

function htmlItem(item, D, auj, ouverts) {
  var fin = F(), esc = fin.esc, cle = String(item.cle || "");
  var fait = estReserve(cle);
  var e = echeance(item, auj, fait), hors = estHors(item), m = texteMontant(item);
  var ps = puces(item);
  var ouvert = !!ouverts[cle];
  var det = Array.isArray(item.details) ? item.details.filter(Boolean) : [];
  var tous = (Array.isArray(item.liens) ? item.liens : []).filter(function (l) { return l && !l.bloque; });
  var liens = tous.filter(function (l) { return fin.safeUrl(l.url); });
  // the retained price without an address of its site (url null): shown without a link, "link to find"
  var sansLien = tous.filter(function (l) { return l.meilleur && !fin.safeUrl(l.url); })[0] || null;
  var prixLien = function (l) { return fini(l.prix_home) ? l.prix_home : fini(l.prix) ? l.prix : null; };
  var best = liens.filter(function (l) { return l.meilleur; })[0] || null;
  if (!best && !sansLien) liens.forEach(function (l) { var p = prixLien(l); if (p != null && (best == null || p < prixLien(best))) best = l; });
  var aDetails = det.length || liens.length || sansLien;
  var urgent = item.urgence === "rouge" && !fait;
  var idDet = "pl-det-" + esc(cle).replace(/[^\w-]/g, "_");
  return '<article class="pl-it' + (urgent ? " urg" : "") + (fait ? " fait" : "") + (hors ? " hors" : "") + '" data-cle="' + esc(cle) + '">' +
    '<div class="pl-row">' +
    '<label class="pl-ck" title="' + esc(tr("pl_booked_title")) + '"><input type="checkbox" name="reserve" data-resa="' + esc(cle) + '" data-k="resa-' + esc(cle) + '"' +
    (fait ? " checked" : "") + '><span class="pl-ck-b" aria-hidden="true">' + fin.icone("ok") + '</span><span class="sr">' + esc(tr("pl_booked_aria", { name: item.titre })) + "</span></label>" +
    visuel(item, D) +
    '<div class="pl-txt"><p class="pl-nm"><b>' + esc(item.titre) + "</b>" + (item.sous ? ' <span class="pl-sub">' + esc(item.sous) + "</span>" : "") + "</p>" +
    (ps.length ? '<p class="pl-tags">' + ps.map(function (p, i) {
      return '<span class="pl-tag' + (i > 1 ? " d-only" : "") + '">' + fin.icone(p.icone) + esc(p.texte) + "</span>";
    }).join("") + "</p>" : "") +
    (fait ? '<p class="pl-par">' + fin.icone("ok") + esc(tr("pl_booked")) + "</p>" : "") + "</div>" +
    '<div class="pl-rt"><b class="pl-m' + (m.aVerifier ? " a-verifier" : "") + '">' + esc(m.texte || fin.argentRond(m.valeur)) + "</b>" +
    (item.prixAVerifier && !m.aVerifier ? '<span class="pl-av">' + esc(tr("pl_plus_to_check")) + "</span>" : "") +
    (hors ? '<span class="pl-hb">' + esc(tr("out_of_budget_note")) + "</span>" : "") +
    '<span class="pl-dl ' + e.cls + '">' + (e.cls === "r" ? fin.icone("urgent") : e.cls === "fait" ? fin.icone("ok") : "") + esc(e.texte) + "</span>" +
    (e.jours != null && e.jours > 0 && !fait ? '<span class="pl-dans d-only">' + esc(tr("lg_in_days", { n: e.jours })) + "</span>" : "") + "</div></div>" +
    (aDetails ? '<button type="button" class="pl-plus" data-plus="' + esc(cle) + '" data-k="plus-' + esc(cle) + '" aria-expanded="' + ouvert + '" aria-controls="' + idDet + '">' +
      fin.icone("fleche") + esc(tr(ouvert ? "so_fewer_details" : "so_more_details")) + "</button>" +
      '<div class="pl-det" id="' + idDet + '"' + (ouvert ? "" : " hidden") + ">" +
      det.map(function (d) { return "<p>" + esc(d) + "</p>"; }).join("") +
      (liens.length || sansLien ? '<p class="pl-liens">' + (sansLien ? '<span class="best sans-lien" title="' + esc(tr("fi_link_missing_title")) + '">' +
        esc(fin.courtSite(sansLien.site)) + (prixLien(sansLien) != null ? " " + esc(fin.argentRond(prixLien(sansLien))) : "") + " · " + esc(tr("fi_link_missing")) + "</span>" : "") +
        liens.map(function (l) {
        var p = prixLien(l);
        return '<a class="' + (l === best && liens.length > 1 ? "best" : "") + '" href="' + esc(fin.safeUrl(l.url)) + '" target="_blank" rel="noopener">' +
          esc(fin.courtSite(l.site)) + (p != null ? " " + esc(fin.argentRond(p)) : "") + ' <span aria-hidden="true">↗</span></a>';
      }).join("") + "</p>" : "") + "</div>" : "") +
    "</article>";
}

function htmlListe(titre, icone, cls, liste, D, auj, ouverts, vide) {
  var fin = F(), esc = fin.esc, reste = liste.filter(function (x) { return !estReserve(x.cle); }).length;
  return '<section class="pl-sec ' + cls + '"><h2 class="pl-h">' + fin.icone(icone) + "<span>" + esc(titre) + "</span>" +
    (liste.length ? '<span class="pl-n">' + esc(reste ? tr("pl_n_to_do", { n: reste }) : tr("pl_all_done")) + "</span>" : "") + "</h2>" +
    (liste.length ? liste.map(function (x) { return htmlItem(x, D, auj, ouverts); }).join("") : '<p class="discret">' + esc(vide) + "</p>") + "</section>";
}

/* The legs out of the shared budget, under the three figures: what each adds, its "Add it to see" toggle. */
function htmlHorsBudget(D, choix) {
  var fin = F(), esc = fin.esc, trip = fin.cfg(D);
  var legs = trip.legs.filter(function (l) { return !l.in_budget; });
  if (!legs.length) return "";
  return legs.map(function (leg) {
    var inclus = !!(choix && choix.inclure && choix.inclure[leg.key] === true);
    var a = fin.horsBudgetDuTrajet(choix, D, leg.key);
    var nom = tr("ui_route_who", { who: trip.labelsOf(leg), route: fin.libRoute(trip, leg) });
    var texte = tr(inclus ? "pl_out_counted" : "pl_out_apart", { leg: nom, sum: a ? a.texte : tr("price_to_check") });
    return '<p class="pl-horsb">' + fin.icone("avion") + "<span>" + esc(texte) + "</span>" +
      '<label><input type="checkbox" name="inclure-' + esc(leg.key) + '" data-inclure="' + esc(leg.key) + '" data-k="inclure-' + esc(leg.key) + '"' +
      (inclus ? " checked" : "") + "> " + esc(tr("fl_add_to_see")) + "</label></p>";
  }).join("");
}

function htmlKpis(D, choix, t, rangs) {
  var fin = F(), esc = fin.esc, trip = fin.cfg(D);
  if (!t || !fini(t.total)) return '<div class="attente calme"><p class="attente-t">' + esc(tr("dt_not_ready")) + "</p></div>";
  var plafond = fini(t.plafond) ? t.plafond : trip.budgetCap;
  var sem = rangs ? cetteSemaine(rangs) : null;
  var loc = fin.argentLocal(t.place);
  var marge = fini(t.marge) && fini(plafond)
    ? (t.marge >= 0 ? tr("dt_margin_under", { amount: fin.argentRond(t.marge), cap: fin.argentRond(plafond) }) : fin.margeApres(t.marge, plafond))
    : "";
  return '<div class="pl-kpis">' +
    '<div class="pl-kpi' + (fini(t.marge) && t.marge < 0 ? " trop" : "") + '"><span>' + esc(tr("pl_kpi_budget")) + "</span><b>≈ " + esc(fin.argentRond(t.total)) + "</b>" +
    (marge ? "<small>" + esc(marge) + "</small>" : "") +
    (t.incomplet ? '<em class="tag-incomplet">' + esc(tr("ui_incomplete")) + "</em>" : "") + "</div>" +
    '<div class="pl-kpi a"><span>' + esc(tr("dt_before")) + "</span><b>≈ " + esc(fin.argentRond(t.avant)) + "</b>" +
    (sem != null ? "<small>" + esc(sem > 0 ? tr("pl_of_which_week", { amount: fin.argentRond(sem) }) : tr("pl_nothing_this_week")) + "</small>" : "") + "</div>" +
    '<div class="pl-kpi"><span>' + esc(tr("dt_on_spot")) + "</span><b>≈ " + esc(fin.argentRond(t.place)) + "</b>" + (loc ? "<small>≈ " + esc(loc) + "</small>" : "") + "</div></div>" +
    htmlHorsBudget(D, choix);
}

function htmlArgent(rangs, t) {
  var fin = F(), esc = fin.esc;
  var b = fin.barres(rangs), total = fin.somme(rangs);
  var ecart = t && fini(t.avant) ? Math.round((t.avant - total) * 100) / 100 : 0;
  return '<section class="pl-sec"><h2 class="pl-h">' + fin.icone("carte") + "<span>" + esc(tr("pl_money_title")) + "</span></h2>" +
    (b.length ? '<div class="pl-tl">' + b.map(function (r) {
      return '<div class="pl-tl-r"><b>' + esc(libelleArgent(r)) + '</b><span class="pl-bar-f" aria-hidden="true"><span class="pl-bar" style="width:' + r.pct + '%"></span></span>' +
        "<span>" + esc(fin.argentRond(r.montant)) + "</span></div>";
    }).join("") + '<div class="pl-tl-r tot"><b>' + esc(tr("pl_in_all")) + "</b><span></span><span>" + esc(fin.argentRond(total)) + "</span></div></div>" +
      (Math.abs(ecart) >= 1 ? '<p class="discret pl-ecart">' + esc(ecart > 0
        ? tr("pl_money_rest", { amount: fin.argentRond(ecart) })
        : tr("pl_money_over", { amount: fin.argentRond(-ecart) })) + "</p>" : "")
      : '<p class="discret">' + esc(tr("pl_money_none")) + "</p>") + "</section>";
}

/* "On the spot" by stage: groupes = surPlace(lignes, currency) of plan.js ({etape, montant, local, postes}); the local
   amount is already converted. */
function htmlSurPlace(groupes, D) {
  var fin = F(), esc = fin.esc;
  if (!groupes || !groupes.length) return "";
  var taux = fin.texteTaux ? fin.texteTaux(D) : "";
  return '<section class="pl-sec"><h2 class="pl-h">' + fin.icone("pieces") + "<span>" + esc(tr("dt_on_spot")) + "</span></h2>" +
    (taux ? '<p class="discret pl-taux">' + esc(taux) + "</p>" : "") +
    '<div class="pl-sp">' + groupes.map(function (g) {
      var info = fin.infoEtape(D, g.etape);
      var loc = fini(g.local) ? I18().fmtMoney(g.local, "local", { converted: true }) : "";
      return '<div class="pl-sp-e ton-' + esc(fin.tonCss(info.ton)) + '"><p class="pl-sp-t"><i aria-hidden="true"></i><b>' + esc(info.nom) + "</b>" +
        "<span>" + esc(fin.argentRond(g.montant)) + (loc ? " <small>(≈ " + esc(loc) + ")</small>" : "") + "</span></p>" +
        '<p class="pl-sp-p">' + (g.postes || []).filter(function (p) { return fini(p.montant) && Math.round(p.montant) !== 0; }).map(function (p) {
          return "<span>" + esc(fin.libPoste(p.poste)) + " " + esc(fin.argentRond(p.montant)) + "</span>";
        }).join("") + "</p></div>";
    }).join("") + "</div></section>";
}

function htmlPlan(D, choix, ouverts) {
  var fin = F(), P = (typeof window !== "undefined" && window.Parcours) || {};
  var trip = fin.cfg(D);
  var t = P.totaux, lignes = P.lignes;
  if (!t && typeof lignesVoyage === "function" && typeof totaux === "function") {
    lignes = lignesVoyage(choix, D);
    t = totaux(lignes, trip.budgetCap);
  }
  var auj = fin.aujourdhui();
  var items = null, rangs = null, h = "";
  if (typeof planItems === "function") {
    try { items = planItems(choix, D, auj) || []; } catch (e) { items = null; if (typeof console !== "undefined") console.error("[plan] planItems", e); }
  }
  if (items && typeof argentPart === "function") {
    try { rangs = argentPart(items, auj) || []; } catch (e) { rangs = null; if (typeof console !== "undefined") console.error("[plan] argentPart", e); }
  }
  h += htmlKpis(D, choix, t, rangs);
  if (items) {
    var sec = null;
    if (typeof sections === "function") { try { sec = sections(items); } catch (e) { sec = null; } }
    var r = repartir(items, sec, estReserve);
    h += htmlListe(tr("pl_now_title"), "urgent", "maintenant", r.maintenant, D, auj, ouverts, tr("pl_now_empty"));
    h += htmlListe(tr("pl_wait_title"), "calendrier", "attendre", r.attendre, D, auj, ouverts, tr("pl_wait_empty"));
    if (r.demarches.length) h += htmlListe(tr("pl_formalities_title"), "document", "demarches", r.demarches, D, auj, ouverts, "");
  } else {
    h += '<div class="attente calme pl-attente"><p class="attente-t">' + fin.esc(tr("pl_not_ready")) + "</p><p>" + fin.esc(tr("pl_not_ready_how")) + "</p></div>";
  }
  if (rangs) h += htmlArgent(rangs, t);
  var groupes = null;
  if (lignes && typeof surPlace === "function") { try { groupes = surPlace(lignes, trip.currency); } catch (e) { groupes = null; } }
  if (groupes) h += htmlSurPlace(groupes, D);
  return h;
}

function ecranPlan(racine, D, choix) {
  var boite = document.createElement("div");
  boite.className = "pl";
  racine.appendChild(boite);
  var ouverts = {};
  boite.addEventListener("change", function (ev) {
    var x = ev.target;
    if (!x || !x.getAttribute) return;
    var resa = x.getAttribute("data-resa"), leg = x.getAttribute("data-inclure");
    if (resa && window.Store && Store.marquerResa) Store.marquerResa(resa, !!x.checked);
    else if (leg && typeof patchChoix === "function") { var o = {}; o[leg] = !!x.checked; patchChoix("inclure", o); }
  });
  boite.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-plus]");
    if (!b) return;
    var cle = b.getAttribute("data-plus"), ouvert = !ouverts[cle];
    ouverts[cle] = ouvert;
    var art = b.closest(".pl-it"), det = art && art.querySelector(".pl-det");
    if (det) det.hidden = !ouvert;
    b.setAttribute("aria-expanded", String(ouvert));
    b.lastChild.nodeValue = tr(ouvert ? "so_fewer_details" : "so_more_details");
  });
  function rendre(c) {
    if (!F()) { boite.innerHTML = '<div class="attente calme"><p class="attente-t"></p></div>'; boite.querySelector(".attente-t").textContent = tr("pl_not_ready"); return; }
    F().redessiner(boite, htmlPlan(D, c, ouverts));
  }
  rendre(choix);
  return { maj: rendre, quitter: function () { if (F() && F().oublierImages) F().oublierImages(boite); } };
}

var api = { repartir: repartir, echeance: echeance, puces: puces, texteMontant: texteMontant, cetteSemaine: cetteSemaine, libelleArgent: libelleArgent,
  estHors: estHors, htmlItem: htmlItem, htmlSurPlace: htmlSurPlace };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") {
  var ECRANS = window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
  ECRANS["plan"] = ecranPlan;
}
})();
