/* Lodging screens: one photo card per lodging, the sort, "compare", "See the other lodgings", and at the top the
   between-stages legs arriving at this stage (window.blocTrajet of vols.js: a flight or a ground leg).
   - ECRANS["logement"] = function (racine, D, choix, ecran) (contract of shell.js); ecran.stage is the stage.
   - Choosing a lodging = patchChoix(<stage>, id); the budget (logic/budget.js) then takes its lines, transfers included.
   - The full-screen fiche is in fiche.js (ouvrirFiche), the comparison in compare.js (comparer); the three files share
     window.LogementsUI (helpers, photos, icons), used only at click time.
   - Pure helpers (stay budget, cancellation, sort…) exported for node: tests/js/logement-ui.test.js.
   Texts through T(), money through fmtMoney (page/js/i18n.js), the trip from creerTrip(D) (logic/config.js). */

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
  var t = f(D);
  if (trips && D) trips.set(D, t);
  return t;
}
function tripCourant() { return typeof TRIP !== "undefined" && TRIP ? TRIP : null; }

/* ================= Pure helpers (tested under node) ================= */
var URGENT_JOURS = 14;          // free cancellation ending in 14 days or less is "urgent"

function num(x) { return typeof x === "number" && isFinite(x); }
function r2(x) { return Math.round(x * 100) / 100; }
function estIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
/* "9.6" / "9,6": a decimal number in the page's language. */
function nloc(x) {
  try { return new Intl.NumberFormat(I18().T.lang ? I18().T.lang() : "en", { maximumFractionDigits: 2 }).format(x); } catch (e) { return String(x); }
}
function argent(n) { return num(n) ? I18().fmtMoney(n, "home") : ""; }

