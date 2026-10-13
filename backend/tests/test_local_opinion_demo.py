"""A fresh clone can create its own fictional opinion data outside the repository."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
GENERATOR = BACKEND / "scripts" / "seed_local_opinion_demo.py"


class LocalOpinionDemoTests(unittest.TestCase):
    def test_repository_output_is_rejected_before_creating_files(self):
        target = BACKEND / "data" / "rejected-local-opinion-demo"
        self.assertFalse(target.exists())
        process = subprocess.run(
            [sys.executable, str(GENERATOR), "--output-dir", str(target)],
            cwd=BACKEND, capture_output=True, text=True, timeout=10,
        )
        self.assertNotEqual(process.returncode, 0)
        self.assertFalse(target.exists())

    def test_fresh_external_database_and_repeat_run(self):
        with tempfile.TemporaryDirectory(prefix="marventa-portable-demo-") as directory:
            target = Path(directory)
            environment = os.environ.copy()
            environment.update({
                "DEMO_PASSWORD": "test-only-local-password", "DATABASE_URL": "",
                "AI_API_KEY": "", "LEAD_OPINION_EMBEDDING_MODEL_PATH": "",
            })
            for _ in range(2):
                process = subprocess.run(
                    [sys.executable, str(GENERATOR), "--output-dir", str(target), "--days", "14"],
                    cwd=BACKEND, env=environment, capture_output=True, text=True, timeout=90,
                    check=True,
                )
                manifest = json.loads(process.stdout)
                self.assertEqual(Path(manifest["database"]), target / "preview.db")
                self.assertTrue(manifest["is_simulated"])
            with closing(sqlite3.connect(target / "preview.db")) as conn:
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM lead_tracking_account_comment_runs WHERE is_simulated = 1"
                ).fetchone()[0], 14)
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM lead_daily_reports"
                ).fetchone()[0], 14)
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM lead_tracking_post_metric_snapshots"
                ).fetchone()[0], 61 * 3)
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM lead_tracking_account_targets"
                ).fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
