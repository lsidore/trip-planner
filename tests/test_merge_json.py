"""scripts/merge_json.py: agents running in parallel add their entries to a shared research file without losing others'."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import merge_json as M  # noqa: E402


class MergeJsonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.target = os.path.join(self.tmp, "research", "sorties-lisbon.json")

    def write(self, name, data):
        p = os.path.join(self.tmp, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return p

    def read(self):
        with open(self.target, encoding="utf-8") as f:
            return json.load(f)

    def run_main(self, argv, stdin=""):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch.object(M.sys, "stdin", io.StringIO(stdin)):
            code = M.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_creates_the_target(self):
        frag = self.write("f.json", {"lisbon-walk": {"duree_min": 120}})
        code, out, _ = self.run_main([self.target, frag])
        self.assertEqual(code, 0)
        self.assertEqual(self.read(), {"lisbon-walk": {"duree_min": 120}})
        self.assertIn("1 added", out)

    def test_dict_of_ids_keeps_other_entries_and_replaces_same_id(self):
        os.makedirs(os.path.dirname(self.target))
        with open(self.target, "w") as f:
            json.dump({"a": {"x": 1}, "b": {"x": 2}}, f)
        frag = self.write("f.json", {"b": {"x": 20}, "c": {"x": 3}})
        code, out, _ = self.run_main([self.target, frag])
        self.assertEqual(code, 0)
        self.assertEqual(self.read(), {"a": {"x": 1}, "b": {"x": 20}, "c": {"x": 3}})
        self.assertIn("1 added, 1 replaced", out)

    def test_lists_merge_by_id_or_code(self):
        os.makedirs(os.path.dirname(self.target))
        with open(self.target, "w") as f:
            json.dump([{"code": "insurance", "cout_home": 90}, {"code": "esim"}], f)
        frag = self.write("f.json", [{"code": "insurance", "cout_home": 96}, {"code": "visa-a"}])
        self.assertEqual(self.run_main([self.target, frag])[0], 0)
        self.assertEqual([x["code"] for x in self.read()], ["insurance", "esim", "visa-a"])
        self.assertEqual(self.read()[0]["cout_home"], 96)

    def test_wrapped_lists_merge_by_id_and_other_keys_replaced(self):
        os.makedirs(os.path.dirname(self.target))
        with open(self.target, "w") as f:
            json.dump({"meta": {"verifie": "2026-01-01"}, "trajets": [{"id": "a-b", "options": []}]}, f)
        frag = self.write("f.json", {"meta": {"verifie": "2026-02-01"}, "trajets": [{"id": "b-c", "options": []}]})
        self.assertEqual(self.run_main([self.target, frag])[0], 0)
        d = self.read()
        self.assertEqual(d["meta"]["verifie"], "2026-02-01")
        self.assertEqual([t["id"] for t in d["trajets"]], ["a-b", "b-c"])

    def test_fragment_from_stdin(self):
        code, _, _ = self.run_main([self.target, "-"], stdin='{"porto-01": {"aeroport": "OPO"}}')
        self.assertEqual(code, 0)
        self.assertEqual(self.read(), {"porto-01": {"aeroport": "OPO"}})

    def test_unreadable_target_is_not_overwritten(self):
        os.makedirs(os.path.dirname(self.target))
        with open(self.target, "w") as f:
            f.write("{broken")
        frag = self.write("f.json", {"a": 1})
        code, _, err = self.run_main([self.target, frag])
        self.assertEqual(code, 1)
        self.assertIn("not valid JSON", err)
        with open(self.target) as f:
            self.assertEqual(f.read(), "{broken")

    def test_shape_mismatch_is_an_error(self):
        os.makedirs(os.path.dirname(self.target))
        with open(self.target, "w") as f:
            json.dump([{"id": "x"}], f)
        frag = self.write("f.json", {"x": {}})
        code, _, err = self.run_main([self.target, frag])
        self.assertEqual(code, 1)
        self.assertIn("same shape", err)

    def test_parallel_merges_lose_nothing(self):
        def worker(n):
            for i in range(15):
                M.merge_into(self.target, {f"w{n}-{i}": {"i": i}})
        threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(self.read()), 60)


if __name__ == "__main__":
    unittest.main()
