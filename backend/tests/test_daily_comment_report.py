import asyncio
import gc
import json
import shutil
import sqlite3
import tempfile
import time
import unittest
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.api import publishing
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.engines.publishing import (
    comment_semantics,
    lead_tracking,
    storage,
)
from app.engines.publishing import (
    daily_comment_report as report,
)
from app.engines.publishing.models import AccountContentPost
from app.engines.publishing.project_memberships import ProjectNotFound
from app.notifications import storage as notification_storage
from fastapi import FastAPI
from fastapi.testclient import TestClient


class DailyCommentReportTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(__file__).parent / (".daily-report-" + uuid.uuid4().hex)
        self.directory.mkdir()
        self.addCleanup(self._remove_directory)
        self.db_path = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(notification_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(report, "LEAD_DAILY_SEMANTIC_MODEL_PATH", ""))
        self.enterContext(patch.object(report, "LEAD_DAILY_REPORT_LLM_ENABLED", False))
        self.owner = auth_storage.create_user("daily-owner", "daily-owner@example.com", "hash")
        self.outsider = auth_storage.create_user("daily-outsider", "daily-outsider@example.com", "hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Daily report project")
        self.day = date(2026, 10, 4)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO project_channel_accounts
                   (id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, authorization_status, scopes, created_at, updated_at)
                   VALUES ('daily-account', ?, 'douyin', 'Brand', 'real-open-id', ?,
                           'active', '["video.list","item.comment"]', '2026-01-01', '2026-01-01')""",
                (self.project.id, self.owner["id"]),
            )
        self.account = lead_tracking._internal_account(self.project.id, "daily-account")
        self.key = lead_tracking.lead_account_key_from_row(self.account)
        lead_tracking.register_comment_targets(self.project.id, "daily-account", ["work-1", "work-2"])

    def _remove_directory(self):
        gc.collect()
        for _ in range(5):
            try:
                shutil.rmtree(self.directory)
                return
            except PermissionError:
                gc.collect()
                time.sleep(0.1)

    def _store(self, items, *, status="completed", simulated=False):
        comments = []
        for index, (content, user_id, work, likes, replies) in enumerate(items):
            comments.append({
                "item_id": work, "comment_id": f"c-{index}", "comment_user_id": user_id,
                "content": content, "create_time": 1791100000 + index,
                "digg_count": likes, "reply_comment_total": replies,
                "top": False, "raw_data": "{}",
            })
        lead_tracking._save_run(self.key, self.day, status, status == "partial", "Official comment snapshot", comments,
                                is_simulated=simulated)

    def test_opinion_labels_and_demand_evidence_use_distinct_people(self):
        self._store([
            ("我不需要这个功能", "u1", "work-1", 100, 20),
            ("我不希望去掉这个功能", "u2", "work-2", 1, 0),
            ("希望支持导出报表", "u3", "work-2", 1, 0),
        ])
        result = report.generate_daily_report(self.account, self.day)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.top_comments[0].comment_id, "c-0")
        self.assertEqual(result.top_comments[0].stance, "oppose")
        self.assertEqual(result.top_comments[1].stance, "support")
        self.assertEqual(result.semantic_status, "rules_only")
        self.assertTrue(all(item.pending_review for item in result.top_comments))
        self.assertTrue(all(topic.evidence_level != "higher_confidence" for topic in result.topics))
        self.assertIn("c-2", next(topic for topic in result.topics if topic.topic == "报表与数据").evidence_comment_ids)

    def test_semantic_disagreement_abstains_instead_of_inventing_positive_need(self):
        self._store([("我不需要这个功能", "u1", "work-1", 15, 0)])
        probabilities = [{
            "purchase_intent": 0.05, "feature_request": 0.95,
            "negative_feedback": 0.1, "reject_feature": 0.25,
            "keep_feature": 0.02, "sarcasm_ambiguity": 0.05,
        }]
        with patch.object(report, "LEAD_DAILY_SEMANTIC_MODEL_PATH", "validated-model"), \
             patch.object(report, "classify_comments", return_value=probabilities), \
             patch.object(report, "thresholds", return_value={key: 0.8 for key in probabilities[0]}):
            result = report.generate_daily_report(self.account, self.day)
        self.assertEqual(result.feature_request_comments, 0)
        self.assertEqual(result.top_comments[0].stance, "uncertain")
        self.assertTrue(result.top_comments[0].pending_review)

    def test_multiple_aspects_do_not_receive_one_blanket_positive_stance(self):
        self._store([("希望支持导出报表，但部署太慢", "u1", "work-1", 2, 0)])
        result = report.generate_daily_report(self.account, self.day)
        self.assertEqual(result.top_comments[0].stance, "uncertain")
        self.assertTrue(result.top_comments[0].pending_review)
        self.assertTrue(all(topic.supporting_comments == 0 for topic in result.topics))

    def test_review_reasons_distinguish_cross_topic_from_sarcasm(self):
        self._store([
            ("我不需要 CRM 对接功能，现有导出就够用了。", "u1", "work-1", 3, 1),
            ("呵呵，报表导出可真快呢。", "u2", "work-2", 2, 0),
        ])
        result = report.generate_daily_report(self.account, self.day)
        by_id = {item.comment_id: item for item in result.top_comments}
        self.assertEqual(by_id["c-0"].review_reason, "multiple_topics")
        self.assertEqual(by_id["c-1"].review_reason, "sarcasm")
        self.assertTrue(all(item.pending_review for item in result.top_comments))

    def test_topic_copy_is_product_focused_without_repeating_counts(self):
        self._store([
            ("建议增加 Excel 报表导出，给团队每周复盘。", "u1", "work-1", 2, 0),
            ("不要删除现有的报表导出功能，我们还在用。", "u2", "work-2", 1, 0),
            ("报表能按月份看吗？", "u3", "work-1", 1, 0),
        ])
        result = report.generate_daily_report(self.account, self.day)
        topic = next(item for item in result.topics if item.topic == "报表与数据")
        self.assertFalse(result.llm_used)
        self.assertEqual(topic.supporting_comments, 2)
        self.assertIn("报表导出", topic.conclusion)
        self.assertIn("新增需求", topic.conclusion)
        self.assertIn("使用流程", topic.product_suggestion)
        self.assertIn("演示提纲", topic.marketing_suggestion)
        for sentence in (topic.conclusion, topic.product_suggestion, topic.marketing_suggestion):
            self.assertNotIn("不能代表", sentence)
            self.assertNotIn("本日有", sentence)
            self.assertNotIn("发布前核对", sentence)

    def test_account_totals_keep_each_evidence_comment_linked_to_its_work(self):
        self._store([
            ("希望支持导出报表", "u1", "work-1", 2, 0),
            ("不要删除报表导出", "u2", "work-2", 3, 1),
            ("报表在哪里看？", "u1", "work-2", 1, 0),
        ])
        result = report.generate_daily_report(self.account, self.day)
        self.assertEqual((result.comments_collected, result.distinct_users, result.works_with_comments),
                         (3, 2, 2))
        topic = next(item for item in result.topics if item.topic == "报表与数据")
        sources = {comment_id: source.item_id for comment_id, source in zip(
            topic.evidence_comment_ids, topic.evidence_sources,
        )}
        self.assertEqual(sources, {"c-0": "work-1", "c-1": "work-2", "c-2": "work-2"})

    def test_work_comments_are_separate_and_account_opinion_uses_every_collected_comment(self):
        self._store([
            ("希望支持导出报表", f"u{index}", "work-1" if index < 6 else "work-2", 12 - index, 0)
            for index in range(12)
        ])
        result = report.generate_daily_report(self.account, self.day)
        by_work = {work.item_id: work for work in result.work_analyses}
        self.assertEqual(set(by_work), {"work-1", "work-2"})
        self.assertEqual([item.comment_id for item in by_work["work-1"].comments],
                         [f"c-{index}" for index in range(6)])
        self.assertEqual([item.comment_id for item in by_work["work-2"].comments],
                         [f"c-{index}" for index in range(6, 12)])
        self.assertEqual(next(topic for topic in by_work["work-1"].topics
                              if topic.topic == "报表与数据").supporting_comments, 6)
        self.assertEqual(next(topic for topic in result.topics
                              if topic.topic == "报表与数据").supporting_comments, 12)
        self.assertNotIn("c-11", [item.comment_id for item in result.top_comments])

    def test_work_scope_applies_before_comment_top_fifty(self):
        self._store([
            ("希望支持导出报表", f"u{index}", "work-1", 100 - index, 0)
            for index in range(51)
        ] + [
            ("可以试用吗", f"guest{index}", "work-2", 1, 0)
            for index in range(9)
        ])
        all_comments = lead_tracking.get_comment_insight(
            self.owner["id"], self.project.id, "daily-account", self.day)
        work_comments = lead_tracking.get_comment_insight(
            self.owner["id"], self.project.id, "daily-account", self.day, "work-2")
        self.assertEqual(len(all_comments.items), 50)
        self.assertTrue(all(item.item_id == "work-1" for item in all_comments.items))
        self.assertEqual(len(work_comments.items), 9)
        self.assertTrue(all(item.item_id == "work-2" for item in work_comments.items))
        works = lead_tracking.list_tracking_works(self.owner["id"], self.project.id, "daily-account")
        self.assertEqual({work["item_id"] for work in works}, {"work-1", "work-2"})
        with self.assertRaises(ProjectNotFound):
            lead_tracking.list_tracking_works(self.outsider["id"], self.project.id, "daily-account")

    def test_optional_llm_cannot_cite_another_comment(self):
        self._store([("希望支持导出报表", "u1", "work-1", 1, 0)])
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            message=SimpleNamespace(content=(
                '{"topics":[{"topic":"报表与数据","evidence_comment_ids":["invented"],'
                '"product_action":"interview_users","marketing_action":"verified_faq"}]}'
            )),
        )])
        provider = SimpleNamespace(model="test-model", client=lambda **_kwargs: client)
        with patch.object(report, "LEAD_DAILY_REPORT_LLM_ENABLED", True), \
             patch.object(report, "get_ai_provider", return_value=provider):
            result = report.generate_daily_report(self.account, self.day)
        self.assertFalse(result.llm_used)
        self.assertIn("报表", result.topics[0].product_suggestion)
        self.assertNotIn("发布前核对", result.topics[0].marketing_suggestion)

    def test_optional_llm_action_uses_business_copy(self):
        self._store([("希望支持导出报表", "u1", "work-1", 1, 0)])
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            message=SimpleNamespace(content=(
                '{"topics":[{"topic":"报表与数据","evidence_comment_ids":["c-0"],'
                '"product_action":"interview_users","marketing_action":"verified_faq"}]}'
            )),
        )])
        provider = SimpleNamespace(model="test-model", client=lambda **_kwargs: client)
        with patch.object(report, "LEAD_DAILY_REPORT_LLM_ENABLED", True), \
             patch.object(report, "get_ai_provider", return_value=provider):
            result = report.generate_daily_report(self.account, self.day)
        self.assertTrue(result.llm_used)
        self.assertIn("使用场景", result.topics[0].product_suggestion)
        self.assertIn("产品答疑", result.topics[0].marketing_suggestion)
        self.assertNotIn("不能代表", result.topics[0].conclusion)

    def test_unvalidated_checkpoint_is_not_loaded(self):
        model_path = self.directory / "unvalidated-model"
        model_path.mkdir()
        (model_path / "validation.json").write_text(json.dumps({
            "validated": False, "labels": list(comment_semantics.LABELS),
            "thresholds": {label: 0.8 for label in comment_semantics.LABELS},
            "temperatures": {label: 1.0 for label in comment_semantics.LABELS},
        }), encoding="utf-8")
        with self.assertRaises(comment_semantics.SemanticModelUnavailable):
            comment_semantics.classify_comments(["测试评论"], str(model_path))

    def test_scheduler_discovery_saves_verified_work_source(self):
        post = AccountContentPost(
            id="new-work", title="产品演示", share_url="https://www.douyin.com/video/123",
        )
        with patch.object(lead_tracking, "_credential", return_value=("authorized-token", "")), \
             patch.object(lead_tracking, "_platform_page", new_callable=AsyncMock,
                          return_value=([post], "1", False)) as provider:
            complete = asyncio.run(lead_tracking.discover_comment_targets(self.account))
        self.assertTrue(complete)
        provider.assert_awaited_once()
        with sqlite3.connect(self.db_path) as conn:
            source = conn.execute(
                "SELECT title, share_url FROM lead_tracking_account_targets WHERE item_id = 'new-work'",
            ).fetchone()
        self.assertEqual(source, ("产品演示", "https://www.douyin.com/video/123"))

    def test_scheduler_includes_authorized_accounts_without_existing_targets(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM lead_tracking_account_targets")
        snapshot = SimpleNamespace(status="completed", message="synced")
        with patch.object(lead_tracking, "LEAD_DAILY_REPORT_ENABLED", True), \
             patch.object(lead_tracking, "discover_comment_targets", new_callable=AsyncMock,
                          return_value=True) as discover, \
             patch.object(lead_tracking, "sync_account_comment_insight", new_callable=AsyncMock,
                          return_value=snapshot) as sync, \
             patch.object(report, "generate_daily_report") as generate:
            asyncio.run(lead_tracking.LeadTrackingCommentScheduler().run_once(self.day))
        discover.assert_awaited_once()
        sync.assert_awaited_once()
        generate.assert_called_once()

    def test_unsupported_platform_never_reads_or_invents_comments(self):
        unsupported = {**self.account, "platform": "xiaohongshu"}
        with patch.object(lead_tracking, "_platform_page", new_callable=AsyncMock) as provider:
            with self.assertRaises(lead_tracking.CommentProviderError):
                asyncio.run(lead_tracking.discover_comment_targets(unsupported))
        provider.assert_not_awaited()
        result = report.generate_daily_report(unsupported, self.day)
        self.assertEqual((result.status, result.source, result.comments_collected),
                         ("unavailable", "unsupported", 0))

    def test_repeat_generation_delivers_once_and_rejects_cross_org_access(self):
        self._store([("希望支持导出报表", "u1", "work-1", 2, 1)])
        report.generate_daily_report(self.account, self.day)
        report.generate_daily_report(self.account, self.day)
        with sqlite3.connect(self.db_path) as conn:
            notifications = conn.execute(
                "SELECT COUNT(*) FROM notifications WHERE kind = 'lead_daily_report'",
            ).fetchone()[0]
            deliveries = conn.execute("SELECT COUNT(*) FROM lead_daily_report_deliveries").fetchone()[0]
        self.assertEqual((notifications, deliveries), (1, 1))
        with self.assertRaises(ProjectNotFound):
            report.get_daily_report(self.outsider["id"], self.project.id, "daily-account", self.day)

    def test_partial_or_simulated_never_claims_strong_demand(self):
        items = [("希望支持导出报表", f"u{i}", "work-1" if i % 2 else "work-2", 2, 0) for i in range(12)]
        self._store(items, status="partial")
        partial = report.generate_daily_report(self.account, self.day)
        self.assertFalse(partial.collection_complete)
        self.assertTrue(all(topic.evidence_level != "higher_confidence" for topic in partial.topics))
        self._store(items, simulated=True)
        simulated = report.generate_daily_report(self.account, self.day)
        self.assertEqual(simulated.status, "unavailable")
        self.assertEqual(simulated.comments_collected, 0)

    def test_local_simulated_preview_is_labeled_and_never_notifies(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """UPDATE project_channel_accounts SET platform_user_id = 'local-test-daily-preview',
                   authorization_status = 'demo', credential_blob = '' WHERE id = 'daily-account'"""
            )
        self.account = lead_tracking._internal_account(self.project.id, "daily-account")
        self.key = lead_tracking.lead_account_key_from_row(self.account)
        self._store([("希望支持导出报表", "fictional-u1", "work-1", 8, 2)], simulated=True)
        external_path = str(Path(tempfile.gettempdir()) / "marventa-local-test-preview.db")
        with patch.object(report, "LEAD_DAILY_LOCAL_DEMO_PREVIEW", True), \
             patch.object(report, "DEBUG", True), \
             patch.object(report, "ENABLE_DEMO_USER", True), \
             patch.object(report, "DATABASE_URL", ""), \
             patch.object(report, "DB_PATH", external_path):
            preview = report.generate_daily_report(self.account, self.day)
            self.assertEqual((preview.status, preview.source, preview.comments_collected),
                             ("completed", "local_demo", 1))
            self.assertTrue(preview.is_simulated)
            self.assertFalse(preview.collection_complete)
            self.assertEqual(report.get_daily_report(
                self.owner["id"], self.project.id, "daily-account", self.day,
            ).source, "local_demo")
            with sqlite3.connect(self.db_path) as conn:
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM lead_daily_report_deliveries"
                ).fetchone()[0], 0)
        self.assertEqual(report.get_daily_report(
            self.owner["id"], self.project.id, "daily-account", self.day,
        ).status, "unavailable")

    def test_roadshow_preview_is_allowlisted_synthetic_and_never_calls_paid_services(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                UPDATE project_channel_accounts SET platform_user_id = 'local-test-roadshow',
                    authorization_status = 'demo', credential_blob = ''
                WHERE id = 'daily-account'
            """)
        account = lead_tracking._internal_account(self.project.id, "daily-account")
        self.key = lead_tracking.lead_account_key_from_row(account)
        self._store([("希望支持报表导出", "sample-reader", "work-1", 8, 1)], simulated=True)
        with patch.object(report, "LEAD_ROADSHOW_PREVIEW_ACCOUNT_IDS", frozenset({"daily-account"})), \
             patch.object(report, "DEBUG", False), \
             patch.object(report, "_llm_suggestions") as llm, \
             patch.object(report, "deliver_daily_report") as notify:
            preview = report.generate_daily_report(account, self.day)
            self.assertEqual((preview.status, preview.source), ("completed", "presentation_preview"))
            self.assertTrue(preview.is_simulated)
            self.assertFalse(preview.collection_complete)
            self.assertEqual(report.get_daily_report(
                self.owner["id"], self.project.id, "daily-account", self.day,
            ).comments_collected, 1)
            self.assertEqual(report.get_daily_report(
                self.owner["id"], self.project.id, "daily-account",
            ).date, self.day.isoformat())
            llm.assert_not_called()
            notify.assert_not_called()
            for invalid in (
                {**account, "id": "not-allowlisted"},
                {**account, "authorization_status": "active"},
                {**account, "credential_blob": "platform-credentials"},
                {**account, "platform_user_id": "real-platform-user"},
            ):
                self.assertFalse(report._demo_preview_allowed(invalid))
            self.assertFalse(report._local_demo_preview(account))
        self.assertEqual(report.get_daily_report(
            self.owner["id"], self.project.id, "daily-account", self.day,
        ).status, "unavailable")

    def test_historical_topic_decision_is_preserved_on_regeneration(self):
        self._store([("希望支持导出报表", "u1", "work-1", 2, 0)])
        report.generate_daily_report(self.account, self.day)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO lead_daily_report_decisions
                   (account_key, local_date, topic, status, reviewed_by_user_id, reviewed_at)
                   VALUES (?, ?, '报表与数据', 'accepted', ?, '2026-10-05T00:00:00Z')""",
                (self.key, self.day.isoformat(), self.owner["id"]),
            )
        report.generate_daily_report(self.account, self.day)
        self.assertEqual(report.get_daily_report(
            self.owner["id"], self.project.id, "daily-account", self.day,
        ).topics[0].decision, "accepted")

    def test_historical_comment_review_overrides_model_and_survives_daily_resync(self):
        items = [("我不需要这个功能", "u1", "work-1", 4, 0)]
        self._store(items)
        report.generate_daily_report(self.account, self.day)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO lead_daily_comment_reviews
                   (account_key, local_date, comment_id, stance, reviewed_by_user_id, reviewed_at)
                   VALUES (?, ?, 'c-0', 'neutral', ?, '2026-10-05T00:00:00Z')""",
                (self.key, self.day.isoformat(), self.owner["id"]),
            )
        corrected = report.generate_daily_report(self.account, self.day)
        self.assertTrue(corrected.top_comments[0].reviewed)
        self.assertFalse(corrected.top_comments[0].pending_review)
        self.assertEqual(corrected.top_comments[0].stance, "neutral")
        with patch.object(lead_tracking, "LEAD_DAILY_REPORT_ENABLED", True):
            self._store(items)
        refreshed = report.generate_daily_report(self.account, self.day)
        self.assertEqual(refreshed.top_comments[0].stance, "neutral")

    def test_job_claim_is_idempotent_and_retries_failed_work(self):
        self.assertTrue(lead_tracking.LeadTrackingCommentScheduler._claim(self.key, self.day))
        self.assertFalse(lead_tracking.LeadTrackingCommentScheduler._claim(self.key, self.day))
        lead_tracking.LeadTrackingCommentScheduler._finish(self.key, self.day, False, "provider unavailable")
        self.assertFalse(lead_tracking.LeadTrackingCommentScheduler._claim(self.key, self.day))
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE lead_daily_jobs SET next_retry_at = ''")
        self.assertTrue(lead_tracking.LeadTrackingCommentScheduler._claim(self.key, self.day))
        lead_tracking.LeadTrackingCommentScheduler._finish(self.key, self.day, True)
        self.assertFalse(lead_tracking.LeadTrackingCommentScheduler._claim(self.key, self.day))


    def test_report_routes_recheck_access_and_expose_original_evidence(self):
        self._store([("希望支持导出报表", "u1", "work-1", 2, 0)])
        report.generate_daily_report(self.account, self.day)
        app = FastAPI()
        app.include_router(publishing.router)
        path = (f"/api/v1/publishing/projects/{self.project.id}/channel-accounts/"
                "daily-account/lead-tracking")
        owner_headers = {"Authorization": "Bearer " + create_access_token(self.owner["id"])}
        outsider_headers = {"Authorization": "Bearer " + create_access_token(self.outsider["id"])}
        with TestClient(app) as client:
            works = client.get(f"{path}/works", headers=owner_headers)
            self.assertEqual(works.status_code, 200)
            self.assertEqual({item["item_id"] for item in works.json()["data"]}, {"work-1", "work-2"})
            self.assertEqual(client.get(f"{path}/works", headers=outsider_headers).status_code, 404)
            scoped_insight = client.get(
                f"{path}/comment-insights?date={self.day}&item_id=work-1", headers=owner_headers)
            self.assertEqual(scoped_insight.status_code, 200)
            self.assertEqual(scoped_insight.json()["data"]["items"][0]["item_id"], "work-1")
            good = client.get(f"{path}/daily-reports?date={self.day}", headers=owner_headers)
            self.assertEqual(good.status_code, 200)
            self.assertEqual(good.json()["data"]["top_comments"][0]["comment_id"], "c-0")
            self.assertEqual(client.get(f"{path}/daily-reports?date={self.day}", headers=outsider_headers).status_code, 404)
            topic = good.json()["data"]["topics"][0]
            self.assertEqual(topic["evidence_comment_ids"], ["c-0"])
            self.assertEqual(topic["evidence_sources"][0]["item_id"], "work-1")
            routes = app.openapi()["paths"]
            for retired in (
                "daily-report-dates", "daily-report-download",
                "daily-comment-reviews", "daily-report-decisions",
            ):
                self.assertNotIn(f"{path}/{retired}".replace(self.project.id, "{project_id}")
                                 .replace("daily-account", "{account_id}"), routes)
                method = client.patch if retired in ("daily-comment-reviews", "daily-report-decisions") else client.get
                self.assertEqual(method(
                    f"{path}/{retired}?date={self.day}", headers=owner_headers,
                ).status_code, 404)

    def test_notification_recipients_need_both_org_and_project_access(self):
        observer = auth_storage.create_user("observer", "observer@example.com", "hash")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO organization_memberships
                   (organization_id, user_id, role, created_at) VALUES (?, ?, 'member', '2026-01-01')""",
                (self.account["organization_id"], observer["id"]),
            )
        self._store([("希望支持导出报表", "u1", "work-1", 2, 0)])
        report.generate_daily_report(self.account, self.day)
        with sqlite3.connect(self.db_path) as conn:
            before = conn.execute(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND kind = 'lead_daily_report'",
                (observer["id"],),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO project_memberships
                   (project_id, user_id, role, created_at) VALUES (?, ?, 'member', '2026-01-01')""",
                (self.project.id, observer["id"]),
            )
        report.generate_daily_report(self.account, self.day)
        with sqlite3.connect(self.db_path) as conn:
            after = conn.execute(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND kind = 'lead_daily_report'",
                (observer["id"],),
            ).fetchone()[0]
        self.assertEqual((before, after), (0, 1))


if __name__ == "__main__":
    unittest.main()
