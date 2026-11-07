/* Outings screens: ECRANS["sorties"] = function (racine, D, choix, ecran) (contract of shell.js); ecran.stage is the stage.

   A list to tick, the outings nearest to the chosen lodging first, with filters by kind; three photos, the price for the
   trip's people, the essentials as icons, "More details" on click (why go, hours, access, included, book on each site
   with its price). For each special evening of the stage (TRIP.specialsAt(stage)), a block: several options side by
   side, one chosen (choix.speciales[<key>]); a mandatory gala dinner of the chosen lodging (a "gala" line with that
   special) is shown as an option already counted. The outings outside your days at the stage (placementSorties of
   days.js) are under "outside your dates". The details show the outing's videos (logement.js tile).

   Read: D.lieux[stage] (lodgings, outings), D.jours (sunrise and sunset), the trip (creerTrip), the choices
   (choix[stage], choix.sorties, choix.speciales), placerSorties (days.js) and lignesVoyage / totaux (budget.js). Writes
   with patchChoix (store.js): one field at a time, never the whole outings table.
   Texts through T(), money through fmtMoney. Pure functions exported for tests/js/sorties-ui.test.js. */
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
function peutRequire() { return typeof module !== "undefined" && typeof require === "function"; }

/* ======================================================================================================
   PHOTOS: the only place where an outing becomes image addresses.
   photosSortie(sortie, taille) -> Promise<[url]>; "s" = the small ones (cards), "l" = the large ones. Only the site's
   files ("media/photos/…") pass. No photo: an empty list (the card keeps its tile), never an error.
   ====================================================================================================== */
var RE_PHOTO = /^media\/photos\/[\w.\/-]+\.jpg$/;
function photosSortie(sortie, taille) {
  var g = sortie && sortie.galerie;
  var liste = g ? (taille === "l" ? g.grandes : g.petites) : null;
  if (!Array.isArray(liste)) return Promise.resolve([]);
  var urls = liste.filter(function (u, i) {
    return typeof u === "string" && RE_PHOTO.test(u) && u.indexOf("..") < 0 && liste.indexOf(u) === i;   // no gap, no duplicate
  });
  return Promise.resolve(urls);
}

/* ======================================================================================================
   Constants
   ====================================================================================================== */
var PAGE = 12;                 // outings shown first; "See more" adds as many
var OPTIONS_VUES = 6;          // options of a block shown first on a large screen
var GENRES = [
  { cle: "voir", couleur: "--c-voir" },
  { cle: "faire", couleur: "--c-faire" },
  { cle: "manger", couleur: "--c-manger" },
  { cle: "boire", couleur: "--c-boire" },
  { cle: "bienetre", couleur: "--c-bienetre" },
  { cle: "agenda", couleur: "--c-agenda" },
];
var GENRES_CLES = {};
GENRES.forEach(function (g) { GENRES_CLES[g.cle] = g; });
var CLES_GENRES = { voir: "so_kind_voir", faire: "so_kind_faire", manger: "so_kind_manger", boire: "so_kind_boire", bienetre: "so_kind_bienetre", agenda: "so_kind_agenda" };
function libGenre(cle) { return tr(CLES_GENRES[cle] || CLES_GENRES.faire); }
var QUAND = { maintenant: { cle: "so_when_now", urgent: true }, vite: { cle: "so_when_soon", urgent: true },
  veille: { cle: "so_when_day_before", urgent: false }, sans: { cle: "so_when_no_booking", urgent: false } };
// Units of the lodging an outing replaces (as budget.js): a restaurant replaces 1 dinner, a bar 2 drinks (one each)
var UNITE_RE = { diners: /dinner|d(?:i|\u00ee)ner/i, dejeuners: /lunch|d(?:e|\u00e9)jeuner/i, verres: /drink|cocktail|glass|verre/i, spa: /massage/i };
var NB_UNITES = { verres: 2 };
var CLES_UNITES = { diners: "so_unit_diners", dejeuners: "so_unit_dejeuners", verres: "so_unit_verres", spa: "so_unit_spa" };

/* ======================================================================================================
   Formats
   ====================================================================================================== */
function nombre(x) { return typeof x === "number" && isFinite(x); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
function argent(n) { return nombre(n) ? I18().fmtMoney(n, "home") : ""; }
function ecartTxt(n) {
  if (!nombre(n)) return "";
  var r = Math.round(n);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + argent(Math.abs(r));
}
function estDate(x) { return typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x); }
function dateCourte(iso) { return estDate(iso) ? I18().fmtDate(iso.slice(0, 10)) : ""; }
function dateLongue(iso) { return estDate(iso) ? I18().fmtDate(iso.slice(0, 10), "weekday") : ""; }
function langue() { var t = I18().T; return typeof t.lang === "function" ? t.lang() : "en"; }
function decimal(x, n) {
  try { return new Intl.NumberFormat(langue(), { minimumFractionDigits: n, maximumFractionDigits: n }).format(x); } catch (e) { return x.toFixed(n); }
}
/* "Jun 21 → 23", "Jun 29 → Jul 3" */
function plage(du, au) {
  var a = /^(\d{4})-(\d{2})-(\d{2})/.exec(du || ""), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(au || "");
  if (!a || !b) return "";
  if (a[1] === b[1] && a[2] === b[2]) {
    var jour = function (d) { return Number(d) === 1 ? tr("date_first_day") : String(Number(d)); };
    var mois = tr("months_short");
    return tr("ui_range_same_month", { m: Array.isArray(mois) ? mois[Number(a[2]) - 1] : "", d1: jour(a[3]), d2: jour(b[3]) });
  }
  return tr("ui_range", { from: dateCourte(du), to: dateCourte(au) });
}
function majuscule(t) { t = String(t || ""); return t.charAt(0).toUpperCase() + t.slice(1); }
function clip(t, n) {
  t = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…";
}
function pourTous(D) { return tr("for_n_people", { n: D ? cfg(D).adults : 1 }); }

/* ======================================================================================================
   Pure functions
   ====================================================================================================== */
function estCochee(choix, id) { return !!(choix && choix.sorties && choix.sorties[id]); }

/* The choices with these outings on top (false = unticked); changes nothing. */
function choixAvec(choix, sortiesPatch) {
  var c = Object.assign({}, choix);
  c.sorties = Object.assign({}, choix && choix.sorties, sortiesPatch);
  return c;
}

/* The day by day's logic (days.js): a global in the page, require under node; null when missing. */
function joursLogic() {
  if (typeof placementSorties === "function") return { placementSorties: placementSorties };
  if (peutRequire()) { try { return require("../logic/days.js"); } catch (e) { return null; } }
  return null;
}
/* Your days at the stage [du, au]: with the choices, the day by day's (placementSorties(choix, D).fenetres: the arrivals,
   the day you leave the last lodging); without choices or without days.js, the stage's dates. */
function fenetre(D, etape, choix) {
  if (choix && typeof choix === "object") {
    var J = joursLogic();
    try {
      var f = J && J.placementSorties(choix, D);
      var w = f && f.fenetres && f.fenetres[etape];
      if (w && estDate(w.du) && estDate(w.au)) return [w.du.slice(0, 10), w.au.slice(0, 10)];
    } catch (err) { /* back to the stage's dates */ }
  }
  var st = D ? cfg(D).stage(etape) : null;
  return st ? [st.from, st.to] : ["", ""];
}

/* The page's shared module: the video tile of the fiches (logement.js, LogementsUI.aide). */
function aideLogement() {
  if (typeof window !== "undefined" && window.LogementsUI && window.LogementsUI.aide) return window.LogementsUI.aide;
  if (peutRequire()) { try { return require("./logement.js"); } catch (e) { return null; } }
  return null;
}

function logementChoisi(D, etape, choix) {
  var L = D && D.lieux && D.lieux[etape], id = choix && choix[etape];
  if (!L || !id) return null;
  return [].concat(L.logements || [], L.autres || []).filter(function (x) { return x && x.id === id; })[0] || null;
}

