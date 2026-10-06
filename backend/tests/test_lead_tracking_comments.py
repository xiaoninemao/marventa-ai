import json
import shutil
import sqlite3
import unittest
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import publishing
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.engines.publishing import (
    account_content,
    channel_credentials,
    lead_analysis,
    lead_identity,
    lead_tracking,
    storage,
)


class LeadTrackingCommentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = Path(__file__).parent / (".lead-tracking-" + uuid.uuid4().hex)
        self.directory.mkdir()
        self.addCleanup(shutil.rmtree, self.directory)
        self.db_path = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(
            channel_credentials,
            "CHANNEL_CREDENTIAL_ENCRYPTION_KEY",
            Fernet.generate_key().decode(),
        ))
        self.enterContext(patch.object(lead_tracking, "LEAD_TRACKING_SYNC_ENABLED", True))
        self.enterContext(patch.object(
            lead_tracking, "LEAD_TRACKING_TIMEZONE", "Asia/Shanghai",
        ))
        self.enterContext(patch.object(
            lead_tracking, "LEAD_TRACKING_REQUIRED_SCOPE", "item.comment",
        ))
        self.enterContext(patch.object(
            lead_analysis, "LEAD_TRACKING_ANALYSIS_MODE", "rules",
        ))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "hash")
        self.outsider = auth_storage.create_user("outsider", "outsider@example.com", "hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Lead tracking")
        self.foreign = storage.create_manual_project(self.outsider["id"], title="Foreign")
        self.secret = "secret-access-token"
        blob = channel_credentials.encrypt_channel_credentials({
            "access_token": self.secret,
            "refresh_token": "secret-refresh-token",
            "open_id": "open-1",
        })
        self._add_account("account-1", self.project.id, blob)
        self._add_account("foreign-account", self.foreign.id, blob)
        self.account_key = lead_identity.lead_account_key_from_row(
            lead_tracking._internal_account(self.project.id, "account-1"),
        )
        self.foreign_key = lead_identity.lead_account_key_from_row(
            lead_tracking._internal_account(self.foreign.id, "foreign-account"),
        )
        app = FastAPI()
        app.include_router(publishing.router)
        self.client = self.enterContext(TestClient(app))
        self.path = (
            f"/api/v1/publishing/projects/{self.project.id}"
            "/channel-accounts/account-1/lead-tracking/comment-insights"
        )
        self.day = date(2026, 10, 4)

    def _add_account(self, account_id, project_id, blob):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO project_channel_accounts (
                    id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, scopes, credential_blob,
                    authorization_status, token_expires_at, created_at, updated_at
                ) VALUES (?, ?, 'douyin', ?, 'open-1', ?, ?, ?, 'active',
                          '2099-01-01 00:00:00', '2026-01-01', '2026-01-01')
                """,
                (
                    account_id, project_id, account_id, self.owner["id"],
                    '["video.list","item.comment"]', blob,
                ),
            )

    def _target(self, item_id="item-1"):
        lead_tracking.register_comment_targets(
            self.project.id, "account-1", [item_id],
        )

    def _comment(self, comment_id, created, *, digg=1, replies=0, content="comment"):
        return {
            "comment_id": comment_id,
            "comment_user_id": "viewer-1",
            "content": content,
            "create_time": created,
            "digg_count": digg,
            "reply_comment_total": replies,
            "top": False,
            "nick_name": "preserved in raw data",
        }

    def _payload(self, items, cursor=0, has_more=False):
        return {
            "data": {
                "list": items,
                "cursor": cursor,
                "has_more": has_more,
                "error_code": 0,
            },
        }

    async def _sync(self, handler):
        requests = []

        def transport(request):
            requests.append(request)
            return handler(request)

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(transport),
        ) as client:
            result = await lead_tracking.sync_account_comment_insight(
                self.project.id, "account-1", self.day, client=client,
            )
        return result, requests

    async def test_exact_official_contract_and_day_boundaries(self):
        self._target()
        zone = ZoneInfo("Asia/Shanghai")
        start = int(datetime(2026, 10, 4, tzinfo=zone).timestamp())
        calls = 0

        def handler(request):
            nonlocal calls
            calls += 1
            self.assertEqual(
                str(request.url).split("?")[0],
                "https://open.douyin.com/item/comment/list/",
            )
            self.assertEqual(request.headers["access-token"], self.secret)
            params = dict(request.url.params)
            self.assertEqual(params["open_id"], "open-1")
            self.assertEqual(params["item_id"], "item-1")
            self.assertEqual(params["count"], "20")
            self.assertEqual(params["sort_type"], "time_asc")
            self.assertEqual(params["cursor"], "0" if calls == 1 else "9")
            if calls == 1:
                return httpx.Response(200, json=self._payload([
                    self._comment("before", start - 1),
                    self._comment("at-start", start),
                    self._comment("last", start + 86_399),
                ], cursor="9", has_more=True))
            return httpx.Response(200, json=self._payload([
                self._comment("at-end", start + 86_400),
                self._comment("later", start + 90_000),
            ], cursor=10, has_more=True))

        result, requests = await self._sync(handler)
        self.assertEqual(len(requests), 2)
        self.assertEqual(result.status, "completed")
        self.assertEqual({item.comment_id for item in result.items}, {"at-start", "last"})
        analysis = lead_analysis.get_lead_analysis(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(analysis.status, "completed")
        self.assertEqual(
            {item.comment_id for item in analysis.items},
            {"at-start", "last"},
        )

    async def test_automatic_analysis_failure_is_explicit_and_manually_retryable(self):
        self._target()
        created = int(datetime(2026, 10, 4, 12, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
        with patch.object(
            lead_analysis,
            "_analyze_comment",
            side_effect=RuntimeError("private analysis failure"),
        ):
            comments, _ = await self._sync(
                lambda _request: httpx.Response(
                    200,
                    json=self._payload([self._comment("retry-me", created)]),
                ),
            )
        self.assertEqual(comments.status, "completed")
        failed = lead_analysis.get_lead_analysis(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.message, lead_analysis.ANALYSIS_FAILED_MESSAGE)
        self.assertNotIn("private analysis failure", failed.model_dump_json())

        retried = lead_analysis.analyze_comment_snapshot(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(retried.status, "completed")
        self.assertEqual([item.comment_id for item in retried.items], ["retry-me"])

    async def test_top50_uses_documented_deterministic_b2b_score(self):
        self._target()
        zone = ZoneInfo("Asia/Shanghai")
        start = int(datetime(2026, 10, 4, tzinfo=zone).timestamp())
        all_items = [
            self._comment(
                f"comment-{index:02d}", start + index,
                digg=index % 5, replies=index % 4,
            )
            for index in range(55)
        ]

        def handler(request):
            cursor = int(request.url.params["cursor"])
            page = all_items[cursor:cursor + 20]
            next_cursor = cursor + len(page)
            return httpx.Response(200, json=self._payload(
                page, cursor=next_cursor, has_more=next_cursor < len(all_items),
            ))

        result, _ = await self._sync(handler)
        self.assertEqual(len(result.items), 50)
        expected = sorted(
            all_items,
            key=lambda item: (
                -(item["digg_count"] + item["reply_comment_total"] * 2),
                -item["create_time"],
                item["comment_id"],
            ),
        )[:50]
        self.assertEqual(
            [item.comment_id for item in result.items],
            [item["comment_id"] for item in expected],
        )
        self.assertEqual(
            result.items[0].interaction_score,
            result.items[0].digg_count + result.items[0].reply_comment_total * 2,
        )
        self.assertFalse(result.is_simulated)

    async def test_stored_demo_snapshot_is_explicitly_marked_simulated(self):
        created = int(datetime(2026, 10, 4, 12, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
        comment = lead_tracking._comment(
            self._comment("demo-comment", created, content="Demo inquiry"),
            "demo-item",
        )
        lead_tracking._save_run(
            self.account_key,
            self.day,
            "completed",
            False,
            "Stored local demo snapshot",
            [comment],
            is_simulated=True,
        )

        result = lead_tracking.get_comment_insight_internal(
            self.account_key,
            self.day,
        )

        self.assertTrue(result.is_simulated)
        self.assertEqual([item.comment_id for item in result.items], ["demo-comment"])

    def _save_analysis_snapshot(self):
        created = int(datetime(2026, 10, 4, 12, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
        comments = [
            lead_tracking._comment(
                self._comment(
                    "buyer", created, digg=24, replies=5,
                    content="想预约演示，月底采购，请提供报价。",
                ),
                "item-1",
            ),
            lead_tracking._comment(
                self._comment(
                    "technical", created + 1, digg=2, replies=1,
                    content="支持 API 对接吗？",
                ),
                "item-1",
            ),
            lead_tracking._comment(
                self._comment("general", created + 2, content="内容很好"),
                "item-1",
            ),
        ]
        lead_tracking._save_run(
            self.account_key,
            self.day,
            "completed",
            False,
            "Stored local demo snapshot",
            comments,
            is_simulated=True,
        )

    async def test_analysis_is_explainable_prioritized_and_simulation_aware(self):
        self._save_analysis_snapshot()

        result = lead_analysis.analyze_comment_snapshot(
            self.owner["id"], self.project.id, "account-1", self.day,
        )

        self.assertEqual(result.status, "completed")
        self.assertTrue(result.is_simulated)
        self.assertEqual(result.analyzed_count, 3)
        self.assertEqual(result.high_count, 1)
        buyer = next(item for item in result.items if item.comment_id == "buyer")
        self.assertEqual(buyer.intent, "high")
        self.assertEqual(buyer.score, 100)
        self.assertEqual(buyer.demand_labels, ["pricing", "demo_trial"])
        self.assertIn("purchase_intent", buyer.evidence)
        self.assertIn("urgency", buyer.evidence)
        self.assertEqual(buyer.recommended_action, "schedule_demo")
        technical = next(item for item in result.items if item.comment_id == "technical")
        self.assertEqual(technical.recommended_action, "technical_review")

    async def test_ai_analysis_uses_anonymous_bounded_batches_and_strict_results(self):
        self._save_analysis_snapshot()
        requests = []

        class Completions:
            def create(_self, **kwargs):
                requests.append(kwargs)
                payload = json.loads(kwargs["messages"][1]["content"])
                content = json.dumps({
                    "items": [{
                        "id": item["id"],
                        "score": 82,
                        "intent": "high",
                        "demand_labels": ["integration"],
                        "evidence": ["concrete_requirement"],
                        "recommended_action": "technical_review",
                    } for item in payload["comments"]],
                })
                return SimpleNamespace(choices=[
                    SimpleNamespace(message=SimpleNamespace(content=content)),
                ])

        client = SimpleNamespace(
            chat=SimpleNamespace(completions=Completions()),
            close=lambda: None,
        )
        with (
            patch.object(lead_analysis, "LEAD_TRACKING_ANALYSIS_MODE", "ai"),
            patch.object(lead_analysis, "LEAD_TRACKING_AI_MODEL", "test-ai"),
            patch.object(lead_analysis, "LEAD_TRACKING_AI_BATCH_SIZE", 2),
        ):
            result = lead_analysis.analyze_comment_snapshot(
                self.owner["id"], self.project.id, "account-1", self.day,
                client=client,
            )

        self.assertEqual(result.analysis_method, "ai")
        self.assertEqual(result.model, "test-ai")
        self.assertEqual(result.rule_version, lead_analysis.AI_PROMPT_VERSION)
        self.assertEqual(len(result.items), 3)
        self.assertEqual(len(requests), 2)
        sent = json.dumps(requests, ensure_ascii=False, default=str)
        self.assertNotIn("viewer-1", sent)
        self.assertNotIn("account-1", sent)
        self.assertNotIn(self.owner["id"], sent)
        self.assertIn("untrusted quoted data", requests[0]["messages"][0]["content"])
        redacted = lead_analysis._redact_comment_for_ai(
            "邮箱 buyer@example.com，电话 13812345678，微信: buyer_123",
        )
        self.assertNotIn("buyer@example.com", redacted)
        self.assertNotIn("13812345678", redacted)
        self.assertNotIn("buyer_123", redacted)
        self.assertLessEqual(
            max(
                len(item["content"])
                for request in requests
                for item in json.loads(request["messages"][1]["content"])["comments"]
            ),
            lead_analysis.AI_COMMENT_MAX_CHARS,
        )

    async def test_invalid_ai_output_persists_sanitized_failed_state(self):
        self._save_analysis_snapshot()

        class Completions:
            def create(_self, **_kwargs):
                return SimpleNamespace(choices=[
                    SimpleNamespace(message=SimpleNamespace(content='{"items":[]}')),
                ])

        client = SimpleNamespace(
            chat=SimpleNamespace(completions=Completions()),
            close=lambda: None,
        )
        with (
            patch.object(lead_analysis, "LEAD_TRACKING_ANALYSIS_MODE", "ai"),
            patch.object(lead_analysis, "LEAD_TRACKING_AI_MODEL", "test-ai"),
            self.assertRaises(lead_analysis.LeadAnalysisProviderError),
        ):
            lead_analysis.analyze_comment_snapshot(
                self.owner["id"], self.project.id, "account-1", self.day,
                client=client,
            )

        failed = lead_analysis.get_lead_analysis(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.analysis_method, "ai")
        self.assertEqual(failed.model, "test-ai")
        self.assertEqual(failed.message, lead_analysis.ANALYSIS_FAILED_MESSAGE)
        self.assertNotIn('{"items":[]}', failed.model_dump_json())

    async def test_manual_review_survives_reanalysis_and_snapshot_refresh_invalidates_it(self):
        self._save_analysis_snapshot()
        lead_analysis.analyze_comment_snapshot(
            self.owner["id"], self.project.id, "account-1", self.day,
        )

        reviewed = lead_analysis.review_lead(
            self.owner["id"], self.project.id, "account-1",
            "buyer", "confirmed", self.day,
        )
        buyer = next(item for item in reviewed.items if item.comment_id == "buyer")
        self.assertEqual(buyer.review_status, "confirmed")
        self.assertTrue(buyer.reviewed_at)

        rerun = lead_analysis.analyze_comment_snapshot(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        buyer = next(item for item in rerun.items if item.comment_id == "buyer")
        self.assertEqual(buyer.review_status, "confirmed")

        self._save_analysis_snapshot()
        invalidated = lead_analysis.get_lead_analysis(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(invalidated.status, "unavailable")

    async def test_same_account_across_projects_shares_snapshot_analysis_and_review(self):
        self.assertNotEqual(self.account_key, self.foreign_key)
        second_project = storage.create_manual_project(
            self.owner["id"],
            title="Second project",
        )
        with storage._get_conn() as conn:
            blob = conn.execute(
                "SELECT credential_blob FROM project_channel_accounts WHERE id = ?",
                ("account-1",),
            ).fetchone()["credential_blob"]
        self._add_account("account-2", second_project.id, blob)
        second_account = lead_tracking._internal_account(
            second_project.id,
            "account-2",
        )
        self.assertIsNotNone(second_account)
        self.assertEqual(
            lead_identity.lead_account_key_from_row(second_account),
            self.account_key,
        )
        self._save_analysis_snapshot()
        lead_analysis.analyze_comment_snapshot(
            self.owner["id"], self.project.id, "account-1", self.day,
        )

        shared = lead_analysis.get_lead_analysis(
            self.owner["id"], second_project.id, "account-2", self.day,
        )
        self.assertEqual(shared.status, "completed")
        self.assertEqual(
            [item.comment_id for item in shared.items],
            ["buyer", "technical", "general"],
        )
        reviewed = lead_analysis.review_lead(
            self.owner["id"], second_project.id, "account-2",
            "buyer", "confirmed", self.day,
        )
        self.assertEqual(
            next(item for item in reviewed.items if item.comment_id == "buyer").review_status,
            "confirmed",
        )
        original = lead_analysis.get_lead_analysis(
            self.owner["id"], self.project.id, "account-1", self.day,
        )
        self.assertEqual(
            next(item for item in original.items if item.comment_id == "buyer").review_status,
            "confirmed",
        )
        foreign = lead_analysis.get_lead_analysis(
            self.outsider["id"], self.foreign.id, "foreign-account", self.day,
        )
        self.assertEqual(foreign.status, "unavailable")

        self._target()
        sync = AsyncMock()
        with patch.object(lead_tracking, "sync_account_comment_insight", sync):
            await lead_tracking.LeadTrackingCommentScheduler().run_once(self.day)
        sync.assert_awaited_once()

    def test_legacy_project_scoped_comments_migrate_to_account_scope(self):
        with storage._get_conn() as conn:
            conn.execute("""
                CREATE TABLE lead_tracking_comment_targets (
                    project_id TEXT, account_id TEXT, item_id TEXT,
                    discovered_at TEXT, last_seen_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE lead_tracking_comment_runs (
                    project_id TEXT, account_id TEXT, local_date TEXT,
                    timezone TEXT, status TEXT, is_simulated INTEGER,
                    limited INTEGER, message TEXT, comments_seen INTEGER,
                    last_synced_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE lead_tracking_comments (
                    project_id TEXT, account_id TEXT, local_date TEXT,
                    item_id TEXT, comment_id TEXT, comment_user_id TEXT,
                    content TEXT, create_time BIGINT, digg_count BIGINT,
                    reply_comment_total BIGINT, top INTEGER, raw_data TEXT
                )
            """)
            conn.execute(
                """
                INSERT INTO lead_tracking_comment_targets
                VALUES (?, 'account-1', 'legacy-item', '2026-10-04', '2026-10-05')
                """,
                (self.project.id,),
            )
            conn.execute(
                """
                INSERT INTO lead_tracking_comment_runs
                VALUES (?, 'account-1', ?, 'Asia/Shanghai', 'completed',
                        0, 0, 'legacy', 1, '2026-10-05T00:00:00Z')
                """,
                (self.project.id, self.day.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO lead_tracking_comments
                VALUES (?, 'account-1', ?, 'legacy-item', 'legacy-comment',
                        'viewer', 'legacy content', 1, 2, 3, 0, '{}')
                """,
                (self.project.id, self.day.isoformat()),
            )
            storage._initialize_account_lead_tracking(conn)
            migrated = conn.execute(
                """
                SELECT account_key, comment_id
                FROM lead_tracking_account_comments
                WHERE local_date = ?
                """,
                (self.day.isoformat(),),
            ).fetchone()
            self.assertEqual(
                (migrated["account_key"], migrated["comment_id"]),
                (self.account_key, "legacy-comment"),
            )
            self.assertEqual(
                conn.execute(
                    "PRAGMA table_info(lead_tracking_comment_runs)",
                ).fetchall(),
                [],
            )

    def test_preorganization_account_key_is_rekeyed_without_data_loss(self):
        with storage._get_conn() as conn:
            conn.execute(
                """
                UPDATE project_channel_accounts
                SET platform_user_id = 'unique-rekey-account'
                WHERE id = ? AND project_id = ?
                """,
                ("account-1", self.project.id),
            )
        account = lead_tracking._internal_account(self.project.id, "account-1")
        new_key = lead_identity.lead_account_key_from_row(account)
        old_key = lead_identity.legacy_lead_account_key(
            account["platform"], account["platform_user_id"], account["id"],
        )
        with storage._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO lead_tracking_account_comment_runs (
                    account_key, local_date, timezone, status, is_simulated,
                    limited, message, comments_seen, last_synced_at
                ) VALUES (?, ?, 'Asia/Shanghai', 'completed', 0, 0, '', 0, ?)
                """,
                (old_key, self.day.isoformat(), "2026-10-05T00:00:00Z"),
            )
            storage._initialize_account_lead_tracking(conn)
            self.assertIsNone(conn.execute(
                """
                SELECT 1 FROM lead_tracking_account_comment_runs
                WHERE account_key = ?
                """,
                (old_key,),
            ).fetchone())
            self.assertIsNotNone(conn.execute(
                """
                SELECT 1 FROM lead_tracking_account_comment_runs
                WHERE account_key = ?
                """,
                (new_key,),
            ).fetchone())

    async def test_analysis_routes_enforce_acl_and_review_exact_item(self):
        self._save_analysis_snapshot()
        path = (
            f"/api/v1/publishing/projects/{self.project.id}"
            "/channel-accounts/account-1/lead-tracking/analysis"
        )
        owner_headers = {
            "Authorization": "Bearer " + create_access_token(self.owner["id"]),
        }
        outsider_headers = {
            "Authorization": "Bearer " + create_access_token(self.outsider["id"]),
        }
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(
            self.client.post(
                path, params={"date": self.day.isoformat()},
                headers=outsider_headers,
            ).status_code,
            404,
        )

        response = self.client.post(
            path, params={"date": self.day.isoformat()}, headers=owner_headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(data["analyzed_count"], 3)
        self.assertEqual(data["pending_count"], 3)

        response = self.client.patch(
            path + "/buyer",
            params={"date": self.day.isoformat()},
            headers=owner_headers,
            json={"status": "confirmed"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["pending_count"], 2)
        buyer = next(
            item for item in response.json()["data"]["items"]
            if item["comment_id"] == "buyer"
        )
        self.assertEqual(buyer["review_status"], "confirmed")
        self.assertEqual(
            self.client.patch(
                path + "/missing",
                params={"date": self.day.isoformat()},
                headers=owner_headers,
                json={"status": "dismissed"},
            ).status_code,
            404,
        )

    async def test_resync_is_idempotent_and_preserves_raw_fields(self):
        self._target()
        created = int(datetime(2026, 10, 4, 12, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
        value = {"content": "first", "digg": 1}

        def handler(_request):
            return httpx.Response(200, json=self._payload([
                self._comment(
                    "same-id", created, content=value["content"], digg=value["digg"],
                ),
            ]))

        await self._sync(handler)
        value = {"content": "updated", "digg": 8}
        result, _ = await self._sync(handler)
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].content, "updated")
        self.assertEqual(result.items[0].digg_count, 8)
        with sqlite3.connect(self.db_path) as conn:
            count, raw = conn.execute(
                "SELECT COUNT(*), raw_data FROM lead_tracking_account_comments",
            ).fetchone()
        self.assertEqual(count, 1)
        self.assertEqual(json.loads(raw)["nick_name"], "preserved in raw data")

    async def test_no_provider_calls_when_disabled_missing_scope_synthetic_or_no_targets(self):
        calls = 0

        def handler(_request):
            nonlocal calls
            calls += 1
            return httpx.Response(500)

        with patch.object(lead_tracking, "LEAD_TRACKING_SYNC_ENABLED", False):
            result, _ = await self._sync(handler)
            self.assertEqual(result.status, "unavailable")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE project_channel_accounts SET scopes = '[]' WHERE id = 'account-1'",
            )
        self._target()
        result, _ = await self._sync(handler)
        self.assertEqual(result.status, "unavailable")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                UPDATE project_channel_accounts
                SET scopes = '["item.comment"]', platform_user_id = 'local-test-1',
                    credential_blob = ''
                WHERE id = 'account-1'
                """,
            )
        result, _ = await self._sync(handler)
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(calls, 0)

    async def test_no_targets_never_calls_provider(self):
        result, requests = await self._sync(
            lambda _request: httpx.Response(500),
        )
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(requests, [])

    async def test_provider_errors_are_strict_sanitized_and_size_bounded(self):
        self._target()

        def malformed(_request):
            return httpx.Response(200, json=self._payload([{
                "comment_id": "bad",
                "content": "missing fields",
            }]))

        result, _ = await self._sync(malformed)
        self.assertEqual(result.status, "failed")
        dumped = result.model_dump_json()
        self.assertNotIn(self.secret, dumped)
        self.assertNotIn("secret-refresh-token", dumped)

        def oversized(_request):
            return httpx.Response(
                200,
                headers={"content-length": str(lead_tracking.MAX_COMMENTS_PER_ACCOUNT * 10_000)},
                content=b"{}",
            )

        result, _ = await self._sync(oversized)
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.message, lead_tracking.PROVIDER_ERROR)

    async def test_safety_ceiling_marks_snapshot_partial(self):
        self._target()
        created = int(datetime(2026, 10, 4, 12, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp())
        with patch.object(lead_tracking, "MAX_PAGES_PER_ACCOUNT", 1):
            result, requests = await self._sync(
                lambda _request: httpx.Response(
                    200,
                    json=self._payload(
                        [self._comment("included", created)],
                        cursor=1,
                        has_more=True,
                    ),
                ),
            )
        self.assertEqual(len(requests), 1)
        self.assertEqual(result.status, "partial")
        self.assertTrue(result.limited)
        self.assertEqual([item.comment_id for item in result.items], ["included"])

    async def test_targets_register_only_after_successful_real_video_list(self):
        payload = {
            "data": {
                "list": [{
                    "item_id": "verified-item",
                    "title": "Real",
                    "create_time": 1_700_000_000,
                }],
                "cursor": 0,
                "has_more": False,
                "error_code": 0,
            },
        }
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(200, json=payload),
            ),
        ) as client:
            await account_content.get_account_content(
                self.owner["id"], self.project.id, "account-1", client=client,
            )
        self.assertEqual(
            lead_tracking._targets(self.account_key),
            ["verified-item"],
        )

        with (
            patch.object(
                account_content, "_platform_page",
                side_effect=account_content.AccountContentProviderError("provider"),
            ),
            self.assertRaises(account_content.AccountContentProviderError),
        ):
            await account_content.get_account_content(
                self.owner["id"], self.project.id, "account-1",
            )
        self.assertEqual(
            lead_tracking._targets(self.account_key),
            ["verified-item"],
        )

    async def test_get_route_enforces_current_org_project_acl_and_exact_dto(self):
        response = self.client.get(
            self.path,
            params={"date": self.day.isoformat()},
            headers={"Authorization": "Bearer " + create_access_token(self.owner["id"])},
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertEqual(set(data), {
            "status", "date", "timezone", "top_limit", "items",
            "is_simulated", "limited", "message", "last_synced_at",
        })
        self.assertEqual(data["status"], "unavailable")
        self.assertFalse(data["is_simulated"])
        self.assertEqual(data["top_limit"], 50)
        self.assertEqual(self.client.get(self.path).status_code, 401)
        self.assertEqual(
            self.client.get(
                self.path,
                headers={
                    "Authorization": "Bearer "
                    + create_access_token(self.outsider["id"]),
                },
            ).status_code,
            404,
        )
        foreign_path = (
            f"/api/v1/publishing/projects/{self.foreign.id}"
            "/channel-accounts/foreign-account/lead-tracking/comment-insights"
        )
        self.assertEqual(
            self.client.get(
                foreign_path,
                headers={
                    "Authorization": "Bearer "
                    + create_access_token(self.owner["id"]),
                },
            ).status_code,
            404,
        )

    def test_next_midnight_handles_timezone_and_dst(self):
        shanghai_now = datetime(2026, 10, 5, 15, 30, tzinfo=timezone.utc)
        self.assertEqual(
            lead_tracking.seconds_until_next_midnight(shanghai_now, "Asia/Shanghai"),
            1_800,
        )
        before_spring_forward = datetime(2026, 3, 8, 5, 0, tzinfo=timezone.utc)
        self.assertEqual(
            lead_tracking.seconds_until_next_midnight(
                before_spring_forward, "America/New_York",
            ),
            82_800,
        )
        before_fall_back = datetime(2026, 11, 1, 4, 0, tzinfo=timezone.utc)
        self.assertEqual(
            lead_tracking.seconds_until_next_midnight(
                before_fall_back, "America/New_York",
            ),
            90_000,
        )


if __name__ == "__main__":
    unittest.main()
