/* A lodging's fiche, opened full screen (the shell's panel).
   All the photos (mosaic, then a full-screen viewer: a grid of all the photos small, photo by photo large with arrows,
   swipe and keyboard; each large photo loads when it is opened, with its two neighbours), the rating of each site and
   ours, the links (official site, each platform with its price and its conditions, Google Maps), a row of videos (hidden
   without any), then folded sections: "To decide" (open), "Price, payment and cancellation", "What is included",
   "To pay on the spot, price by price" (n × u, "published price" / "estimated"), "Services and restaurants", "Reviews".
   Global: ouvrirFiche(id, {etape?, photos?, retour?: {lib, fn}}). Shared helpers: window.LogementsUI (logement.js).
   Texts through T(), money through UI.argent / UI.local (shell.js). */

(function () {
"use strict";
if (typeof window === "undefined") return;
var LUI = window.LogementsUI = window.LogementsUI || {};

function num(x) { return typeof x === "number" && isFinite(x); }
function A() { return LUI.aide; }
function ic(n) { return LUI.icone(n); }
function esc(s) { return UI.esc(s); }
function tr(cle, vars) { return T(cle, vars); }
function liste(a) { return Array.isArray(a) ? a.filter(function (x) { return x != null && x !== ""; }) : []; }
function nloc(x) { return A().nloc(x); }

/* A row "icon · bold title · text"; a long text stays folded on 3 lines, "Read more" opens it.
   corps: HTML already escaped; brut: the text, to measure its length. */
var LONG = 200;
function rang(icone, ton, titre, corps, brut) {
  var long = String(brut == null ? "" : brut).length > LONG;
  return '<div class="lg-rang' + (ton ? " " + ton : "") + '">' + ic(icone) + '<div class="lg-rang-c"><p class="lg-p' + (long ? " lg-long" : "") + '"><b>' +
    esc(titre) + "</b> " + corps + "</p>" + (long ? '<button type="button" class="lg-suite" data-act="suite">' + esc(tr("fi_read_more")) + "</button>" : "") + "</div></div>";
}
function section(titre, resume, corps, ouverte) {
  return '<details class="lg-sec"' + (ouverte ? " open" : "") + "><summary><span class=\"lg-sec-t\">" + esc(titre) + "</span>" +
    (resume ? '<span class="lg-sec-r">' + esc(resume) + "</span>" : "") + ic("droite") + "</summary>" +
    '<div class="lg-sec-c">' + corps + "</div></details>";
}
function puces(items) {
  items = liste(items);
  return items.length ? '<ul class="lg-liste">' + items.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "";
}
function verifie(d) {
  return d ? '<p class="lg-verifie">' + esc(tr("fi_checked_on", { date: UI.date(String(d).slice(0, 10)) + " " + String(d).slice(0, 4) })) + "</p>" : "";
}

/* ---------- A budget line: "6 lunches × $35" … $210 ---------- */
function htmlLigne(l) {
  var t = A().texteLigne(l), q = l.quand === "avant" ? tr("fi_before_leaving") : l.quand === "place" ? tr("fi_on_the_spot") : "";
  var src = t.aVerifier ? '<span class="lg-src verif">' + esc(t.source) + "</span>"
    : '<span class="lg-src' + (t.estime ? " est" : t.inclus ? " inc" : "") + '">' + esc(t.source) + "</span>";
  var gauche = t.inclus ? esc(t.lib) : esc(t.lib) + (num(t.u) ? " × " + esc(UI.argent(t.u)) : "");
  var droite = t.inclus ? esc(tr("lg_src_included")) : t.montant == null ? "—" : esc(UI.argent(t.montant));
  return '<div class="lg-ln"><span class="lg-ln-g">' + gauche + " " + src + (l.note ? '<small class="lg-ln-n">' + esc(l.note) + "</small>" : "") +
    '</span><span class="lg-ln-d"><b>' + droite + "</b>" + (q && !t.inclus ? '<small class="lg-quand">' + esc(q) + "</small>" : "") + "</span></div>";
}
function htmlTotal(lib, v, local) {
  var loc = local ? UI.local(v) : "";
  return '<div class="lg-ln lg-ln-tot"><span class="lg-ln-g">' + esc(lib) + '</span><span class="lg-ln-d"><b>' + esc(UI.argent(v)) + "</b>" +
    (loc ? "<small>≈ " + esc(loc) + "</small>" : "") + "</span></div>";
}

/* ---------- Gallery: mosaic (the 1st photo, the view when the gallery says so, + 4), then the viewer ---------- */
/* Displayed width of the large tile (attribute sizes): .lg-gal in 2fr 1fr 1fr, 2fr 1fr or a single column, fiche ≤ 820 px. */
function taillesGrande(n) {
  return n <= 1 ? "(min-width: 860px) 820px, 100vw" : n <= 3 ? "(min-width: 860px) 550px, 67vw" : "(min-width: 860px) 410px, 50vw";
}
function htmlMosaique(l) {
  var n = LUI.nbPhotos(l.slug), h = [];
  var tuile = function (i, cls, extra) {
    return '<button type="button" class="lg-gal-t ' + cls + '" data-act="photo" data-i="' + i + '" aria-label="' + esc(tr("fi_photo_of", { i: i + 1, n: n })) + '">' +
      '<img alt="" loading="lazy" decoding="async" data-ph="' + esc(l.slug) + ":" + i + '">' + (extra || "") + "</button>";
  };
  h.push(tuile(0, "lg-gal-grand"));
  for (var i = 1; i < Math.min(n, 5); i++) {
    h.push(i === 4 || (i === n - 1 && n > 2)
      ? tuile(i, "lg-gal-der", '<span class="lg-gal-plus" data-act="grille">' + ic("grille") + esc(tr("fi_all_photos", { n: n })) + "</span>")
      : tuile(i, ""));
  }
  return '<div class="lg-gal n' + Math.min(n, 5) + '">' + h.join("") + "</div>";
}

/* The viewer: a separate <dialog>, opened above the panel (stack of modal dialogs). */
var V = null;
function visio() {
  if (V) return V;
  var d = document.createElement("dialog");
  d.className = "lg-visio";
  d.setAttribute("aria-label", tr("fi_photos"));
  d.innerHTML =
    '<div class="lg-v-tete"><p class="lg-v-titre"></p><span class="lg-v-n" aria-live="polite"></span>' +
    '<button type="button" class="lg-v-b lg-v-mode" data-v="grille" aria-label="' + esc(tr("fi_grid_aria")) + '">' + ic("grille") + "</button>" +
    '<button type="button" class="lg-v-b" data-v="fermer" aria-label="' + esc(tr("fi_close_photos")) + '">' + ic("croix") + "</button></div>" +
    '<div class="lg-v-scene"><button type="button" class="lg-v-nav prec" data-v="prec" aria-label="' + esc(tr("fi_prev_photo")) + '">' + ic("gauche") + "</button>" +
    '<img class="lg-v-img" alt="">' +
    '<button type="button" class="lg-v-nav suiv" data-v="suiv" aria-label="' + esc(tr("fi_next_photo")) + '">' + ic("droite") + "</button></div>" +
    '<div class="lg-v-grille" tabindex="-1"></div>';
  document.body.appendChild(d);
  V = { d: d, img: d.querySelector(".lg-v-img"), grille: d.querySelector(".lg-v-grille"), scene: d.querySelector(".lg-v-scene"),
    n: 0, i: 0, slug: "", mode: "photo", depuisGrille: false, jeton: 0, obs: null, retour: null };
  d.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-v]");
    if (!b) return;
    var v = b.dataset.v;
    if (v === "fermer") fermerVisio();
    else if (v === "prec") montrer(V.i - 1);
    else if (v === "suiv") montrer(V.i + 1);
    else if (v === "grille") modeGrille();
    else if (v === "tuile") { V.depuisGrille = true; modePhoto(+b.dataset.i); }
  });
  d.addEventListener("cancel", function (ev) {
    ev.preventDefault();
    if (V.mode === "photo" && V.depuisGrille) modeGrille(); else fermerVisio();
  });
  d.addEventListener("keydown", function (ev) {
    if (V.mode !== "photo") return;
    if (ev.key === "ArrowRight") { ev.preventDefault(); montrer(V.i + 1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); montrer(V.i - 1); }
  });
  var x0 = null, y0 = null;
  V.scene.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  V.scene.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) montrer(V.i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  return V;
}
function ouvrirVisio(l, i, mode) {
  var v = visio();
  v.slug = l.slug;
  v.n = LUI.nbPhotos(l.slug);
  if (!v.n) return;
  v.retour = document.activeElement;
  v.d.querySelector(".lg-v-titre").textContent = l.nom || "";
  v.d.setAttribute("aria-label", tr("fi_photos_of", { name: l.nom || "" }));
  construireGrille();
  if (!v.d.open) { if (typeof v.d.showModal === "function") v.d.showModal(); else v.d.setAttribute("open", ""); }
  v.depuisGrille = false;
  if (mode === "grille") modeGrille(); else modePhoto(i || 0);
}
function fermerVisio() {
  if (!V) return;
  if (V.obs) { V.obs.disconnect(); V.obs = null; }
  V.jeton++;
  if (V.d.open) { if (typeof V.d.close === "function") V.d.close(); else V.d.removeAttribute("open"); }
  if (V.retour && typeof V.retour.focus === "function") { try { V.retour.focus({ preventScroll: true }); } catch (e) {} }
}
function construireGrille() {
  var g = V.grille, h = [];
  for (var i = 0; i < V.n; i++) {
    h.push('<button type="button" class="lg-v-tuile" data-v="tuile" data-i="' + i + '" aria-label="' + esc(tr("fi_photo_n", { i: i + 1 })) + '">' +
      '<img alt="" loading="lazy" decoding="async" data-ph="' + esc(V.slug) + ":" + i + '"></button>');
  }
  g.innerHTML = '<div class="lg-v-tuiles">' + h.join("") + "</div>";
  if (V.obs) V.obs.disconnect();
  V.obs = null;
  /* The small photos (600 px) of the tiles coming close to the screen, while scrolling. */
  var poser = function (img) {
    if (img.dataset.pose) return;
    img.dataset.pose = "1";
    var p = img.dataset.ph.split(":");
    LUI.poserPhoto(img, V.slug, +p[p.length - 1], "s");
  };
  if (typeof IntersectionObserver === "function") {
    V.obs = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { poser(e.target); V.obs.unobserve(e.target); } });
    }, { root: g, rootMargin: "400px 0px" });
    UI.$$("img", g).forEach(function (img) { V.obs.observe(img); });
  } else UI.$$("img", g).forEach(poser);
}
function modeGrille() {
  V.mode = "grille";
  V.d.classList.add("en-grille");
  V.scene.hidden = true;
  V.grille.hidden = false;
  V.d.querySelector(".lg-v-mode").hidden = true;
  V.d.querySelector(".lg-v-n").textContent = tr("fi_n_photos", { n: V.n });
  var t = V.grille.querySelector('[data-i="' + V.i + '"]');
  if (t) { try { t.scrollIntoView({ block: "center" }); t.focus({ preventScroll: true }); } catch (e) {} }
  else { try { V.grille.focus(); } catch (e) {} }
}
function modePhoto(i) {
  V.mode = "photo";
  V.d.classList.remove("en-grille");
  V.grille.hidden = true;
  V.scene.hidden = false;
  V.d.querySelector(".lg-v-mode").hidden = false;
  montrer(i);
  try { V.d.querySelector(".lg-v-nav.suiv").focus({ preventScroll: true }); } catch (e) {}
}
/* Photo i large (1,600 px), decoded before it is shown; its two neighbours load ahead, nothing else.
   Meanwhile: the small one already in cache (blurred a moment) rather than an empty screen. */
