"""Labels produced in Python (budget lines, notes, link names), in English and French.

`T(key, lang, **vars)` returns the label in `lang`; an unknown language falls back to English; an unknown key returns
the key itself and warns once on stderr. The page's own texts live in the page translation files, not here.
"""
import sys

EN = {
    # flights (scripts/flights.py)
    "layover": "Layover: {parts}.",
    "overnight": "overnight", "airport_change": "airport change", "separate": "separate tickets",
    "separate_note": "Separate tickets: the bag is collected and checked in again at each ticket change.",
    "ticket": "{who}{frm} → {to}, {date} ({airlines}{bag}) · {site}",
    "bag_included": ", bag included",
    "bag_line": "{who}checked bag (extra), {frm} → {to}",
    "lowest": "lowest price found: {site}, {price} {cur} for {n} traveler(s)",
    "checked": " (checked {date})",
    "bag_unknown": "checked bag not included, supplement unknown: price to check",
    "bag_kiwi": "supplement read at Kiwi",
    "bag_estimated": "supplement read at Kiwi, added to {site}'s fare: estimated (that site may charge it differently)",
    "out_of_budget": "outside the shared budget",
    # lodging lines (scripts/page_data.py)
    "stay_nights": "nights · {name} ({platform})",
    "cancellation": "cancellation {text}",
    "payment": "payment: {text}",
    "breakfasts": "breakfasts", "lunches": "lunches", "dinners": "dinners", "gala_dinner": "mandatory gala dinner",
    "drinks": "drinks", "spa": "massages and spa", "transfers": "airport ↔ stay transfers",
    "estimated": "{item} (estimated)",
    "book_with_lodging": "book with the lodging a few days ahead",
    # links
    "official_site": "Official site", "booking_default": "Booking",
    # ground legs
    "ground_line": "{frm} → {to}, {date} ({operator})",
    "ground_booking": "book: {text}",
}

FR = {
    "layover": "Escale : {parts}.",
    "overnight": "de nuit", "airport_change": "changement d'aéroport", "separate": "billets séparés",
    "separate_note": "Billets séparés : la valise se reprend et se réenregistre à chaque changement de billet.",
    "ticket": "{who}{frm} → {to}, {date} ({airlines}{bag}) · {site}",
    "bag_included": ", valise comprise",
    "bag_line": "{who}valise en soute (ajout), {frm} → {to}",
    "lowest": "prix le plus bas relevé : {site}, {price} {cur} pour {n} voyageur(s)",
    "checked": " (vérifié le {date})",
    "bag_unknown": "valise en soute non comprise, supplément non relevé : prix à vérifier",
    "bag_kiwi": "supplément relevé chez Kiwi",
    "bag_estimated": "supplément relevé chez Kiwi, ajouté au tarif de {site} : estimé (ce site peut le facturer autrement)",
    "out_of_budget": "hors budget commun",
    "stay_nights": "nuits · {name} ({platform})",
    "cancellation": "annulation {text}",
    "payment": "paiement : {text}",
    "breakfasts": "petits-déjeuners", "lunches": "déjeuners", "dinners": "dîners", "gala_dinner": "dîner de gala imposé",
    "drinks": "verres", "spa": "massages et spa", "transfers": "transferts aéroport ↔ logement",
    "estimated": "{item} (estimé)",
    "book_with_lodging": "à réserver auprès du logement quelques jours avant",
    "official_site": "Site officiel", "booking_default": "Réservation",
    "ground_line": "{frm} → {to}, {date} ({operator})",
    "ground_booking": "réserver : {text}",
}

TABLES = {"en": EN, "fr": FR}
_WARNED = set()


def T(key, lang="en", **vars):
    table = TABLES.get(lang) or EN
    text = table.get(key)
    if text is None:
        text = EN.get(key)
    if text is None:
        if key not in _WARNED:
            _WARNED.add(key)
            print(f"warning: missing translation key {key!r}", file=sys.stderr)
        return key
    return text.format(**vars) if vars else text
