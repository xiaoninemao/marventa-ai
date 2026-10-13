"""The account overview must not mix works, dates or simulated snapshots."""

from __future__ import annotations

import gc
import shutil
import tempfile
import time
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from app.auth import storage as auth_storage
from app.engines.publishing import lead_tracking, opinion_monitor, storage
from app.engines.publishing.project_memberships import ProjectNotFound


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 12, 12, tzinfo=tz)


class OpinionOverviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="marventa-opinion-test-"))
        self.addCleanup(self._cleanup)
        self.db_path = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(opinion_monitor, "datetime", FixedDateTime))
        self.enterContext(patch.object(opinion_monitor, "LEAD_OPINION_EMBEDDING_MODEL_PATH", ""))
        self.owner = auth_storage.create_user("opinion-owner", "opinion-owner@example.com", "hash")
        self.outsider = auth_storage.create_user("opinion-outsider", "opinion-outsider@example.com", "hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Opinion project")
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO project_channel_accounts
                   (id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, authorization_status, scopes, created_at, updated_at)
                   VALUES ('opinion-account', ?, 'douyin', 'Brand', 'opinion-platform-id', ?,
                           'active', '["video.list","item.comment"]', '2026-01-01', '2026-01-01')""",
                (self.project.id, self.owner["id"]),
            )
        account = lead_tracking._internal_account(self.project.id, "opinion-account")
        self.key = lead_tracking.lead_account_key_from_row(account)

    def _cleanup(self):
        gc.collect()
        for _ in range(5):
            try:
                shutil.rmtree(self.directory)
                return
            except PermissionError:
                gc.collect()
                time.sleep(0.1)

    def _store(self, day: int, comments: list[tuple[str, str, str]], *, simulated=False):
        lead_tracking._save_run(self.key, date(2026, 10, day), "completed", False, "test", [
            {
                "item_id": "work-a" if index % 2 else "work-b",
                "comment_id": comment_id, "comment_user_id": user_id, "content": content,
                "create_time": 1791660000 + index, "digg_count": 0,
                "reply_comment_total": 0, "top": False, "raw_data": "{}",
            } for index, (comment_id, user_id, content) in enumerate(comments)
        ], is_simulated=simulated)

    def test_overview_uses_all_works_and_distinguishes_missing_days_from_zero(self):
        self._store(10, [("same", "u1", "能不能支持报表导出？")])
        self._store(11, [
            ("same", "u1", "能不能支持报表导出？"),
            ("c2", "u2", "我不需要 CRM 对接功能"),
            ("c3", "u3", "页面太慢了"),
            ("c4", "u4", "界面很好用"),
            ("c5", "u5", "呵呵，真快"),
        ])
        self._store(9, [("fake", "fake-user", "虚构评论")], simulated=True)
        result = opinion_monitor.get_opinion_overview(
            self.owner["id"], self.project.id, "opinion-account", 7,
        )
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.covered_days, 2)
        self.assertEqual(result.comments_collected, 5)
        self.assertEqual(result.distinct_users, 5)
        self.assertEqual(result.question_percent, 20.0)
        self.assertEqual(result.demand_percent, 20.0)
        self.assertEqual({item.key: item.count for item in result.sentiments}, {
            "positive": 1, "neutral": 2, "negative": 1, "uncertain": 1,
        })
        self.assertIsNone(result.daily[0].comments)
        self.assertEqual(result.daily[-2].comments, 0)
        self.assertEqual(result.daily[-1].comments, 5)
        self.assertFalse(result.is_simulated)
        with self.assertRaises(ProjectNotFound):
            opinion_monitor.get_opinion_overview(
                self.outsider["id"], self.project.id, "opinion-account", 7,
            )

    def test_theme_proportions_use_collected_comments_not_interaction_counts(self):
        self._store(11, [(f"c{index}", f"u{index}", f"主题评论 {index}") for index in range(30)])
        self.enterContext(patch.object(opinion_monitor, "LEAD_OPINION_EMBEDDING_MODEL_PATH", "local-model"))
        with patch.object(opinion_monitor, "_discover_themes", return_value=(
            {f"c{index}": 1 if index < 18 else 2 for index in range(30)},
            {1: "报表 · 数据", 2: "体验 · 性能"},
            {1: [("报表", 0.8)], 2: [("性能", 0.7)]},
        )):
            result = opinion_monitor.get_opinion_overview(
                self.owner["id"], self.project.id, "opinion-account", 7,
            )
        self.assertEqual(result.theme_status, "ready")
        self.assertEqual([(item.label, item.percent) for item in result.themes], [
            ("报表 · 数据", 60.0), ("体验 · 性能", 40.0),
        ])
        self.assertEqual({item.word for item in result.words}, {"报表", "性能"})


if __name__ == "__main__":
    unittest.main()