function montrer(i) {
  var n = V.n;
  if (!n) return;
  i = ((i % n) + n) % n;
  V.i = i;
  var jeton = ++V.jeton, slug = V.slug;
  V.d.querySelector(".lg-v-n").textContent = (i + 1) + " / " + n;
  var prete = LUI.photoPrete(slug, i, "l");
  V.scene.classList.toggle("charge", !prete);
  if (!prete) LUI.photoLogement(slug, i, "s").then(function (u) { if (jeton === V.jeton && !LUI.photoPrete(slug, i, "l")) V.img.src = u; }, function () {});
  LUI.chargerPhoto(slug, i, "l").then(function (url) {
    if (jeton !== V.jeton) return;
    V.img.src = url;
    V.scene.classList.remove("charge");
  }, function () { if (jeton === V.jeton) { V.scene.classList.remove("charge"); V.img.removeAttribute("src"); } });
  [i + 1, i - 1].forEach(function (j) { LUI.chargerPhoto(slug, ((j % n) + n) % n, "l").catch(function () {}); });
}
LUI.ouvrirVisio = ouvrirVisio;

/* ---------- Videos: logement.videos; the tile is shared with the outings (LogementsUI.aide.htmlVideos, logement.js),
   the thumbnails load when they are shown (LogementsUI.poserVignettes) ---------- */