/* Today (local time), YYYY-MM-DD. */
function isoLocal(d) {
  d = d || new Date();
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/* Whole days from a to b (ISO dates), in UTC. */
function joursEntre(a, b) {
  var p = function (s) { var x = s.split("-"); return Date.UTC(+x[0], +x[1] - 1, +x[2]); };
  return Math.round((p(b) - p(a)) / 86400000);
}
/* "Jun 15" */
function dateCourte(iso) { return estIso(iso) ? I18().fmtDate(iso) : ""; }

function montant(l) { return l && num(l.n) && num(l.u) ? l.n * l.u : 0; }
function manque(l) { return !!(l && (l.incomplet || !num(l.u) || !num(l.n))); }

/* Stay budget = room + spending (meals, drinks, massages, transfers), from the fiche's lines.
   {chambre, extras, avant, place, total, incomplet, postes: {repas, verres, bienetre, trajets, …}}:
   chambre + extras = total = avant (paid before leaving) + place (on the spot). Without lines ("other" lodgings): the
   room alone, extras and place = null, incomplete. Never NaN: null when unknown. */
function budgetSejour(l, nuits) {
  var lignes = l && Array.isArray(l.lignes) ? l.lignes : [];
  var p = (l && l.prix) || {};
  if (!lignes.length) {
    var n = num(nuits) ? nuits : num(l && l.nuits) ? l.nuits : 1;
    var ch = num(p.total_home) ? p.total_home : num(p.nuit_home) ? r2(p.nuit_home * n) : null;
    return { chambre: ch, extras: null, avant: ch, place: null, total: ch, incomplet: true, postes: {} };
  }
  var chambre = 0, extras = 0, avant = 0, place = 0, incomplet = false, postes = {}, aChambre = false;
  lignes.forEach(function (x) {
    if (manque(x)) { incomplet = true; return; }
    var m = montant(x);
    if (x.cle === "chambre") { chambre += m; aChambre = true; }
    else if (m) { extras += m; postes[x.poste || "autre"] = r2((postes[x.poste || "autre"] || 0) + m); }
    if (x.quand === "avant") avant += m;
    else if (x.quand === "place") place += m;
  });
  if (!aChambre) {
    // no "room" line: the platform's price, paid before leaving
    if (num(p.total_home)) { chambre = p.total_home; avant += p.total_home; } else incomplet = true;
  }
  return { chambre: r2(chambre), extras: r2(extras), avant: r2(avant), place: r2(place), total: r2(chambre + extras),
    incomplet: incomplet, postes: postes };
}

/* Free cancellation: {court, texte, ton: bon|urgent|non|inconnu, date, jours}. aujourdhui: YYYY-MM-DD. */
function annulation(prix, aujourdhui) {
  var p = prix || {}, t = String(p.annulation || ""), auj = estIso(aujourdhui) ? aujourdhui : isoLocal();
  var r = { court: "", texte: t, ton: "inconnu", date: null, jours: null };
  if (estIso(p.annulation_date)) {
    var j = joursEntre(auj, p.annulation_date), d = dateCourte(p.annulation_date);
    r.date = p.annulation_date;
    r.jours = j;
    if (j < 0) { r.ton = "non"; r.court = tr("lg_cancel_ended", { date: d }); }
    else {
      r.ton = j <= URGENT_JOURS ? "urgent" : "bon";
      var quand = j === 0 ? tr("lg_today") : j === 1 ? tr("lg_tomorrow") : tr("lg_in_days", { n: j });
      r.court = j <= URGENT_JOURS ? tr("lg_cancel_until_soon", { date: d, when: quand }) : tr("lg_cancel_until", { date: d });
    }
    return r;
  }
  if (/non[\s-]?(?:rembours|refund)/i.test(t)) { r.ton = "non"; r.court = tr("lg_non_refundable"); }
  else if (/gratuit|free/i.test(t)) r.court = tr("lg_cancel_free_date_to_check");
  else r.court = tr("lg_cancel_to_check");
  return r;
}

/* Sort of the cards (a copy). critere: budget (stay, incomplete last) | qualite (descending) | chambre (ascending) |
   favoris (♥ first, then the research's favorites, then quality, then the stay budget; unknown criterion = favoris).
   opts.estFavori(l): a ♥; opts.budget(l): a budget already computed (else budgetSejour). */
function trier(liste, critere, opts) {
  opts = opts || {};
  var bud = function (l) { return opts.budget ? opts.budget(l) : budgetSejour(l); };
  var info = (liste || []).map(function (l, i) {
    var b = bud(l) || {};
    return {
      l: l, i: i,
      sejour: !b.incomplet && num(b.total) ? b.total : Infinity,
      chambre: num(b.chambre) ? b.chambre : Infinity,
      q: num(l.note_qualite) ? l.note_qualite : -Infinity,
      coeur: opts.estFavori && opts.estFavori(l) ? 0 : 1,
      fav: l.favori ? 0 : 1,
    };
  });
  var cmp = function (a, b) {
    for (var k = 2; k < arguments.length; k++) {
      var f = arguments[k], x = f(a), y = f(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return a.i - b.i;
  };
  var parSejour = function (x) { return x.sejour; }, parChambre = function (x) { return x.chambre; };
  var tri = {
    budget: function (a, b) { return cmp(a, b, parSejour, parChambre); },
    qualite: function (a, b) { return cmp(a, b, function (x) { return -x.q; }, parSejour); },
    chambre: function (a, b) { return cmp(a, b, parChambre, parSejour); },
    favoris: function (a, b) { return cmp(a, b, function (x) { return x.coeur; }, function (x) { return x.fav; }, function (x) { return -x.q; }, parSejour); },
  };
  return info.sort(tri[critere] || tri.favoris).map(function (x) { return x.l; });
}

/* A readable budget line: "n label" × u = amount, source "published price" | "estimated" | "included" | "price to check". */
function texteLigne(l) {
  l = l || {};
  var lib = String(l.lib || "");
  var inclus = l.src === "inclus" || l.quand === "inclus";
  if (manque(l)) return { lib: (num(l.n) && l.n > 0 ? l.n + " " : "") + lib, n: l.n, u: null, montant: null, source: tr("price_to_check"), aVerifier: true, inclus: false };
  if (inclus || !l.n) return { lib: lib, n: l.n, u: l.u, montant: 0, source: tr("lg_src_included"), inclus: true };
  return { lib: l.n + " " + lib, n: l.n, u: l.u, montant: r2(l.n * l.u), source: tr(l.src === "estime" ? "lg_src_estimated" : "lg_src_published"), estime: l.src === "estime", inclus: false };
}

/* Photos of a lodging = files: l.galerie = {n, vue_en_tete, grandes, petites} (page_data.py); only the site's addresses
   "media/photos/…" are accepted. Number of usable photos (0 without a gallery). */
var RE_PHOTO = /^media\/photos\/[\w.\/-]+\.jpg$/;
function galerieValide(l) {
  var g = l && l.galerie;
  return g && Array.isArray(g.petites) && Array.isArray(g.grandes) ? g : null;
}
function nbPhotosDe(l) {
  var g = galerieValide(l);
  if (!g) return 0;
  var n = Math.min(g.petites.length, g.grandes.length);
  return num(g.n) ? Math.min(n, g.n) : n;
}
/* Address of photo i: size "s" = <NN>-s.jpg (cards, thumbnails, mosaic), "l" = <NN>.jpg (full-screen viewer); null if absent. */
function cheminPhoto(l, i, taille) {
  var g = galerieValide(l);
  if (!g || !(i >= 0 && i < nbPhotosDe(l)) || Math.floor(i) !== i) return null;
  var u = (taille === "l" ? g.grandes : g.petites)[i];
  return typeof u === "string" && RE_PHOTO.test(u) && u.indexOf("..") < 0 ? u : null;
}

/* A site's rating: "9.6" (out of 10) or "4.9/5" (sites rating out of 5). */
function noteAvis(s) {
  if (!s || !num(s.note)) return "";
  return s.note <= 5 ? nloc(s.note) + "/5" : nloc(s.note);
}
/* The most telling source of reviews (no aggregator), by number of reviews. */
function meilleurAvis(avis) {
  var src = avis && Array.isArray(avis.sources) ? avis.sources.filter(function (s) { return s && num(s.note); }) : [];
  var directes = src.filter(function (s) { return !/trivago|agr[e\u00e9]g|average|moyenne/i.test(String(s.site)); });
  if (directes.length) src = directes;
  if (!src.length) return null;
  return src.slice().sort(function (a, b) { return (b.nb || 0) - (a.nb || 0); })[0];
}

/* "1 h 40" */
function duree(min) {
  if (!num(min)) return "";
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  if (!h) return tr("dur_min", { m: m });
  return m ? tr("dur_h_min", { h: h, mm: (m < 10 ? "0" : "") + m }) : tr("dur_h", { h: h });
}
/* Words of a transport mode of the data ("voiture", "voiture+bateau", "ferry"...): "by car then by boat". */
var MODES = [[/voiture|car\b|drive/i, "mode_car"], [/bateau|boat|ferry/i, "mode_boat"], [/bus|coach|minivan/i, "mode_bus"],
  [/train|rail/i, "mode_train"], [/metro|subway/i, "mode_metro"], [/tram/i, "mode_tram"], [/taxi/i, "mode_taxi"], [/pied|walk|foot/i, "mode_walk"]];
function libelleMode(mode) {
  return String(mode || "").split("+").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i][0].test(x)) return tr(MODES[i][1]);
    return x;
  }).join(" " + tr("then") + " ");
}
function parBateau(mode) { return /bateau|boat|ferry/i.test(String(mode || "")); }
/* "Lisbon (LIS) → 1 h 45 by car then by boat · private ≈ $140 · last public boat 20:30" (the last transport named
   from the access mode: a boat or ferry, else public transport). */
function texteAcces(a, trip) {
  if (!a) return "";
  var t = trip || tripCourant();
  var apt = a.aeroport ? (t ? t.airportName(a.aeroport) : a.aeroport) : "";
  var parts = [(apt ? apt + " → " : "") + duree(a.duree_min) + (a.mode ? " " + libelleMode(a.mode) : "")];
  if (num(a.prive_home)) parts.push(tr("lg_private_about", { price: argent(a.prive_home) }));
  if (a.dernier_public) parts.push(tr("lg_last_public", { what: tr(parBateau(a.mode) ? "nature_boat" : "nature_transport"), time: a.dernier_public }));
  return parts.filter(Boolean).join(" · ");
}

/* Mandatory gala dinner: {impose, montant, texte, ton, speciale, lignes}; null when the fiche says nothing. A dinner
   imposed during the stay is a "gala" line of the fiche (already counted in the stay budget), tied to its special
   evening (line.speciale). */
