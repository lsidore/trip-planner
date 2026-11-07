"""Médias en haute qualité (tâche 21) : liens en grande taille, fichiers <NN>.jpg / <NN>-s.jpg, index, filtre de retrait
(rubrique de la source, analyse de scène, doublons par empreinte), photos des lieux. Sans réseau : petites images fabriquées."""
import contextlib
import io
import json
import os
import random
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

try:
    from PIL import Image, ImageCms
except ImportError:  # the Pillow-dependent classes below are skipped
    Image = ImageCms = None
NEEDS_PILLOW = unittest.skipUnless(Image is not None, "Pillow is not installed (python3 -m pip install --user Pillow)")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import photos as M  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
STATE = ("TRIP", "OUT", "INDEX", "RETRAITS", "CACHE", "BIN", "IMPORTS", "MANUAL", "ID_IMPORT")


def configured(test, trip_dir=SAMPLE):
    """Configure scripts/photos.py for a trip for the length of a test, then restore its previous state."""
    old = {k: getattr(M, k) for k in STATE}
    test.addCleanup(lambda: [setattr(M, k, v) for k, v in old.items()])
    M.configure(load(trip_dir))


def img(chemin):
    with Image.open(chemin) as im:
        im.load()
        return im.copy()


def lire(chemin):
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def motif(seed, w, h):
    """Image « photo » déterministe : même graine = même image (à toute taille), graines différentes = images différentes."""
    rnd = random.Random(seed)
    petit = Image.new("RGB", (9, 8))
    petit.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(72)])
    return petit.resize((w, h), Image.BILINEAR)


class Cache:
    """Un cache de téléchargement fabriqué (research/medias-cache/<slug>/) dans un dossier temporaire."""

    def __init__(self, tmp, slug="lisbon-xx"):
        self.tmp, self.slug = tmp, slug
        self.dossier = os.path.join(tmp, "cache", slug)
        os.makedirs(self.dossier)
        self.meta = []

    def ajouter(self, graine, w, h, source="Trip.com", label="", ordre=None, **kw):
        k = len(self.meta) if ordre is None else ordre
        cid = f"c{len(self.meta):03d}"
        im = motif(graine, w, h)
        M.ecrire(im, os.path.join(self.dossier, cid + ".jpg"), M.GRAND_PX, M.GRAND_Q)
        M.ecrire(im, os.path.join(self.dossier, cid + "-s.jpg"), M.PETIT_PX, M.PETIT_Q)
        hh, col = M.empreinte(im)
        self.meta.append(dict({"id": cid, "ordre": k, "source": source, "label": label, "rang": k, "url": f"https://x.example/{cid}.jpg",
                               "px": [w, h], "octets": 1, "hash": hh, "couleur": col, "sd": 60.0, "couverture": False,
                               "fournisseur": M.fournisseur(f"https://x.example/{cid}.jpg", source)}, **kw))
        return cid

    def ecrire(self, **info):
        d = dict({"slug": self.slug, "photo_cover": None, "candidats": self.meta, "echecs": []}, **info)
        with open(os.path.join(self.dossier, "cands.json"), "w", encoding="utf-8") as f:
            json.dump(d, f)
        return d


