"""Account-scoped follow-up keeps decisions and AI evidence tied to stored reports."""

from __future__ import annotations

import gc
import json
import shutil
import tempfile
import threading
import time
import unittest
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.auth import storage as auth_storage
from app import config as runtime_config
from app.engines.publishing import lead_tracking, opinion_details, opinion_strategy, storage
from app.engines.publishing.daily_comment_report import DailyCommentReport, ReportComment, ReportTopic, ReportWorkAnalysis
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.project_memberships import ProjectNotFound


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 12, 12, tzinfo=tz)


class OpinionStrategyTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="marventa-opinion-strategy-"))
        self.addCleanup(self._cleanup)
        db = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", db))
        self.enterContext(patch.object(storage, "DB_PATH", db))
        self.enterContext(patch.object(opinion_strategy, "datetime", FixedDateTime))
        self.enterContext(patch.object(opinion_strategy, "LEAD_OPINION_STRATEGY_LLM_ENABLED", False))
        self.owner = auth_storage.create_user("opinion-strategy-owner", "opinion-strategy-owner@example.com", "hash")
        self.outsider = auth_storage.create_user("opinion-strategy-outsider", "opinion-strategy-outsider@example.com", "hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Strategy project")
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO project_channel_accounts
                   (id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, authorization_status, scopes, created_at, updated_at)
                   VALUES ('strategy-account', ?, 'douyin', 'Brand', 'strategy-platform-id', ?,
                           'active', '["video.list","item.comment"]', '2026-01-01', '2026-01-01')""",
                (self.project.id, self.owner["id"]),
            )
        account = lead_tracking._internal_account(self.project.id, "strategy-account")
        self.key = lead_account_key_from_row(account)
        self.organization_id = account["organization_id"]

    def _cleanup(self):
        gc.collect()
        for _ in range(5):
            try:
                shutil.rmtree(self.directory)
                return
            except PermissionError:
                gc.collect()
                time.sleep(0.1)

    def _report(self, day: str, topic_name: str, *, simulated=False):
        topic = ReportTopic(
            topic=topic_name, conclusion=f"{topic_name}需确认", supporting_comments=2,
            opposing_comments=0, neutral_comments=0, distinct_users=2, works=1,
            evidence_level="individual_feedback", trend="insufficient_history",
            evidence_comment_ids=[f"comment-{day}"], quotes=["希望优化报表导出"],
            product_suggestion="梳理报表使用路径", marketing_suggestion="整理常见问题",
        )
        report = DailyCommentReport(
            status="completed", date=day, timezone="Asia/Shanghai",
            organization_id=self.organization_id, account_key=self.key,
            is_simulated=simulated, pending_review_comments=2,
            negative_feedback_comments=1, topics=[topic],
        )
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO lead_daily_reports
                   (account_key, local_date, organization_id, status, report_version, report_json, generated_at)
                   VALUES (?, ?, ?, 'completed', 'test', ?, ?)""",
                (self.key, day, self.organization_id, report.model_dump_json(), day),
            )

    def test_pending_and_accepted_actions_track_completion_without_crossing_scope(self):
        self._report("2026-10-10", "报表与数据")
        self._report("2026-10-11", "系统集成")
        self._report("2026-10-09", "不应显示", simulated=True)
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO lead_daily_report_decisions
                   (account_key, local_date, topic, status, reviewed_by_user_id, reviewed_at)
                   VALUES (?, '2026-10-10', '报表与数据', 'accepted', ?, '2026-10-11')""",
                (self.key, self.owner["id"]),
            )
        summary = opinion_strategy.get_opinion_actions(self.owner["id"], self.project.id, "strategy-account", 7)
        self.assertEqual(summary.report_days, 2)
        self.assertEqual(summary.pending_review_comments, 4)
        self.assertEqual({item.topic: item.status for item in summary.actions}, {
            "报表与数据": "accepted", "系统集成": "pending",
        })
        accepted = next(item for item in summary.actions if item.status == "accepted")
        updated = opinion_strategy.set_opinion_action_completed(
            self.owner["id"], self.project.id, "strategy-account", 7, accepted.id, True,
        )
        self.assertTrue(next(item for item in updated.actions if item.id == accepted.id).completed)
        restored = opinion_strategy.set_opinion_action_completed(
            self.owner["id"], self.project.id, "strategy-account", 7, accepted.id, False,
        )
        self.assertFalse(next(item for item in restored.actions if item.id == accepted.id).completed)
        with self.assertRaises(LookupError):
            opinion_strategy.set_opinion_action_completed(
                self.owner["id"], self.project.id, "strategy-account", 7,
                next(item for item in summary.actions if item.status == "pending").id, True,
            )
        pending_id = next(item for item in summary.actions if item.status == "pending").id
        accepted_summary = opinion_strategy.accept_opinion_action(
            self.owner["id"], self.project.id, "strategy-account", 7, pending_id,
        )
        self.assertEqual({item.status for item in accepted_summary.actions}, {"accepted"})
        with self.assertRaises(ProjectNotFound):
            opinion_strategy.get_opinion_actions(self.outsider["id"], self.project.id, "strategy-account", 7)

    def test_ai_rejects_unknown_evidence_reference(self):
        self._report("2026-10-11", "报表与数据")
        action_id = opinion_strategy.get_opinion_actions(
            self.owner["id"], self.project.id, "strategy-account", 7,
        ).actions[0].id
        provider = MagicMock()
        provider.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content=(
            '{"headline":"继续优化报表","recommendations":[{"title":"梳理需求",'
            '"next_step":"联系反馈用户","rationale":"评论提及报表",'
            '"evidence_action_ids":["fabricated"]}]}'
        )))]
        config = MagicMock(model="test-model")
        config.client.return_value = provider
        with patch.object(opinion_strategy, "_llm_available", return_value=True), \
                patch.object(opinion_strategy, "get_ai_provider", return_value=config):
            with self.assertRaisesRegex(ValueError, "unknown action"):
                opinion_strategy.generate_opinion_strategy(
                    self.owner["id"], self.project.id, "strategy-account", 7,
                )
            provider.chat.completions.create.return_value.choices[0].message.content = (
                '{"headline":"确认报表需求","recommendations":[{"title":"核对导出流程",'
                '"next_step":"访谈相关用户","rationale":"简报中记录了报表诉求",'
                f'"evidence_action_ids":["{action_id}"]}}]}}'
            )
            result = opinion_strategy.generate_opinion_strategy(
                self.owner["id"], self.project.id, "strategy-account", 7,
            )
            self.assertEqual(result.recommendations[0].source_dates, ["2026-10-11"])
        self.assertEqual(provider.close.call_count, 2)

    def test_configured_strategy_uses_openai_compatible_http_endpoint(self):
        self._report("2026-10-11", "报表与数据")
        action_id = opinion_strategy.get_opinion_actions(
            self.owner["id"], self.project.id, "strategy-account", 7,
        ).actions[0].id
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers["Content-Length"])
                requests.append((self.path, dict(self.headers), json.loads(self.rfile.read(length))))
                answer = json.dumps({
                    "id": "chatcmpl-local-test", "object": "chat.completion", "created": 0,
                    "model": "local-test-model", "choices": [{"index": 0, "finish_reason": "stop",
                        "message": {"role": "assistant", "content": json.dumps({
                            "headline": "确认报表需求", "recommendations": [{
                                "title": "核对导出流程", "next_step": "访谈相关用户",
                                "rationale": "简报记录了报表诉求", "evidence_action_ids": [action_id],
                            }],
                        }, ensure_ascii=False)},
                    }],
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(answer)))
                self.end_headers()
                self.wfile.write(answer)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(opinion_strategy, "LEAD_OPINION_STRATEGY_LLM_ENABLED", True), patch.multiple(
                runtime_config, AI_API_KEY="local-test-key",
                AI_BASE_URL=f"http://127.0.0.1:{server.server_port}/v1",
                AI_MODEL="local-test-model", LEAD_TRACKING_AI_OVERRIDE_ENABLED=False,
            ):
                result = opinion_strategy.generate_opinion_strategy(
                    self.owner["id"], self.project.id, "strategy-account", 7,
                )
            self.assertEqual(result.status, "completed")
            self.assertEqual(result.recommendations[0].evidence_action_ids, [action_id])
            self.assertEqual(requests[0][0], "/v1/chat/completions")
            self.assertEqual(requests[0][2]["response_format"], {"type": "json_object"})
            self.assertEqual(requests[0][2]["model"], "local-test-model")
            self.assertEqual(requests[0][1]["Authorization"], "Bearer local-test-key")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_details_use_only_scoped_report_comments_and_recorded_post_metrics(self):
        self._report("2026-10-11", "报表与数据")
        with storage._get_conn() as conn:
            row = conn.execute("SELECT report_json FROM lead_daily_reports WHERE account_key = ?", (self.key,)).fetchone()
            report = DailyCommentReport.model_validate_json(row["report_json"])
            selected = ReportComment(
                comment_id="comment-1", item_id="work-1", item_title="报表演示",
                content="报表打开太慢了", comment_user_id="raw-user-id",
                create_time=int(datetime(2026, 10, 11, 8).timestamp()),
                digg_count=12, reply_comment_total=3, interaction_score=18,
                topics=["报表与数据"], signals=["negative_feedback"],
            )
            extra = selected.model_copy(update={
                "comment_id": "comment-2", "content": "报表导出字段可以自定义吗？",
                "comment_user_id": "another-raw-user-id", "digg_count": 1,
            })
            report.top_comments = [selected]
            report.work_analyses = [ReportWorkAnalysis(
                item_id="work-1", item_title="报表演示", comments=[selected, extra],
            )]
            conn.execute("UPDATE lead_daily_reports SET report_json = ? WHERE account_key = ?",
                         (report.model_dump_json(), self.key))
            conn.execute("""INSERT INTO lead_tracking_account_targets
                (account_key, platform, platform_user_id, item_id, discovered_at, last_seen_at,
                 title, share_url, published_at, views, likes, comments, shares)
                VALUES (?, 'douyin', 'strategy-platform-id', 'work-1', '2026-10-11', '2026-10-11',
                        '报表演示', '', '2026-10-09T08:00:00Z', 1000, 70, 20, 10)""", (self.key,))
            conn.executemany("""INSERT INTO lead_tracking_post_metric_snapshots
                (account_key, local_date, item_id, views, likes, comments, shares, observed_at)
                VALUES (?, ?, 'work-1', ?, ?, ?, ?, '2026-10-11T00:00:00Z')""", [
                    (self.key, "2026-10-10", 800, 55, 16, 9),
                    (self.key, "2026-10-11", 1000, 70, 20, 10),
                ])
        details = opinion_details.get_opinion_details(self.owner["id"], self.project.id, "strategy-account", 7)
        self.assertEqual(len(details.comments), 2)
        self.assertNotIn("raw-user-id", details.model_dump_json())
        self.assertEqual({item.mood for item in details.comments}, {"negative", "neutral"})
        self.assertEqual(details.posts[0].engagement, 100)
        self.assertEqual(details.posts[0].rate, 10)
        self.assertEqual(details.performance.post_count, 1)
        self.assertEqual(details.performance.views, 1000)
        self.assertEqual(details.performance.engagement, 100)
        self.assertEqual(details.performance.risk_count, 1)
        self.assertEqual(details.performance.daily[-1].views, 200)
        self.assertEqual(details.performance.daily[-1].engagement, 20)
        self.assertIsNone(details.performance.daily[-2].views)
        with self.assertRaises(ProjectNotFound):
            opinion_details.get_opinion_details(self.outsider["id"], self.project.id, "strategy-account", 7)


if __name__ == "__main__":
    unittest.main()