function gala(l) {
  l = l || {};
  var lg = (Array.isArray(l.lignes) ? l.lignes : []).filter(function (x) { return x && x.cle === "gala"; });
  var t = String((l.pour_decider && l.pour_decider.gala) || "");
  if (lg.length) {
    var m = lg.reduce(function (s, x) { return s + montant(x); }, 0);
    var inc = lg.some(manque);
    return { impose: true, montant: inc ? null : r2(m), texte: t || lg.map(function (x) { return x.lib; }).join(" ; "), ton: "warn", speciale: lg[0].speciale || null, lignes: lg };
  }
  if (!t) return null;
  var bon = /^(none|no |not |nothing|n\/a|aucun|rien|pas |sans objet|ne concerne)/i.test(t.trim());
  return { impose: false, montant: null, texte: t, ton: bon ? "good" : "", speciale: null, lignes: [] };
}

/* Video link: https on instagram.com, youtube.com or youtu.be only; else "". */
function urlVideo(u) {
  if (typeof u !== "string" || !/^https:\/\//i.test(u)) return "";
  try {
    var h = new URL(u).hostname.toLowerCase();
    return /(^|\.)(instagram\.com|youtube\.com|youtu\.be)$/.test(h) ? u : "";
  } catch (e) { return ""; }
}
/* Thumbnail of a video: v.vignette = "media/videos/<platform>-<cid>.jpg", a real file. {fichier: path|null}. */
function cheminVignette(v) {
  var r = String((v && v.vignette) || "");
  var f = /^(?:media\/)?(videos\/[\w.-]+\.(?:jpg|jpeg|webp|png))$/i.exec(r);
  return { fichier: f ? "media/" + f[1] : null };
}
/* What the video shows (field "montre") → a short label; "" when unknown. */
var MONTRE = {
  chambre: "lg_shows_chambre", vue: "lg_shows_vue", piscine: "lg_shows_piscine", plage: "lg_shows_plage", repas: "lg_shows_repas",
  ambiance: "lg_shows_ambiance", activite: "lg_shows_activite", trajet: "lg_shows_trajet", evenement: "lg_shows_evenement", visite: "lg_shows_visite",
};
function libelleMontre(m) { return Object.prototype.hasOwnProperty.call(MONTRE, m) ? tr(MONTRE[m]) : ""; }

/* ---------- The row of videos: the same tile for a lodging's fiche and an outing's details ----------
   Only the videos whose address passes urlVideo. The VIDEOS_VUES first are shown, the others behind "See the N videos".
   No thumbnail is loaded here: each <img data-vi="i"> stays without src; poserVignettes (in the page) loads them. */
var VIDEOS_VUES = 3;
var LECTURE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.55)"/><path d="M10 8l6 4-6 4z" fill="#fff"/></svg>';
function escTexte(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
function videosValides(liste) { return (Array.isArray(liste) ? liste : []).filter(function (v) { return v && urlVideo(v.url); }); }
function dureeVideo(s) {
  if (!num(s)) return "";
  if (s < 60) return tr("dur_s", { s: Math.round(s) });
  if (s < 3600) return tr("dur_min", { m: Math.round(s / 60) });
  return duree(Math.round(s / 60));
}
/* HTML of the row; "" without a video. opts.titre, opts.sous (the discreet line next to the title). */
function htmlVideos(videos, opts) {
  var vids = videosValides(videos), esc = escTexte;
  if (!vids.length) return "";
  opts = opts || {};
  var tuile = function (v, i) {
    var insta = /instagram/i.test(v.plateforme || v.url);
    var meta = [tr(insta ? "lg_video_reel" : "lg_video_youtube"), dureeVideo(v.duree_s), /^\d{4}/.test(String(v.date || "")) ? String(v.date).slice(0, 4) : ""].filter(Boolean).join(" · ");
    var montre = libelleMontre(v.montre);
    var plus = i >= VIDEOS_VUES;
    return '<a class="lg-vid' + (plus ? " lg-vid-plus" : "") + '"' + (plus ? " hidden" : "") + ' href="' + esc(urlVideo(v.url)) + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="lg-vid-th"><img alt="" loading="lazy" decoding="async" data-vi="' + i + '" hidden>' + LECTURE +
      (montre ? '<span class="lg-vid-m">' + esc(montre) + "</span>" : "") + "</span>" +
      '<span class="lg-vid-t"><b>' + esc(v.titre || tr("lg_video")) + "</b>" +
      (v.raison ? '<span class="lg-vid-r">' + esc(v.raison) + "</span>" : "") +
      "<small>" + esc(meta) + (v.auteur ? " · " + esc(v.auteur) : "") + "</small></span></a>";
  };
  return '<div class="lg-vids-box"><p class="lg-f-h">' + esc(opts.titre || tr("lg_videos")) +
    ' <span class="discret">' + esc(opts.sous || tr("lg_videos_sub")) + "</span></p>" +
    '<div class="lg-vids">' + vids.map(tuile).join("") + "</div>" +
    (vids.length > VIDEOS_VUES ? '<button type="button" class="btn small lg-vids-tout" data-act="videos" aria-expanded="false">' + esc(tr("lg_videos_all", { n: vids.length })) + "</button>" : "") + "</div>";
}

/* Is id a lodging (full fiche or "other") of this stage? The only condition to write choix[stage]. */
function appartient(D, etape, id) {
  var p = D && D.lieux && D.lieux[etape];
  if (!p || typeof id !== "string" || !id) return false;
  return [].concat(p.logements || [], p.autres || []).some(function (l) { return l && l.id === id; });
}
/* The between-stages legs shown at the top of a stage's lodging screen: those arriving at that stage. */
function legsEnTete(etape, D) { return cfg(D).legsArrivingAt(etape).map(function (l) { return l.key; }); }

var Aide = {
  appartient: appartient, cheminVignette: cheminVignette, libelleMontre: libelleMontre, legsEnTete: legsEnTete,
  htmlVideos: htmlVideos, videosValides: videosValides, dureeVideo: dureeVideo, VIDEOS_VUES: VIDEOS_VUES,
  isoLocal: isoLocal, joursEntre: joursEntre, dateCourte: dateCourte, budgetSejour: budgetSejour, annulation: annulation,
  trier: trier, texteLigne: texteLigne, cheminPhoto: cheminPhoto, noteAvis: noteAvis, meilleurAvis: meilleurAvis, nloc: nloc,
  duree: duree, libelleMode: libelleMode, texteAcces: texteAcces, gala: gala, urlVideo: urlVideo, nbPhotosDe: nbPhotosDe,
};
if (typeof module !== "undefined" && module.exports) module.exports = Aide;
if (typeof window === "undefined") return;

/* ================= In the page ================= */
var LUI = window.LogementsUI = window.LogementsUI || {};
LUI.aide = Aide;

/* ---------- Photos: ALL the lodging images go through here ----------
   Files: l.galerie lists media/photos/<slug>/<NN>-s.jpg (cards, thumbnails, mosaic) and <NN>.jpg (full-screen viewer);
   the large ones load on demand only (the photo opened and its two neighbours). */
var parSlug = {}, pretes = {}, chargements = {};
/* Index slug → lodging, filled at each render (D.lieux[*].logements and autres). */
function indexer(D) {
  cfg(D).stageKeys.forEach(function (e) {
    var p = D && D.lieux && D.lieux[e];
    if (!p) return;
    [].concat(p.logements || [], p.autres || []).forEach(function (l) { if (l && l.slug) parSlug[l.slug] = l; });
  });
}
function nbPhotos(slug) { return nbPhotosDe(parSlug[slug]); }
function urlPhoto(slug, i, taille) { return cheminPhoto(parSlug[slug], i, taille === "l" ? "l" : "s"); }
function photoLogement(slug, i, taille) {
  var u = urlPhoto(slug, i, taille);
  return u ? Promise.resolve(u) : Promise.reject(new Error("photo " + slug + " #" + i + " missing"));
}
/* Downloads the file of photo i once (large by default) → Promise<url> once arrived and decoded. */
function chargerPhoto(slug, i, taille) {
  var u = urlPhoto(slug, i, taille || "l");
  if (!u) return Promise.reject(new Error("photo " + slug + " #" + i + " missing"));
  if (!chargements[u]) {
    chargements[u] = new Promise(function (ok, ko) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () {
        pretes[u] = true;
        var fin = function () { ok(u); };
        if (typeof im.decode === "function") im.decode().then(fin, fin); else fin();
      };
      im.onerror = function () { delete chargements[u]; ko(new Error("photo not found: " + u)); };
      im.src = u;
    });
  }
  return chargements[u];
}
function photoPrete(slug, i, taille) { var u = urlPhoto(slug, i, taille || "l"); return !!(u && pretes[u]); }
/* Puts the small photo i in an <img>, shown once decoded. opts.sizes (large mosaic tile) adds srcset small 600w, large
   1600w. Without a photo, or a missing file: lg-sans-photo (the tile's background). */