function htmlVideos(l) { return A().htmlVideos(l.videos); }

/* ---------- The blocks of the fiche ---------- */
function htmlNotes(l, complet) {
  var h = [];
  if (complet) {
    liste(l.avis && l.avis.sources).forEach(function (s) {
      var n = A().noteAvis(s);
      if (n) h.push("<span>" + esc(s.site) + " <b>" + esc(n) + "</b>" + (s.nb ? " · " + esc(tr("lg_reviews", { n: s.nb })) : "") + "</span>");
    });
  } else if (num(l.note)) h.push("<span>" + esc((l.prix && l.prix.plateforme) || tr("lg_rating")) + " <b>" + esc(A().noteAvis({ note: l.note })) + "</b></span>");
  var pd = l.pour_decider || {};
  if (num(l.note_qualite)) {
    h.push('<span class="lg-nous">' + esc(tr("fi_our_rating")) + " <b>" + esc(nloc(l.note_qualite)) + "</b>/10" +
      (num(pd.note_qualite_prix) ? " · " + esc(tr("fi_value_rating")) + " <b>" + esc(nloc(pd.note_qualite_prix)) + "</b>/10" : "") + "</span>");
  }
  return h.length ? '<div class="lg-notes">' + h.join("") + "</div>" : "";
}
/* The links: the retained price = the link marked `retenu` (the platform of the budget's price). Without an address
   for that site (url null), it stays shown, without a link, with "link to find": the label never moves to another
   site. Data without `retenu` ("other" lodging): the 1st priced link with an address. */
