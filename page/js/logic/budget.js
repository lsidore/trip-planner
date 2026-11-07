// Budget of the trip: every amount, computed from the data (parcours.json + D.lieux[stage]) and the choices.
// Pure JavaScript, no DOM, no network; tested by tests/js/budget.test.js.
//
//   D      = parcours.json, with each parcours-<stage>.json stored in D.lieux[<stage key>] (keys: D.trip.stages).
//   Choix  = { <leg key>: option id, <stage key>: lodging id, sorties: { id: { jour } | false },
//              speciales: { <special key>: outing id | null | false }, inclure: { <leg key>: boolean } }
//            sorties: only truthy entries count (false = unticked). speciales: one outing per special evening.
//            inclure: a leg outside the budget (all its travelers have flights_in_budget false) counts when true.
//   Ligne  = { n, u, lib, src, quand, etape, poste, cle, note?, hors_budget?, incomplet?, sortie?, trajet?, sens?, cause? }
//            amount = n × u; src: direct | releve | estime | inclus; quand: avant | place | inclus.
//            u = null (+ incomplet: true) when the price is missing: the line is worth 0 in the sums, the total becomes
//            "incomplete" and the page writes "price to check" (never 0, never NaN).
//            trajet: the leg of a line; sens ("arrivee" | "retour") and cause (a leg) on the date adjustments.
//   TRIP comes from creerTrip(D) (config.js) at each call; texts come from T() (i18n.js).
//
// Private names start with "bud": this file is concatenated with the other logic/ files in the page.

// Item of a lodging line, and the words that identify a real unit of that item in its label (a taxi to the restaurants
// keyed "diners" is not a dinner). Labels come from the research files, in English or French.
const BUD_POSTE_CLE = { petits_dej: "repas", dejeuners: "repas", diners: "repas", gala: "repas", verres: "verres", spa: "bienetre", transferts: "trajets" };
const BUD_UNITE = {
  diners: { mot: "bud_unit_dinner", re: /dinner|d(?:i|\u00ee)ner/i },
  dejeuners: { mot: "bud_unit_lunch", re: /lunch|d(?:e|\u00e9)jeuner/i },
  verres: { mot: "bud_unit_drink", re: /drink|cocktail|glass|verre/i },
  spa: { mot: "bud_unit_massage", re: /massage/i },
};
// Units of the lodging an outing replaces: a restaurant replaces 1 dinner, a bar 2 drinks (one each that evening).
const BUD_NB_UNITES = { verres: 2 };

// ------------------------------------------------------------------------------------------------ tools

function budCfg(D) {
  const f = typeof creerTrip === "function" ? creerTrip : require("./config.js").creerTrip;
  return f(D);
}

function budI18n() {
  return typeof T === "function" && typeof fmtDate === "function" ? { T, fmtDate, fmtMoney } : require("../i18n.js");
}

function budT(cle, vars) {
  return budI18n().T(cle, vars);
}

function budDate(iso) {
  return budI18n().fmtDate(iso);
}

function budNum(x) {
  return typeof x === "number" && isFinite(x);
}

function budR2(x) {
  return Math.round(x * 100) / 100 + 0; // "+ 0" avoids -0
}

function budSimple(o) {
  return !!o && typeof o === "object" && !Array.isArray(o);
}

/** Amount of a line: n × u, or 0 when the price is missing. */
function montantLigne(l) {
  return l && budNum(l.n) && budNum(l.u) ? l.n * l.u : 0;
}

function budIncomplete(l) {
  return !!l && (l.incomplet === true || !budNum(l.n) || !budNum(l.u));
}

/** Days from a to b ("YYYY-MM-DD"), negative when b is before a. */
function budJours(a, b) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  return Math.round((p(b) - p(a)) / 86400000);
}

function budLieux(D, cle) {
  return (D && D.lieux && D.lieux[cle]) || null;
}

function budToutCharge(D, trip) {
  return trip.stageKeys.every((c) => !!budLieux(D, c));
}