function poserPhoto(img, slug, i, taille, opts) {
  var u = urlPhoto(slug, i, taille);
  var pret = function () { img.classList.remove("lg-attente"); };
  if (!u) { pret(); img.classList.add("lg-sans-photo"); return Promise.resolve(null); }
  if (img.dataset.ph && img.dataset.ph !== slug + ":" + i) return Promise.resolve(null);   // the image shows another photo
  img.classList.add("lg-attente");
  img.onerror = function () { pret(); img.classList.add("lg-sans-photo"); img.removeAttribute("srcset"); img.removeAttribute("src"); };
  var g = opts && opts.sizes ? urlPhoto(slug, i, "l") : null;
  if (g) { img.sizes = opts.sizes; img.srcset = u + " 600w, " + g + " 1600w"; }
  img.src = u;
  if (typeof img.decode === "function") img.decode().then(pret, pret); else pret();
  return Promise.resolve(u);
}
/* Thumbnail of a video (lodging or outing) → Promise<url|null>: its media/videos/… file, else null. */
function vignetteVideo(v) {
  var c = cheminVignette(v);
  if (!c.fichier) return Promise.resolve(null);
  return new Promise(function (ok) {
    var im = new Image();
    im.onload = function () { ok(c.fichier); };
    im.onerror = function () { ok(null); };
    im.src = c.fichier;
  });
}
/* Loads the thumbnails of the row of videos that are shown; one hidden behind "See the N videos" only when the list opens. */
function poserVignettes(racine, videos) {
  var vids = videosValides(videos);
  if (!racine || !vids.length) return;
  UI.$$("img[data-vi]", racine).forEach(function (img) {
    if (img.dataset.pose) return;
    var tuile = typeof img.closest === "function" ? img.closest(".lg-vid") : null;
    if (tuile && tuile.hidden) return;
    var v = vids[+img.dataset.vi];
    if (!v) return;
    img.dataset.pose = "1";
    vignetteVideo(v).then(function (url) { if (url) { img.src = url; img.hidden = false; } }, function () {});
  });
}
/* "See the N videos" / "Fewer videos" (button data-act="videos" of htmlVideos). */
function basculerVideos(bouton, videos) {
  var box = bouton && typeof bouton.closest === "function" ? bouton.closest(".lg-vids-box") : null;
  if (!box) return;
  var ouv = bouton.getAttribute("aria-expanded") !== "true";
  UI.$$(".lg-vid-plus", box).forEach(function (a) { a.hidden = !ouv; });
  bouton.setAttribute("aria-expanded", String(ouv));
  bouton.textContent = ouv ? tr("lg_videos_fewer") : tr("lg_videos_all", { n: UI.$$(".lg-vid", box).length });
  if (ouv) poserVignettes(box, videos);
}
LUI.vignetteVideo = vignetteVideo;
LUI.poserVignettes = poserVignettes;
LUI.basculerVideos = basculerVideos;
LUI.indexer = indexer;
LUI.photoLogement = photoLogement;
LUI.nbPhotos = nbPhotos;
LUI.photoPrete = photoPrete;
LUI.chargerPhoto = chargerPhoto;
LUI.poserPhoto = poserPhoto;