function htmlLiens(l) {
  var tous = liste(l.liens), parChamp = tous.some(function (x) { return x && x.retenu === true; }), fait = false;
  var h = tous.map(function (x) {
    var u = UI.safeUrl(x.url), prix = num(x.prix_home);
    var best = parChamp ? x.retenu === true && !fait : prix && !!u && !fait;
    if (best) fait = true;
    if (!u && !best) return "";
    var lib = x.site === "Google Maps" ? ic("epingle") + "Google Maps" : esc(x.site);
    var tete = '<span class="lg-lien-t">' + lib + (prix ? " <b>" + esc(UI.argent(x.prix_home)) + "</b>" : "") + (u ? ic("externe") : "") + "</span>";
    var cond = x.conditions ? LUI.court(x.conditions, 70) : "";
    if (!u) {
      return '<span class="lg-lien retenu sans-lien" title="' + esc(tr("fi_link_missing_title")) + '">' + tete +
        '<small class="lg-lien-c">' + esc(tr("fi_link_missing") + (cond ? " · " + cond : "")) + "</small></span>";
    }
    return '<a class="lg-lien' + (best ? " retenu" : "") + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + tete +
      (cond ? '<small class="lg-lien-c">' + esc(cond) + "</small>" : best ? '<small class="lg-lien-c">' + esc(tr("fi_price_retained")) + "</small>" : "") + "</a>";
  }).join("");
  return h ? '<div class="lg-liens">' + h + "</div>" : "";
}
function htmlPourDecider(l, complet) {
  var pd = l.pour_decider || {}, h = [], g = A().gala(l);
  if (!complet) {
    h.push('<p class="lg-pd-lead">' + esc(l.ligne || "") + "</p>");
    h.push(rang("alerte", "warn", tr("fi_incomplete"), esc(tr("fi_incomplete_text"))));
    return h.join("");
  }
  if (pd.verdict) h.push('<p class="lg-pd-lead">' + esc(pd.verdict) + "</p>");
  if (pd.vue) h.push(rang("oeil", "", tr("fi_view"), esc(pd.vue), pd.vue));
  if (pd.chambre) h.push(rang("lit", "", tr("fi_room"), esc(pd.chambre), pd.chambre));
  if (pd.public) h.push(rang("calme", "", tr("fi_quiet"), esc(pd.public), pd.public));
  var acc = A().texteAcces(l.acces, typeof TRIP !== "undefined" ? TRIP : null);
  if (acc || pd.acces) h.push(rang("epingle", "", tr("fi_access"), (acc ? '<span class="lg-t-fort">' + esc(acc) + ".</span> " : "") + esc(pd.acces || ""), acc + " " + (pd.acces || "")));
  if (liste(pd.points_forts).length) h.push(rang("check", "good", tr("fi_likes"), esc(liste(pd.points_forts).join(" ; ")), liste(pd.points_forts).join(" ; ")));
  var gache = liste(pd.vigilance);
  if (gache.length) h.push(rang("alerte", "warn", tr("fi_spoils"), esc(gache.join(" ; ")), gache.join(" ; ")));
  if (g) {
    if (g.impose) {
      h.push(rang("verre", "warn", num(g.montant) ? tr("fi_gala_imposed_price", { price: UI.argent(g.montant) }) : tr("fi_gala_imposed_unknown"), esc(g.texte), g.texte));
    } else h.push(rang("verre", g.ton, tr("fi_gala"), esc(g.texte), g.texte));
  }
  liste(pd.offres).forEach(function (o) {
    var j = o.avant ? A().joursEntre(A().isoLocal(), o.avant) : null;
    var titre = !o.avant ? tr("fi_offer") : j < 0 ? tr("fi_offer_ended", { date: UI.date(o.avant) }) : tr("fi_offer_before", { date: UI.date(o.avant) });
    h.push(rang("offre", j != null && j >= 0 && j <= 14 ? "urgent" : "", titre, esc(o.texte), o.texte));
  });
  if (l.prix && l.prix.dispo) h.push(rang("calendrier", "", tr("fi_availability"), esc(l.prix.dispo), l.prix.dispo));
  if (pd.pourquoi) h.push('<div class="d-only">' + rang("etoile", "", tr("fi_why"), esc(pd.pourquoi), pd.pourquoi) + "</div>");
  return h.join("");
}
function htmlPrix(l, complet, b, etape) {
  var p = l.prix || {}, h = [], an = A().annulation(p, A().isoLocal());
  var nuits = LUI.nuits(etape);
  if (num(b.chambre)) {
    var phrase = tr("fi_room_price_text", { price: UI.argent(b.chambre), n: nuits }) +
      (num(p.nuit_home) ? " " + tr("fi_per_night", { price: UI.argent(p.nuit_home) }) : "") + (p.plateforme ? " " + tr("fi_on_site", { site: p.plateforme }) : "");
    h.push(rang("argent", "", tr("fi_room_price"), esc(phrase) + (p.detail ? '. <span class="discret">' + esc(p.detail) + "</span>" : ".")));
  } else h.push(rang("argent", "warn", tr("fi_room_price"), esc(tr("fi_to_check")) + "."));
  h.push(rang("calendrier", an.ton === "bon" ? "good" : an.ton === "inconnu" ? "" : "warn", an.texte && an.texte !== an.court ? tr("label_colon", { label: an.court }) : an.court + ".",
    an.texte && an.texte !== an.court ? esc(an.texte) + "." : ""));
  if (p.paiement || p.prelevement_date) {
    h.push(rang("argent", "", tr("fi_payment"), esc(p.paiement || "") +
      (p.prelevement_date ? (p.paiement ? " · " : "") + esc(tr("fi_charged_on", { date: UI.dateLongue(p.prelevement_date) })) : "") + "."));
  }
  var autres = liste(p.autres);
  if (autres.length) {
    h.push('<p class="lg-f-h">' + esc(tr("fi_other_offers")) + '</p><div class="lg-offres">' + autres.map(function (o) {
      return '<div class="lg-ln"><span class="lg-ln-g">' + esc(o.site) + (o.annulation ? ' <small class="lg-ln-n">' + esc(o.annulation) + "</small>" : "") +
        (o.detail ? '<small class="lg-ln-n">' + esc(o.detail) + "</small>" : "") + '</span><span class="lg-ln-d"><b>' +
        (num(o.total_home) ? esc(UI.argent(o.total_home)) : "—") + "</b></span></div>";
    }).join("") + "</div>");
  }
  if (complet) {
    var avant = liste(l.lignes).filter(function (x) { return x.quand === "avant"; });
    if (avant.length) h.push('<p class="lg-f-h">' + esc(tr("fi_pay_before")) + "</p>" + avant.map(htmlLigne).join("") + htmlTotal(tr("fi_before_total"), b.avant));
  }
  h.push(verifie(p.verifie));
  return h.join("");
}
function htmlInclus(l) {
  var inc = liste(l.inclus).slice();
  liste(l.lignes).forEach(function (x) { if (x.src === "inclus" && x.lib && inc.indexOf(x.lib) < 0) inc.push(x.lib); });
  return inc.length ? puces(inc) : '<p class="discret">' + esc(tr("fi_nothing_noted")) + "</p>";
}
function htmlSurPlace(l, b) {
  var place = liste(l.lignes).filter(function (x) { return x.quand === "place"; });
  var h = place.map(htmlLigne);
  if (place.length) h.push(htmlTotal(tr("fi_spot_total"), b.place, true));
  else h.push('<p class="discret">' + esc(tr("fi_spot_none")) + "</p>");
  var opts = liste(l.prestations && l.prestations.non_inclus);
  if (opts.length) {
    h.push('<p class="lg-f-h">' + esc(tr("fi_optional")) + "</p>" + opts.map(function (o) {
      return '<div class="lg-ln lg-ln-opt"><span class="lg-ln-g">' + esc(o.service) + (o.source ? '<small class="lg-ln-n">' + esc(LUI.court(o.source, 160)) + "</small>" : "") +
        '</span><span class="lg-ln-d">' + (num(o.prix_home) ? "<b>" + esc(UI.argent(o.prix_home)) + "</b>" : "<small>" + esc(tr("fi_price_not_found")) + "</small>") + "</span></div>";
    }).join(""));
  }
  return h.join("");
}
function htmlPrestations(l) {
  var p = l.prestations || {}, h = [];
  if (liste(p.equipements).length) h.push('<p class="lg-f-h">' + esc(tr("fi_on_site_amenities")) + "</p>" + puces(p.equipements));
  if (liste(p.restaurants).length) h.push('<p class="lg-f-h">' + esc(tr("fi_restaurants")) + "</p>" + puces(p.restaurants));
  var f = liste(p.formules);
  if (f.length) {
    h.push('<p class="lg-f-h">' + esc(tr("fi_meal_plans")) + "</p>" + f.map(function (x) {
      return '<div class="lg-ln"><span class="lg-ln-g">' + esc(x.nom) + (x.detail ? '<small class="lg-ln-n">' + esc(x.detail) + "</small>" : "") +
        '</span><span class="lg-ln-d"><b>' + (num(x.total_home) ? esc(UI.argent(x.total_home)) : "—") + "</b>" +
        (num(x.total_home) ? "<small>" + esc(tr("fi_for_the_stay")) + "</small>" : "") + "</span></div>";
    }).join(""));
  }
  return h.join("") || '<p class="discret">' + esc(tr("fi_nothing_noted")) + "</p>";
}
function htmlAvis(l) {
  var a = l.avis || {}, h = [];
  if (liste(a.aiment).length) h.push('<p class="lg-f-h good">' + esc(tr("fi_reviews_like")) + "</p>" + puces(a.aiment));
  if (liste(a.reprochent).length) h.push('<p class="lg-f-h warn">' + esc(tr("fi_reviews_dislike")) + "</p>" + puces(a.reprochent));
  if (liste(a.citations).length) h.push(liste(a.citations).map(function (c) { return '<blockquote class="lg-cit">' + esc(c) + "</blockquote>"; }).join(""));
  if (a.alerte) h.push(rang("alerte", /^(no alert|nothing|none|pas d'alerte|aucune)/i.test(a.alerte) ? "" : "warn", tr("fi_to_know"), esc(a.alerte), a.alerte));
  return h.join("") || '<p class="discret">' + esc(tr("fi_no_reviews")) + "</p>";
}

function boutonChoisir(choisi) { return choisi ? ic("check") + esc(tr("lg_your_choice")) : esc(tr("fi_choose")); }
function htmlTete(l, etape) {
  var choisi = LUI.estChoisi(etape, l.id), b = LUI.budget(l, etape);
  return '<div class="lg-f-tete">' +
    '<div class="lg-f-id"><p class="lg-f-zone">' + esc(l.zone || "") + "</p><p class=\"lg-f-ligne\">" + esc(l.ligne || "") + "</p></div>" +
    '<div class="lg-f-prix">' + LUI.htmlAddition(b, { nuits: LUI.nuits(etape) }) +
      '<div class="lg-ecart-box">' + LUI.htmlEcart(etape, l.id) + "</div>" +
      '<div class="lg-f-act">' +
        '<button type="button" class="btn' + (choisi ? " lg-est-choisi" : " primary") + '" data-act="choisir"' + (choisi ? ' aria-pressed="true"' : "") + ">" +
          boutonChoisir(choisi) + "</button>" +
        '<button type="button" class="lg-coeur lg-coeur-f" data-act="coeur" aria-pressed="' + LUI.estMonFav(l) + '"' + (LUI.estFav(l) ? ' data-aime="1"' : "") +
          ' aria-label="' + esc(tr("lg_favorite_aria", { name: l.nom || "" })) + '">' + ic("coeur") + "</button>" +
      "</div>" + LUI.htmlAnnulation(l.prix) + "</div></div>";
}

function rendreFiche(panneau, t, opts) {
  /* A new box at each opening: the shell reuses the same panel body for each fiche and each comparison; a listener
     set on it would still act on the closed fiches. */
  var boite = document.createElement("div");
  boite.className = "lg-fiche";
  panneau.appendChild(boite);
  var l = t.l, etape = t.etape, complet = t.complet, b = LUI.budget(l, etape);
  var resPrix = [num(b.avant) ? tr("fi_sum_before", { price: UI.argent(b.avant) }) : "",
    num(b.place) && complet ? tr("fi_sum_spot", { price: UI.argent(b.place) }) : ""].filter(Boolean).join(" · ");
  var inc = liste(l.inclus);
  var p = l.prestations || {};
  var resPrest = [liste(p.equipements).length ? tr("fi_n_amenities", { n: liste(p.equipements).length }) : "",
    liste(p.restaurants).length ? tr("fi_n_restaurants", { n: liste(p.restaurants).length }) : ""].filter(Boolean).join(", ");
  var loc = num(b.place) ? UI.local(b.place) : "";
  boite.innerHTML = '<div class="lg-fiche-in">' +
    (opts.retour ? '<button type="button" class="btn small lg-f-retour" data-act="retour">' + ic("gauche") + esc(opts.retour.lib || tr("ui_back")) + "</button>" : "") +
    htmlMosaique(l) +
    '<div class="lg-f-in">' +
      htmlTete(l, etape) +
      htmlNotes(l, complet) +
      htmlLiens(l) +
      htmlVideos(l) +
      section(tr("fi_sec_decide"), "", htmlPourDecider(l, complet), true) +
      section(tr("fi_sec_price"), resPrix, htmlPrix(l, complet, b, etape)) +
      (complet ? section(tr("fi_sec_included"), LUI.court(inc.slice(0, 3).join(", "), 70), htmlInclus(l)) : "") +
      (complet ? section(tr("fi_sec_spot"), num(b.place) ? "≈ " + UI.argent(b.place) + (loc ? " (≈ " + loc + ")" : "") : "", htmlSurPlace(l, b)) : "") +
      (complet ? section(tr("fi_sec_services"), resPrest, htmlPrestations(l)) : "") +
      (complet ? section(tr("fi_sec_reviews"), tr("fi_sec_reviews_sub"), htmlAvis(l)) : "") +
    "</div></div>";

  UI.$$("img[data-ph]", boite).forEach(function (img) {
    var x = img.dataset.ph.split(":"), i = +x[x.length - 1];
    // the mosaic's large tile may take the large photo (srcset); the other tiles stay small
    LUI.poserPhoto(img, l.slug, i, "s", i === 0 ? { sizes: taillesGrande(LUI.nbPhotos(l.slug)) } : null);
  });
  LUI.poserVignettes(boite, l.videos);     // the first 3; the others when "See the N videos" opens

  function maj() {
    var choisi = LUI.estChoisi(etape, l.id), bc = UI.$('.lg-f-act [data-act="choisir"]', boite);
    if (bc) {
      bc.className = "btn" + (choisi ? " lg-est-choisi" : " primary");
      bc.innerHTML = boutonChoisir(choisi);
      if (choisi) bc.setAttribute("aria-pressed", "true"); else bc.removeAttribute("aria-pressed");
    }
    var e = UI.$(".lg-f-tete .lg-ecart-box", boite);
    if (e) e.innerHTML = LUI.htmlEcart(etape, l.id);
    var h = UI.$(".lg-coeur-f", boite);
    if (h) { h.setAttribute("aria-pressed", String(LUI.estMonFav(l))); if (LUI.estFav(l)) h.dataset.aime = "1"; else delete h.dataset.aime; }
  }

  boite.addEventListener("click", function (ev) {
    var b2 = ev.target.closest("[data-act]");
    if (!b2 || !boite.contains(b2)) return;
    var act = b2.dataset.act;
    if (act === "grille") { ev.stopPropagation(); ouvrirVisio(l, 0, "grille"); }
    else if (act === "photo") ouvrirVisio(l, +b2.dataset.i, "photo");
    else if (act === "choisir") LUI.choisir(etape, l.id);
    else if (act === "coeur") { if (window.Store) Store.basculerFavori(LUI.cleFav(l)); }
    else if (act === "retour" && opts.retour && typeof opts.retour.fn === "function") opts.retour.fn();
    else if (act === "suite") {
      var t2 = b2.previousElementSibling, ouvert = t2.classList.toggle("ouvert");
      b2.textContent = tr(ouvert ? "fi_fold" : "fi_read_more");
    } else if (act === "videos") LUI.basculerVideos(b2, l.videos);
  });

  if (opts.photos) setTimeout(function () { ouvrirVisio(l, 0, "photo"); }, 0);
  return { maj: maj, quitter: function () { fermerVisio(); } };
}

function ouvrirFiche(id, opts) {
  opts = opts || {};
  if (window.Parcours && Parcours.D) LUI.indexer(Parcours.D);
  var t = LUI.trouver(id, opts.etape) || LUI.trouver(id);
  if (!t) { if (UI.toast) UI.toast(tr("fi_gone")); return; }
  var corps = UI.ouvrirPanneau(t.l.nom, function (corps) { return rendreFiche(corps, t, opts); });
  // the panel was hidden when the shell reset its scroll: do it again once open
  if (corps) corps.scrollTop = 0;
}
window.ouvrirFiche = ouvrirFiche;
})();