/* ---------- distance ---------- */
function distanceKm(a, b) {
  if (!a || !b || !nombre(a.lat) || !nombre(a.lng) || !nombre(b.lat) || !nombre(b.lng)) return null;
  var R = 6371, rad = Math.PI / 180;
  var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* [{s, km}] nearest to `origine` (the chosen lodging) first; without coordinates last, by interest. */
function trierParDistance(liste, origine) {
  return (liste || []).map(function (s, i) { return { s: s, km: distanceKm(origine, s), i: i }; }).sort(function (a, b) {
    var sa = nombre(a.s.score) ? a.s.score : 0, sb = nombre(b.s.score) ? b.s.score : 0;
    if (a.km == null && b.km == null) return (sb - sa) || (a.i - b.i);
    if (a.km == null) return 1;
    if (b.km == null) return -1;
    return (a.km - b.km) || (sb - sa) || (a.i - b.i);
  }).map(function (x) { return { s: x.s, km: x.km }; });
}
function texteDistance(km, approx) {
  if (!nombre(km)) return "";
  var dixieme = Math.round(km * 10) / 10;
  var t = km < 1 ? Math.max(50, Math.round(km * 20) * 50) + " m" : dixieme < 10 ? decimal(dixieme, 1) + " km" : Math.round(km) + " km";
  return (approx ? "≈ " : "") + t;
}

/* ---------- kinds and filters ---------- */
function genreDe(s) { return s && GENRES_CLES[s.groupe] ? s.groupe : "faire"; }
function passeFiltre(entree, filtre, choix) {
  if (!filtre || filtre === "tout") return true;
  if (filtre === "cochees") return estCochee(choix, entree.s.id);
  return genreDe(entree.s) === filtre;
}
function filtrer(entrees, filtre, choix) { return (entrees || []).filter(function (e) { return passeFiltre(e, filtre, choix); }); }
function compterGenres(entrees, choix) {
  var n = { tout: 0, cochees: 0 };
  GENRES.forEach(function (g) { n[g.cle] = 0; });
  (entrees || []).forEach(function (e) {
    n.tout++;
    n[genreDe(e.s)]++;
    if (estCochee(choix, e.s.id)) n.cochees++;
  });
  return n;
}

/* ---------- dates: outside the stage, special evenings ---------- */
function horsDates(s, fen) {
  if (!s) return false;
  if (estDate(s.date_fixe)) { var d = s.date_fixe.slice(0, 10); return d < fen[0] || d > fen[1]; }
  var ds = Array.isArray(s.dates) ? s.dates : [];
  if (ds.length && ds.every(estDate)) return !ds.some(function (x) { var j = x.slice(0, 10); return j >= fen[0] && j <= fen[1]; });
  return false;   // dates in free text: no known constraint
}
/* { liste, blocs: {<special key>: [s]}, hors }: the outings of the ticking list, the options of each special evening of
   the stage, those outside your dates. gardes = choix.speciales: the option chosen in a block stays in its block. */
function repartirSorties(sorties, fen, cles, gardes) {
  var out = { liste: [], blocs: {}, hors: [] };
  (cles || []).forEach(function (k) { out.blocs[k] = []; });
  var g = gardes && typeof gardes === "object" ? gardes : {};
  (sorties || []).forEach(function (s) {
    var k = s && typeof s.speciale === "string" && out.blocs[s.speciale] ? s.speciale : null;
    if (k && g[k] === s.id) out.blocs[k].push(s);
    else if (horsDates(s, fen)) out.hors.push(s);
    else if (k) out.blocs[k].push(s);
    else out.liste.push(s);
  });
  return out;
}
function raisonHorsDates(s, nomEtape, fen) {
  var vars = { stage: nomEtape, range: plage(fen[0], fen[1]) };
  return estDate(s.date_fixe) ? tr("so_out_of_dates_day", Object.assign({ date: dateCourte(s.date_fixe) }, vars)) : tr("so_out_of_dates_dates", vars);
}

function prixTri(s) { return nombre(s.prix_couple_home) ? s.prix_couple_home : Infinity; }
function ordonnerOptions(options, tri) {
  var liste = (options || []).slice();
  var score = function (s) { return nombre(s.score) ? s.score : 0; };
  liste.sort(function (a, b) {
    var pa = prixTri(a), pb = prixTri(b), c;
    if (tri === "prix") c = pa === pb ? 0 : pa < pb ? -1 : 1;
    else if (tri === "date") {   // the day, then the departure time
      var da = a.date_fixe || "9999", db = b.date_fixe || "9999";
      c = da < db ? -1 : da > db ? 1 : 0;
      if (!c) { var ha = a.depart || "99:99", hb = b.depart || "99:99"; c = ha < hb ? -1 : ha > hb ? 1 : 0; }
    } else { c = score(b) - score(a); if (!c) c = pa === pb ? 0 : pa < pb ? -1 : 1; }
    if (!c && tri !== "pertinence") c = score(b) - score(a);
    return c || String(a.nom || "").localeCompare(String(b.nom || ""));
  });
  return liste;
}

/* Gala dinner imposed by the chosen lodging for this special evening: { lib, n, u, total, src, inclus } or null.
   A "gala" line of the fiche tied to this special (line.speciale); a line without a special belongs to the stage's only
   special evening (seule: true). */
function galaDuLogement(logement, cle, seule) {
  var lignes = logement && Array.isArray(logement.lignes) ? logement.lignes : [];
  var mien = lignes.filter(function (l) {
    if (!l || l.cle !== "gala") return false;
    return l.speciale ? l.speciale === cle : !!seule;
  });
  if (!mien.length) return null;
  var total = 0, n = 0, inclus = true;
  mien.forEach(function (l) {
    var m = nombre(l.n) && nombre(l.u) ? l.n * l.u : 0;
    total += m;
    n += nombre(l.n) ? l.n : 0;
    if (l.src !== "inclus") inclus = false;
  });
  var premier = mien[0];
  return {
    lib: premier.lib, n: mien.length === 1 ? premier.n : n, u: mien.length === 1 ? premier.u : null, total: total,
    src: premier.src, inclus: inclus && total === 0,
  };
}

/* The blocks of the stage's special evenings: [{cle, special, titre, sur, options, gala}]; [] without any. */
function blocsDeLEtape(etape, D, choix, fen) {
  var trip = cfg(D), sp = trip.specialsAt(etape), st = trip.stage(etape);
  if (!sp.length) return [];
  var L = (D.lieux && D.lieux[etape]) || {};
  var f = fen || fenetre(D, etape, choix);
  var parts = repartirSorties(L.sorties, f, sp.map(function (x) { return x.key; }), choix && choix.speciales);
  var lg = logementChoisi(D, etape, choix);
  return sp.map(function (x) {
    return {
      cle: x.key, special: x, titre: x.title,
      sur: tr("so_special_over", { stage: st ? st.title : etape, date: dateLongue(x.date) }),
      options: parts.blocs[x.key] || [], gala: galaDuLogement(lg, x.key, sp.length === 1),
    };
  });
}

/* ---------- what is said about an outing ---------- */
function prixSortie(s) {
  var p = s ? s.prix_couple_home : null;
  if (!nombre(p)) return { etat: "inconnu", montant: null, estime: false };
  return { etat: p === 0 ? "gratuit" : "connu", montant: p, estime: s.prix_estime === true };
}
function dureeTexte(min) {
  if (!nombre(min) || min <= 0) return "";
  if (min < 60) return tr("dur_min", { m: Math.round(min) });
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? tr("dur_h_min", { h: h, mm: (m < 10 ? "0" : "") + m }) : tr("dur_h", { h: h });
}
function uneLigne(s) {
  var t = String((s && (s.resume || s.sous_type)) || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  var m = /^(.{40,}?[.!?])(\s|$)/.exec(t);
  var p = m ? m[1] : t;
  return p.length > 150 ? p.slice(0, 150).replace(/\s+\S*$/, "") + "…" : p;
}
function meilleureNote(s) {
  var best = null;
  ((s && s.notes) || []).forEach(function (n) {
    if (n && nombre(n.note) && (!best || (n.avis || 0) > (best.avis || 0))) best = n;
  });
  return best;
}
function texteNote(n) {
  if (!n || !nombre(n.note)) return "";
  return decimal(n.note, 1) + (nombre(n.avis) && n.avis > 0 ? " · " + tr("so_reviews", { n: n.avis }) : "");
}
/* The mood of an outing, from its tags (research files in English or French). */
var HUMEURS = /^(romantic|romantique|quiet|calm|sans foule|private|priv[\u00e9e]|view|vue|sunset|coucher de soleil|sunrise|lever de soleil)$/i;
function humeur(s) {
  return ((s && s.tags) || []).filter(function (t) { return HUMEURS.test(String(t)); }).slice(0, 2).join(", ");
}
function quandReserver(cle) { return QUAND[cle] ? { libelle: tr(QUAND[cle].cle), urgent: QUAND[cle].urgent } : null; }

/* Deadline and price rise (else: the right moment to book): { date, texte, urgent }. */
function echeance(s) {
  var h = s && s.hausse;
  if (h && estDate(h.avant)) {
    var apres = nombre(h.prix_apres_home) ? tr("so_then_price", { price: argent(h.prix_apres_home) }) : tr("so_price_rises");
    return { date: h.avant.slice(0, 10), texte: tr("so_book_before", { date: dateCourte(h.avant), after: apres }), urgent: true };
  }
  var q = quandReserver(s && s.quand_reserver);
  return q ? { date: null, texte: q.libelle, urgent: q.urgent } : { date: null, texte: "", urgent: false };
}

/* Dress code: the field `tenue`, else the sentence "dress code …" written in the outing's texts. */
function tenueDe(s) {
  if (!s) return null;
  if (typeof s.tenue === "string" && s.tenue.trim()) return s.tenue.trim();
  var textes = [s.acces].concat(s.pas_compris || [], s.compris || [], [s.fetes, s.horaires, s.resume, s.pourquoi, s.meilleur_moment]);
  for (var i = 0; i < textes.length; i++) {
    if (typeof textes[i] !== "string") continue;
    var m = /\b(?:tenue|dress ?code)\b\s*:?\s*([^.;\n]{3,100})/i.exec(textes[i]);
    if (m) return clip(m[1].replace(/[\s,"»]+$/, ""), 90);
  }
  return null;
}

function liensReservation(s) {
  var ok = function (u) { return typeof u === "string" && /^https?:\/\//i.test(u); };
  var liens = ((s && s.liens) || []).filter(function (l) { return l && ok(l.url); }).map(function (l, i) {
    return { site: l.site || tr("so_site"), url: l.url, prix: nombre(l.prix_home) ? l.prix_home : null, verifie: l.verifie || null, i: i, meilleur: false };
  });
  liens.sort(function (a, b) {
    if (a.prix == null && b.prix == null) return a.i - b.i;
    if (a.prix == null) return 1;
    if (b.prix == null) return -1;
    return (a.prix - b.prix) || (a.i - b.i);
  });
  if (liens.length && liens[0].prix != null) liens[0].meilleur = true;
  if (!liens.length && s) {
    if (ok(s.lien_reservation)) liens.push({ site: tr("so_book"), url: s.lien_reservation, prix: null, verifie: null, i: 0, meilleur: false });
    if (ok(s.lien) && s.lien !== s.lien_reservation) liens.push({ site: tr("so_more_info"), url: s.lien, prix: null, verifie: null, i: 1, meilleur: false });
  }
  return liens.map(function (l) { delete l.i; return l; });
}

/* ---------- days ---------- */
function jourPlus(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function joursProposables(s, fen) {
  if (s && estDate(s.date_fixe)) return [];
  var out = [];
  if (!estDate(fen[0]) || !estDate(fen[1])) return out;
  for (var d = fen[0]; d <= fen[1]; d = jourPlus(d, 1)) out.push(d);
  var ds = s && Array.isArray(s.dates) ? s.dates : [];
  if (ds.length && ds.every(estDate)) {
    var dispo = ds.map(function (x) { return x.slice(0, 10); });
    out = out.filter(function (d) { return dispo.indexOf(d) >= 0; });
  }
  return out;
}
/* The outing's day: chosen, else placed by the day by day, else its fixed date. */
function jourDe(id, s, choix, placees) {
  var e = choix && choix.sorties ? choix.sorties[id] : null;
  var choisi = e && typeof e === "object" && estDate(e.jour) ? e.jour.slice(0, 10) : null;
  var fixe = !!s && estDate(s.date_fixe);
  var jour = choisi || (fixe ? s.date_fixe.slice(0, 10) : placees && placees[id]) || null;
  return { jour: jour, choisi: !!choisi, fixe: fixe };
}
function soleilDuJour(D, date) {
  var j = D && Array.isArray(D.jours) ? D.jours.filter(function (x) { return x && x.date === date; })[0] : null;
  return j ? { date: date, lever: j.lever || null, coucher: j.coucher || null } : null;
}
/* "departure 06:00 · sunrise 06:32"; jour = {lever, coucher}; approx: the day is not fixed yet. */
function texteHoraire(s, jour, approx) {
  var parts = [];
  if (s && s.depart) parts.push(tr(genreDe(s) === "faire" ? "so_departure_at" : "so_at", { time: s.depart }));
  if (jour && s) {
    if (s.moment === "aube" && jour.lever) parts.push(tr(approx ? "so_sunrise_about" : "so_sunrise", { time: jour.lever }));
    else if (s.moment === "coucher" && jour.coucher) parts.push(tr(approx ? "so_sunset_about" : "so_sunset", { time: jour.coucher }));
  }
  return parts.join(" · ");
}

/* ---------- effect on the budget and the "replaces" sentence ---------- */
function calcDefaut() {
  if (typeof lignesVoyage === "function" && typeof totaux === "function") return { lignesVoyage: lignesVoyage, totaux: totaux };
  if (peutRequire()) { try { var B = require("../logic/budget.js"); return { lignesVoyage: B.lignesVoyage, totaux: B.totaux }; } catch (e) { return null; } }
  return null;
}
/* "replaces 1 dinner planned at the lodging" (rem = { n, cle }). */
function libRemplace(rem, conditionnel) {
  var unite = tr(rem.cle && CLES_UNITES[rem.cle] ? CLES_UNITES[rem.cle] : "so_unit_item", { n: rem.n });
  return tr(conditionnel ? "so_would_replace" : "so_replaces", { n: rem.n, unit: unite });
}
/* Without the budget module: what the outing replaces in the lodging's fiche, { cle, n, u } where u is the amount
   removed (n units, as budget.js: 1 dinner, 2 drinks); null when there is nothing to replace. */
function uniteRemplacee(lignes, s) {
  var cle = s && s.remplace;
  if (!cle) return null;
  var re = UNITE_RE[cle], voulu = NB_UNITES[cle] || 1, n = 0, montant = 0;
  (lignes || []).forEach(function (x) {
    if (n >= voulu || !x || x.cle !== cle || x.src === "inclus" || !nombre(x.n) || x.n < 1 || !nombre(x.u) || x.u <= 0) return;
    if (re && !re.test(x.lib || "")) return;
    var k = Math.min(voulu - n, Math.floor(x.n));
    n += k;
    montant += k * x.u;
  });
  return n ? { cle: cle, n: n, u: montant } : null;
}
/* "replaces 1 dinner planned at the lodging: +$85 − $100 = −$15" (the result is the difference of the two amounts). */
function phraseRemplace(rem, prix) {
  if (!rem || !nombre(rem.u)) return "";
  if (!nombre(prix)) return tr("so_replace_unknown", { text: libRemplace(rem, true), amount: argent(rem.u) });
  var a = Math.round(prix), b = Math.round(rem.u);
  return tr("so_replaces_calc", { text: libRemplace(rem), price: argent(a), removed: argent(b), result: ecartTxt(a - b) });
}

/* Simulates a change of choices: { total, lignes } or null without the budget module. */
function simuler(calc, D, choix, patch) {
  if (!calc) return null;
  try {
    var lignes = calc.lignesVoyage(Object.assign({}, choix, patch), D);
    return { lignes: lignes, total: calc.totaux(lignes, D ? cfg(D).budgetCap : null).total };
  } catch (e) { return null; }
}
function unePaire(cle, valeur) { var o = {}; o[cle] = valeur; return o; }
/* The lodging's unit the outing replaces: the budget's "remplace" lines when it exists, else the lodging's fiche. */
function remplaceDe(s, choix, D, avec) {
  if (!s.remplace || !nombre(s.prix_couple_home)) return null;
  if (avec) {
    var lignes = avec.lignes.filter(function (x) { return x && x.cle === "remplace" && x.sortie === s.id && nombre(x.u) && nombre(x.n); });
    if (!lignes.length) return null;
    var n = 0, montant = 0;
    lignes.forEach(function (x) { n += -x.n; montant += -x.n * x.u; });   // each line removes units (n < 0)
    return n > 0 ? { cle: s.remplace, n: n, u: montant } : null;
  }
  var lg = logementChoisi(D, s.etape, choix);
  return uniteRemplacee(lg && lg.lignes, s);
}
function prixManque(avec, s) {
  return !!avec && avec.lignes.some(function (l) { return l && l.sortie === s.id && l.incomplet === true; });
}
/* What ticking this outing changes: { montant, incomplet, remplace: {cle, n, u}|null } (whatever its state).
   With "remplace", the effect is the difference of the sentence's two amounts (+$85 − $100 = −$15). */
function effetSortie(s, choix, D, calc) {
  var ouverte = Object.assign({}, choix && choix.sorties);
  var avec = simuler(calc, D, choix, { sorties: Object.assign({}, ouverte, unePaire(s.id, ouverte[s.id] || { jour: null })) });
  var sans = simuler(calc, D, choix, { sorties: Object.assign({}, ouverte, unePaire(s.id, false)) });
  var prix = s.prix_couple_home;
  if (!nombre(prix)) return { montant: null, incomplet: true, remplace: null };
  var rem = remplaceDe(s, choix, D, avec);
  var m = rem ? Math.round(prix) - Math.round(rem.u) : avec && sans ? avec.total - sans.total : prix;
  return { montant: m, incomplet: prixManque(avec, s), remplace: rem };
}
function avecSpeciale(choix, cle, valeur) { return { speciales: Object.assign({}, choix && choix.speciales, unePaire(cle, valeur)) }; }
/* The same for an option of a special evening: the difference with what is chosen now. */
function effetOption(s, cle, choix, D, calc) {
  var avec = simuler(calc, D, choix, avecSpeciale(choix, cle, s.id));
  var actuel = simuler(calc, D, choix, {});
  var prix = s.prix_couple_home;
  if (!nombre(prix)) return { montant: null, incomplet: true, remplace: null };
  var rem = remplaceDe(s, choix, D, avec);
  var m = avec && actuel ? avec.total - actuel.total : rem ? Math.round(prix) - Math.round(rem.u) : prix;
  return { montant: m, incomplet: prixManque(avec, s), remplace: rem };
}
/* What "no option" changes compared with the current choice, or null without the budget module. */
function effetAucune(cle, choix, D, calc) {
  var sans = simuler(calc, D, choix, avecSpeciale(choix, cle, false));
  var actuel = simuler(calc, D, choix, {});
  return sans && actuel ? sans.total - actuel.total : null;
}

/* Effect on the budget and the margin left, the same words as the flights and the lodgings:
   "+$149 to the budget · margin $351", "+$600 to the budget · $100 over $6,000"; no cap: no margin. "" without amount. */
function texteEffetBudget(montant, tot) {
  if (!nombre(montant)) return "";
  var r = Math.round(montant);
  var t = r === 0 ? tr("ui_same_budget") : tr("ui_to_budget", { amount: ecartTxt(montant) });
  if (tot && nombre(tot.marge)) {
    var m = tot.marge - montant;
    var marge = m >= 0 ? tr("ui_margin", { amount: argent(m) }) : tr("ui_over_cap", { amount: argent(-m), cap: argent(tot.plafond) });
    t += " · " + (tot.incomplet ? tr("ui_approx_incomplete", { text: marge }) : marge);
  }
  return t;
}

/* The ticked outings of the stage (among `ids`): how many, for how much (replacements included), is a price missing. */
function resumeSorties(lignes, etape, ids) {
  var vus = {}, total = 0, incomplet = false;
  (lignes || []).forEach(function (l) {
    if (!l || !l.sortie || l.etape !== etape || ids.indexOf(l.sortie) < 0) return;
    vus[l.sortie] = true;
    if (nombre(l.n) && nombre(l.u)) total += l.n * l.u;
    if (l.incomplet === true || !nombre(l.u)) incomplet = true;
  });
  return { n: Object.keys(vus).length, total: total, incomplet: incomplet };
}

/* The writes: one field at a time (the outings table is never sent whole). */
function patchSortie(id, coche, jour) {
  var o = {};
  o[id] = coche ? { jour: estDate(jour) ? jour : null } : false;
  return ["sorties", o];
}
function patchBloc(cle, id) { return ["speciales", unePaire(cle, id || false)]; }

/* ======================================================================================================
   Rendering
   ====================================================================================================== */
function svg(chemin, plein) {
  return '<svg viewBox="0 0 24 24" fill="' + (plein ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + chemin + "</svg>";
}
var ICONE = {
  horloge: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  soleil: svg('<circle cx="12" cy="14" r="4"/><path d="M3 20h18M12 4v3"/>'),
  lieu: svg('<path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  coeur: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>'),
  etoile: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
  calendrier: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
  alerte: svg('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  tenue: svg('<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>'),
  image: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  couvert: svg('<path d="M7 3v6a2 2 0 0 0 2 2v10M11 3v6a2 2 0 0 1-2 2M17 3c-2 2-3 5-3 8h3v10"/>'),
  lune: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
};
function puce(icone, texte, cls) {
  return '<li class="so-p' + (cls ? " " + cls : "") + '">' + ICONE[icone] + "<span>" + esc(texte) + "</span></li>";
}

function htmlPhotos(s, taille) {
  var n = Math.min(3, s && s.galerie && Array.isArray(s.galerie.petites) ? s.galerie.petites.length : 0);
  if (taille === "l") n = Math.min(1, n);
  if (!n) return '<div class="so-photos vide" data-n="0">' + ICONE.image + "</div>";
  var cases = "";
  for (var i = 0; i < n; i++) cases += '<span class="so-ph"></span>';
  return '<div class="so-photos" data-n="' + n + '" data-taille="' + taille + '">' + cases + "</div>";
}

function htmlPrix(s, cls, D) {
  var p = prixSortie(s);
  var haut = p.etat === "gratuit" ? "<b>" + esc(tr("so_free")) + "</b>" : p.etat === "inconnu" ? '<b class="so-aver">' + esc(tr("price_to_check")) + "</b>" : "<b>" + esc(argent(p.montant)) + "</b>";
  var bas = p.etat === "connu" ? "<span>" + esc(pourTous(D)) + "</span>" : "";
  var src = p.etat === "inconnu" ? "" : p.estime ? '<em class="so-est">' + esc(tr("lg_src_estimated")) + "</em>"
    : '<span class="so-src d-only">' + esc(tr("lg_src_published")) + (s.verifie ? " · " + esc(tr("so_checked_on", { date: dateCourte(s.verifie) })) : "") + "</span>";
  return '<div class="so-prix' + (cls ? " " + cls : "") + '">' + haut + bas + src + "</div>";
}

function htmlCompris(s, avecPas) {
  var c = (s.compris || []).slice(0, 2).map(function (x) { return esc(clip(x, 80)); });
  var h = c.length ? '<p class="so-comprend"><b>' + esc(tr("so_d_included")) + "</b> " + c.join(" · ") + "</p>" : "";
  var pas = avecPas ? (s.pas_compris || [])[0] : null;
  if (pas) h += '<p class="so-comprend so-pas"><b>' + esc(tr("so_d_not_included")) + "</b> " + esc(clip(pas, 90)) + "</p>";
  return h;
}

function htmlListe(titre, items, cls) {
  var l = (items || []).filter(Boolean);
  return l.length ? '<section class="so-d ' + (cls || "") + '"><h4>' + esc(titre) + "</h4><ul>" + l.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></section>" : "";
}
function htmlTexte(titre, texte, cls) {
  return texte ? '<section class="so-d ' + (cls || "") + '"><h4>' + esc(titre) + "</h4><p>" + esc(texte) + "</p></section>" : "";
}

/* The outing's videos: the same tile as a lodging's fiche (logement.js); thumbnails load when the details open. */
function htmlVideosSortie(s) {
  var A = aideLogement();
  return A && typeof A.htmlVideos === "function" ? A.htmlVideos(s && s.videos, { sous: tr("so_videos_sub") }) : "";
}

function htmlDetails(s, ent) {
  var h = htmlVideosSortie(s);
  h += htmlTexte(tr("so_d_why"), s.pourquoi);
  h += htmlTexte(tr("so_d_hours"), s.horaires);
  h += htmlTexte(tr("so_d_best"), s.meilleur_moment);
  var acces = s.acces || "";
  if (ent && nombre(ent.km)) acces = (acces ? acces.replace(/\s*\.?\s*$/, ". ") : "") + tr("so_d_distance", { dist: texteDistance(ent.km, s.approx) });
  h += htmlTexte(tr("so_d_access"), acces);
  h += '<div class="so-d2">' + htmlListe(tr("so_d_included"), s.compris) + htmlListe(tr("so_d_not_included"), s.pas_compris) + "</div>";
  var rez = s.reserver_quand || "";
  var ech = echeance(s);
  if (s.hausse && ech.texte) rez = (rez ? rez + " " : "") + tr("so_d_price", { text: ech.texte });
  h += htmlTexte(tr("so_d_book"), rez);
  h += htmlTexte(tr("so_d_crowds"), s.fetes, "d-only");
  if (s.prix) h += htmlTexte(tr("so_d_price_read", { kind: tr(s.prix_estime ? "lg_src_estimated" : "lg_src_published") }), s.prix, "d-only");
  var notes = (s.notes || []).filter(function (n) { return n && nombre(n.note); }).map(function (n) {
    return tr("label_value", { label: n.site, value: texteNote(n) });
  });
  h += htmlListe(tr("so_d_reviews"), notes, "d-only");
  var liens = liensReservation(s);
  if (liens.length) {
    h += '<section class="so-d"><h4>' + esc(tr("so_d_book_sites")) + '</h4><div class="so-liens">' + liens.map(function (l) {
      var prix = l.prix != null ? esc(argent(l.prix)) : esc(tr("price_to_check"));
      return '<a class="so-lien' + (l.meilleur ? " meilleur" : "") + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(l.site) + " · " + prix + " ↗" + (l.verifie ? '<small class="d-only"> ' + esc(tr("so_checked_on", { date: dateCourte(l.verifie) })) + "</small>" : "") + "</a>";
    }).join("") + "</div></section>";
  }
  return h;
}

function htmlCarte(s, ent, D) {
  var g = GENRES_CLES[genreDe(s)];
  var puces = [];
  var d = dureeTexte(s.duree_min);
  if (d) puces.push(puce("horloge", d));
  if (estDate(s.date_fixe)) puces.push(puce("calendrier", tr("so_on_date", { date: dateLongue(s.date_fixe) })));
  puces.push('<li class="so-p" data-v="horaire" hidden>' + ICONE.soleil + "<span></span></li>");
  if (ent && nombre(ent.km)) puces.push(puce("lieu", tr("so_from_lodging", { dist: texteDistance(ent.km, s.approx) })));
  if (s.incontournable) puces.push(puce("etoile", tr("so_must_see"), "bon"));
  var h = humeur(s);
  if (h) puces.push(puce("coeur", h, "bon"));
  var note = meilleureNote(s);
  if (note) puces.push(puce("etoile", texteNote(note)));
  var ech = echeance(s);
  if (ech.texte) puces.push(puce(ech.urgent ? "alerte" : "calendrier", ech.texte, ech.urgent ? "att" : ""));
  var ligne = uneLigne(s);
  return '<article class="so-carte" data-id="' + esc(s.id) + '" data-genre="' + g.cle + '" style="--k:var(' + g.couleur + ')" hidden>' +
    htmlPhotos(s, "s") + '<span class="so-genre"><i></i>' + esc(libGenre(g.cle)) + "</span>" +
    '<div class="so-corps"><div class="so-haut"><div class="so-titre"><h3 class="so-nom">' + esc(s.nom) + "</h3>" +
    (ligne ? '<p class="so-ligne">' + esc(ligne) + "</p>" : "") + "</div>" + htmlPrix(s, "", D) + "</div>" +
    htmlCompris(s, false) +
    '<ul class="so-puces">' + puces.join("") + "</ul>" +
    '<p class="so-remplace" data-v="remplace" hidden></p>' +
    '<div class="so-actions"><button type="button" class="so-plus" data-act="plus" aria-expanded="false">' + ICONE.chevron + "<span>" + esc(tr("so_more_details")) + "</span></button>" +
    '<span class="so-jour" data-v="jour" hidden></span>' +
    '<button type="button" class="so-ajout" data-act="cocher" aria-pressed="false"><span class="so-ajout-t">' + esc(tr("so_add")) + '</span><span class="so-eff" data-v="effet"></span></button></div>' +
    '<div class="so-details" data-v="details" hidden>' + htmlDetails(s, ent) + "</div></div></article>";
}

function htmlOption(s, cle, D) {
  var g = GENRES_CLES[genreDe(s)];
  var tenue = tenueDe(s);
  var ech = echeance(s);
  var quand = [estDate(s.date_fixe) ? dateCourte(s.date_fixe) : "", s.depart ? s.depart : ""].filter(Boolean).join(" · ");
  var lignes = "";
  if (tenue) lignes += '<li class="so-p">' + ICONE.tenue + "<span>" + esc(tr("so_dress", { text: tenue })) + "</span></li>";
  else lignes += '<li class="so-p mute">' + ICONE.tenue + "<span>" + esc(tr("so_dress_unknown")) + "</span></li>";
  if (ech.texte) lignes += '<li class="so-p' + (ech.urgent ? " att" : "") + '">' + ICONE[ech.urgent ? "alerte" : "calendrier"] + "<span>" + esc(majuscule(ech.texte)) + "</span></li>";
  var note = meilleureNote(s);
  if (note) lignes += '<li class="so-p">' + ICONE.etoile + "<span>" + esc(texteNote(note)) + "</span></li>";
  return '<article class="so-opt" data-opt="' + esc(s.id) + '" data-champ="' + esc(cle) + '" style="--k:var(' + g.couleur + ')">' +
    htmlPhotos(s, "l") + (quand ? '<span class="so-genre"><i></i>' + esc(quand) + "</span>" : "") +
    '<div class="so-corps"><h3 class="so-nom">' + esc(s.nom) + "</h3>" + htmlPrix(s, "ligne", D) + htmlCompris(s, true) +
    '<ul class="so-puces col">' + lignes + "</ul>" +
    '<p class="so-remplace" data-v="remplace" hidden></p>' +
    '<div class="so-actions"><button type="button" class="so-plus" data-act="plus" aria-expanded="false">' + ICONE.chevron + "<span>" + esc(tr("so_more_details")) + "</span></button>" +
    '<button type="button" class="so-ajout so-choisir" data-act="choisir" data-champ="' + esc(cle) + '" data-id="' + esc(s.id) + '" aria-pressed="false"><span class="so-ajout-t">' +
    esc(tr("so_choose")) + '</span><span class="so-eff" data-v="effet"></span></button></div>' +
    '<div class="so-details" data-v="details" hidden>' + htmlDetails(s, null) + "</div></div></article>";
}

function htmlAucune(cle, gala, nomLogement) {
  var titre, texte, prix = "";
  if (gala) {
    titre = majuscule(gala.lib);
    texte = tr("so_gala_imposed_by", { name: nomLogement || tr("so_your_lodging") });
    prix = gala.inclus ? tr("so_gala_included")
      : tr("so_gala_counted", { calc: (gala.u != null && gala.n !== 1 ? gala.n + " × " + argent(gala.u) + " = " : "") + argent(gala.total),
        kind: tr(gala.src === "estime" ? "lg_src_estimated" : "lg_src_published") });
  } else { titre = tr("so_special_none"); texte = tr("so_special_none_text"); }
  return '<article class="so-opt so-neutre" data-opt="" data-champ="' + esc(cle) + '">' +
    '<div class="so-neutre-photo">' + ICONE[gala ? "couvert" : "lune"] + "</div>" +
    '<div class="so-corps"><h3 class="so-nom">' + esc(titre) + "</h3>" +
    (prix ? '<p class="so-neutre-prix">' + esc(prix) + "</p>" : "") +
    '<p class="so-ligne">' + esc(texte) + "</p>" +
    '<div class="so-actions"><span></span><button type="button" class="so-ajout so-choisir" data-act="choisir" data-champ="' + esc(cle) + '" data-id="" aria-pressed="false"><span class="so-ajout-t">' +
    esc(tr("so_choose")) + '</span><span class="so-eff" data-v="effet"></span></button></div>' +
    "</div></article>";
}

/* A special evening's block (its options side by side, one choice). b = an entry of blocsDeLEtape; st = its state. */
function htmlBloc(b, st, nomLg, D) {
  var opts = ordonnerOptions(b.options, st.tri);
  var echeances = b.options.map(function (s) { return echeance(s).date; }).filter(Boolean).sort();
  var cle = b.cle;
  return '<section class="so-bloc" data-champ="' + esc(cle) + '" aria-labelledby="so-bloc-t-' + esc(cle) + '">' +
    '<header class="so-bloc-tete"><p class="so-bloc-sur">' + ICONE.calendrier + esc(b.sur) + "</p>" +
    '<h2 id="so-bloc-t-' + esc(cle) + '">' + esc(b.titre) + '</h2><p class="so-bloc-sous">' + esc(tr("so_special_sub")) + "</p>" +
    (echeances.length ? '<p class="so-bloc-ech">' + ICONE.alerte + esc(tr("so_first_deadline", { date: dateCourte(echeances[0]) })) + "</p>" : "") +
    "</header>" +
    '<div class="so-bloc-outils"><p class="so-bloc-choix" data-v="bloc-choix" aria-live="polite"></p>' +
    (opts.length > 1 ? '<div class="so-tri" role="group" aria-label="' + esc(tr("so_sort_aria")) + '"><span>' + esc(tr("so_sort")) + "</span>" +
      ["pertinence", "prix", "date"].map(function (t) {
        return '<button type="button" data-act="tri" data-tri="' + t + '" aria-pressed="' + (st.tri === t) + '">' + esc(tr({ pertinence: "so_sort_pertinence", prix: "so_sort_prix", date: "so_sort_date" }[t])) + "</button>";
      }).join("") + "</div>" : "") + "</div>" +
    '<div class="so-opts' + (st.plusOptions ? " tout" : "") + '" data-v="opts" role="group" aria-label="' + esc(b.titre) + '">' +
    (b.gala ? htmlAucune(cle, b.gala, nomLg) : "") + opts.map(function (s) { return htmlOption(s, cle, D); }).join("") +
    (b.gala ? "" : htmlAucune(cle, null, nomLg)) + "</div>" +
    (opts.length > OPTIONS_VUES ? '<button type="button" class="btn so-opts-plus" data-act="options-plus"></button>' : "") +
    (opts.length ? "" : '<p class="discret">' + esc(tr("so_special_no_option")) + "</p>") +
    '<p class="so-bloc-note" data-v="bloc-note" hidden></p></section>';
}

/* ---------- the screen ---------- */
function creer(etape, racine, D, choix) {
  var wrap = document.createElement("div");
  wrap.className = "so";
  racine.appendChild(wrap);
  var poignee = { maj: function () {}, quitter: function () {} };
  var trip = cfg(D), st0 = trip.stage(etape), nomEtape = st0 ? st0.title : etape;
  var L = D && D.lieux && D.lieux[etape];
  if (!L || !Array.isArray(L.sorties)) {
    wrap.innerHTML = '<div class="attente"><p class="attente-t">' + esc(tr("so_not_ready")) + "</p><p>" + esc(tr("so_not_ready_how")) + "</p></div>";
    return poignee;
  }
  // your days at the stage (arrivals, an earlier return or one after midnight): the "outside your dates" list follows them
  var fen = fenetre(D, etape, choix);
  var cles = trip.specialsAt(etape).map(function (x) { return x.key; });
  var calc = calcDefaut();
  var parts = repartirSorties(L.sorties, fen, cles, choix && choix.speciales);
  var st = {
    choix: choix, logementId: null, lg: null, filtre: "tout", limite: PAGE,
    ent: [], parId: {}, optionsParId: {}, placees: {}, observer: null, blocs: [], etatsBlocs: {},
  };
  cles.forEach(function (k) { st.etatsBlocs[k] = { tri: "pertinence", plusOptions: false }; });
  var ouverts = {};   // opened details, kept when the screen is rebuilt
  var idsListe = parts.liste.concat(parts.hors).map(function (s) { return s.id; });
  function choixBloc(cle) { var v = st.choix && st.choix.speciales ? st.choix.speciales[cle] : null; return typeof v === "string" && v ? v : null; }

  /* --- photos: the addresses are asked when the card comes close to the screen --- */
  function chargerPhotos(el, s, taille) {
    photosSortie(s, "s").then(function (urls) {
      if (!el.isConnected) return;
      if (!urls.length) { el.classList.add("vide"); el.dataset.n = "0"; el.innerHTML = ICONE.image; return; }
      var max = taille === "l" ? 1 : 3;
      urls = urls.slice(0, max);
      el.dataset.n = String(urls.length);
      el.innerHTML = "";
      urls.forEach(function (u) {
        var im = document.createElement("img");
        im.loading = "lazy";
        im.decoding = "async";
        im.alt = "";
        im.src = u;
        el.appendChild(im);
      });
    }, function () { el.classList.add("vide"); });
  }
  function surveiller(el, s) {
    if (!el || !el.classList.contains("so-photos") || el.classList.contains("vide")) return;
    var taille = el.dataset.taille || "s";
    if (!st.observer) { chargerPhotos(el, s, taille); return; }
    el._sortie = s;
    st.observer.observe(el);
  }

  /* --- build --- */
  function construire() {
    if (st.observer) st.observer.disconnect();
    st.observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(function (entrees) {
      entrees.forEach(function (x) {
        if (!x.isIntersecting) return;
        st.observer.unobserve(x.target);
        chargerPhotos(x.target, x.target._sortie, x.target.dataset.taille || "s");
      });
    }, { rootMargin: "700px 0px" }) : null;
    st.logementId = st.choix[etape];
    st.lg = logementChoisi(D, etape, st.choix);
    st.ent = trierParDistance(parts.liste, st.lg);
    st.parId = {};
    st.ent.forEach(function (e) { st.parId[e.s.id] = e; });
    st.optionsParId = {};
    st.blocs = blocsDeLEtape(etape, D, st.choix, fen);
    var nomLg = st.lg ? st.lg.nom : "";

    var h = nomLg ? '<div class="so-entete"><p class="so-autour">' + ICONE.lieu + "<span>" + esc(tr("so_around")) + " <b>" + esc(nomLg) + "</b></span></p></div>" : "";
    st.blocs.forEach(function (b) { h += htmlBloc(b, st.etatsBlocs[b.cle], nomLg, D); });

    h += '<section class="so-liste-bloc" aria-labelledby="so-liste-t"><h2 id="so-liste-t" class="so-h2">' + esc(tr("so_list_title", { stage: nomEtape })) + "</h2>" +
      '<p class="so-resume" data-v="resume" aria-live="polite"></p>' +
      '<div class="so-filtres" role="group" aria-label="' + esc(tr("so_filter_aria")) + '" data-v="filtres"></div>' +
      '<div class="so-liste" data-v="liste">' + st.ent.map(function (e) { return htmlCarte(e.s, e, D); }).join("") + "</div>" +
      '<p class="discret so-vide" data-v="vide" hidden>' + esc(tr("so_none_kind")) + "</p>" +
      '<button type="button" class="btn so-voir-plus" data-act="voir-plus" hidden></button></section>';

    if (parts.hors.length) {
      h += '<details class="so-hors"><summary>' + esc(tr("so_out_of_dates", { n: parts.hors.length })) + "</summary>" +
        '<p class="discret">' + esc(tr("so_out_of_dates_note", { stage: nomEtape })) + "</p><ul>" +
        parts.hors.map(function (s) {
          return '<li data-hors="' + esc(s.id) + '"><span><b>' + esc(clip(s.nom, 110)) + "</b> <small>" + esc(raisonHorsDates(s, nomEtape, fen)) + "</small></span>" +
            '<button type="button" class="btn small" data-act="retirer" data-id="' + esc(s.id) + '" hidden>' + esc(tr("so_remove")) + "</button></li>";
        }).join("") + "</ul></details>";
    }
    wrap.innerHTML = h;

    Array.prototype.forEach.call(wrap.querySelectorAll(".so-carte"), function (el) {
      var e = st.parId[el.getAttribute("data-id")];
      if (e) e.el = el;
    });
    Array.prototype.forEach.call(wrap.querySelectorAll(".so-opt[data-opt]"), function (el) {
      var id = el.getAttribute("data-opt"), cle = el.getAttribute("data-champ");
      if (!id) return;
      var b = st.blocs.filter(function (x) { return x.cle === cle; })[0];
      var s = b ? b.options.filter(function (x) { return x.id === id; })[0] : null;
      if (!s) return;
      st.optionsParId[id] = { s: s, el: el, cle: cle };
      surveiller(el.querySelector(".so-photos"), s);
    });
    ecrireFiltres();
    appliquerFiltre();
    Object.keys(ouverts).forEach(function (id) {   // opened details stay opened after a rebuild
      if (!ouverts[id]) return;
      var carte = wrap.querySelector('.so-carte[data-id="' + id + '"], .so-opt[data-opt="' + id + '"]');
      if (carte) basculerDetails(carte.querySelector('[data-act="plus"]'));
    });
  }

  /* --- updates in place --- */
  function totauxPage() { return typeof window !== "undefined" && window.Parcours && Parcours.totaux ? Parcours.totaux : null; }
  function texteEffet(eff, p) {
    if (!eff || !nombre(eff.montant)) return tr("price_to_check");
    if (p && p.etat === "gratuit" && !eff.remplace) return tr("so_free");
    return texteEffetBudget(eff.montant, totauxPage());
  }
  function majPhrase(el, s, eff) {
    var r = el.querySelector('[data-v="remplace"]');
    var phrase = eff && eff.remplace ? phraseRemplace(eff.remplace, s.prix_couple_home) : "";
    r.textContent = phrase;
    r.hidden = !phrase;
  }
  function majJour(e) {
    var s = e.s, el = e.el, coche = estCochee(st.choix, s.id);
    var zone = el.querySelector('[data-v="jour"]');
    var j = jourDe(s.id, s, st.choix, st.placees);
    var jours = joursProposables(s, fen);
    zone.hidden = !coche;
    if (!coche) return;
    if (j.fixe) { zone.innerHTML = '<span class="so-jour-fixe">' + ICONE.calendrier + esc(tr("so_on_date", { date: dateLongue(j.jour) })) + "</span>"; zone._sel = null; return; }
    if (!zone._sel) {
      zone.innerHTML = "<label>" + ICONE.calendrier + '<span class="so-jour-l">' + esc(tr("so_day")) + '</span><select data-act="jour" aria-label="' + esc(tr("so_day_aria", { name: clip(s.nom, 60) })) + '"></select></label>';
      zone._sel = zone.querySelector("select");
    }
    var sel = zone._sel;
    var auto = j.choisi ? tr("so_day_auto") : j.jour ? tr("so_day_suggested", { date: dateLongue(j.jour) }) : tr("so_day_to_choose");
    var cleSel = jours.join(",") + "|" + auto;
    if (sel._cle !== cleSel) {
      sel.innerHTML = '<option value="">' + esc(auto) + "</option>" + jours.map(function (d) { return '<option value="' + d + '">' + esc(dateLongue(d)) + "</option>"; }).join("");
      sel._cle = cleSel;
    }
    sel.value = j.choisi ? j.jour : "";
    if (sel.value !== (j.choisi ? j.jour : "")) sel.value = "";
  }
  function majHoraire(e) {
    var s = e.s, li = e.el.querySelector('[data-v="horaire"]');
    var j = jourDe(s.id, s, st.choix, st.placees);
    var reel = j.jour && (j.fixe || estCochee(st.choix, s.id));
    var jour = soleilDuJour(D, reel ? j.jour : refJour());
    var t = texteHoraire(s, jour, !reel);
    li.hidden = !t;
    li.lastChild.textContent = t;
  }
  var _ref = null;
  function refJour() {
    if (_ref) return _ref;
    var jours = joursProposables({}, fen);
    _ref = jours[Math.floor(jours.length / 2)] || fen[0];
    return _ref;
  }
  function majCarte(e) {
    var s = e.s, el = e.el, coche = estCochee(st.choix, s.id);
    el.classList.toggle("coche", coche);
    var b = el.querySelector('[data-act="cocher"]');
    b.setAttribute("aria-pressed", String(coche));
    b.setAttribute("aria-label", tr(coche ? "so_remove_aria" : "so_add_aria", { name: s.nom }));
    var eff = effetSortie(s, st.choix, D, calc);
    b.querySelector(".so-ajout-t").textContent = tr(coche ? "so_added" : "so_add");
    b.querySelector(".so-eff").textContent = coche ? "" : texteEffet(eff, prixSortie(s));
    majPhrase(el, s, eff);
    majJour(e);
    majHoraire(e);
  }
  function majOption(o, courant) {
    var s = o.s, el = o.el, choisie = courant === s.id;
    el.classList.toggle("choisie", choisie);
    var b = el.querySelector('[data-act="choisir"]');
    b.setAttribute("aria-pressed", String(choisie));
    b.setAttribute("aria-label", tr(choisie ? "so_your_choice_aria" : "so_choose_aria", { name: s.nom }));
    var eff = effetOption(s, o.cle, st.choix, D, calc);
    b.querySelector(".so-ajout-t").textContent = tr(choisie ? "so_your_choice" : "so_choose");
    b.querySelector(".so-eff").textContent = choisie ? "" : texteEffet(eff, prixSortie(s));
    majPhrase(el, s, eff);
  }
  function majBlocs() {
    st.blocs.forEach(function (bl) {
      var cle = bl.cle, courant = choixBloc(cle);
      var zone = wrap.querySelector('.so-bloc[data-champ="' + cle + '"]');
      if (!zone) return;
      Object.keys(st.optionsParId).forEach(function (id) { var o = st.optionsParId[id]; if (o.cle === cle) majOption(o, courant); });
      var neutre = zone.querySelector(".so-neutre");
      if (neutre) {
        var choisie = !courant;
        neutre.classList.toggle("choisie", choisie);
        var b = neutre.querySelector('[data-act="choisir"]');
        b.setAttribute("aria-pressed", String(choisie));
        b.querySelector(".so-ajout-t").textContent = tr(choisie ? "so_your_choice" : "so_choose");
        var ec = effetAucune(cle, st.choix, D, calc);
        b.querySelector(".so-eff").textContent = choisie || ec == null ? "" : texteEffetBudget(ec, totauxPage());
      }
      var o = courant ? st.optionsParId[courant] : null;
      var choixTxt = zone.querySelector('[data-v="bloc-choix"]');
      if (o) {
        var p = prixSortie(o.s);
        var prix = p.etat === "connu" ? argent(p.montant) + " " + pourTous(D) : p.etat === "inconnu" ? tr("price_to_check") : tr("so_free");
        choixTxt.innerHTML = esc(tr("so_block_choice")) + " <b>" + esc(clip(o.s.nom, 70)) + "</b> · " + esc(prix);
      } else if (courant) {
        choixTxt.innerHTML = esc(tr("so_block_choice_gone"));
      } else {
        choixTxt.innerHTML = esc(tr("so_block_choice")) + " <b>" + esc(bl.gala ? majuscule(bl.gala.lib) : tr("so_special_none")) + "</b>" + (bl.gala ? " " + esc(tr("so_already_counted")) : "");
      }
      var note = zone.querySelector('[data-v="bloc-note"]');
      var texte = [];
      if (bl.gala && !bl.gala.inclus) texte.push(tr("so_gala_note", { price: argent(bl.gala.total) }));
      var gl = st.lg && st.lg.pour_decider && typeof st.lg.pour_decider.gala === "string" ? st.lg.pour_decider.gala.trim() : "";
      if (gl && !/^(none|no |not |nothing|aucun|rien|sans objet|pas concern|non concern)/i.test(gl)) texte.push(tr("so_gala_lodging", { text: gl }));
      note.textContent = texte.join(" ");
      note.hidden = !texte.length;
      var plus = zone.querySelector('[data-act="options-plus"]');
      var et = st.etatsBlocs[cle];
      if (plus) plus.textContent = et.plusOptions ? tr("so_options_fewer") : tr("so_options_more", { n: bl.options.length - OPTIONS_VUES });
      var opts = zone.querySelector('[data-v="opts"]');
      opts.classList.toggle("tout", et.plusOptions);
      Array.prototype.forEach.call(opts.querySelectorAll(".so-opt[data-opt]:not(.so-neutre)"), function (el, i) {
        el.classList.toggle("plus", i >= OPTIONS_VUES && !el.classList.contains("choisie"));
      });
    });
  }
  function majResume() {
    var el = wrap.querySelector('[data-v="resume"]');
    var r;
    if (calc) {
      try { r = resumeSorties(calc.lignesVoyage(st.choix, D), etape, idsListe); } catch (e) { r = null; }
    }
    if (!r) {
      var coches = idsListe.filter(function (id) { return estCochee(st.choix, id); });
      r = { n: coches.length, total: 0, incomplet: true };
    }
    if (!r.n) { el.innerHTML = esc(tr("so_nothing_ticked")); return; }
    el.innerHTML = "<b>" + esc(tr("so_ticked", { n: r.n })) + "</b> · ≈ " + esc(argent(r.total)) + " " + esc(pourTous(D)) +
      (r.incomplet ? ' <em class="tag-incomplet">' + esc(tr("ui_incomplete")) + "</em>" : "");
  }
  function majHors() {
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-hors]"), function (li) {
      li.querySelector("button").hidden = !estCochee(st.choix, li.getAttribute("data-hors"));
    });
  }
  /* The kind buttons are written once per build; then only the numbers and the state change. */
  function ecrireFiltres() {
    var n = compterGenres(st.ent, st.choix);
    var defs = [{ cle: "tout", lib: tr("so_filter_all") }].concat(GENRES.filter(function (g) { return n[g.cle] > 0; }).map(function (g) {
      return { cle: g.cle, lib: libGenre(g.cle) };
    }), [{ cle: "cochees", lib: tr("so_filter_ticked") }]);
    wrap.querySelector('[data-v="filtres"]').innerHTML = defs.map(function (f) {
      var g = GENRES_CLES[f.cle];
      return '<button type="button" class="so-filtre" data-act="filtre" data-f="' + f.cle + '" aria-pressed="false"' +
        (g ? ' style="--k:var(' + g.couleur + ')"' : "") + ">" + (g ? "<i></i>" : "") + esc(f.lib) + " <small></small></button>";
    }).join("");
  }
  function majFiltres() {
    var n = compterGenres(st.ent, st.choix);
    Array.prototype.forEach.call(wrap.querySelectorAll(".so-filtre"), function (b) {
      var f = b.getAttribute("data-f");
      b.setAttribute("aria-pressed", String(st.filtre === f));
      b.querySelector("small").textContent = n[f];
    });
  }
  /* What is visible: the filter, then the PAGE first (ticked ones always stay visible). */
  function appliquerFiltre() {
    var montres = 0, total = 0;
    st.ent.forEach(function (e) {
      if (!e.el) return;
      var ok = passeFiltre(e, st.filtre, st.choix);
      var visible = ok && (montres < st.limite || estCochee(st.choix, e.s.id));
      if (ok) total++;
      if (visible) montres++;
      if (e.el.hidden === visible) {
        e.el.hidden = !visible;
        if (visible) surveiller(e.el.querySelector(".so-photos"), e.s);
      }
    });
    var plus = wrap.querySelector('[data-act="voir-plus"]');
    var reste = total - montres;
    plus.hidden = reste <= 0;
    plus.textContent = tr("so_see_more", { n: Math.min(PAGE, reste), left: reste });
    wrap.querySelector('[data-v="vide"]').hidden = total > 0;
    majTout();
  }
  /* Everything that depends on the choices: suggested days, visible cards, blocks, summary, counters. */
  function majTout() {
    try { st.placees = typeof placerSorties === "function" ? placerSorties(st.choix, D) || {} : {}; } catch (e) { st.placees = {}; }
    st.ent.forEach(function (e) { if (e.el && !e.el.hidden) majCarte(e); });
    majFiltres();
    majResume();
    majBlocs();
    majHors();
  }

  /* --- order of a block's options (moving the same elements) --- */
  function reordonner(cle) {
    var zone = wrap.querySelector('.so-bloc[data-champ="' + cle + '"] [data-v="opts"]');
    var bl = st.blocs.filter(function (x) { return x.cle === cle; })[0];
    if (!zone || !bl) return;
    ordonnerOptions(bl.options, st.etatsBlocs[cle].tri).forEach(function (s) {
      var o = st.optionsParId[s.id];
      if (o) zone.appendChild(o.el);
    });
    var neutre = zone.querySelector(".so-neutre");
    if (neutre && !bl.gala) zone.appendChild(neutre);
    Array.prototype.forEach.call(wrap.querySelectorAll('.so-bloc[data-champ="' + cle + '"] [data-act="tri"]'), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.tri === st.etatsBlocs[cle].tri));
    });
    majBlocs();
  }

  /* --- actions --- */
  function ecrire(args) {
    if (typeof patchChoix !== "function") return;
    try { patchChoix(args[0], args[1]); } catch (e) { if (typeof console !== "undefined") console.error("[outings] patchChoix", e); }
  }
  function sortieDeCarte(carte) {
    var id = carte && (carte.getAttribute("data-id") || carte.getAttribute("data-opt"));
    var e = id ? st.parId[id] || st.optionsParId[id] : null;
    return e ? e.s : null;
  }
  function basculerDetails(btn) {
    var carte = btn.closest(".so-carte, .so-opt");
    var det = carte.querySelector('[data-v="details"]');
    var ouvert = det.hidden;     // it is about to open
    det.hidden = !ouvert;
    btn.setAttribute("aria-expanded", String(ouvert));
    btn.querySelector("span").textContent = tr(ouvert ? "so_fewer_details" : "so_more_details");
    btn.classList.toggle("ouvert", ouvert);
    var id = carte.getAttribute("data-id") || carte.getAttribute("data-opt");
    if (id) ouverts[id] = ouvert;
    // the video thumbnails load only once the details are open
    var LUI = typeof window !== "undefined" ? window.LogementsUI : null, s = sortieDeCarte(carte);
    if (ouvert && s && LUI && typeof LUI.poserVignettes === "function") LUI.poserVignettes(det, s.videos);
  }
  wrap.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-act]");
    if (!b || !wrap.contains(b) || b.tagName === "SELECT") return;
    var act = b.getAttribute("data-act");
    var bloc = b.closest ? b.closest(".so-bloc") : null, cleBloc = bloc ? bloc.getAttribute("data-champ") : null;
    if (act === "plus") basculerDetails(b);
    else if (act === "cocher") {
      var id = b.closest(".so-carte").getAttribute("data-id");
      ecrire(patchSortie(id, !estCochee(st.choix, id), null));
    } else if (act === "retirer") ecrire(patchSortie(b.getAttribute("data-id"), false));
    else if (act === "choisir") {
      var cle = b.getAttribute("data-champ"), sel = b.getAttribute("data-id");
      if (cle && (sel || null) !== choixBloc(cle)) ecrire(patchBloc(cle, sel || null));
    } else if (act === "filtre") { st.filtre = b.getAttribute("data-f"); st.limite = PAGE; appliquerFiltre(); }
    else if (act === "voir-plus") { st.limite += PAGE; appliquerFiltre(); }
    else if (act === "tri" && cleBloc && st.etatsBlocs[cleBloc]) { st.etatsBlocs[cleBloc].tri = b.getAttribute("data-tri"); reordonner(cleBloc); }
    else if (act === "options-plus" && cleBloc && st.etatsBlocs[cleBloc]) { st.etatsBlocs[cleBloc].plusOptions = !st.etatsBlocs[cleBloc].plusOptions; majBlocs(); }
    else if (act === "videos") {   // "See the N videos" in the details: the other tiles and their thumbnails
      var sv = sortieDeCarte(b.closest(".so-carte, .so-opt")), LUI = window.LogementsUI;
      if (sv && LUI && typeof LUI.basculerVideos === "function") LUI.basculerVideos(b, sv.videos);
    }
  });
  wrap.addEventListener("change", function (ev) {
    var sel = ev.target.closest('select[data-act="jour"]');
    if (!sel) return;
    var id = sel.closest(".so-carte").getAttribute("data-id");
    ecrire(patchSortie(id, true, sel.value || null));
  });

  construire();

  poignee.maj = function (nouveau) {
    st.choix = nouveau;
    var f = fenetre(D, etape, nouveau);
    if (f[0] !== fen[0] || f[1] !== fen[1]) {             // your days changed (another flight): "outside your dates" again
      fen = f;
      _ref = null;
      parts = repartirSorties(L.sorties, fen, cles, nouveau && nouveau.speciales);
      idsListe = parts.liste.concat(parts.hors).map(function (s) { return s.id; });
      construire();
    } else if (nouveau[etape] !== st.logementId) construire();   // another lodging: new sort by distance, its gala
    else majTout();
  };
  poignee.quitter = function () {
    if (st.observer) st.observer.disconnect();
  };
  return poignee;
}