/* ---------- Icons (inline SVG) ---------- */
var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
var ICONES = {
  coeur: S + '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  photos: S + '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/></svg>',
  calendrier: S + '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
  etoile: S + '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  avis: S + '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  oeil: S + '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  lit: S + '<path d="M3 18v-8M21 18v-5a3 3 0 0 0-3-3H10v8"/><path d="M3 15h18"/><circle cx="6.5" cy="12" r="1.5"/></svg>',
  calme: S + '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/></svg>',
  epingle: S + '<path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  alerte: S + '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  verre: S + '<path d="M8 3h8l-1 7a3 3 0 0 1-6 0z"/><path d="M12 13v7M8.5 21h7"/></svg>',
  offre: S + '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="8" cy="8" r="1.5"/></svg>',
  check: S + '<path d="M5 12l5 5L20 7"/></svg>',
  plus: S + '<path d="M12 5v14M5 12h14"/></svg>',
  croix: S + '<path d="M6 6l12 12M18 6 6 18"/></svg>',
  gauche: S + '<path d="m15 18-6-6 6-6"/></svg>',
  droite: S + '<path d="m9 18 6-6-6-6"/></svg>',
  grille: S + '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  lecture: LECTURE,
  externe: S + '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  comparer: S + '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/></svg>',
  argent: S + '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  inclus: S + '<path d="M20 7 10 17l-5-5"/><rect x="3" y="3" width="18" height="18" rx="3" opacity=".35"/></svg>',
  resto: S + '<path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v6M11 3v6M17 3c-1.7 1-2.5 3-2.5 6 0 2 1 3 2.5 3v9"/></svg>',
  voiture: S + '<path d="M5 16h14l-1.5-6.5A2 2 0 0 0 15.6 8H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>',
};
LUI.icone = function (n) { return ICONES[n] || ""; };

/* ---------- Data and computations shared by the cards, the fiche and the comparison ---------- */
var budgets = typeof WeakMap === "function" ? new WeakMap() : null;
function D_() { return window.Parcours && Parcours.D; }
function nuitsEtape(etape) {
  var D = D_(), st = D ? cfg(D).stage(etape) : null;
  return st && num(st.nights) ? st.nights : 1;
}
function budgetDe(l, etape) {
  if (budgets && budgets.has(l)) return budgets.get(l);
  var b = budgetSejour(l, nuitsEtape(etape));
  if (budgets) budgets.set(l, b);
  return b;
}
/* {l, etape, complet} for a lodging id (full fiche or "other"); null when unknown. */
function trouver(id, etape) {
  var D = D_();
  if (!D || !D.lieux) return null;
  var liste = etape ? [etape] : cfg(D).stageKeys;
  for (var i = 0; i < liste.length; i++) {
    var p = D.lieux[liste[i]];
    if (!p) continue;
    var l = (p.logements || []).filter(function (x) { return x.id === id; })[0];
    if (l) return { l: l, etape: liste[i], complet: true };
    var a = (p.autres || []).filter(function (x) { return x.id === id; })[0];
    if (a) return { l: a, etape: liste[i], complet: false };
  }
  return null;
}
function pourTous() { var D = D_(); return tr("for_n_people", { n: D ? cfg(D).adults : 1 }); }
/* Effect of choosing this lodging on the trip's total: {montant, incomplet, marge, plafond}; null when the computation
   does not exist (logic/budget.js): the effect is then hidden rather than wrong. */
function ecartPour(etape, id) {
  var P = window.Parcours;
  if (typeof window.ecart !== "function" || !P || !P.D || !P.choix || !P.totaux) return null;
  try {
    var patch = {};
    patch[etape] = id;
    var r = window.ecart(P.choix, P.D, patch);
    if (!r || !num(r.montant)) return null;
    var m = num(P.totaux.marge) ? r2(P.totaux.marge - r.montant) : null;
    return { montant: r.montant, incomplet: !!r.incomplet, marge: m, plafond: P.totaux.plafond, totalIncomplet: !!P.totaux.incomplet };
  } catch (e) { if (typeof console !== "undefined") console.error("[lodging] effect", e); return null; }
}
function estChoisi(etape, id) { var c = window.Parcours && Parcours.choix; return !!(c && c[etape] === id); }
function choisir(etape, id) {
  // not a lodging of this stage (an outing's id, another screen's…): nothing is written
  if (!appartient(D_(), etape, id)) return false;
  var t = trouver(id, etape);
  if (estChoisi(etape, id)) return true;
  try { patchChoix(etape, id); } catch (e) { if (typeof console !== "undefined") console.error("[lodging] choice", e); return false; }
  if (t && UI.toast) UI.toast(tr(t.complet ? "lg_chosen_toast" : "lg_chosen_toast_incomplete", { name: court(t.l.nom, 48) }));
  return true;
}
function court(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }

/* ♥ (Store.favs, key "log:<slug>"). */
function cleFav(l) { return typeof cleFavoriLogement === "function" ? cleFavoriLogement(l.slug) : "log:" + l.slug; }
function estFav(l) { return !!(window.Store && Store.estFavori && Store.estFavori(cleFav(l))); }
function estMonFav(l) { return !!(window.Store && Store.estMonFavori && Store.estMonFavori(cleFav(l))); }

