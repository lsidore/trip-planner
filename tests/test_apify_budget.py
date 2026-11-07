"""scripts/apify_budget.py: the Apify credit left, in English, without a traceback when there is no token."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import apify_budget as A  # noqa: E402

FAKE = "fake-apify-1234"


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_api(req, timeout=None, context=None):
    assert req.get_header("Authorization") == f"Bearer {FAKE}"
    if "/users/me/limits" in req.full_url:
        data = {"current": {"monthlyUsageUsd": 1.25}, "limits": {"maxMonthlyUsageUsd": 5.0},
                "monthlyUsageCycle": {"startAt": "2026-11-01T00:00:00Z", "endAt": "2026-11-30T23:59:59Z"}}
    else:
        data = {"items": [{"startedAt": "2026-11-05T10:00:00Z", "actId": "abc", "status": "SUCCEEDED", "usageTotalUsd": 0.12}]}
    return Resp(json.dumps({"data": data}).encode())


class ApifyBudgetTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def run_main(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch.object(A.urllib.request, "urlopen", fake_api):
            code = A.main([], root=self.root)
        return code, out.getvalue(), err.getvalue()

    def test_no_token(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("No Apify token", err)

    def test_credit_left_and_runs(self):
        with open(os.path.join(self.root, ".env"), "w") as f:
            f.write(f"APIFY_TOKEN={FAKE}\n")
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        self.assertIn("used USD 1.250 of USD 5.00, left USD 3.750", out)
        self.assertIn("2026-11-01 -> 2026-11-30", out)
        self.assertIn("SUCCEEDED", out)
        self.assertNotIn(FAKE, out + err)


if __name__ == "__main__":
    unittest.main()