class Cadre(unittest.TestCase):
    """Redirige les dossiers de scripts/photos.py vers un dossier temporaire."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.tmp = self.tmpdir.name
        configured(self)
        self.out = os.path.join(self.tmp, "photos")
        for nom, val in (("OUT", self.out), ("INDEX", os.path.join(self.out, "index.json")),
                         ("RETRAITS", os.path.join(self.out, "retraits.json")), ("CACHE", os.path.join(self.tmp, "cache")),
                         ("BIN", os.path.join(self.tmp, "cache", ".bin", "medias_vision"))):
            p = mock.patch.object(M, nom, val)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmpdir.cleanup)

    def trier(self, cache, features=None, **info):
        d = cache.ecrire(**info)
        return M.trier_logement(d, features or {})


class TestLiensEnGrandeTaille(unittest.TestCase):
    def test_airbnb_1920_haute_qualite(self):
        v = M.variantes("https://a0.muscache.com/im/pictures/miso/Hosting-1/original/x.jpeg?im_w=1200")
        self.assertEqual(v[0], "https://a0.muscache.com/im/pictures/miso/Hosting-1/original/x.jpeg?im_w=1920&im_q=highq")
        self.assertEqual(v[-1], "https://a0.muscache.com/im/pictures/miso/Hosting-1/original/x.jpeg?im_w=1200")  # repli : le lien d'origine

    def test_booking_2048(self):
        v = M.variantes("https://cf.bstatic.com/xdata/images/hotel/max1024x768/639249648.jpg?k=abc&o=")
        self.assertEqual(v[0], "https://cf.bstatic.com/xdata/images/hotel/max2048x1536/639249648.jpg?k=abc&o=")
        self.assertIn("max500", M.variantes("https://q-xx.bstatic.com/xdata/images/hotel/max500/1.jpg?k=a")[-1])
        self.assertIn("max2048x1536", M.variantes("https://q-xx.bstatic.com/xdata/images/hotel/max500/1.jpg?k=a")[0])

    def test_agoda_sans_parametre_de_taille(self):
        self.assertEqual(M.variantes("https://pix8.agoda.net/hotelImages/1/0/ab.jpg?s=1024x768")[0], "https://pix8.agoda.net/hotelImages/1/0/ab.jpg")
        self.assertEqual(M.variantes("https://pix8.agoda.net/hotelImages/1/0/ab.jpeg?va=1&ce=3&s=1024x768")[0],
                         "https://pix8.agoda.net/hotelImages/1/0/ab.jpeg?va=1&ce=3")

    def test_trip_original(self):
        self.assertEqual(M.variantes("https://ak-d.tripcdn.com/images/0585w12000u5mkzw687D6_R_960_660_R5_D.jpg")[0],
                         "https://ak-d.tripcdn.com/images/0585w12000u5mkzw687D6.jpg")

    def test_google_2000_et_non_7499(self):
        v = M.variantes("https://lh3.googleusercontent.com/gps-cs-s/ANWiy9Sq=s7499")
        self.assertEqual(v[0], "https://lh3.googleusercontent.com/gps-cs-s/ANWiy9Sq=w2000")

    def test_wikimedia_miniature_agrandie(self):
        v = M.variantes("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/330px-Foo.jpg")
        self.assertTrue(v[0].endswith("/1600px-Foo.jpg"))

    def test_wikimedia_original_becomes_a_1600px_thumbnail(self):
        u = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg"
        self.assertEqual(M.wikimedia_thumb(u),
                         "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/1600px-Foo_bar.jpg")
        self.assertEqual(M.variantes(u)[0], M.wikimedia_thumb(u))
        self.assertEqual(M.variantes(u)[-1], u)          # the original stays as the last resort
        for other in ("https://example.com/a/ab/Foo.jpg", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/330px-Foo.jpg"):
            self.assertEqual(M.wikimedia_thumb(other), other)

    def test_wikimedia_thumbnail_keeps_escapes_and_parentheses(self):
        name = "Caf%C3%A9_de_Lisboa_%28Rua_Augusta%2C_1%29.jpg"
        u = f"https://upload.wikimedia.org/wikipedia/commons/c/c3/{name}"
        self.assertEqual(M.wikimedia_thumb(u),
                         f"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/{name}/1600px-{name}")
        raw = "https://upload.wikimedia.org/wikipedia/commons/c/c3/Caf%C3%A9_(Rua_Augusta%2C_1).jpg"
        self.assertEqual(M.variantes(raw)[0], M.wikimedia_thumb(raw))
        self.assertTrue(M.wikimedia_thumb(raw).endswith("/1600px-Caf%C3%A9_(Rua_Augusta%2C_1).jpg"))

    def test_wikimedia_downloads_use_a_descriptive_user_agent_and_a_pause(self):
        seen = []

        class R:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            def read(s):
                return b"x"

        def fake_open(req, timeout=0, context=None):
            seen.append((req.get_header("User-agent"), time.monotonic()))
            return R()
        with mock.patch.object(M.urllib.request, "urlopen", fake_open), mock.patch.object(M, "WIKI_DELAY", 0.05):
            M.lire_url("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/1600px-F.jpg")
            M.lire_url("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/G.jpg/1600px-G.jpg")
        self.assertTrue(all(ua.startswith("trip-planner/") and "github.com" in ua for ua, _t in seen))
        self.assertGreaterEqual(seen[1][1] - seen[0][1], 0.045)

    def test_trip_et_agoda_donnent_l_original(self):
        import gallery_sources as GS
        self.assertEqual(GS.agoda_original("//pix8.agoda.net/hotelImages/9/0/x.jpeg?va=1&ce=3&s=1024x768"),
                         "https://pix8.agoda.net/hotelImages/9/0/x.jpeg?va=1&ce=3")

    def test_fournisseurs(self):
        self.assertEqual(M.fournisseur("https://cf.bstatic.com/x.jpg"), "Booking.com")
        self.assertEqual(M.fournisseur("https://a0.muscache.com/x.jpg"), "Airbnb")
        self.assertEqual(M.fournisseur("https://www.sripanwa.com/a.jpg", "site officiel"), "the venue's own site")


@NEEDS_PILLOW
class TestEcritureDesFichiers(unittest.TestCase):
    def test_grand_cote_1600_jamais_agrandi_et_progressif(self):
        with tempfile.TemporaryDirectory() as d:
            M.ecrire(motif(1, 2400, 1600), os.path.join(d, "a.jpg"), 1600, 82)
            M.ecrire(motif(2, 900, 600), os.path.join(d, "b.jpg"), 1600, 82)
            M.ecrire(motif(3, 1000, 2000), os.path.join(d, "c-s.jpg"), 600, 78)
            with Image.open(os.path.join(d, "a.jpg")) as a, Image.open(os.path.join(d, "b.jpg")) as b, \
                    Image.open(os.path.join(d, "c-s.jpg")) as c:
                self.assertEqual(a.size, (1600, 1067))
                self.assertEqual(b.size, (900, 600))  # jamais agrandie
                self.assertEqual(c.size, (300, 600))  # portrait : le grand côté est la hauteur
                self.assertEqual(a.format, "JPEG")
                self.assertTrue(a.info.get("progressive") or a.info.get("progression"))
                self.assertNotIn("exif", a.info)

    def test_vers_srgb_cmyk_et_transparence(self):
        cmyk = Image.new("CMYK", (8, 8), (0, 0, 0, 0))
        self.assertEqual(M.vers_srgb(cmyk).mode, "RGB")
        rgba = Image.new("RGBA", (8, 8), (255, 0, 0, 0))  # entièrement transparent : fond blanc
        self.assertEqual(M.vers_srgb(rgba).getpixel((0, 0)), (255, 255, 255))

    def test_vers_srgb_convertit_un_profil_etranger_et_ignore_un_profil_illisible(self):
        profil = ImageCms.ImageCmsProfile(ImageCms.createProfile("XYZ")).tobytes()  # pas du sRGB
        im = Image.new("RGB", (8, 8), (200, 40, 40))
        im.info["icc_profile"] = profil
        marque = Image.new("RGB", (8, 8), (1, 2, 3))
        with mock.patch.object(M.ImageCms, "profileToProfile", return_value=marque) as conv:
            self.assertEqual(M.vers_srgb(im).getpixel((0, 0)), (1, 2, 3))
        self.assertEqual(conv.call_count, 1)
        srgb = Image.new("RGB", (8, 8), (200, 40, 40))
        srgb.info["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        with mock.patch.object(M.ImageCms, "profileToProfile", return_value=marque) as conv:
            self.assertEqual(M.vers_srgb(srgb).getpixel((0, 0)), (200, 40, 40))  # déjà sRGB : intact
        self.assertEqual(conv.call_count, 0)
        mauvais = Image.new("RGB", (8, 8), (200, 40, 40))
        mauvais.info["icc_profile"] = b"pas un profil"
        self.assertEqual(M.vers_srgb(mauvais).getpixel((0, 0)), (200, 40, 40))


@NEEDS_PILLOW
class TestDoublons(unittest.TestCase):
    def test_meme_photo_a_deux_tailles(self):
        a, b = M.empreinte(motif(7, 400, 300)), M.empreinte(motif(7, 1600, 1200))
        self.assertTrue(M.meme_photo(a, b)[0])

    def test_photos_differentes(self):
        self.assertFalse(M.meme_photo(M.empreinte(motif(7, 400, 300)), M.empreinte(motif(8, 400, 300)))[0])

    def test_meme_forme_mais_couleurs_differentes_ne_sont_pas_des_doublons(self):
        """Deux dégradés de même structure mais l'un clair, l'autre sombre : la couleur les distingue."""
        clair = Image.new("RGB", (400, 300), (230, 230, 230))
        sombre = Image.new("RGB", (400, 300), (20, 20, 20))
        ok, _ = M.meme_photo(M.empreinte(clair), M.empreinte(sombre))
        self.assertFalse(ok)


@NEEDS_PILLOW
class TestRetraitSelonLaSource(Cadre):
    def test_salle_de_reunion_et_banquet_sont_ecartes_par_la_rubrique(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067, label="Piscine extérieure")
        c.ajouter(2, 1600, 1067, label="Salle multifonctionnelle")
        c.ajouter(3, 1600, 1067, source="Agoda", label="Facility photos / Meeting room")
        c.ajouter(4, 1600, 1067, source="Agoda", label="Facility photos / Ballroom")
        c.ajouter(5, 1600, 1067, label="Chambre : Suite avec vue sur la baie")
        gardes, retraits, _ = self.trier(c)
        self.assertEqual([g["label"] for g in gardes], ["Chambre : Suite avec vue sur la baie", "Piscine extérieure"])  # chambres avant piscine
        self.assertEqual(sorted(r["photo"] for r in retraits), ["c001", "c002", "c003"])
        self.assertTrue(all(r["raison"] == "reunion_banquet" for r in retraits))
        self.assertIn("Meeting room", next(r for r in retraits if r["photo"] == "c002")["detail"])

    def test_le_nom_du_fichier_compte_pour_un_site_officiel(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067, source="site officiel", url="https://hotel.example/wp-content/uploads/Ballroom-wedding-01.jpg")
        c.ajouter(2, 1600, 1067, source="site officiel", url="https://hotel.example/wp-content/uploads/pool-villa.jpg")
        gardes, retraits, _ = self.trier(c)
        self.assertEqual([g["id"] for g in gardes], ["c001"])
        self.assertEqual(retraits[0]["raison"], "reunion_banquet")

    def test_une_rubrique_qui_ecarte_une_copie_ecarte_toutes_les_copies(self):
        """La même photo vue par Booking (sans rubrique) et par Trip.com (« Salle de réunion ») : écartée des deux côtés."""
        c = Cache(self.tmp)
        c.ajouter(5, 1000, 700, source="liens fournis")
        c.ajouter(5, 1920, 1280, label="Salle de réunion")
        c.ajouter(6, 1600, 1067)
        gardes, retraits, _ = self.trier(c)
        self.assertEqual([g["id"] for g in gardes], ["c002"])
        raisons = {r["photo"]: r["raison"] for r in retraits}
        self.assertEqual(raisons["c001"], "reunion_banquet")
        self.assertEqual(raisons["c000"], "doublon")  # consignée comme copie d'une photo écartée
        self.assertIn("copy of c001", next(r for r in retraits if r["photo"] == "c000")["detail"])

    def test_attractions_et_plan_d_etage(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067, source="Agoda", label="Facility photos / Attractions")
        c.ajouter(2, 1600, 1067, source="Agoda", label="Other / Floor plans")  # vue aérienne rangée là : gardée sans dessin ni texte
        c.ajouter(3, 1600, 1067)
        gardes, retraits, _ = self.trier(c)
        self.assertEqual(sorted(g["id"] for g in gardes), ["c001", "c002"])
        self.assertEqual([(r["photo"], r["raison"]) for r in retraits], [("c000", "hors_logement")])

    def test_plan_d_etage_dessine_est_ecarte(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067, source="Agoda", label="Other / Floor plans")
        c.ajouter(2, 1600, 1067)
        feat = {"c000": {"labels": [["diagram", 0.8]], "visages": [], "texte": {"mots": 12, "aire": 0.1, "lignes": 5}}}
        gardes, retraits, _ = self.trier(c, feat)
        self.assertEqual([g["id"] for g in gardes], ["c001"])
        self.assertEqual(retraits[0]["raison"], "hors_logement")


@NEEDS_PILLOW
class TestRetraitVisuel(Cadre):
    n = 0

    def une(self, features, **kw):
        TestRetraitVisuel.n += 1
        c = Cache(self.tmp, f"lisbon-v{TestRetraitVisuel.n}")
        c.ajouter(1, 1600, 1067)
        c.ajouter(2, 1600, 1067, **kw)
        gardes, retraits, _ = self.trier(c, {"c001": features})
        return [g["id"] for g in gardes], retraits

    def test_scene_de_conference_ou_de_mariage(self):
        gardes, retraits = self.une({"labels": [["conference", 0.7], ["indoor", 0.9]], "visages": [], "texte": {}})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "reunion_banquet"))
        gardes, retraits = self.une({"labels": [["wedding", 0.6]], "visages": [], "texte": {}})
        self.assertEqual(retraits[0]["raison"], "reunion_banquet")
        gardes, retraits = self.une({"labels": [["conference", 0.2]], "visages": [], "texte": {}})  # sous le seuil : gardée
        self.assertEqual(gardes, ["c000", "c001"])

    def test_texte_enseigne_affiche_et_menu(self):
        gardes, retraits = self.une({"labels": [], "visages": [], "texte": {"mots": 31, "aire": 0.3, "lignes": 9}})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "affiche_texte"))
        # un seul mot lu, même sur une grande zone : c'est du feuillage ou un motif, pas une affiche
        gardes, retraits = self.une({"labels": [], "visages": [], "texte": {"mots": 1, "aire": 0.5, "lignes": 1}})
        self.assertEqual(gardes, ["c000", "c001"])

    def test_personnes_au_premier_plan(self):
        gardes, retraits = self.une({"labels": [["people", 0.9]], "visages": [0.08], "texte": {}})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "personnes"))
        gardes, retraits = self.une({"labels": [["people", 0.9]], "visages": [0.003, 0.002], "texte": {}})  # couple vu de loin : gardée
        self.assertEqual(gardes, ["c000", "c001"])

    def test_gros_plan_d_objet_sans_scene(self):
        gardes, retraits = self.une({"labels": [["remote_control", 0.8], ["electronics", 0.5]], "visages": [], "texte": {}})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "objet"))
        gardes, retraits = self.une({"labels": [["remote_control", 0.8], ["bedroom", 0.6], ["indoor", 0.9]], "visages": [], "texte": {}})
        self.assertEqual(gardes, ["c000", "c001"])  # une chambre avec une télécommande dessus n'est pas un gros plan

    def test_couverts_et_verres_en_gros_plan_mais_pas_une_table_dans_un_restaurant(self):
        gardes, retraits = self.une({"labels": [["tableware", 0.9], ["utensil", 0.9], ["drinking_glass", 0.9]], "visages": [], "texte": {}})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "objet"))
        gardes, retraits = self.une({"labels": [["tableware", 0.9], ["restaurant", 0.8], ["interior_room", 0.8]], "visages": [], "texte": {}})
        self.assertEqual(gardes, ["c000", "c001"])
        # un parasol compte parfois comme « utensil » : le ciel et l'extérieur disent que c'est un lieu
        gardes, retraits = self.une({"labels": [["umbrella", 0.9], ["utensil", 0.9], ["outdoor", 0.9], ["sky", 0.9]], "visages": [], "texte": {}})
        self.assertEqual(gardes, ["c000", "c001"])

    def test_plan_dessine_sur_fond_blanc_mais_vue_aerienne_sans_etiquette_gardee(self):
        gardes, retraits = self.une({"labels": [["structure", 0.12]], "visages": [], "texte": {}, "blanc": 0.7})
        self.assertEqual((gardes, retraits[0]["raison"]), (["c000"], "objet"))
        gardes, retraits = self.une({"labels": [["structure", 0.12]], "visages": [], "texte": {}, "blanc": 0.02})  # aérienne
        self.assertEqual(gardes, ["c000", "c001"])

    def test_bandeau_et_image_unie(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067)
        c.ajouter(2, 2400, 400)  # rapport 6 : bandeau
        c.ajouter(3, 1600, 1067, sd=3.0)  # presque unie
        gardes, retraits, _ = self.trier(c)
        self.assertEqual([g["id"] for g in gardes], ["c000"])
        self.assertEqual(sorted((r["photo"], r["raison"]) for r in retraits), [("c001", "format"), ("c002", "format")])

    def test_sans_vision_seul_le_format_et_les_rubriques_jouent(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067)
        c.ajouter(2, 1600, 1067)
        gardes, retraits, _ = self.trier(c, {})
        self.assertEqual(len(gardes), 2)


@NEEDS_PILLOW
class TestDoublonsDansLaGalerie(Cadre):
    def test_on_garde_la_plus_grande_a_la_place_de_la_premiere(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1024, 683, source="liens fournis")  # lien des chercheurs en 1 024 px
        c.ajouter(2, 1600, 1067)
        c.ajouter(1, 1600, 1067, source="Agoda")  # la même photo en 2 048 px (réduite à 1 600 dans le cache)
        gardes, retraits, _ = self.trier(c)
        self.assertEqual([g["id"] for g in gardes], ["c002", "c001"])  # la grande copie, à la place de la première
        self.assertEqual([(r["photo"], r["raison"]) for r in retraits], [("c000", "doublon")])
        self.assertIn("copy of c002", retraits[0]["detail"])


@NEEDS_PILLOW
class TestOrdreEtVue(Cadre):
    def test_la_photo_de_la_vue_choisie_a_la_main_passe_en_tete_et_n_est_jamais_retiree(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067)
        c.ajouter(2, 1600, 1067)
        c.ajouter(3, 1000, 750, source="archive (Google Hôtels)", couverture=True)  # 0-cover.jpg
        feat = {"c002": {"labels": [["conference", 0.9]], "visages": [0.2], "texte": {}}}  # les règles visuelles ne l'écartent pas
        gardes, retraits, vue = self.trier(c, feat)
        self.assertEqual([g["id"] for g in gardes], ["c002", "c000", "c001"])
        self.assertTrue(vue)
        self.assertEqual(retraits, [])

    def test_photo_cover_du_chercheur(self):
        c = Cache(self.tmp)
        for k in range(1, 6):
            c.ajouter(k, 1600, 1067, source="liens fournis", rang=k - 1)
        gardes, _, vue = self.trier(c, photo_cover=4)  # « la 4e photo de la liste montre la vue »
        self.assertEqual(gardes[0]["id"], "c003")
        self.assertTrue(vue)

    def test_sans_choix_pas_de_vue_en_tete(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067)
        _, _, vue = self.trier(c)
        self.assertFalse(vue)

    def test_la_vue_est_la_copie_la_plus_grande_du_groupe(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067)
        c.ajouter(2, 1000, 700, source="archive (Google Hôtels)", couverture=True)
        c.ajouter(2, 1600, 1067, source="Agoda")  # même photo, plus grande
        gardes, _, vue = self.trier(c)
        self.assertEqual(gardes[0]["id"], "c002")
        self.assertTrue(vue)


@NEEDS_PILLOW
class TestResolutionEtPlafond(Cadre):
    def test_les_petites_photos_partent_si_assez_de_grandes(self):
        c = Cache(self.tmp)
        for k in range(10):
            c.ajouter(k, 1600, 1067)
        c.ajouter(50, 700, 466, source="archive (Google Hôtels)")
        gardes, retraits, _ = self.trier(c)
        self.assertEqual(len(gardes), 10)
        self.assertEqual([(r["photo"], r["raison"]) for r in retraits], [("c010", "petite")])

    def test_sous_640_px_une_photo_est_floue_et_part_toujours(self):
        c = Cache(self.tmp)
        for k in range(3):
            c.ajouter(k, 1600, 1067)
        c.ajouter(50, 480, 320, source="archive (liens fournis)")
        gardes, retraits, _ = self.trier(c)
        self.assertEqual(len(gardes), 3)
        self.assertEqual([(r["photo"], r["raison"]) for r in retraits], [("c003", "petite")])
        self.assertIn("640", retraits[0]["detail"])

    def test_les_petites_photos_restent_si_la_galerie_serait_pauvre(self):
        c = Cache(self.tmp)
        for k in range(3):
            c.ajouter(k, 1600, 1067)
        c.ajouter(50, 700, 466, source="archive (Google Hôtels)")
        gardes, _, _ = self.trier(c)
        self.assertEqual(len(gardes), 4)

    def test_plafond_resserre_d_abord_les_rubriques_qui_se_repetent(self):
        c = Cache(self.tmp)
        for k in range(30):
            c.ajouter(k, 1600, 1067, source="Agoda", label="Room photos / Pool Villa")  # une chambre, 30 angles
        for k in range(30, 40):
            c.ajouter(k, 1600, 1067, source="Agoda", label="Facility photos / Spa")
        d = c.ecrire()
        gardes, retraits, _ = M.trier_logement(d, {}, max_logement=20)
        self.assertEqual(len(gardes), 20)
        villa = [g for g in gardes if "Pool Villa" in g["label"]]
        spa = [g for g in gardes if "Spa" in g["label"]]
        self.assertEqual((len(villa), len(spa)), (10, 10))  # la chambre répétée est rognée avant le spa
        self.assertTrue(all(r["raison"] == "plafond" for r in retraits))
        self.assertEqual(len(retraits), 20)


@NEEDS_PILLOW
class TestOrdreDesRubriques(Cadre):
    def test_rang_des_rubriques(self):
        for label, rang in (("Room photos / Sea View Suite", 1), ("Chambre : Suite avec vue", 1), ("Property views / Exterior view", 0),
                            ("Vue sur l'océan", 0), ("Piscine extérieure", 2), ("Facility photos / Beach", 2), ("On-site dining / Restaurant", 3),
                            ("Facility photos / Spa", 4), ("Salle de sport", 4), ("", 2)):
            self.assertEqual(M.rang_rubrique(label), rang, label)

    def test_photos_des_chercheurs_d_abord_puis_vues_chambres_piscine_table_reste(self):
        c = Cache(self.tmp)
        c.ajouter(1, 1600, 1067, source="Agoda", label="Facility photos / Spa")
        c.ajouter(2, 1600, 1067, source="Agoda", label="On-site dining / Restaurant")
        c.ajouter(3, 1600, 1067, source="Agoda", label="Room photos / Pool Villa")
        c.ajouter(4, 1600, 1067, source="Agoda", label="Facility photos / Swimming pool")
        c.ajouter(5, 1600, 1067, source="Agoda", label="Property views / Exterior view")
        c.ajouter(6, 1600, 1067, source="liens fournis")  # son rang de source est le dernier, mais les chercheurs passent en premier
        gardes, _, _ = self.trier(c)
        self.assertEqual([g["label"] for g in gardes], ["", "Property views / Exterior view", "Room photos / Pool Villa",
                                                         "Facility photos / Swimming pool", "On-site dining / Restaurant", "Facility photos / Spa"])

    def test_au_dela_du_plafond_une_photo_par_rubrique_d_abord_les_chambres_avant_le_reste(self):
        c = Cache(self.tmp)
        for k in range(10):  # le spa vient en premier dans la source (Agoda range les installations avant les chambres)
            c.ajouter(k, 1600, 1067, source="Agoda", label="Facility photos / Spa")
        for k in range(10, 14):
            c.ajouter(k, 1600, 1067, source="Agoda", label="Room photos / Pool Villa")
        for k in range(14, 18):
            c.ajouter(k, 1600, 1067, source="Agoda", label="Room photos / Garden Suite")
        d = c.ecrire()
        gardes, retraits, _ = M.trier_logement(d, {}, max_logement=9)
        compte = {}
        for g in gardes:
            compte[g["label"]] = compte.get(g["label"], 0) + 1
        # 3 rubriques : 3 couches de 3 photos (1re de chaque rubrique, puis 2e, puis 3e)
        self.assertEqual(compte, {"Room photos / Pool Villa": 3, "Room photos / Garden Suite": 3, "Facility photos / Spa": 3})
        self.assertEqual([g["label"] for g in gardes][-3:], ["Facility photos / Spa"] * 3)  # galerie rangée : chambres, puis le spa
        self.assertEqual(len(retraits), 9)
        self.assertTrue(all(r["raison"] == "plafond" and "of section" in r["detail"] for r in retraits))

    def test_la_photo_de_la_vue_survit_au_plafond(self):
        c = Cache(self.tmp)
        for k in range(6):
            c.ajouter(k, 1600, 1067, source="Agoda", label="Room photos / Pool Villa")
        c.ajouter(50, 1000, 750, source="archive (Google Hôtels)", couverture=True)
        d = c.ecrire()
        gardes, _, vue = M.trier_logement(d, {}, max_logement=3)
        self.assertEqual((len(gardes), gardes[0]["id"], vue), (3, "c006", True))


@NEEDS_PILLOW
class TestPublicationDesFichiers(Cadre):
    def test_fichiers_numerotes_index_et_retraits(self):
        c = Cache(self.tmp, "lisbon-xx")
        c.ajouter(1, 2000, 1333, source="Airbnb", label="Bedroom 1", url="https://a0.muscache.com/im/pictures/1.jpeg", fournisseur="Airbnb")
        c.ajouter(2, 1500, 1000, source="Airbnb", label="Meeting room", url="https://a0.muscache.com/im/pictures/2.jpeg", fournisseur="Airbnb")
        c.ajouter(3, 1000, 2000, source="Airbnb", label="Bathroom", url="https://a0.muscache.com/im/pictures/3.jpeg", fournisseur="Airbnb")
        d = c.ecrire()
        with open(os.path.join(c.dossier, "cands.json"), "w") as f:
            json.dump(dict(d, photo_cover=None), f)
        entree = M.trier("lisbon-xx")
        self.assertEqual(entree["n"], 2)
        dossier = os.path.join(self.out, "lisbon-xx")
        self.assertEqual(sorted(os.listdir(dossier)), ["01-s.jpg", "01.jpg", "02-s.jpg", "02.jpg"])
        grand, petit = img(os.path.join(dossier, "01.jpg")), img(os.path.join(dossier, "01-s.jpg"))
        self.assertEqual(max(grand.size), 1600)
        self.assertEqual(max(petit.size), 600)
        self.assertEqual(img(os.path.join(dossier, "02.jpg")).size, (800, 1600))  # portrait 1000×2000 : le grand côté (la hauteur) à 1 600
        idx = lire(os.path.join(self.out, "index.json"))
        self.assertEqual(set(idx["lisbon-xx"]), {"n", "source", "credits", "vue_en_tete", "px_median", "px_max", "retirees"})
        self.assertEqual((idx["lisbon-xx"]["n"], idx["lisbon-xx"]["source"], idx["lisbon-xx"]["vue_en_tete"], idx["lisbon-xx"]["retirees"]),
                         (2, "Airbnb", False, 1))
        self.assertIn("Airbnb", idx["lisbon-xx"]["credits"])
        ret = lire(os.path.join(self.out, "retraits.json"))
        self.assertEqual([(r["genre"], r["slug"], r["photo"], r["raison"]) for r in ret["retraits"]],
                         [("logement", "lisbon-xx", "c001", "reunion_banquet")])
        self.assertEqual(ret["totaux"], {"reunion_banquet": 1})
        self.assertIn("regles", ret)

    def test_retrier_remplace_les_fichiers_et_les_retraits_du_logement(self):
        c = Cache(self.tmp, "lisbon-xx")
        for k in range(3):
            c.ajouter(k, 1600, 1067)
        c.ecrire()
        M.trier("lisbon-xx")
        # un second tri avec une photo de moins dans le cache : le dossier est refait, pas complété
        c2 = Cache(self.tmp, "lisbon-xx-bis")
        c2.ajouter(1, 1600, 1067)
        c2.ecrire(slug="lisbon-xx")
        shutil_dir = os.path.join(self.tmp, "cache", "lisbon-xx")
        import shutil
        shutil.rmtree(shutil_dir)
        os.rename(c2.dossier, shutil_dir)
        M.trier("lisbon-xx")
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, "lisbon-xx"))), ["01-s.jpg", "01.jpg"])
        self.assertEqual(lire(os.path.join(self.out, "index.json"))["lisbon-xx"]["n"], 1)

    def test_l_index_range_les_lieux_en_dernier_et_garde_les_autres_logements(self):
        for slug in ("porto-b", "lisbon-a"):
            c = Cache(self.tmp, slug)
            c.ajouter(1, 1600, 1067)
            c.ecrire()
            M.trier(slug)
        M.publier_lieu("lisbon-poi-1", [(motif(1, 1500, 1000), "https://x.example/a.jpg", "https://upload.wikimedia.org/a.jpg")], [])
        idx = lire(os.path.join(self.out, "index.json"))
        self.assertEqual(list(idx), ["lisbon-a", "porto-b", "lieux"])
        self.assertEqual(idx["lieux"]["lisbon-poi-1"]["n"], 1)
        self.assertIn("Wikimedia Commons", idx["lieux"]["lisbon-poi-1"]["credits"])


@NEEDS_PILLOW
class TestPhotosDesLieux(Cadre):
    def test_fichiers_1200_et_500(self):
        gardes = [(motif(k, 2000, 1500), f"https://x.example/{k}.jpg", f"https://x.example/{k}.jpg") for k in range(1, 4)]
        M.publier_lieu("porto-poi-9", gardes, [{"url": "https://x.example/logo.png", "raison": "pas_une_photo", "detail": "logo"}])
        d = os.path.join(self.out, "lieux", "porto-poi-9")
        self.assertEqual(sorted(os.listdir(d)), ["01-s.jpg", "01.jpg", "02-s.jpg", "02.jpg", "03-s.jpg", "03.jpg"])
        self.assertEqual(max(img(os.path.join(d, "01.jpg")).size), 1200)
        self.assertEqual(max(img(os.path.join(d, "01-s.jpg")).size), 500)
        idx = lire(os.path.join(self.out, "index.json"))
        self.assertEqual(idx["lieux"]["porto-poi-9"]["n"], 3)
        ret = lire(os.path.join(self.out, "retraits.json"))
        self.assertEqual([(r["genre"], r["slug"], r["raison"]) for r in ret["retraits"]], [("lieu", "porto-poi-9", "pas_une_photo")])

    def test_six_photos_au_plus(self):
        self.assertEqual(M.MAX_LIEU, 6)

    def test_un_lieu_sans_photo_est_retire_de_l_index(self):
        M.publier_lieu("porto-poi-9", [(motif(1, 1500, 1000), "https://x.example/a.jpg", "https://x.example/a.jpg")], [])
        M.publier_lieu("porto-poi-9", [], [])
        idx = lire(os.path.join(self.out, "index.json"))
        self.assertNotIn("porto-poi-9", idx["lieux"])
        self.assertFalse(os.path.exists(os.path.join(self.out, "lieux", "porto-poi-9")))


@NEEDS_PILLOW
class TestFaireLieu(unittest.TestCase):
    """Un lieu : liens des chercheurs, puis pages du lieu ; 6 photos au plus, ni doublon, ni logo, ni lien mort."""

    def lieu(self, photos, extra=(), lien="https://resto.example/", sources=()):
        return {"_photos": list(photos), "_extra": list(extra), "lien": lien, "sources": list(sources), "notes": []}

    def test_six_au_plus_sans_doublon_ni_logo_ni_lien_mort(self):
        images = {f"https://x.example/{k}.jpg": motif(k, 1500, 1000) for k in range(1, 10)}
        images["https://x.example/copie.jpg"] = motif(1, 1200, 800)  # la photo 1 en plus petit
        images["https://x.example/logo.jpg"] = Image.new("RGB", (1200, 800), (255, 255, 255))

        def faux(urls, site=False, tries=2):
            u = urls[-1]
            return (images[u].copy(), u, 1) if u in images else (None, "HTTP Error 404", 0)
        liens = ["https://x.example/1.jpg", "https://x.example/mort.jpg", "https://x.example/copie.jpg", "https://x.example/logo.jpg"] \
            + [f"https://x.example/{k}.jpg" for k in range(2, 10)]
        with mock.patch.object(M, "telecharger_un", faux), mock.patch("place_photos_extra.page_images", return_value=[]):
            gardes, retraits = M.faire_lieu("lisbon-p01", "lisbon", self.lieu(liens[:6], liens[6:]))
        self.assertLessEqual(len(gardes), 6)
        self.assertEqual(len(gardes), 6)
        self.assertEqual([g[1] for g in gardes][:2], ["https://x.example/1.jpg", "https://x.example/2.jpg"])
        raisons = {r["url"]: r["raison"] for r in retraits}
        self.assertEqual(raisons["https://x.example/mort.jpg"], "echec")
        self.assertEqual(raisons["https://x.example/copie.jpg"], "doublon")
        self.assertEqual(raisons["https://x.example/logo.jpg"], "pas_une_photo")

    def test_complete_avec_les_pages_du_lieu_quand_il_manque_des_photos(self):
        images = {f"https://resto.example/img/{k}.jpg": motif(100 + k, 1400, 900) for k in range(5)}
        images["https://x.example/a.jpg"] = motif(1, 1400, 900)

        def faux(urls, site=False, tries=2):
            u = urls[-1]
            return (images[u].copy(), u, 1) if u in images else (None, "404", 0)
        with mock.patch.object(M, "telecharger_un", faux), \
                mock.patch("place_photos_extra.page_images", return_value=list(images)[:5]):
            gardes, _ = M.faire_lieu("lisbon-p02", "lisbon", self.lieu(["https://x.example/a.jpg"]))
        self.assertEqual(len(gardes), 6)
        self.assertEqual(gardes[0][1], "https://x.example/a.jpg")  # les liens des chercheurs d'abord


@NEEDS_PILLOW
class TestTelechargementUnitaire(unittest.TestCase):
    def test_telecharger_un_essaie_les_liens_dans_l_ordre_et_replie(self):
        buf = io.BytesIO()
        motif(1, 1200, 800).save(buf, "JPEG", quality=90)
        data = buf.getvalue()

        def faux_get(url, timeout=0):
            if "grand" in url:
                raise OSError("HTTP Error 404: Not Found")
            return data
        with mock.patch.object(M, "get", faux_get):
            im, url, n = M.telecharger_un(["https://x.example/grand.jpg", "https://x.example/petit.jpg"])
        self.assertEqual((im.size, url, n), ((1200, 800), "https://x.example/petit.jpg", len(data)))

    def test_image_trop_petite_refusee_avec_sa_raison(self):
        buf = io.BytesIO()
        motif(1, 300, 200).save(buf, "JPEG", quality=95)
        with mock.patch.object(M, "get", lambda url, timeout=0: buf.getvalue() * 40):
            im, raison, _ = M.telecharger_un(["https://x.example/a.jpg"])
        self.assertIsNone(im)
        self.assertIn("too small", raison)


class TestObjetsDeTable(unittest.TestCase):
    """Décision du contrôleur (2026-10-28) : une assiette, un verre ou une bouteille en gros plan est retirée d'une galerie de
    logement, mais c'est le sujet d'un restaurant, d'un bar ou d'un marché."""

    def test_objets_pour_un_lieu_de_table(self):
        for cat in ("restaurant", "bar", "bar / rooftop", "rooftop", "street food", "marché", "café", "soirée"):
            self.assertTrue(M.OBJETS_TABLE.isdisjoint(M.objets_pour(cat)), cat)
            self.assertIn("remote_control", M.objets_pour(cat), cat)        # une télécommande reste un objet
        for cat in ("à voir", "plage", "nature", "", None):
            self.assertEqual(M.objets_pour(cat), M.OBJETS, cat)

    def test_gros_plan_d_assiette(self):
        labels = {"plate": 0.8, "food": 0.6}
        self.assertTrue(M.motif_objet(labels))                                 # logement : retiré, comme avant
        self.assertIsNone(M.motif_objet(labels, objets=M.objets_pour("restaurant")))
        f = {"labels": [["drinking_glass", 0.7]], "visages": [], "texte": {}}
        c = {"px": [1600, 1067], "sd": 60}
        self.assertEqual(M.motif_visuel(c, f)[0], "objet")
        self.assertIsNone(M.motif_visuel(c, f, objets=M.objets_pour("bar")))


@NEEDS_PILLOW
class TestImports(Cadre):
    """`photos.py imports` : les lieux de research/imports/*/lieux.json passent par le même chemin que les autres."""

    def ecrire_import(self, racine, nom, contenu):
        os.makedirs(os.path.join(racine, nom))
        with open(os.path.join(racine, nom, "lieux.json"), "w", encoding="utf-8") as f:
            json.dump(contenu, f)

    def test_liste_des_lieux_importes(self):
        imp = os.path.join(self.tmp, "imports")
        self.ecrire_import(imp, "a", {"etape": "lisbon", "type": "logement", "lieux": [{"id": "lisbon-imp-a-01", "nom": "H", "photo_urls": ["https://x/1.jpg"]}]})
        self.ecrire_import(imp, "b", {"etape": "porto", "type": "sortie", "lieux": [{"id": "porto-imp-b-01", "nom": "R"}, "pas un lieu"]})
        self.ecrire_import(imp, "c", {"etape": "lune", "type": "sortie", "lieux": [{"id": "x", "nom": "x"}]})
        with mock.patch.object(M, "IMPORTS", imp):
            t = M.imports_a_faire()
        self.assertEqual([(g, e, d) for g, e, _x, d in t], [("logement", "lisbon", "lisbon-imp-a-01"), ("sortie", "porto", "porto-imp-b-01")])

    def test_logement_en_cache_trie_sans_telecharger_et_sortie_en_photos_de_lieu(self):
        imp = os.path.join(self.tmp, "imports")
        self.ecrire_import(imp, "a", {"etape": "lisbon", "type": "logement", "lieux": [{"id": "lisbon-imp-a-01", "nom": "H"}]})
        self.ecrire_import(imp, "b", {"etape": "lisbon", "type": "sortie", "lieux": [{"id": "lisbon-imp-b-01", "nom": "R", "categorie": "restaurant",
                                                                                     "photo_urls": ["https://x.example/r.jpg"]}]})
        c = Cache(self.tmp, "lisbon-imp-a-01")
        for k in range(3):
            c.ajouter(k, 1600, 1067)
        c.ecrire()
        lieu = [(motif(9, 1500, 1000), "https://x.example/r.jpg", "https://x.example/r.jpg")]

        def pas_de_reseau(*a, **k):
            raise AssertionError("téléchargement alors que le logement est en cache")
        with mock.patch.object(M, "IMPORTS", imp), mock.patch.object(M, "telecharger", pas_de_reseau), \
                mock.patch.object(M, "faire_lieu", return_value=(lieu, [])) as fl:
            M.cmd_imports([], False)
        idx = lire(os.path.join(self.out, "index.json"))
        self.assertEqual(idx["lisbon-imp-a-01"]["n"], 3)
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, "lisbon-imp-a-01")))[:2], ["01-s.jpg", "01.jpg"])
        self.assertEqual(idx["lieux"]["lisbon-imp-b-01"]["n"], 1)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "lieux", "lisbon-imp-b-01", "01-s.jpg")))
        pid, etape, p = fl.call_args[0]
        self.assertEqual((pid, etape, p["_photos"], p["_extra"]), ("lisbon-imp-b-01", "lisbon", ["https://x.example/r.jpg"], []))
        # second passage : la sortie a déjà ses photos (rien n'est refait sans --force)
        with mock.patch.object(M, "IMPORTS", imp), mock.patch.object(M, "telecharger", pas_de_reseau), \
                mock.patch.object(M, "faire_lieu", side_effect=AssertionError("refait")):
            M.cmd_imports([], False)



class TestIdsImportesEtSuppressions(Cadre):
    """Revue G4, C1 : un id lu dans research/imports/*/lieux.json (écrit par l'analyse d'une vidéo) ne choisit jamais
    ce qui est supprimé. Les ids sont filtrés, et chaque rmtree est précédé d'un contrôle du chemin réel."""

    def setUp(self):
        super().setUp()
        self.temoin = os.path.join(self.tmp, "temoin")
        os.makedirs(self.temoin)
        with open(os.path.join(self.temoin, "precieux.txt"), "w", encoding="utf-8") as f:
            f.write("à garder")
        os.makedirs(os.path.join(self.out, "lieux"))

    def intact(self):
        self.assertEqual(os.listdir(self.temoin), ["precieux.txt"])

    def ecrire_import(self, nom, contenu):
        imp = os.path.join(self.tmp, "imports")
        os.makedirs(os.path.join(imp, nom))
        with open(os.path.join(imp, nom, "lieux.json"), "w", encoding="utf-8") as f:
            json.dump(contenu, f)
        return imp

    def test_seuls_les_ids_de_imports_py_id_passent(self):
        mauvais = [self.temoin, "/Users/someone", "../../trip", "../../../../trip", "a/b", "lisbon-imp-x-01/../../x", "MER-IMP-X-01",  # privacy-check: ignore
                   "lisbon-imp-x-01 ", "porto-imp-x-01", "lisbon-imp--01", "lisbon-imp-x-1", 12, None, ""]
        imp = self.ecrire_import("a", {"etape": "lisbon", "type": "sortie",
                                       "lieux": [{"id": i, "nom": "x"} for i in mauvais] + [{"id": "lisbon-imp-x-01", "nom": "bon"}]})
        erreur = io.StringIO()
        with mock.patch.object(M, "IMPORTS", imp), contextlib.redirect_stderr(erreur):
            t = M.imports_a_faire()
        self.assertEqual([d for _g, _e, _x, d in t], ["lisbon-imp-x-01"])
        self.assertIn("id refused", erreur.getvalue())

    def test_un_lieu_sans_photo_ne_supprime_rien_hors_des_photos(self):
        # l'attaque de la revue : faire_lieu ne trouve rien, publier_lieu ferait rmtree(<id>) — ici bloqué en amont
        imp = self.ecrire_import("a", {"etape": "lisbon", "type": "sortie",
                                       "lieux": [{"id": self.temoin, "nom": "x"}, {"id": "../../temoin", "nom": "y"}]})
        with mock.patch.object(M, "IMPORTS", imp), mock.patch.object(M, "faire_lieu", return_value=([], [])) as fl, \
                contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            M.cmd_imports([], False)
        fl.assert_not_called()
        self.intact()

    def test_publier_lieu_refuse_avant_tout_rmtree(self):
        for pid in (self.temoin, os.path.relpath(self.temoin, os.path.join(self.out, "lieux")), "a/b", "..", "Mer-1", ""):
            with self.subTest(pid=pid), self.assertRaises(M.CheminRefuse):
                M.publier_lieu(pid, [], [])
        self.intact()
        self.assertFalse(os.path.exists(os.path.join(self.out, "index.json")), "rien n'est écrit non plus")

    def test_liens_symboliques_refuses(self):
        # le dossier d'un lieu, son .tmp, ou le dossier lieux/ lui-même pointent ailleurs : refus, rien n'est supprimé
        os.symlink(self.temoin, os.path.join(self.out, "lieux", "lisbon-imp-x-01"))
        with self.assertRaises(M.CheminRefuse):
            M.publier_lieu("lisbon-imp-x-01", [], [])
        os.symlink(self.temoin, os.path.join(self.out, "lieux", "lisbon-imp-x-02.tmp"))
        with self.assertRaises(M.CheminRefuse):
            M.publier_lieu("lisbon-imp-x-02", [], [])
        self.intact()
        os.makedirs(os.path.join(self.tmp, "cache"))
        os.symlink(self.temoin, os.path.join(self.tmp, "cache", "lisbon-imp-y-01"))
        with self.assertRaises(M.CheminRefuse):
            M.dossier_cache("lisbon-imp-y-01")
        with self.assertRaises(M.CheminRefuse):
            M.publier_logement("lisbon-imp-y-01", [], None, [])
        self.intact()
        autre = os.path.join(self.tmp, "autre-out")
        os.makedirs(os.path.join(autre, "photos"))
        os.symlink(self.temoin, os.path.join(autre, "photos", "lieux"))
        with mock.patch.object(M, "OUT", os.path.join(autre, "photos")), self.assertRaises(M.CheminRefuse):
            M.publier_lieu("lisbon-imp-x-03", [], [])
        self.intact()

    def test_dossier_sur(self):
        self.assertEqual(M.dossier_sur(self.out, "lieux", "lisbon-imp-x-01"),
                         os.path.join(os.path.realpath(self.out), "lieux", "lisbon-imp-x-01"))
        for nom in ("..", ".", "a/b", "/x", "x\0", "A", "-x", "x" * 81):
            with self.subTest(nom=nom), self.assertRaises(M.CheminRefuse):
                M.dossier_sur(self.out, nom)