function budOption(D, leg, id) {
  const t = D && D.vols && D.vols[leg];
  return t && Array.isArray(t.options) && typeof id === "string" ? t.options.find((o) => o.id === id) || null : null;
}

function budSortie(D, trip, id) {
  if (typeof id !== "string") return null;
  for (const c of trip.stageKeys) {
    const p = budLieux(D, c);
    const s = p && Array.isArray(p.sorties) ? p.sorties.find((x) => x.id === id) : null;
    if (s) return s.etape ? s : Object.assign({}, s, { etape: c });
  }
  return null;
}

/** { logement, complet }: the full fiche (with lines) or the "incomplete budget" entry; null when unknown. */
function budLogement(D, cle, id) {
  const p = budLieux(D, cle);
  if (!p || typeof id !== "string") return null;
  const l = (p.logements || []).find((x) => x.id === id);
  if (l) return { logement: l, complet: true };
  const a = (p.autres || []).find((x) => x.id === id);
  return a ? { logement: a, complet: false } : null;
}

function budNuits(trip, cle) {
  const s = trip.stage(cle);
  return s && budNum(s.nights) && s.nights > 0 ? s.nights : 1;
}

/** A line whose price is missing: counted 0, total "incomplete", shown "price to check". */
function budAVerifier(base) {
  return Object.assign({ n: 1, u: null, src: "estime", quand: "avant", note: budT("price_to_check"), incomplet: true }, base);
}

/** Does this leg count in the budget? Yes when it is in the budget, else only when ticked "add it to see". */
function budInclus(c, D, leg) {
  if (leg.in_budget) return true;
  const ch = budSimple(c.inclure) ? c.inclure : {};
  const d = D && D.defaut && budSimple(D.defaut.inclure) ? D.defaut.inclure : {};
  return (typeof ch[leg.key] === "boolean" ? ch[leg.key] : d[leg.key]) === true;
}

// ------------------------------------------------------------------------------------------------ legs

/** Label of a leg in a budget line: "Alex · flight to Lisbon", "flight Comporta → Porto", "Lisbon → Comporta". */
function budLibTrajet(trip, leg) {
  const titre = (k) => (trip.stage(k) ? trip.stage(k).title : k || "");
  if (leg.kind === "arrival") return budT("bud_leg_arrival", { who: trip.labelsOf(leg), to: titre(leg.to_stage) });
  if (leg.kind === "return") return budT("bud_leg_return", { who: trip.labelsOf(leg), from: titre(leg.from_stage) });
  return budT(leg.mode === "flight" ? "bud_leg_flight" : "bud_leg_ground", { from: titre(leg.from_stage), to: titre(leg.to_stage) });
}

function budLignesTrajet(D, trip, leg, id, compte) {
  const o = budOption(D, leg.key, id);
  const vol = leg.mode === "flight";
  const lib = budLibTrajet(trip, leg);
  const n = vol ? leg.adults || 1 : 1; // a flight is priced per adult, a ground trip for the whole group
  const base = vol
    ? { etape: "vols", poste: "vols", quand: "avant", cle: "vol" }
    : { etape: leg.to_stage || "vols", poste: "trajets", quand: "avant", cle: "trajet" };
  let lignes;
  if (!o) {
    lignes = [budAVerifier(Object.assign({ n, lib: budT("bud_not_found", { leg: lib }) }, base))];
  } else {
    lignes = (o.lignes || []).map((l) => Object.assign({}, l));
    if (!lignes.some((l) => l.cle === base.cle)) {
      lignes.unshift(budAVerifier(Object.assign({ n, lib: budT("bud_no_price", { leg: lib }) }, base)));
    }
    const v = o.valise;
    if (vol && v && v.comprise !== true && !budNum(v.ajout_home) && !lignes.some((l) => l.cle === "valise")) {
      lignes.push(budAVerifier(Object.assign({}, base, { n, lib: budT("bud_bag_unknown", { leg: lib }), cle: "valise" })));
    }
  }
  // a leg outside the budget counts only when ticked "add it to see" (its note then says so)
  const hors = budT("out_of_budget_note");
  lignes.forEach((l) => {
    l.trajet = leg.key;
    if (compte) {
      delete l.hors_budget;
      if (typeof l.note === "string" && hors && l.note.indexOf(hors) >= 0) l.note = l.note.split(hors).join(budT("bud_counted_in_budget"));
    } else l.hors_budget = true;
  });
  return lignes;
}