/* Detailed addition "room + meals + drinks + massage + transfers = stay": never a second price alone. */
var ORDRE_POSTES = ["repas", "verres", "bienetre", "trajets", "activites"];
var CLES_POSTES = { repas: "lg_item_repas", verres: "lg_item_verres", bienetre: "lg_item_bienetre", trajets: "lg_item_trajets", activites: "lg_item_activites" };
function libPoste(p) { return Object.prototype.hasOwnProperty.call(CLES_POSTES, p) ? tr(CLES_POSTES[p]) : p; }
function postesTries(b) {
  var k = Object.keys((b && b.postes) || {});
  return k.sort(function (x, y) {
    var a = ORDRE_POSTES.indexOf(x), c = ORDRE_POSTES.indexOf(y);
    return (a < 0 ? 99 : a) - (c < 0 ? 99 : c);
  });
}
function textePostes(b) {
  return postesTries(b).map(function (p) { return libPoste(p) + " " + argent(b.postes[p]); }).join(" · ");
}
function htmlAddition(b, opts) {
  var esc = UI.esc;
  opts = opts || {};
  if (!b || !num(b.chambre)) return '<p class="lg-add"><span class="lg-verif">' + esc(tr("price_to_check")) + "</span></p>";
  var t = function (v, lib, cls) { return '<span class="lg-add-t' + (cls ? " " + cls : "") + '"><b>' + esc(argent(v)) + "</b> " + esc(lib) + "</span>"; };
  var ch = t(b.chambre, opts.nuits ? tr("lg_room_nights", { n: opts.nuits }) : tr("lg_room"));
  if (b.extras == null) return '<p class="lg-add">' + ch + ' <em class="tag-incomplet">' + esc(tr("lg_budget_incomplete")) + "</em></p>";
  var plus = '<span class="lg-op" aria-hidden="true">+</span>';
  return '<p class="lg-add" aria-label="' + esc(tr("lg_addition_aria", { room: argent(b.chambre), items: textePostes(b), total: argent(b.total) })) + '">' +
    ch + postesTries(b).map(function (p) { return plus + t(b.postes[p], libPoste(p)); }).join("") +
    '<span class="lg-op" aria-hidden="true">=</span>' + t(b.total, tr("lg_stay"), "lg-add-tot") +
    (b.incomplet ? ' <em class="tag-incomplet">' + esc(tr("ui_incomplete")) + "</em>" : "") + "</p>";
}
function htmlPostes(b) {
  var t = textePostes(b);
  return t ? '<p class="lg-postes">' + UI.esc(t) + "</p>" : "";
}
function htmlAnnulation(prix) {
  var a = annulation(prix, isoLocal());
  return '<span class="lg-puce lg-an-' + a.ton + '" title="' + UI.esc(a.texte || a.court) + '">' + ICONES.calendrier + "<span>" + UI.esc(a.court) + "</span></span>";
}
/* "+$1,200 to the budget · margin $845" (or "Your choice · margin …"); "" without the computation. */
function htmlEcart(etape, id) {
  var e = ecartPour(etape, id), esc = UI.esc;
  if (!e) return "";
  // the same words as the flights and the outings
  var marge = e.marge === null ? "" : e.marge >= 0 ? tr("ui_margin", { amount: argent(e.marge) }) : tr("ui_over_cap", { amount: argent(-e.marge), cap: argent(e.plafond) });
  var cls = e.marge !== null && e.marge < 0 ? " trop" : "";
  var inc = e.incomplet || (estChoisi(etape, id) && e.totalIncomplet) ? ' <em class="tag-incomplet">' + esc(tr("lg_budget_incomplete")) + "</em>" : "";
  var suite = marge ? " · " + esc(marge) : "";
  if (estChoisi(etape, id)) return '<p class="lg-ecart ici' + cls + '"><b>' + esc(tr("lg_your_choice")) + "</b>" + suite + inc + "</p>";
  var r = Math.round(e.montant), sens = r > 0 ? "plus" : r < 0 ? "moins" : "egal";
  var lib = r === 0 ? esc(tr("ui_same_budget")) : esc(tr("ui_to_budget", { amount: (r > 0 ? "+" : "−") + argent(Math.abs(r)) }));
  return '<p class="lg-ecart ' + sens + cls + '"><b>' + lib + "</b>" + suite + inc + "</p>";
}
LUI.trouver = trouver;
LUI.budget = budgetDe;
LUI.nuits = nuitsEtape;
LUI.pourTous = pourTous;
LUI.ecartPour = ecartPour;
LUI.estChoisi = estChoisi;
LUI.choisir = choisir;
LUI.court = court;
LUI.estFav = estFav;
LUI.estMonFav = estMonFav;
LUI.cleFav = cleFav;
LUI.htmlAddition = htmlAddition;
LUI.htmlPostes = htmlPostes;
LUI.textePostes = textePostes;
LUI.htmlAnnulation = htmlAnnulation;
LUI.htmlEcart = htmlEcart;

/* ================= A stage's lodging screen ================= */
var TRIS = ["favoris", "budget", "qualite", "chambre"];
var CLES_TRIS = { favoris: "lg_sort_favoris", budget: "lg_sort_budget", qualite: "lg_sort_qualite", chambre: "lg_sort_chambre" };
var MAX_CMP = 3;

function lsLire(k, d) { return typeof lsGet === "function" && window.Store && Store.cle ? lsGet(Store.cle(k), d) : d; }
function lsEcrire(k, v) { if (typeof lsSet === "function" && window.Store && Store.cle) lsSet(Store.cle(k), v); }

