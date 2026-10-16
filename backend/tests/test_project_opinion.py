"""Project opinion aggregation retains account evidence and missing coverage."""

import json
import shutil
import unittest
import uuid
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import publishing
from app.auth import storage as auth_storage
from app.auth.dependencies import get_current_user
from app.engines.publishing import (
    daily_comment_report,
    lead_tracking,
    opinion_monitor,
    opinion_strategy,
    project_opinion,
    storage,
)
from app.engines.publishing.account_content import _scoped_account
from app.engines.publishing.daily_comment_report import (
    DailyCommentReport,
    ReportComment,
    ReportTopic,
    ReportWorkAnalysis,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.project_memberships import ProjectNotFound


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 12, 12, tzinfo=tz)


class ProjectOpinionTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(__file__).parent / (".project-opinion-" + uuid.uuid4().hex)
        self.directory.mkdir()
        self.addCleanup(shutil.rmtree, self.directory)
        db = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", db))
        self.enterContext(patch.object(storage, "DB_PATH", db))
        self.enterContext(patch.object(opinion_monitor, "datetime", FixedDateTime))
        self.enterContext(patch.object(opinion_strategy, "datetime", FixedDateTime))
        self.enterContext(patch.object(opinion_monitor, "LEAD_OPINION_EMBEDDING_MODEL_PATH", ""))
        self.enterContext(patch.object(opinion_strategy, "LEAD_OPINION_STRATEGY_LLM_ENABLED", False))
        self.owner = auth_storage.create_user("project-owner", "project-owner@example.com", "hash")
        self.outsider = auth_storage.create_user("project-outsider", "project-outsider@example.com", "hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Project")
        self.other_project = storage.create_manual_project(self.owner["id"], title="Other project")
        self.foreign_project = storage.create_manual_project(self.outsider["id"], title="Foreign project")
        self._bind("a", "open-a")
        self._bind("b", "open-b")
        self._bind("duplicate-a", "open-a")
        self._bind("other", "open-other", project=self.other_project)
        self._bind("foreign", "open-a", project=self.foreign_project, owner=self.outsider)
        app = FastAPI()
        app.include_router(publishing.router)
        app.dependency_overrides[get_current_user] = lambda: self.owner
        self.client = self.enterContext(TestClient(app))
        self.app = app

    def _bind(self, binding, identity, *, project=None, owner=None, platform="douyin"):
        project, owner = project or self.project, owner or self.owner
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO project_channel_accounts
                   (id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, authorization_status, scopes, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'active', '["video.list","item.comment"]',
                           '2026-01-01', '2026-01-01')""",
                (binding, project.id, platform, f"Brand {binding}", identity, owner["id"]),
            )

    def _account(self, binding):
        project = self.foreign_project if binding == "foreign" else self.other_project if binding == "other" else self.project
        owner = self.outsider if binding == "foreign" else self.owner
        return _scoped_account(owner["id"], project.id, binding)

    def _store(self, binding, texts, *, day=11, status="completed", simulated=False):
        key = lead_account_key_from_row(self._account(binding))
        lead_tracking._save_run(key, date(2026, 10, day), status, False, "test", [{
            "item_id": "same-post", "comment_id": f"same:{index}",
            "comment_user_id": f"user-{index}", "content": text,
            "create_time": 1791660000 + index, "digg_count": 0,
            "reply_comment_total": 0, "top": False, "raw_data": "{}",
        } for index, text in enumerate(texts)], is_simulated=simulated)

    def _report(self, binding, *, day=11, reviewed=False, simulated=False, mismatch=False):
        account = self._account(binding)
        key = lead_account_key_from_row(account)
        topic = ReportTopic(
            topic="报表", conclusion=f"来自 {binding} 的报表需求",
            supporting_comments=1, opposing_comments=0, neutral_comments=0,
            distinct_users=1, works=1, evidence_level="individual_feedback",
            trend="insufficient_history", evidence_comment_ids=["same:0"],
            quotes=[f"希望优化报表 {binding}"], product_suggestion="核对导出",
            marketing_suggestion="整理常见问题",
        )
        comment = ReportComment(
            comment_id="same:0", item_id="same-post", content="报表太慢了",
            comment_user_id="user-0", create_time=1791660000,
            digg_count=0, reply_comment_total=0, interaction_score=0,
            topics=["报表"], signals=["negative_feedback"], stance="support",
            pending_review=not reviewed, reviewed=reviewed,
        )
        local_date = f"2026-10-{day:02}"
        report = DailyCommentReport(
            status="completed", date=local_date, timezone="Asia/Shanghai",
            organization_id="wrong-org" if mismatch else account["organization_id"],
            account_key=key, is_simulated=simulated, pending_review_comments=int(not reviewed),
            negative_feedback_comments=1, topics=[topic],
            work_analyses=[ReportWorkAnalysis(item_id="same-post", comments=[comment])],
        )
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO lead_daily_reports
                   (account_key, local_date, organization_id, status, report_version, report_json, generated_at)
                   VALUES (?, ?, ?, 'completed', 'test', ?, ?)""",
                (key, local_date, account["organization_id"], report.model_dump_json(), local_date),
            )

    def _post(self, binding, views, engagement, previous_views, previous_engagement):
        account = self._account(binding)
        key = lead_account_key_from_row(account)
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO lead_tracking_account_targets
                   (account_key, platform, platform_user_id, item_id, discovered_at, last_seen_at,
                    title, share_url, published_at, views, likes, comments, shares)
                   VALUES (?, ?, ?, 'same-post', '2026-10-11', '2026-10-11',
                           'Post', '', '2026-10-09T08:00:00Z', ?, ?, 0, 0)""",
                (key, account["platform"], account["platform_user_id"], views, engagement),
            )
            conn.executemany(
                """INSERT INTO lead_tracking_post_metric_snapshots
                   (account_key, local_date, item_id, views, likes, comments, shares, observed_at)
                   VALUES (?, ?, 'same-post', ?, ?, 0, 0, '2026-10-11T00:00:00Z')""",
                [(key, "2026-10-10", previous_views, previous_engagement),
                 (key, "2026-10-11", views, engagement)],
            )

    def _monitor(self, days=7):
        return project_opinion.get_project_opinion_monitor(self.owner["id"], self.project.id, days)

    def test_project_preview_rules_never_replace_the_real_topic_model_for_mixed_evidence(self):
        with storage._get_conn() as conn:
            conn.execute("""
                UPDATE project_channel_accounts SET platform_user_id = 'local-test-roadshow',
                    authorization_status = 'demo' WHERE id = 'a'
            """)
        self._store("a", ["希望支持飞书对接"], simulated=True)
        self._store("b", ["报表使用很方便"])
        with patch.object(daily_comment_report, "LEAD_ROADSHOW_PREVIEW_ACCOUNT_IDS", frozenset({"a"})):
            preview = project_opinion._overview([self._account("a")], self.project.id, 7)
            self.assertTrue(preview.is_simulated)
            self.assertEqual(preview.theme_status, "ready")
            mixed = project_opinion._overview([self._account("a"), self._account("b")], self.project.id, 7)
            self.assertTrue(mixed.is_simulated)
            self.assertNotEqual(mixed.theme_status, "ready")
            self.assertEqual(mixed.comments_collected, 2)

    def test_weighted_project_counts_and_identity_safe_provenance(self):
        self._store("a", ["页面太慢了"])
        self._store("b", ["很好用"] * 3)
        self._store("other", ["其他项目"] * 8)
        self._store("foreign", ["其他组织"] * 9)
        self._report("a")
        self._report("b")
        self._post("a", 100, 50, 80, 40)
        self._post("b", 900, 90, 700, 60)
        result = self._monitor()
        self.assertEqual(result.overview.comments_collected, 4)
        self.assertEqual(result.overview.distinct_users, 4)
        self.assertEqual(result.overview.covered_days, 1)
        self.assertEqual(result.overview.daily[-1].negative_percent, 25)
        self.assertTrue(result.overview.daily[-1].collection_complete)
        self.assertEqual({share.key: share.percent for share in result.overview.sentiments},
                         {"positive": 75, "negative": 25, "neutral": 0, "uncertain": 0})
        self.assertEqual(result.details.performance.views, 1000)
        self.assertEqual(result.details.performance.engagement, 140)
        self.assertEqual(result.details.performance.rate, 14)
        self.assertEqual(result.details.performance.daily[-1].views, 220)
        self.assertEqual(result.details.performance.daily[-1].engagement, 40)
        self.assertIsNone(result.details.performance.daily[-1].previous_views)
        self.assertEqual(result.actions.report_days, 1)
        self.assertEqual(result.actions.pending_review_comments, 2)
        self.assertEqual(result.actions.negative_feedback_comments, 2)
        self.assertEqual(result.details.performance.risk_count, 2)
        self.assertEqual(len({post.item_id for post in result.details.posts}), 2)
        self.assertEqual(len({comment.comment_id for comment in result.details.comments}), 2)
        self.assertEqual(len({action.id for action in result.actions.actions}), 2)
        posts = {post.account_id: post for post in result.details.posts}
        comments = {comment.account_id: comment for comment in result.details.comments}
        for action in result.actions.actions:
            self.assertEqual(action.evidence_comment_ids, [comments[action.account_id].comment_id])
            self.assertEqual(comments[action.account_id].item_id, posts[action.account_id].item_id)
            self.assertEqual(action.source_action_id, opinion_strategy._action_id("pending", "报表"))
            self.assertEqual(action.account_name, f"Brand {action.account_id}")
            self.assertEqual(action.project_id, self.project.id)
        account_result = opinion_monitor.get_opinion_overview(self.owner["id"], self.project.id, "a")
        self.assertEqual(account_result.comments_collected, 1)
        self.assertEqual(account_result.sentiments[2].percent, 100)
        self.assertEqual(opinion_strategy.get_opinion_actions(
            self.owner["id"], self.project.id, "a").actions[0].id,
            result.actions.actions[0].source_action_id)
        self.assertNotIn("user-0", result.model_dump_json())
        response = self.client.get(f"/api/v1/publishing/projects/{self.project.id}/opinion-monitor")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        for section, field in (("details", "posts"), ("details", "comments"), ("actions", "actions")):
            self.assertEqual({item["account_id"] for item in data[section][field]}, {"a", "b"})
            self.assertTrue(all(item["account_name"] and item["project_id"] == self.project.id
                                for item in data[section][field]))

    def test_missing_and_partial_coverage_is_not_fabricated_zero(self):
        self._store("a", [], day=9)
        self._store("a", ["太慢"], day=10)
        self._store("b", [], day=10, status="partial")
        self._store("a", [], day=11)
        self._store("b", [], day=11)
        self._post("a", 100, 10, 90, 9)
        self._post("b", None, None, 50, 5)
        result = self._monitor()
        self.assertEqual(result.overview.covered_days, 3)
        self.assertEqual(result.overview.incomplete_days, 2)
        self.assertEqual(result.overview.status, "partial")
        points = {point.date: point for point in result.overview.daily}
        self.assertIsNone(points["2026-10-09"].comments)
        self.assertEqual(points["2026-10-09"].covered_accounts, 1)
        self.assertEqual(points["2026-10-10"].comments, 1)
        self.assertFalse(points["2026-10-10"].collection_complete)
        self.assertEqual(points["2026-10-11"].comments, 0)
        self.assertTrue(points["2026-10-11"].collection_complete)
        self.assertIsNone(result.details.performance.views)
        self.assertIsNone(result.details.performance.engagement)
        self.assertIsNone(result.details.performance.rate)
        self.assertIsNone(result.details.performance.daily[-1].views)
        self.assertIsNone(result.details.performance.daily[-1].engagement)

    def test_themes_and_question_demand_percentages_use_combined_evidence(self):
        self._store("a", [f"报表太慢了 {index}" for index in range(10)])
        self._store("b", [f"能不能支持导出？ {index}" for index in range(30)])
        def discover(key, rows, model):
            self.assertEqual(key, f"project:{self.project.id}")
            self.assertEqual(len({row["comment_id"] for row in rows}), 40)
            return ({row["comment_id"]: 1 if "太慢" in row["content"] else 2 for row in rows},
                    {1: "性能", 2: "导出"}, {1: [("性能", .8)], 2: [("导出", .8)]})
        with patch.object(opinion_monitor, "LEAD_OPINION_EMBEDDING_MODEL_PATH", "model"), \
                patch.object(opinion_monitor, "_discover_themes", side_effect=discover):
            result = self._monitor()
        self.assertEqual(result.overview.question_percent, 75)
        self.assertEqual(result.overview.demand_percent, 75)
        self.assertEqual({item.label: item.percent for item in result.overview.keyword_clusters},
                         {"性能": 25, "导出": 75})
        self.assertEqual({word.word: word.weight for word in result.overview.words},
                         {"导出": 1, "性能": .333})

    def test_report_day_union_and_comment_dedup_use_latest_review(self):
        for binding in ("a", "b"):
            self._report(binding, day=10)
            self._report(binding, day=11, reviewed=True)
        result = self._monitor(30)
        self.assertEqual(result.actions.report_days, 2)
        self.assertEqual(result.actions.pending_review_comments, 0)
        self.assertEqual(result.actions.negative_feedback_comments, 2)
        self.assertEqual(len(result.details.comments), 2)
        self.assertEqual(len(result.details.performance.daily), 30)
        self.assertEqual(len(result.overview.daily), 30)
        self.assertTrue(all(action.report_count == 2 for action in result.actions.actions))

    def test_permission_and_project_organization_isolation(self):
        self._store("a", ["当前项目"])
        self._store("other", ["其他项目"] * 2)
        self._store("foreign", ["其他组织"] * 3)
        self.assertEqual(self._monitor().overview.comments_collected, 1)
        self.assertEqual(project_opinion.get_project_opinion_monitor(
            self.owner["id"], self.other_project.id).overview.comments_collected, 2)
        self.assertEqual(project_opinion.get_project_opinion_monitor(
            self.outsider["id"], self.foreign_project.id).overview.comments_collected, 3)
        for method in (project_opinion.get_project_opinion_monitor, project_opinion.generate_project_opinion_strategy):
            with self.assertRaises(ProjectNotFound):
                method(self.outsider["id"], self.project.id)
        with storage._get_conn() as conn:
            conn.execute("INSERT INTO project_memberships (project_id, user_id, role, created_at) "
                         "VALUES (?, ?, 'member', '2026-10-11')",
                         (self.project.id, self.outsider["id"]))
        with self.assertRaises(ProjectNotFound):
            project_opinion.get_project_opinion_monitor(self.outsider["id"], self.project.id)

    def test_empty_project_http_shape_period_and_scope(self):
        empty = storage.create_manual_project(self.owner["id"], title="Empty")
        url = f"/api/v1/publishing/projects/{empty.id}"
        response = self.client.get(url + "/opinion-monitor?days=30")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(set(data), {"overview", "details", "actions"})
        self.assertEqual(data["overview"]["status"], "unavailable")
        self.assertEqual(data["overview"]["covered_days"], 0)
        self.assertTrue(all(point["comments"] is None for point in data["overview"]["daily"]))
        self.assertEqual(len(data["details"]["performance"]["daily"]), 30)
        self.assertIsNone(data["details"]["performance"]["views"])
        self.assertEqual(data["actions"]["actions"], [])
        response = self.client.post(url + "/opinion-strategy")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["status"], "insufficient_data")
        self.assertEqual(self.client.get(url + "/opinion-monitor?days=8").status_code, 422)
        self.assertEqual(self.client.post(url + "/opinion-strategy?days=8").status_code, 422)
        self.app.dependency_overrides[get_current_user] = lambda: self.outsider
        self.assertEqual(self.client.get(url + "/opinion-monitor").status_code, 404)
        self.assertEqual(self.client.post(url + "/opinion-strategy").status_code, 404)

    def test_identity_includes_platform_and_unidentified_bindings_do_not_collapse(self):
        self._bind("different-platform", "open-a", platform="xiaohongshu")
        self._bind("no-id-a", "")
        self._bind("no-id-b", "")
        for binding in ("a", "different-platform", "no-id-a", "no-id-b"):
            self._store(binding, ["很好用"])
        result = self._monitor()
        self.assertEqual(result.overview.comments_collected, 4)
        self.assertEqual(result.overview.distinct_users, 4)
        self.assertEqual(result.overview.daily[-1].total_accounts, 5)
        self.assertEqual(result.overview.daily[-1].covered_accounts, 4)
        self.assertIsNone(result.overview.daily[-1].comments)

    def test_inactive_bindings_retain_history_but_missing_collection_is_partial(self):
        self._store("a", ["很好用"])
        for status in ("expired", "revoked"):
            with storage._get_conn() as conn:
                conn.execute("UPDATE project_channel_accounts SET authorization_status = ? WHERE id = 'b'",
                             (status,))
            result = self._monitor()
            self.assertEqual(result.overview.status, "partial")
            self.assertEqual(result.overview.daily[-1].total_accounts, 2)
            self.assertEqual(result.overview.daily[-1].covered_accounts, 1)
            self.assertIsNone(result.overview.daily[-1].comments)
        self._store("b", ["报表太慢了"])
        self._report("b")
        self._post("b", 100, 10, 90, 9)
        result = self._monitor()
        self.assertEqual(result.overview.status, "completed")
        self.assertEqual(result.overview.comments_collected, 2)
        self.assertEqual({comment.account_id for comment in result.details.comments}, {"b"})
        self.assertEqual({action.account_id for action in result.actions.actions}, {"b"})

    def test_same_org_requires_project_membership_and_members_can_read(self):
        member = auth_storage.create_user("project-member", "project-member@example.com", "hash")
        org = auth_storage.get_current_organization(self.owner["id"])["id"]
        with storage._get_conn() as conn:
            conn.execute("INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-10-11')",
                         (org, member["id"]))
            conn.execute("UPDATE user_organization_preferences SET organization_id = ? WHERE user_id = ?",
                         (org, member["id"]))
        with self.assertRaises(ProjectNotFound):
            project_opinion.get_project_opinion_monitor(member["id"], self.project.id)
        with storage._get_conn() as conn:
            conn.execute("INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-10-11')",
                         (self.project.id, member["id"]))
        self._store("a", ["很好用"])
        self.assertEqual(project_opinion.get_project_opinion_monitor(
            member["id"], self.project.id).overview.comments_collected, 1)
        self.assertEqual(project_opinion.generate_project_opinion_strategy(
            member["id"], self.project.id).status, "insufficient_data")

    def test_strategy_grounding_uses_all_accounts_and_global_action_ids(self):
        for binding in ("a", "b", "other", "foreign"):
            self._report(binding)
        provider = MagicMock()
        config = MagicMock(model="test-model")
        config.client.return_value = provider
        captured = []
        def generate(**kwargs):
            payload = json.loads(kwargs["messages"][1]["content"])
            captured.append(payload)
            ids = [action["id"] for action in payload["actions"]]
            return MagicMock(choices=[MagicMock(message=MagicMock(content=json.dumps({
                "headline": "确认报表需求", "recommendations": [{
                    "title": "核对导出流程", "next_step": "访谈相关用户",
                    "rationale": "两个账号记录报表需求", "evidence_action_ids": ids,
                }],
            })))])
        provider.chat.completions.create.side_effect = generate
        with patch.object(opinion_strategy, "_llm_available", return_value=True), \
                patch.object(opinion_strategy, "get_ai_provider", return_value=config):
            result = project_opinion.generate_project_opinion_strategy(self.owner["id"], self.project.id)
        expected = {action.id for action in self._monitor().actions.actions}
        self.assertEqual(set(result.recommendations[0].evidence_action_ids), expected)
        self.assertEqual(len(captured[0]["actions"]), 2)
        self.assertEqual(captured[0]["report_days"], 1)
        evidence = [action["evidence"][0] for action in captured[0]["actions"]]
        self.assertEqual(len({item["id"] for item in evidence}), 2)
        self.assertEqual({item["text"] for item in evidence}, {"希望优化报表 a", "希望优化报表 b"})
        self.assertEqual(result.recommendations[0].source_dates, ["2026-10-11"])
        provider.close.assert_called_once()

    def test_strategy_configuration_and_invalid_grounding_errors_are_not_dropped(self):
        self._report("a")
        url = f"/api/v1/publishing/projects/{self.project.id}"
        self.assertEqual(self.client.post(url + "/opinion-strategy").status_code, 503)
        provider = MagicMock()
        config = MagicMock(model="test-model")
        config.client.return_value = provider
        provider.chat.completions.create.return_value = MagicMock(choices=[MagicMock(message=MagicMock(content=(
            '{"headline":"继续优化报表","recommendations":[{"title":"梳理需求",'
            '"next_step":"联系反馈用户","rationale":"评论提及报表",'
            '"evidence_action_ids":["fabricated"]}]}'
        )))])
        with patch.object(opinion_strategy, "_llm_available", return_value=True), \
                patch.object(opinion_strategy, "get_ai_provider", return_value=config):
            with self.assertRaisesRegex(ValueError, "unknown action"):
                project_opinion.generate_project_opinion_strategy(self.owner["id"], self.project.id)
            with self.assertLogs(publishing.logger, level="ERROR"):
                self.assertEqual(self.client.post(url + "/opinion-strategy").status_code, 502)

    def test_simulated_and_mismatched_reports_are_excluded(self):
        self._store("a", ["真实"])
        self._store("b", ["模拟"], simulated=True)
        self._report("a", mismatch=True)
        self._report("b", simulated=True)
        result = self._monitor()
        self.assertEqual(result.overview.comments_collected, 1)
        self.assertFalse(result.overview.is_simulated)
        self.assertEqual(result.actions.report_days, 0)
        self.assertEqual(result.actions.actions, [])
        self.assertEqual(result.details.comments, [])