/**
 * Entry authorisations asked by the chosen flights (transit visa...), once each; the legs in the budget first, so that
 * a formality is outside the budget only when no counted leg asks for it. Formalities already in D.bases are skipped.
 */
function budLignesFormalites(D, trip, c) {
  const compte = {};
  trip.legs.forEach((l) => { compte[l.key] = budInclus(c, D, l); });
  const ordre = trip.legs.filter((l) => compte[l.key]).concat(trip.legs.filter((l) => !compte[l.key]));
  const vues = {};
  ((D && D.bases) || []).forEach((l) => { if (l && l.poste === "formalites") vues[l.cle] = true; });
  const out = [];
  ordre.forEach((leg) => {
    const o = budOption(D, leg.key, c[leg.key]);
    ((o && o.formalites) || []).forEach((code) => {
      if (vues[code]) return;
      vues[code] = true;
      const f = ((D && D.formalites) || []).find((x) => x.code === code);
      const base = { etape: "vols", poste: "formalites", quand: "avant", cle: code };
      let l;
      if (f && budNum(f.cout_home)) {
        const qui = trip.traveler(f.qui);
        l = Object.assign({ n: qui ? qui.adults : trip.adults || 1, u: f.cout_home, lib: (qui ? `${qui.label} · ` : "") + f.titre, src: "releve" }, base);
        if (f.url_officielle) l.note = budT("bud_official_site", { url: f.url_officielle });
      } else {
        l = budAVerifier(Object.assign({ lib: budT("bud_formality_to_check", { code }) }, base));
      }
      if (!compte[leg.key]) l.hors_budget = true;
      out.push(l);
    });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ lodgings

function budLignesLogement(D, trip, cle, id) {
  const r = budLogement(D, cle, id);
  const base = { etape: cle, poste: "logements", quand: "avant", cle: "chambre" };
  if (!r) return [budAVerifier(Object.assign({ lib: budT("bud_lodging_not_found", { id: id || budT("bud_none_chosen") }) }, base))];
  const { logement: l, complet } = r;
  if (complet && Array.isArray(l.lignes) && l.lignes.length) {
    return l.lignes.map((x) => Object.assign({ etape: cle }, x));
  }
  // incomplete fiche: the room at its price, the rest (meals, drinks, massages, transfers) still to price
  const p = l.prix || {};
  const nuits = budNuits(trip, cle);
  const total = budNum(p.total_home) ? p.total_home : budNum(p.nuit_home) ? p.nuit_home * nuits : null;
  const lib = budT("bud_room_nights", { name: l.nom || l.id }) + (p.plateforme ? ` (${p.plateforme})` : "");
  const chambre = total === null
    ? budAVerifier(Object.assign({ lib, n: nuits }, base))
    : Object.assign({ n: nuits, u: budR2(total / nuits), lib, src: "releve", note: budT("bud_incomplete_fiche_note") }, base);
  const reste = budAVerifier({
    n: 1, lib: budT("bud_incomplete_fiche_line"), etape: cle, poste: "repas", quand: "place", cle: "fiche-incomplete",
  });
  return [chambre, reste];
}

/** Average price of a night: sum of the "chambre" lines ÷ number of nights; null when unknown. */
function budNuitMoyenne(lignes) {
  const ch = lignes.filter((l) => l.cle === "chambre" && !budIncomplete(l));
  const nuits = ch.reduce((s, l) => s + l.n, 0);
  return nuits > 0 ? ch.reduce((s, l) => s + l.n * l.u, 0) / nuits : null;
}

function budNomLogement(D, cle, id) {
  const r = budLogement(D, cle, id);
  return r ? r.logement.nom : budT("bud_lodging_default");
}

// ------------------------------------------------------------------------------------------------ outings and "remplace"

function budPosteSortie(s) {
  if (s.remplace && BUD_POSTE_CLE[s.remplace]) return BUD_POSTE_CLE[s.remplace];
  if (s.groupe === "manger") return "repas";
  if (s.groupe === "boire") return "verres";
  if (s.groupe === "bienetre") return "bienetre";
  return "activites";
}

/** An outing booked online is paid before leaving; a restaurant, a bar, a massage are paid there. */
function budQuandSortie(s) {
  const surPlace = s.groupe === "manger" || s.groupe === "boire" || s.groupe === "bienetre";
  return s.a_reserver && !surPlace ? "avant" : "place";
}

/** Units of the lodging's fiche an outing can replace: paid lines whose label really is that meal / drink. */
function budUnitesRemplacables(lignesLogement, cle) {
  const spec = BUD_UNITE[cle];
  return lignesLogement
    .filter((l) => l.cle === cle && l.src !== "inclus" && budNum(l.n) && l.n >= 1 && budNum(l.u) && l.u > 0 && (!spec || spec.re.test(l.lib || "")))
    .map((l) => ({ ligne: l, restant: Math.floor(l.n) }));
}

function budLignesSortie(s, pools) {
  const prix = s.prix_couple_home;
  const connu = budNum(prix);
  const l = {
    n: 1,
    u: connu ? prix : null,
    lib: s.nom,
    src: s.prix_estime === true ? "estime" : "releve",
    quand: budQuandSortie(s),
    etape: s.etape,
    poste: budPosteSortie(s),
    cle: s.id,
    sortie: s.id,
  };
  if (!connu) {
    l.incomplet = true;
    l.note = budT("price_to_check");
  }
  const out = [l];
  // A restaurant or a massage replaces 1 unit of the same item in the lodging, a bar 2 drinks (BUD_NB_UNITES). While its
  // price is unknown nothing is removed (the total must not drop because of a price nobody knows).
  if (!connu || !s.remplace) return out;
  const cle = s.remplace;
  const lgLignes = pools[`${s.etape}/*`] || [];
  // A special evening whose dinner the lodging serves as a gala (a "gala" line for that special): its regular dinners
  // do not cover that evening, so there is no dinner to replace (and the gala, mandatory, stays).
  if (cle === "diners" && s.speciale && lgLignes.some((x) => x.cle === "gala" && x.speciale === s.speciale)) return out;
  const clePool = `${s.etape}/${cle}`;
  const pool = pools[clePool] || (pools[clePool] = budUnitesRemplacables(lgLignes, cle));
  const spec = BUD_UNITE[cle];
  const unite = budT(spec ? spec.mot : "bud_unit_item");
  const nb = BUD_NB_UNITES[cle] || 1;
  for (let i = 0; i < nb; i++) {
    const u = pool.find((x) => x.restant > 0);
    if (!u) break; // never more negative lines than units of the item
    u.restant -= 1;
    out.push({
      n: -1,
      u: u.ligne.u,
      lib: budT("bud_replaces", { unit: unite }),
      src: u.ligne.src,
      quand: u.ligne.quand,
      etape: s.etape,
      poste: u.ligne.poste || BUD_POSTE_CLE[cle] || l.poste,
      cle: "remplace",
      sortie: s.id,
    });
  }
  return out;
}

function budSpeciales(c, D) {
  const d = D && D.defaut && budSimple(D.defaut.speciales) ? D.defaut.speciales : {};
  return Object.assign({}, d, budSimple(c.speciales) ? c.speciales : {});
}

/**
 * The outings that count for these choices, each once, in this order: the ticked outings of no special evening, then for
 * each special evening its single outing: the one chosen in its block (speciales[key]), else the last outing of that
 * evening ticked in the list. An outing whose stage is not loaded is kept as ticked.
 */
function sortiesComptees(choix, D) {
  const c = budSimple(choix) ? choix : {};
  const trip = budCfg(D);
  const cochees = budSimple(c.sorties) ? c.sorties : {};
  const ids = [];
  const parSpeciale = {};
  Object.keys(cochees).forEach((id) => {
    if (!cochees[id]) return;
    const s = budSortie(D, trip, id);
    if (s && typeof s.speciale === "string" && s.speciale) parSpeciale[s.speciale] = id;
    else ids.push(id);
  });
  const sp = budSpeciales(c, D);
  const cles = trip.specials.map((x) => x.key);
  Object.keys(sp).concat(Object.keys(parSpeciale)).forEach((k) => { if (cles.indexOf(k) < 0) cles.push(k); });
  cles.forEach((k) => {
    const id = typeof sp[k] === "string" && sp[k] ? sp[k] : parSpeciale[k];
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  return ids;
}

// ------------------------------------------------------------------------------------------------ dates of the first arrival and the last return

/**
 * sens: "plus" (nights to pay on top) or "perdue"; k: number of nights; info: { jour, leg, q? } (q: the departure from
 * the lodging, jourDepartLogement of alerts.js, on the return side).
 */
function budAjustement(sens, k, etape, D, trip, c, info, aller) {
  const id = c[etape];
  const nom = budNomLogement(D, etape, id);
  const q = info.q || null;
  const veille = !aller && !!q && q.veille === true;
  const qui = trip.whoOf(info.leg);
  const quoi = aller
    ? qui ? budT("bud_arrives_on", { who: qui, date: budDate(info.jour) }) : budT("bud_arrival_on", { date: budDate(info.jour) })
    : veille
      ? budT("bud_leaving_evening", { date: budDate(q.jour), day: budDate(q.jour_vol), time: q.dep })
      : budT("bud_return_on", { date: budDate(info.jour) });
  const prevu = budDate(aller ? trip.start : trip.end);
  const jours = veille ? { jour: q.jour, jour_vol: q.jour_vol, veille: true } : { jour: info.jour };
  const marques = { sens: aller ? "arrivee" : "retour", cause: info.leg.key };
  if (sens === "perdue") {
    return Object.assign({
      n: 0, u: 0,
      lib: budT("bud_lost_night_lib", { name: nom, what: quoi, planned: prevu }),
      src: "inclus", quand: "inclus", etape, poste: "logements", cle: "nuit-perdue", nuits: k,
    }, jours, marques, { note: budT("bud_lost_night_note", { n: k }) });
  }
  const moy = budNuitMoyenne(budLignesLogement(D, trip, etape, id));
  const base = Object.assign({
    lib: budT("bud_extra_night_lib", { name: nom, what: quoi, planned: prevu }),
    src: "estime", quand: "avant", etape, poste: "logements", cle: "nuit-en-plus", nuits: k,
  }, jours, marques);
  return moy === null ? budAVerifier(Object.assign({ n: k }, base)) : Object.assign({ n: k, u: budR2(moy) }, base);
}

/** jourDepartLogement of alerts.js (a global in the page; under node, by require); null when missing. */
function budJourDepart() {
  if (typeof jourDepartLogement === "function") return jourDepartLogement;
  return typeof module !== "undefined" && typeof require === "function" ? require("./alerts.js").jourDepartLogement : null;
}

/** departsEtape of alerts.js (a global in the page; under node, by require); null when missing. */
function budDeparts() {
  if (typeof departsEtape === "function") return departsEtape;
  return typeof module !== "undefined" && typeof require === "function" ? require("./alerts.js").departsEtape : null;
}

/** The day you leave the last lodging for this return flight; without alerts.js, the day of the flight. */
function budQuitter(c, D, leg, o) {
  const f = budJourDepart();
  const q = f ? f(c, D, leg) : null;
  if (q) return q;
  const s0 = o.segments[0];
  const m = /T(\d{2}):(\d{2})/.exec(s0.dep_local || "");
  return { jour: String(s0.dep_local || "").slice(0, 10), veille: false, minutes: m ? Number(m[1]) * 60 + Number(m[2]) : 0 };
}

/**
 * "Extra night" / "lost night" lines when the first landing is not on the trip's first day, or when the last traveler
 * does not leave the last lodging on its last day. Arrival: the earliest local landing day of the chosen arrival flights;
 * return: the latest day someone leaves the hotel for a chosen return flight (a flight leaving after midnight makes you
 * leave the evening before: no extra night). An extra night costs the average night of that stage's lodging; a lost
 * night costs nothing more (n = 0, the room already paid does not get cheaper). Extra fields: jour (landing, or leaving
 * the hotel), and after midnight jour_vol and veille: true; sens and cause (the leg).
 */
function ajustementsDates(choix, D) {
  const c = budSimple(choix) ? choix : {};
  const trip = budCfg(D);
  const out = [];
  if (!trip.stageKeys.length) return out;
  const premier = trip.stageKeys[0];
  const dernier = trip.stageKeys[trip.stageKeys.length - 1];
  let tot = null;
  trip.arrivals.forEach((leg) => {
    const o = budOption(D, leg.key, c[leg.key]);
    if (!o || !Array.isArray(o.segments) || !o.segments.length) return;
    const jour = String(o.segments[o.segments.length - 1].arr_local || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(jour) && (!tot || jour < tot.jour)) tot = { jour, leg };
  });
  if (tot && trip.start) {
    const d = budJours(trip.start, tot.jour);
    if (d < 0) out.push(budAjustement("plus", -d, premier, D, trip, c, tot, true));
    else if (d > 0) out.push(budAjustement("perdue", d, premier, D, trip, c, tot, true));
  }
  let tard = null;
  trip.returns.forEach((leg) => {
    const o = budOption(D, leg.key, c[leg.key]);
    if (!o || !Array.isArray(o.segments) || !o.segments.length) return;
    const q = budQuitter(c, D, leg.key, o);
    if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q.jour)) return;
    if (!tard || q.jour > tard.jour || (q.jour === tard.jour && q.minutes > tard.q.minutes)) tard = { jour: q.jour, leg, q };
  });
  if (tard && trip.end) {
    const d = budJours(trip.end, tard.jour);
    if (d > 0) out.push(budAjustement("plus", d, dernier, D, trip, c, tard, false));
    else if (d < 0) out.push(budAjustement("perdue", -d, dernier, D, trip, c, tard, false));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ outings that cannot happen

/** days.js (JoursLogic): a global in the page; under node, by require. null when missing. */
function budJoursLogic() {
  if (typeof JoursLogic !== "undefined" && JoursLogic && typeof JoursLogic.placementSorties === "function") return JoursLogic;
  return typeof module !== "undefined" && typeof require === "function" ? require("./days.js") : null;
}

/** The days an outing can happen in the window w {du, au}: its fixed date or its dates; null when any day will do. */
function budJoursPossibles(s, w) {
  const iso = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x);
  if (iso(s.date_fixe)) return [s.date_fixe.slice(0, 10)];
  const d = Array.isArray(s.dates) && s.dates.length && s.dates.every(iso) ? s.dates.map((x) => x.slice(0, 10)) : null;
  return d && w ? d.filter((x) => x >= w.du && x <= w.au) : d;
}

/**
 * { id: true } of the counted outings that cannot happen, so are not paid:
 *  - none of your days at their stage fits them (fixed date or dates outside those days): days.js impossibles;
 *  - their only possible day is a day someone leaves the lodging of their stage, and they end after that departure
 *    (same rule as days.js and the "jour-trajet" alert of alerts.js, which stays).
 * An outing that can change day stays counted (the alert suggests another day). Without days.js: none.
 */
function budImpossibles(c, D, trip) {
  const J = budJoursLogic();
  const out = {};
  if (!J || typeof J.placementSorties !== "function" || !budToutCharge(D, trip)) return out;
  const p = J.placementSorties(c, D);
  ((p && p.impossibles) || []).forEach((id) => { out[id] = true; });
  const fin = typeof J.finMoment === "function" ? J.finMoment : null;
  const departs = budDeparts();
  if (!fin || !departs || !p || !p.jours) return out;
  const parEtape = {};
  Object.keys(p.jours).forEach((id) => {
    if (out[id]) return;
    const s = budSortie(D, trip, id);
    if (!s) return;
    if (!(s.etape in parEtape)) parEtape[s.etape] = departs(c, D, s.etape) || [];
    const jour = p.jours[id];
    const m = fin(s.moment);
    if (m === null || !parEtape[s.etape].some((q) => q.jour === jour && m > q.minutes)) return;
    const possibles = budJoursPossibles(s, p.fenetres && p.fenetres[s.etape]);
    if (possibles && possibles.length && possibles.every((d) => d === jour)) out[id] = true;
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ API

/**
 * Every line of the trip for these choices, in this order: legs (flights and ground trips), entry authorisations,
 * common lines (bases), the lodging of each stage, the counted outings (with their "remplace" lines), the date
 * adjustments. Returns copies: D is never changed.
 */
function lignesVoyage(choix, D) {
  const c = budSimple(choix) ? choix : {};
  const trip = budCfg(D);
  const out = [];
  trip.legs.forEach((leg) => budLignesTrajet(D, trip, leg, c[leg.key], budInclus(c, D, leg)).forEach((l) => out.push(l)));
  budLignesFormalites(D, trip, c).forEach((l) => out.push(l));
  ((D && D.bases) || []).forEach((l) => out.push(Object.assign({}, l)));

  const pools = {};
  trip.stageKeys.forEach((cle) => {
    const lg = budLignesLogement(D, trip, cle, c[cle]);
    pools[`${cle}/*`] = lg;
    lg.forEach((l) => out.push(l));
  });

  // an outing that can happen on none of your days, or only on an evening someone has already left, is not paid
  const vus = budImpossibles(c, D, trip);
  sortiesComptees(c, D).forEach((id) => {
    if (vus[id]) return;
    vus[id] = true;
    const s = budSortie(D, trip, id);
    if (s) budLignesSortie(s, pools).forEach((l) => out.push(l));
  });

  ajustementsDates(c, D).forEach((l) => out.push(l));
  return out;
}

/**
 * Totals of a list of lines. Lines outside the budget count neither in the total, nor in the margin, nor before / on the
 * spot; their sum is horsBudget. incomplet: a price is missing among the lines that count. Without a cap, marge is null.
 */
function totaux(lignes, plafond) {
  const p = budNum(plafond) ? plafond : null;
  let total = 0;
  let avant = 0;
  let hors = 0;
  let incomplet = false;
  let horsInc = false;
  (lignes || []).forEach((l) => {
    const m = montantLigne(l);
    if (l && l.hors_budget) {
      hors += m;
      if (budIncomplete(l)) horsInc = true;
      return;
    }
    total += m;
    if (l && l.quand === "avant") avant += m;
    if (budIncomplete(l)) incomplet = true;
  });
  return {
    total: budR2(total),
    avant: budR2(avant),
    place: budR2(total - avant),
    marge: p === null ? null : budR2(p - total),
    plafond: p,
    horsBudget: budR2(hors),
    incomplet,
    horsBudgetIncomplet: horsInc,
  };
}

function budCleIncomplete(l) {
  return `${l.etape}|${l.poste}|${l.cle}|${l.lib}`;
}

/**
 * Effect of a change of choice on the total: { montant, incomplet }. patch = fields of Choix replacing those of choix (one
 * level: to tick an outing, pass the whole sorties table). incomplet: the change brings a line without price that was not
 * there already.
 */
function ecart(choix, D, patch) {
  const avant = lignesVoyage(choix, D);
  const apres = lignesVoyage(Object.assign({}, choix, patch || {}), D);
  const plafond = budCfg(D).budgetCap;
  const ta = totaux(apres, plafond);
  const tb = totaux(avant, plafond);
  const deja = {};
  avant.forEach((l) => {
    if (!l.hors_budget && budIncomplete(l)) deja[budCleIncomplete(l)] = true;
  });
  const nouvelle = apres.some((l) => !l.hors_budget && budIncomplete(l) && !deja[budCleIncomplete(l)]);
  return { montant: budR2(ta.total - tb.total), incomplet: nouvelle };
}

/**
 * Puts saved choices back in order (for example after the data was rebuilt): an id that no longer exists takes the
 * default back. Returns { choix, remplaces: [replaced fields], sortiesRetirees: [ids] }. Absent (undefined) = default,
 * without message. A stage whose data is not loaded yet is not checked: the saved choice is kept. A special evening saved
 * as null or false ("none") is kept. Outings of a special evening ticked in the list move to speciales (the last one).
 */
function resoudreChoix(enregistre, D) {
  const s = budSimple(enregistre) ? enregistre : {};
  const d = (D && D.defaut) || {};
  const trip = budCfg(D);
  const charge = budToutCharge(D, trip);
  const choix = {};
  const remplaces = [];
  const sortiesRetirees = [];

  trip.legs.forEach((leg) => {
    const k = leg.key;
    const v = s[k];
    if (typeof v !== "string") choix[k] = d[k];
    else if (budOption(D, k, v) || !(D && D.vols && D.vols[k])) choix[k] = v;
    else {
      choix[k] = d[k];
      remplaces.push(k);
    }
  });
  const si = budSimple(s.inclure) ? s.inclure : {};
  const di = budSimple(d.inclure) ? d.inclure : {};
  choix.inclure = {};
  trip.legs.forEach((leg) => {
    const k = leg.key;
    choix.inclure[k] = typeof si[k] === "boolean" ? si[k] : typeof di[k] === "boolean" ? di[k] : leg.in_budget;
  });
  trip.stageKeys.forEach((k) => {
    const v = s[k];
    if (typeof v !== "string") choix[k] = d[k];
    else if (budLogement(D, k, v) || !budLieux(D, k)) choix[k] = v;
    else {
      choix[k] = d[k];
      remplaces.push(k);
    }
  });

  const parSpeciale = {};
  if (budSimple(s.sorties)) {
    choix.sorties = {};
    Object.keys(s.sorties).forEach((id) => {
      const v = s.sorties[id];
      const x = budSortie(D, trip, id);
      const connue = !!x || !charge;
      if (!v) {
        if (connue) choix.sorties[id] = false; // unticked: kept as a trace, does not count
      } else if (x && typeof x.speciale === "string" && x.speciale) {
        parSpeciale[x.speciale] = id; // a special evening is a single choice: it moves to speciales
      } else if (connue) {
        choix.sorties[id] = Object.assign({ jour: null }, budSimple(v) ? v : {});
      } else {
        sortiesRetirees.push(id); // ticked but gone from the data
      }
    });
    if (sortiesRetirees.length) remplaces.push("sorties");
  } else {
    choix.sorties = JSON.parse(JSON.stringify(budSimple(d.sorties) ? d.sorties : {}));
  }

  const ss = budSimple(s.speciales) ? s.speciales : {};
  const ds = budSimple(d.speciales) ? d.speciales : {};
  const cles = trip.specials.map((x) => x.key);
  Object.keys(ds).forEach((k) => { if (cles.indexOf(k) < 0) cles.push(k); });
  choix.speciales = {};
  cles.forEach((k) => {
    const v = ss[k];
    const defaut = ds[k] === undefined ? null : ds[k];
    if (typeof v === "string" && v) {
      const x = budSortie(D, trip, v);
      if ((x && x.speciale === k) || !charge) choix.speciales[k] = v;
      else {
        choix.speciales[k] = parSpeciale[k] || defaut;
        remplaces.push(`speciales.${k}`);
      }
    } else if (parSpeciale[k]) choix.speciales[k] = parSpeciale[k];
    else if (v === null || v === false) choix.speciales[k] = v; // "none", respected without message
    else if (v === undefined) choix.speciales[k] = defaut;
    else {
      choix.speciales[k] = defaut;
      remplaces.push(`speciales.${k}`);
    }
  });
  return { choix, remplaces, sortiesRetirees };
}

if (typeof module !== "undefined") {
  module.exports = { lignesVoyage, totaux, ecart, resoudreChoix, ajustementsDates, montantLigne, sortiesComptees };
}