function ecranLogements(racine, D, choix, ecran) {
  var esc = UI.esc, etape = ecran && ecran.stage;
  /* The whole screen lives in a new box at each render: the shell reuses the same root (#ecran) for every screen, and
     listeners set on it would survive the change of screen. */
  var boite = document.createElement("div");
  boite.className = "lg-ecran";
  racine.appendChild(boite);
  indexer(D);
  var lieux = (D.lieux && D.lieux[etape]) || {};
  var logements = (lieux.logements || []).slice(), autres = (lieux.autres || []).slice();
  var etat = {
    tri: lsLire("tri-logement", "favoris"),
    cmp: [],                 // ids ticked "compare" (2 or 3)
    autresOuverts: false,
  };
  if (TRIS.indexOf(etat.tri) < 0) etat.tri = "favoris";
  var nuits = nuitsEtape(etape);

  boite.innerHTML =
    '<div class="lg-vols" hidden></div>' +
    '<div class="lg-choix" aria-live="polite"></div>' +
    '<div class="lg-barre">' +
      '<p class="lg-compte">' + esc([tr("lg_count", { n: logements.length }), tr("lg_nights", { n: nuits }), tr("lg_prices_for", { people: pourTous() })].join(" · ")) + "</p>" +
      '<label class="lg-tri"><span>' + esc(tr("lg_sort")) + "</span><select>" + TRIS.map(function (t) {
        return '<option value="' + t + '"' + (t === etat.tri ? " selected" : "") + ">" + esc(tr(CLES_TRIS[t])) + "</option>";
      }).join("") + "</select></label>" +
    "</div>" +
    (logements.length ? '<div class="lg-grille" data-liste="fiches"></div>'
      : '<div class="attente"><p class="attente-t">' + esc(tr("lg_none_complete")) + "</p></div>") +
    (autres.length ? '<div class="lg-autres">' +
      '<button type="button" class="btn lg-voir-autres" aria-expanded="false">' + esc(tr("lg_see_others", { n: autres.length })) + "</button>" +
      '<div class="lg-autres-corps" hidden><p class="discret">' + esc(tr("lg_others_note")) + "</p>" +
      '<div class="lg-grille" data-liste="autres"></div></div></div>' : "") +
    '<div class="lg-cmp-barre" hidden role="region" aria-label="' + esc(tr("lg_compare_aria")) + '">' +
      '<span class="lg-cmp-t"></span>' +
      '<button type="button" class="btn small lg-cmp-vider">' + esc(tr("lg_compare_clear")) + "</button>" +
      '<button type="button" class="btn small primary lg-cmp-ouvrir">' + ICONES.comparer + "<span>" + esc(tr("lg_compare")) + "</span></button>" +
    "</div>";

  /* The between-stages legs arriving at this stage (vols.js), at the top of the screen. */
  var poignees = [], boxVols = UI.$(".lg-vols", boite);
  if (typeof window.blocTrajet === "function") {
    legsEnTete(etape, D).forEach(function (k) {
      try {
        var p = window.blocTrajet(boxVols, k, D, choix);
        if (p) poignees.push(p);
      } catch (e) { if (typeof console !== "undefined") console.error("[lodging] leg " + k, e); }
    });
    boxVols.hidden = !poignees.length;
  }

  function triees(liste) {
    return trier(liste, etat.tri, { estFavori: estFav, budget: function (l) { return budgetDe(l, etape); } });
  }

  /* A card: photo, name, a line, addition, cancellation, quality, effect, actions. */
  function htmlCarte(l, complet) {
    var b = budgetDe(l, etape), n = nbPhotos(l.slug), choisi = estChoisi(etape, l.id);
    var av = complet ? meilleurAvis(l.avis) : null;
    var noteSite = !complet && num(l.note) ? { site: (l.prix && l.prix.plateforme) || tr("lg_rating"), note: l.note } : null;
    var q = num(l.note_qualite) ? '<span class="lg-puce lg-q">' + ICONES.etoile + "<span>" + esc(tr("lg_quality")) + " <b>" + esc(nloc(l.note_qualite)) + "</b>/10</span></span>" : "";
    var avisPuce = av || noteSite ? '<span class="lg-puce' + (av ? " d-only" : "") + '">' + ICONES.avis + "<span>" + esc((av || noteSite).site) + " <b>" +
      esc(noteAvis(av || noteSite)) + "</b>" + (av && av.nb ? " · " + esc(tr("lg_reviews", { n: av.nb })) : "") + "</span></span>" : "";
    var acces = complet && l.acces ? '<span class="lg-puce d-only">' + ICONES.voiture + "<span>" + esc(texteAcces(l.acces, cfg(D))) + "</span></span>" : "";
    return '<article class="lg-carte' + (choisi ? " choisi" : "") + (complet ? "" : " autre") + '" data-id="' + esc(l.id) + '">' +
      '<div class="lg-photo">' +
        '<button type="button" class="lg-photo-b" data-act="photos" aria-label="' + esc(tr("lg_photos_aria", { n: n, name: l.nom })) + '">' +
          '<img alt="" loading="lazy" decoding="async" width="760" height="507" data-slug="' + esc(l.slug) + '"></button>' +
        (n ? '<span class="lg-nbph">' + ICONES.photos + n + "</span>" : "") +
        '<span class="lg-tag-choisi"' + (choisi ? "" : " hidden") + ">" + ICONES.check + esc(tr("lg_your_choice")) + "</span>" +
        (l.folie ? '<span class="lg-tag-folie">' + esc(tr("lg_splurge")) + "</span>" : "") +
        '<button type="button" class="lg-coeur" data-act="coeur" aria-pressed="' + estMonFav(l) + '"' + (estFav(l) ? ' data-aime="1"' : "") +
          ' aria-label="' + esc(tr("lg_favorite_aria", { name: court(l.nom, 60) })) + '">' + ICONES.coeur + "</button>" +
      "</div>" +
      '<div class="lg-corps">' +
        '<h3 class="lg-nom"><button type="button" data-act="fiche">' + esc(l.nom) + "</button></h3>" +
        '<p class="lg-ligne">' + esc(l.ligne || l.zone || "") + "</p>" +
        htmlAddition(b) +
        '<div class="d-only">' + (num(l.prix && l.prix.nuit_home) ? '<p class="lg-postes">' + esc([tr("lg_per_night", { price: argent(l.prix.nuit_home) }), tr("lg_nights", { n: nuits })].concat(l.prix.plateforme ? [l.prix.plateforme] : []).join(" · ")) + "</p>" : "") + "</div>" +
        '<div class="lg-puces">' + htmlAnnulation(l.prix) + q + avisPuce + acces + "</div>" +
        '<div class="lg-ecart-box">' + htmlEcart(etape, l.id) + "</div>" +
        '<div class="lg-actions">' +
          '<button type="button" class="btn small' + (choisi ? " lg-est-choisi" : " primary") + '" data-act="choisir"' + (choisi ? ' aria-pressed="true"' : "") + ">" +
            (choisi ? ICONES.check + esc(tr("lg_chosen")) : esc(tr("lg_choose"))) + "</button>" +
          '<button type="button" class="btn small" data-act="fiche">' + esc(tr("lg_fiche")) + "</button>" +
          '<label class="lg-cmp"><input type="checkbox" data-act="cmp"' + (etat.cmp.indexOf(l.id) >= 0 ? " checked" : "") + "> " + esc(tr("lg_compare")) + "</label>" +
        "</div>" +
      "</div></article>";
  }

  function remplir(nom, liste, complet) {
    var g = UI.$('.lg-grille[data-liste="' + nom + '"]', boite);
    if (!g) return;
    g.innerHTML = triees(liste).map(function (l) { return htmlCarte(l, complet); }).join("");
    UI.$$("img[data-slug]", g).forEach(function (img) { img.dataset.ph = img.dataset.slug + ":0"; poserPhoto(img, img.dataset.slug, 0, "s"); });
    majCmp();
  }

  function rendreChoix() {
    var box = UI.$(".lg-choix", boite), c = window.Parcours && Parcours.choix;
    var t = c && c[etape] ? trouver(c[etape], etape) : null;
    if (!t) { box.innerHTML = ""; return; }
    var l = t.l, b = budgetDe(l, etape);
    var trs = (l.lignes || []).filter(function (x) { return x.cle === "transferts"; }).map(texteLigne);
    var trTxt = !t.complet ? tr("lg_transfers_to_price")
      : trs.length ? tr("lg_transfers_added", { list: trs.map(function (x) {
          return x.montant == null ? tr("lg_line_to_check", { lib: x.lib }) : x.n + " × " + argent(x.u) + " (" + x.source + ")";
        }).join(" + ") })
      : "";
    box.innerHTML = '<div class="lg-choix-in">' +
      '<img alt="" loading="lazy" decoding="async" width="96" height="64" data-ph="' + esc(l.slug) + ':0">' +
      '<div class="lg-choix-t"><p class="lg-choix-sur">' + esc(tr("lg_your_choice_stage")) + "</p>" +
      '<p class="lg-choix-nom"><button type="button" data-act="fiche" data-id="' + esc(l.id) + '">' + esc(l.nom) + "</button></p>" +
      htmlAddition(b) +
      (trTxt ? '<p class="lg-choix-tr">' + ICONES.voiture + "<span>" + esc(trTxt) + "</span></p>" : "") +
      "</div></div>";
    var img = UI.$("img", box);
    poserPhoto(img, l.slug, 0, "s");
  }

  /* Update in place (choice, ♥, effects) without sorting again or reloading the photos. */
  function majCartes() {
    UI.$$(".lg-carte", boite).forEach(function (el) {
      var id = el.dataset.id, t = trouver(id, etape);
      if (!t) return;
      var l = t.l, choisi = estChoisi(etape, id);
      el.classList.toggle("choisi", choisi);
      UI.$(".lg-tag-choisi", el).hidden = !choisi;
      var bc = UI.$('[data-act="choisir"]', el);
      bc.className = "btn small" + (choisi ? " lg-est-choisi" : " primary");
      bc.innerHTML = choisi ? ICONES.check + UI.esc(tr("lg_chosen")) : UI.esc(tr("lg_choose"));
      if (choisi) bc.setAttribute("aria-pressed", "true"); else bc.removeAttribute("aria-pressed");
      UI.$(".lg-ecart-box", el).innerHTML = htmlEcart(etape, id);
      var h = UI.$(".lg-coeur", el);
      h.setAttribute("aria-pressed", String(estMonFav(l)));
      if (estFav(l)) h.dataset.aime = "1"; else delete h.dataset.aime;
    });
    rendreChoix();
  }

  function majCmp() {
    var barre = UI.$(".lg-cmp-barre", boite), n = etat.cmp.length;
    barre.hidden = n === 0;
    document.body.classList.toggle("lg-cmp-actif", n > 0);
    UI.$(".lg-cmp-t", barre).innerHTML = n === 1
      ? esc(tr("lg_compare_one")) + '<span class="lg-cmp-plus"> ' + esc(tr("lg_compare_one_more")) + "</span>"
      : esc(tr("lg_compare_n", { n: n }));
    UI.$(".lg-cmp-ouvrir", barre).disabled = n < 2;
    UI.$$('input[data-act="cmp"]', boite).forEach(function (cb) {
      var id = cb.closest(".lg-carte").dataset.id;
      cb.checked = etat.cmp.indexOf(id) >= 0;
      cb.disabled = !cb.checked && n >= MAX_CMP;
      cb.closest(".lg-cmp").title = cb.disabled ? tr("lg_compare_max") : "";
    });
  }

  function ouvrirComparaison() {
    if (etat.cmp.length < 2) return;
    if (typeof window.comparer === "function") window.comparer(etat.cmp.slice(), { etape: etape });
  }

  boite.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (b && boite.contains(b)) {
      var carte = b.closest(".lg-carte"), id = b.dataset.id || (carte && carte.dataset.id), act = b.dataset.act;
      if (act === "cmp") return;           // handled by "change"
      if (!id) return;
      if (act === "choisir") choisir(etape, id);
      else if (act === "fiche" && typeof window.ouvrirFiche === "function") window.ouvrirFiche(id, { etape: etape });
      else if (act === "photos" && typeof window.ouvrirFiche === "function") window.ouvrirFiche(id, { etape: etape, photos: true });
      else if (act === "coeur") { var t = trouver(id, etape); if (t && window.Store) Store.basculerFavori(cleFav(t.l)); }
      return;
    }
    if (ev.target.closest(".lg-voir-autres")) {
      var bt = ev.target.closest(".lg-voir-autres"), corps = UI.$(".lg-autres-corps", boite);
      etat.autresOuverts = corps.hidden;
      corps.hidden = !etat.autresOuverts;
      bt.setAttribute("aria-expanded", String(etat.autresOuverts));
      bt.textContent = etat.autresOuverts ? tr("lg_hide_others") : tr("lg_see_others", { n: autres.length });
      if (etat.autresOuverts && !UI.$('.lg-grille[data-liste="autres"] .lg-carte', boite)) remplir("autres", autres, false);
      return;
    }
    if (ev.target.closest(".lg-cmp-vider")) { etat.cmp = []; majCmp(); return; }
    if (ev.target.closest(".lg-cmp-ouvrir")) ouvrirComparaison();
  });
  boite.addEventListener("change", function (ev) {
    var cb = ev.target.closest('input[data-act="cmp"]');
    if (cb) {
      var id = cb.closest(".lg-carte").dataset.id, i = etat.cmp.indexOf(id);
      if (cb.checked && i < 0 && etat.cmp.length < MAX_CMP) etat.cmp.push(id);
      if (!cb.checked && i >= 0) etat.cmp.splice(i, 1);
      majCmp();
      return;
    }
    var sel = ev.target.closest(".lg-tri select");
    if (sel) {
      etat.tri = sel.value;
      lsEcrire("tri-logement", etat.tri);
      remplir("fiches", logements, true);
      if (etat.autresOuverts) remplir("autres", autres, false);
    }
  });

  remplir("fiches", logements, true);
  rendreChoix();

  return {
    maj: function (c) {
      majCartes();
      poignees.forEach(function (p) {
        if (typeof p.maj === "function") { try { p.maj(c); } catch (e) { if (typeof console !== "undefined") console.error("[lodging] leg update", e); } }
      });
    },
    quitter: function () {
      document.body.classList.remove("lg-cmp-actif");
      poignees.forEach(function (p) { if (typeof p.quitter === "function") { try { p.quitter(); } catch (e) {} } });
    },
  };
}

window.ecranLogements = ecranLogements;
var ECRANS = window.ECRANS = window.ECRANS || {};
ECRANS["logement"] = ecranLogements;
})();