/* ECRANS["sorties"]: the outings screen of ecran.stage. */
function ecranSorties(racine, D, choix, ecran) { return creer(ecran && ecran.stage, racine, D, choix); }

var api = {
  ecranSorties: ecranSorties, photosSortie: photosSortie, blocsDeLEtape: blocsDeLEtape,
  GENRES_CLES: GENRES_CLES, estCochee: estCochee, choixAvec: choixAvec, fenetre: fenetre, logementChoisi: logementChoisi,
  distanceKm: distanceKm, trierParDistance: trierParDistance, texteDistance: texteDistance,
  compterGenres: compterGenres, filtrer: filtrer, horsDates: horsDates, repartirSorties: repartirSorties,
  raisonHorsDates: raisonHorsDates, ordonnerOptions: ordonnerOptions, galaDuLogement: galaDuLogement,
  prixSortie: prixSortie, dureeTexte: dureeTexte, uneLigne: uneLigne, meilleureNote: meilleureNote, texteNote: texteNote,
  humeur: humeur, quandReserver: quandReserver, echeance: echeance, tenueDe: tenueDe, liensReservation: liensReservation,
  joursProposables: joursProposables, jourDe: jourDe, soleilDuJour: soleilDuJour, texteHoraire: texteHoraire,
  uniteRemplacee: uniteRemplacee, phraseRemplace: phraseRemplace, effetSortie: effetSortie, effetOption: effetOption, effetAucune: effetAucune,
  resumeSorties: resumeSorties, patchSortie: patchSortie, patchBloc: patchBloc, texteEffetBudget: texteEffetBudget,
  htmlDetails: htmlDetails, htmlCarte: htmlCarte, htmlBloc: htmlBloc, dateCourte: dateCourte, dateLongue: dateLongue,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined" && typeof document !== "undefined") {
  var ECRANS = window.ECRANS = window.ECRANS && typeof window.ECRANS === "object" ? window.ECRANS : {};
  ECRANS["sorties"] = ecranSorties;
}
})();
