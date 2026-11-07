/* Compare 2 or 3 lodgings of a stage, side by side: room price, spending, stay budget, effect on the total, view,
   reviews, cancellation, access, quality, gala dinner, in short.
   One column per lodging; on a phone the table scrolls horizontally inside its frame (the page itself never scrolls
   horizontally). Opened in the shell's panel.
   Global: comparer(ids: string[2..3], {etape?}). Shared helpers: window.LogementsUI (logement.js). Texts through T(). */

(function () {
"use strict";
if (typeof window === "undefined") return;
var LUI = window.LogementsUI = window.LogementsUI || {};

function num(x) { return typeof x === "number" && isFinite(x); }
function esc(s) { return UI.esc(s); }
function tr(cle, vars) { return T(cle, vars); }
function A() { return LUI.aide; }
function nloc(x) { return A().nloc(x); }
function vide() { return '<span class="lg-c-vide">' + esc(tr("cp_to_check")) + "</span>"; }
function clamp(t) { return t ? '<span class="lg-c-long">' + esc(t) + "</span>" : vide(); }

/* The rows of the table: [title key, function(t, b, ctx) → HTML]. t = {l, etape, complet}, b = stay budget. */
var LIGNES = [
  ["cp_room", function (t, b) {
    var p = t.l.prix || {};
    return num(b.chambre) ? "<b>" + esc(UI.argent(b.chambre)) + "</b><small>" + esc(tr("lg_nights", { n: LUI.nuits(t.etape) })) +
      (num(p.nuit_home) ? " · " + esc(tr("cp_per_night", { price: UI.argent(p.nuit_home) })) : "") + (p.plateforme ? " · " + esc(p.plateforme) : "") + "</small>" : vide();
  }],
  ["cp_spending", function (t, b) {
    if (b.extras == null) return '<em class="tag-incomplet">' + esc(tr("lg_budget_incomplete")) + "</em>";
    return "<b>+ " + esc(UI.argent(b.extras)) + "</b><small>" + esc(LUI.textePostes(b)) + "</small>";
  }],
  ["cp_stay", function (t, b, ctx) {
    if (!num(b.total)) return vide();
    return '<b class="lg-c-gros">' + esc(UI.argent(b.total)) + "</b>" + (b.incomplet ? ' <em class="tag-incomplet">' + esc(tr("ui_incomplete")) + "</em>" : "") +
      (ctx.moinsCher === t.l.id ? '<span class="lg-c-mieux">' + esc(tr("cp_cheapest")) + "</span>" : "");
  }],
  ["cp_effect", function (t) {
    var h = LUI.htmlEcart(t.etape, t.l.id);
    return h || '<span class="lg-c-vide">' + esc(tr("cp_effect_unavailable")) + "</span>";
  }],
  ["cp_view", function (t) { return clamp(t.l.pour_decider && t.l.pour_decider.vue); }],
  ["cp_reviews", function (t) {
    var srcs = t.complet ? (t.l.avis && t.l.avis.sources || []) : num(t.l.note) ? [{ site: (t.l.prix && t.l.prix.plateforme) || tr("lg_rating"), note: t.l.note }] : [];
    var h = srcs.filter(function (s) { return A().noteAvis(s); }).slice(0, 4).map(function (s) {
      return "<span>" + esc(s.site) + " <b>" + esc(A().noteAvis(s)) + "</b>" + (s.nb ? " · " + esc(s.nb) : "") + "</span>";
    });
    return h.length ? '<span class="lg-c-avis">' + h.join("") + "</span>" : vide();
  }],
  ["cp_cancellation", function (t) {
    var a = A().annulation(t.l.prix, A().isoLocal());
    return '<span class="lg-c-an lg-an-' + a.ton + '">' + esc(a.court) + "</span>" + (a.texte && a.texte !== a.court ? "<small>" + esc(LUI.court(a.texte, 90)) + "</small>" : "");
  }],
  ["cp_access", function (t) {
    var x = A().texteAcces(t.l.acces, typeof TRIP !== "undefined" ? TRIP : null);
    return x ? esc(x) : vide();
  }],
  ["cp_quality", function (t, b, ctx) {
    var pd = t.l.pour_decider || {};
    if (!num(t.l.note_qualite)) return vide();
    return "<b>" + esc(nloc(t.l.note_qualite)) + "</b>/10" + (num(pd.note_qualite_prix) ? "<small>" + esc(tr("fi_value_rating")) + " " + esc(nloc(pd.note_qualite_prix)) + "/10</small>" : "") +
      (ctx.meilleur === t.l.id ? '<span class="lg-c-mieux">' + esc(tr("cp_best_rated")) + "</span>" : "");
  }],
  ["cp_gala", function (t) {
    var g = A().gala(t.l);
    if (!g) return vide();
    if (g.impose) {
      return '<b class="warn">' + esc(num(g.montant) ? tr("cp_gala_imposed_price", { price: UI.argent(g.montant) }) : tr("cp_gala_imposed")) + "</b><small>" +
        esc(tr("cp_gala_counted")) + "</small>";
    }
    return clamp(g.texte);
  }],
  ["cp_in_short", function (t) { return clamp(t.l.pour_decider && t.l.pour_decider.verdict); }],
];

function rendre(panneau, ids, opts) {
  /* A new box at each opening: the panel's body is shared with the fiches. */
  var boite = document.createElement("div");
  boite.className = "lg-c-boite";
  panneau.appendChild(boite);
  var ts = ids.map(function (id) { return LUI.trouver(id, opts.etape) || LUI.trouver(id); }).filter(Boolean);
  if (ts.length < 2) {
    boite.innerHTML = '<div class="attente calme"><p class="attente-t">' + esc(tr("cp_tick_two")) + "</p></div>";
    return {};
  }
  function dessiner() {
    var bs = ts.map(function (t) { return LUI.budget(t.l, t.etape); });
    /* "the cheapest" and "the best rated": only when there is a single winner. */
    var seul = function (val, mieux) {
      var v = ts.map(val), ok = v.filter(num);
      if (ok.length < 2) return null;
      var best = mieux(ok), qui = ts.filter(function (t, i) { return v[i] === best; });
      return qui.length === 1 ? qui[0].l.id : null;
    };
    var ctx = {
      moinsCher: seul(function (t, i) { return !bs[i].incomplet && num(bs[i].total) ? Math.round(bs[i].total) : null; }, function (a) { return Math.min.apply(null, a); }),
      meilleur: seul(function (t) { return num(t.l.note_qualite) ? t.l.note_qualite : null; }, function (a) { return Math.max.apply(null, a); }),
    };
    var tete = ts.map(function (t) {
      var l = t.l, choisi = LUI.estChoisi(t.etape, l.id);
      return '<th scope="col" class="lg-c-col' + (choisi ? " choisi" : "") + '">' +
        '<button type="button" class="lg-c-photo" data-act="fiche" data-id="' + esc(l.id) + '" aria-label="' + esc(tr("cp_fiche_aria", { name: l.nom })) + '">' +
          '<img alt="" loading="lazy" decoding="async" width="760" height="507" data-ph="' + esc(l.slug) + ':0"></button>' +
        '<span class="lg-c-nom">' + esc(l.nom) + "</span>" +
        '<span class="lg-c-act">' +
          '<button type="button" class="btn small' + (choisi ? " lg-est-choisi" : " primary") + '" data-act="choisir" data-id="' + esc(l.id) + '"' + (choisi ? ' aria-pressed="true"' : "") + ">" +
            (choisi ? LUI.icone("check") + esc(tr("lg_chosen")) : esc(tr("lg_choose"))) + "</button>" +
          '<button type="button" class="btn small" data-act="fiche" data-id="' + esc(l.id) + '">' + esc(tr("lg_fiche")) + "</button>" +
        "</span></th>";
    }).join("");
    var corpsT = LIGNES.map(function (r) {
      return '<tr><th scope="row">' + esc(tr(r[0])) + "</th>" + ts.map(function (t, i) { return "<td" + (LUI.estChoisi(t.etape, t.l.id) ? ' class="choisi"' : "") + ">" + r[1](t, bs[i], ctx) + "</td>"; }).join("") + "</tr>";
    }).join("");
    boite.innerHTML = '<div class="lg-comparaison">' +
      '<p class="discret lg-c-note">' + esc(tr("cp_note", { people: LUI.pourTous() })) + "</p>" +
      '<div class="lg-c-defile" role="region" aria-label="' + esc(tr("cp_table_aria")) + '" tabindex="0">' +
      '<table class="lg-c-t n' + ts.length + '"><thead><tr><td class="lg-c-coin"></td>' + tete + "</tr></thead><tbody>" + corpsT + "</tbody></table></div></div>";
    UI.$$("img[data-ph]", boite).forEach(function (img) {
      var x = img.dataset.ph.split(":");
      LUI.poserPhoto(img, x.slice(0, -1).join(":"), 0, "s");
    });
  }
  var defile = 0;
  function maj() {
    var d = UI.$(".lg-c-defile", boite);
    defile = d ? d.scrollLeft : 0;
    dessiner();
    var d2 = UI.$(".lg-c-defile", boite);
    if (d2) d2.scrollLeft = defile;
  }
  boite.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (!b || !boite.contains(b)) return;
    var t = ts.filter(function (x) { return x.l.id === b.dataset.id; })[0];
    if (!t) return;
    if (b.dataset.act === "choisir") LUI.choisir(t.etape, t.l.id);
    else if (b.dataset.act === "fiche" && typeof window.ouvrirFiche === "function") {
      window.ouvrirFiche(t.l.id, { etape: t.etape, retour: { lib: tr("cp_back"), fn: function () { comparer(ids, opts); } } });
    }
  });
  dessiner();
  return { maj: maj };
}

function comparer(ids, opts) {
  opts = opts || {};
  ids = (ids || []).filter(function (x, i, a) { return typeof x === "string" && a.indexOf(x) === i; }).slice(0, 3);
  if (window.Parcours && Parcours.D) LUI.indexer(Parcours.D);
  var corps = UI.ouvrirPanneau(tr("cp_title", { n: ids.length }), function (corps) { return rendre(corps, ids, opts); });
  if (corps) corps.scrollTop = 0;   // the panel was hidden when the shell reset its scroll
}
window.comparer = comparer;
})();