def degrade(w, h):
    """Gradient image: the same image at two sizes keeps the same fingerprint."""
    im = Image.new("RGB", (w, h))
    im.putdata([((x * 255) // w, (y * 255) // h, 90) for y in range(h) for x in range(w)])
    return im


@NEEDS_PILLOW
class TestFingerprints(unittest.TestCase):
    def test_same_image_other_size_is_a_near_duplicate(self):
        a, b = M.dhash(degrade(400, 300)), M.dhash(degrade(1000, 750))
        self.assertLessEqual(bin(a ^ b).count("1"), M.DOUBLON_BITS)

    def test_two_different_images_are_not(self):
        autre = Image.new("RGB", (400, 300), (10, 10, 10))
        autre.paste(Image.new("RGB", (200, 300), (250, 250, 250)), (200, 0))
        self.assertGreater(bin(M.dhash(autre) ^ M.dhash(degrade(400, 300))).count("1"), M.DOUBLON_BITS)


class TestOfficialSites(unittest.TestCase):
    def test_keeps_the_site_whose_domain_carries_the_name(self):
        o = {"nom": "Casa Alfama Lodge - Pool Suite"}
        urls = ["https://www.booking.com/hotel/pt/casa-alfama.html", "https://www.casaalfamalodge.com/rooms/",
                "https://www.tripadvisor.com/Hotel_Review-casa-alfama", "https://www.timeout.com/casa-alfama"]
        self.assertEqual(M.official_sites(o, "lisbon-01", urls), ["https://www.casaalfamalodge.com/"])

    def test_ignores_an_unrelated_blog(self):
        o = {"nom": "Quinta Verde Retreat"}
        self.assertEqual(M.official_sites(o, "x", ["https://www.travelblog.example/quinta", "https://exa.ai/x"]), [])

    def test_name_found_on_trip_com_must_look_alike(self):
        self.assertTrue(M.plausible({"nom": "Quinta Verde Retreat"}, "Quinta Verde Retreat : Rates"))
        self.assertFalse(M.plausible({"nom": "Quinta Verde Retreat"}, "Grand Atlantic Hotel"))


class TestTripDriven(Cadre):
    def test_stage_keys_come_from_the_trip(self):
        self.assertEqual(M.stage_keys(), ["lisbon", "comporta", "porto"])

    def test_affiches_lists_the_trip_lodgings_with_stage_slugs(self):
        slugs = [(k, s) for k, _o, s in M.affiches()]
        self.assertIn(("lisbon", "lisbon-01"), slugs)
        self.assertIn(("porto", "porto-01"), slugs)
        self.assertTrue(all(s.startswith(k + "-") for k, s in slugs))

    def test_affiches_without_research_is_empty(self):
        d = os.path.join(self.tmp, "t")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        shutil.rmtree(os.path.join(d, "research"))
        configured(self, d)
        self.assertEqual(M.affiches(), [])
        self.assertEqual(M.lieux_a_faire(), [])

    def test_places_of_the_trip_have_photo_links_and_stages(self):
        lieux = M.lieux_a_faire()
        ids = {pid: etape for pid, etape, _p in lieux}
        self.assertEqual(ids["lisbon-alfama-walk"], "lisbon")
        self.assertEqual(ids["porto-cellar-tasting"], "porto")
        self.assertTrue(all("_extra" in p and "_photos" in p for _i, _e, p in lieux))

    def test_imported_id_pattern_uses_the_trip_stages(self):
        self.assertTrue(M.ID_IMPORT.match("comporta-imp-abc-01"))
        self.assertFalse(M.ID_IMPORT.match("mer-imp-abc-01"))

    def test_manual_sources_are_read_from_the_trip(self):
        d = os.path.join(self.tmp, "t2")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        with open(os.path.join(d, "research", "sources-photos.json"), "w", encoding="utf-8") as f:
            json.dump({"lisbon-01": {"agoda": ["123"], "site": ["https://x.example/"]}}, f)
        configured(self, d)
        self.assertEqual(M.sources_manuelles("lisbon-01", "agoda"), ["123"])
        self.assertEqual(M.sources_manuelles("lisbon-01", "trip"), [])
        self.assertEqual(M.sources_manuelles("porto-01", "agoda"), [])

    def test_manual_sources_file_is_optional(self):
        self.assertEqual(M.sources_manuelles("lisbon-01", "agoda"), [])


class TestEnglishReasons(unittest.TestCase):
    """The detail strings written to retraits.json are English (no French left)."""
    C = {"px": [1600, 1067], "sd": 60}

    def detail(self, f, c=None):
        return M.motif_visuel(c or self.C, f)

    def test_text_detail(self):
        raison, d = self.detail({"labels": [], "visages": [], "texte": {"mots": 31, "aire": 0.3, "lignes": 9}})
        self.assertEqual((raison, d), ("affiche_texte", "text: 31 words on 9 lines, 30% of the image"))

    def test_face_detail(self):
        raison, d = self.detail({"labels": [], "visages": [0.08], "texte": {}})
        self.assertEqual((raison, d), ("personnes", "face(s): 8.0% of the image"))

    def test_format_details(self):
        self.assertEqual(M.motif_visuel({"px": [3000, 600], "sd": 60}, None), ("format", "aspect ratio 5.00"))
        self.assertIn("almost uniform", M.motif_visuel({"px": [1600, 1067], "sd": 3}, None)[1])

    def test_no_french_accents_in_any_detail(self):
        feats = [{"labels": [["conference", 0.9]]}, {"labels": [["document", 0.9]]}, {"labels": [["remote_control", 0.8]], "texte": {}}]
        for f in feats:
            raison, d = self.detail(dict(f, visages=[], texte=f.get("texte", {})))
            self.assertFalse(any(ch in d for ch in "éèêàâôùç«»"), d)


@NEEDS_PILLOW
class TestVisionOffMacos(Cadre):
    def test_vision_skipped_off_macos(self):
        c = Cache(self.tmp, "lisbon-sk")
        for k in range(3):
            c.ajouter(k, 1600, 1067)
        c.ecrire()
        out = io.StringIO()
        with mock.patch.object(M.sys, "platform", "linux"), contextlib.redirect_stdout(out):
            self.assertFalse(M.vision_prete())
            self.assertIn("skipped", M.vision_note())
            M.cmd_trier(["lisbon-sk"])   # not a lodging of the trip: nothing to sort, but the note is printed
            e = M.trier("lisbon-sk")
        self.assertIn("skipped", out.getvalue())
        self.assertEqual(e["n"], 3)      # every photo is kept without Vision

    def test_vision_needs_swiftc_too(self):
        with mock.patch.object(M.sys, "platform", "darwin"), mock.patch.object(M.shutil, "which", return_value=None):
            self.assertFalse(M.vision_prete())

    def test_ssl_context_falls_back_to_the_default(self):
        with mock.patch.object(M.os.path, "exists", return_value=False), \
                mock.patch.object(M.ssl, "create_default_context") as ctx:
            ctx.return_value = "default"
            import importlib
            m2 = importlib.reload(M)
            self.assertEqual(m2.CTX, "default")
            ctx.assert_called_with(cafile=None)
        importlib.reload(M)


class TestCli(unittest.TestCase):
    def test_bad_trip_reports_without_traceback(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(M.main(["--trip", "/nonexistent-trip-dir", "inventaire"]), 1)
        self.assertIn("trip.json", err.getvalue())

    def test_missing_pillow_is_one_plain_line(self):
        old = {k: getattr(M, k) for k in STATE}   # main() configures the module for the trip: restore it after
        self.addCleanup(lambda: [setattr(M, k, v) for k, v in old.items()])
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(M, "Image", None):
            self.assertEqual(M.main(["--trip", SAMPLE, "tout"]), 1)
        self.assertEqual(err.getvalue(), M.NO_PILLOW + "\n")
        self.assertIn("python3 scripts/setup.py status", err.getvalue())
        self.assertNotIn("Traceback", out.getvalue() + err.getvalue())

    def test_no_command_prints_usage(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(M.main([]), 2)
        self.assertIn("--trip", out.getvalue())


if __name__ == "__main__":
    unittest.main()
