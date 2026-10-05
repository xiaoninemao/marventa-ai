import json
import shutil
import sqlite3
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

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
    channel_oauth,
    storage,
)
from app.engines.publishing.project_memberships import ProjectNotFound


class AccountContentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = Path(__file__).parent / (".account-content-" + uuid.uuid4().hex)
        self.directory.mkdir()
        self.addCleanup(shutil.rmtree, self.directory)
        self.db_path = str(self.directory / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(
            channel_credentials, "CHANNEL_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode(),
        ))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "test-hash")
        self.member = auth_storage.create_user("member", "member@example.com", "test-hash")
        self.outsider = auth_storage.create_user("outsider", "outsider@example.com", "test-hash")
        self.project = storage.create_manual_project(self.owner["id"], title="Account content")
        self.other = storage.create_manual_project(self.owner["id"], title="Other accessible")
        self.foreign = storage.create_manual_project(self.outsider["id"], title="Foreign org")
        org = auth_storage.get_current_organization(self.owner["id"])["id"]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (org, self.member["id"]),
            )
            conn.execute(
                "UPDATE user_organization_preferences SET organization_id = ? WHERE user_id = ?",
                (org, self.member["id"]),
            )
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.foreign.id, self.owner["id"]),
            )
        self.inaccessible = storage.create_manual_project(self.member["id"], title="No membership")
        self.secret = "private-access-token"
        self.blob = channel_credentials.encrypt_channel_credentials({
            "access_token": self.secret, "refresh_token": "private-refresh-token", "open_id": "open-1",
        })
        self.add_account("account-1", self.project.id)
        self.add_account("other-account", self.other.id)
        self.add_account("foreign-account", self.foreign.id)
        self.add_account("inaccessible-account", self.inaccessible.id)
        app = FastAPI()
        app.include_router(publishing.router)
        self.client = self.enterContext(TestClient(app))
        self.base = "/api/v1/publishing"
        self.path = self.base + f"/projects/{self.project.id}/channel-accounts/account-1/content"

    def headers(self, user=None):
        return {"Authorization": "Bearer " + create_access_token((user or self.owner)["id"])}

    def add_account(self, account_id, project_id, platform="douyin"):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT INTO project_channel_accounts (
                    id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, scopes, credential_blob, authorization_status,
                    token_expires_at, created_at, updated_at
                ) VALUES (?, ?, ?, 'Creator', 'open-1', ?, ?, ?, 'active',
                          '2099-01-01 00:00:00', '2026-01-01', '2026-01-01')
            """, (account_id, project_id, platform, self.owner["id"], '["video.list"]', self.blob))

    def update_account(self, **values):
        with sqlite3.connect(self.db_path) as conn:
            for key, value in values.items():
                conn.execute(
                    f"UPDATE project_channel_accounts SET {key} = ? WHERE id = 'account-1'", (value,),
                )

    def response(self, **changes):
        data = {"list": [], "cursor": 0, "has_more": False, "error_code": 0}
        data.update(changes)
        return {"data": data}

    async def read(self, payload=None, *, handler=None, **kwargs):
        requests = []

        def transport(request):
            requests.append(request)
            return handler(request) if handler else httpx.Response(200, json=payload or self.response())

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            result = await account_content.get_account_content(
                self.owner["id"], self.project.id, "account-1", client=client, **kwargs,
            )
        return result, requests

    def assert_safe(self, value):
        text = json.dumps(value)
        for secret in (self.secret, "private-refresh-token", self.blob, "credential_blob", "access_token"):
            self.assertNotIn(secret, text)

    async def test_accounts_scoped_to_accessible_current_org_and_safe(self):
        response = self.client.get(self.base + "/account-content/accounts", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(set(payload), {"success", "message", "data"})
        self.assertEqual({a["id"] for a in payload["data"]}, {"account-1", "other-account"})
        self.assertEqual(payload["data"][0]["content_status"], "ready")
        self.assertEqual(payload["data"][0]["required_scope"], "video.list")
        self.assert_safe(payload)
        response = self.client.get(
            self.base + "/account-content/accounts", params={"project_id": self.project.id},
            headers=self.headers(),
        )
        self.assertEqual([a["id"] for a in response.json()["data"]], ["account-1"])

    async def test_content_route_serializes_exact_page_and_post_keys(self):
        post = account_content.AccountContentPost(id="remote-id")
        with patch.object(
            account_content, "_platform_page", new=AsyncMock(return_value=([post], "5", True)),
        ):
            response = self.client.get(self.path, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        page = response.json()["data"]
        self.assertEqual(set(page), {
            "account", "source", "status", "items", "next_cursor", "has_more",
            "page", "page_size", "limited", "message",
        })
        self.assertEqual(set(page["items"][0]), {
            "id", "title", "content", "cover_url", "image_urls", "video_url", "platform_video_id",
            "share_url", "published_at", "media_type",
            "visibility", "statistics", "plan_id",
        })
        self.assertEqual(set(page["items"][0]["statistics"]), {"likes", "comments", "views", "shares"})
        self.assertNotIn("favorites", page["items"][0]["statistics"])
        self.assertEqual(page["next_cursor"], "5")
        self.assert_safe(page)

    async def test_inaccessible_accounts_and_unauthenticated_never_call_provider(self):
        with patch.object(account_content, "_platform_page", new_callable=AsyncMock) as provider:
            self.assertEqual(self.client.get(self.path).status_code, 401)
            for project in (self.foreign, self.inaccessible):
                response = self.client.get(
                    self.base + "/account-content/accounts",
                    params={"project_id": project.id}, headers=self.headers(),
                )
                self.assertEqual(response.status_code, 404)
            for project, account in (
                (self.project, "other-account"), (self.project, "missing"),
                (self.foreign, "foreign-account"), (self.inaccessible, "inaccessible-account"),
            ):
                response = self.client.get(
                    self.base + f"/projects/{project.id}/channel-accounts/{account}/content",
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(self.client.get(
                self.path, headers=self.headers(self.outsider),
            ).status_code, 404)
            provider.assert_not_awaited()
        with self.assertRaises(ProjectNotFound):
            await account_content.get_account_content(
                self.owner["id"], self.project.id, "other-account",
            )

    async def test_explicit_unavailable_states_no_calls_and_no_status_mutation(self):
        for values, status in (
            ({"scopes": '["video.create.bind"]'}, "scope_required"),
            ({"scopes": "not-json"}, "scope_required"),
            ({"token_expires_at": "2020-01-01"}, "authorization_required"),
            ({"token_expires_at": ""}, "authorization_required"),
            ({"token_expires_at": "invalid"}, "authorization_required"),
            ({"credential_blob": ""}, "authorization_required"),
            ({"credential_blob": "invalid-encrypted-secret"}, "authorization_required"),
            ({"authorization_status": "expired"}, "authorization_required"),
            ({"platform": "xiaohongshu"}, "unsupported_platform"),
        ):
            with self.subTest(values=values):
                self.update_account(
                    platform="douyin", authorization_status="active", credential_blob=self.blob,
                    scopes='["video.list"]', token_expires_at="2099-01-01",
                )
                self.update_account(**values)
                result, requests = await self.read()
                self.assertEqual(result.status, status)
                self.assertEqual(result.account.content_status, status)
                self.assertEqual(result.items, [])
                self.assertEqual(requests, [])
                self.assert_safe(result.model_dump())
                with sqlite3.connect(self.db_path) as conn:
                    stored = conn.execute(
                        "SELECT authorization_status FROM project_channel_accounts WHERE id='account-1'",
                    ).fetchone()[0]
                self.assertEqual(stored, values.get("authorization_status", "active"))
        self.update_account(platform="douyin")
        with patch.object(channel_credentials, "CHANNEL_CREDENTIAL_ENCRYPTION_KEY", ""):
            result, requests = await self.read()
        self.assertEqual(result.status, "configuration_required")
        self.assertEqual(requests, [])

    async def test_exact_official_get_contract_and_types(self):
        result, requests = await self.read(self.response(
            list=[{
                "item_id": "post-1", "title": "Real title", "cover": "https://cdn.example.com/a.jpg",
                "share_url": "https://www.douyin.com/video/1", "create_time": 1571075129,
                "video_status": 4, "is_reviewed": True, "media_type": 2,
                "statistics": {"digg_count": 0, "play_count": 5, "download_count": 17, "forward_count": 23},
            }],
            cursor=9007199254740993, has_more=True,
        ))
        request = requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(str(request.url).split("?")[0], account_content.DOUYIN_CONTENT_URL)
        self.assertEqual(dict(request.url.params), {"open_id": "open-1", "count": "12", "cursor": "0"})
        self.assertEqual(request.headers["access-token"], self.secret)
        self.assertEqual(request.headers["Content-Type"], "application/json")
        self.assertEqual(request.content, b"")
        self.assertEqual(request.extensions["timeout"]["read"], 15.0)
        self.assertEqual(result.next_cursor, "9007199254740993")
        self.assertEqual(result.items[0].published_at, "2019-10-14T17:45:29Z")
        self.assertEqual(result.items[0].visibility, "reviewing")
        self.assertEqual(result.items[0].media_type, "image_text")
        self.assertEqual(result.items[0].statistics.model_dump(), {
            "likes": 0, "comments": None, "views": 5, "shares": None,
        })
        self.assertEqual(result.items[0].plan_id, "")
        self.assert_safe(result.model_dump())

    async def test_unknown_status_and_media_do_not_claim_published(self):
        items = [
            {"item_id": str(index), "video_status": status, "media_type": media, "is_reviewed": True}
            for index, (status, media) in enumerate(((1, 4), (2, 2), (99, 99), (True, True), ([], [])))
        ]
        result, _ = await self.read(self.response(list=items))
        self.assertEqual([p.visibility for p in result.items], [
            "published", "not_public", "unknown", "unknown", "unknown",
        ])
        self.assertEqual([p.media_type for p in result.items], [
            "video", "image_text", "unknown", "unknown", "unknown",
        ])
        self.assertTrue(all(p.statistics.views is None for p in result.items))

    async def test_platform_single_title_is_not_split_into_invented_content(self):
        text = "Platform title\nSecond line stays in the same field"
        result, _ = await self.read(self.response(list=[{"item_id": "post", "title": text}]))
        self.assertEqual(result.items[0].title, text)
        self.assertEqual(result.items[0].content, "")
        self.assertEqual(result.items[0].image_urls, [])
        self.assertEqual(result.items[0].video_url, "")

    async def test_cursor_and_count_bounds_rejected_before_calls(self):
        with patch.object(account_content, "_platform_page", new_callable=AsyncMock) as provider:
            for params in (
                {"source": "scrape"}, {"cursor": "-1"}, {"cursor": "1e2"},
                {"cursor": "9223372036854775808"}, {"cursor": "9" * 1000},
                {"cursor": "1"}, {"count": 0}, {"count": 25}, {"page": 0}, {"page": 5},
            ):
                response = self.client.get(self.path, params=params, headers=self.headers())
                self.assertEqual(response.status_code, 422, response.text)
            provider.assert_not_awaited()
        result, requests = await self.read(
            self.response(cursor=account_content.MAX_CURSOR, has_more=True),
            cursor="9007199254740993", count=24, page=4,
        )
        self.assertEqual(requests[0].url.params["cursor"], "9007199254740993")
        self.assertTrue(result.limited)
        self.assertTrue(result.has_more)
        self.assertIsNone(result.next_cursor)
        self.assertIn("four-page limit", result.message)

    async def test_public_urls_only_and_no_server_media_requests(self):
        for url in (
            "http://example.com/x", "javascript:alert(1)", "//example.com/x",
            "https://user:password@example.com/x", "https://127.0.0.1/x",
            "https://10.0.0.1/x", "https://[::1]/x", "https://localhost/x",
            "https://host.internal/x", "https://127.1/x", "https://2130706433/x",
            "https://example.com\\@127.0.0.1/x", "https://example.com/\nsecret",
            "https://example.com:8080/x", "https://%31%32%37.0.0.1/x",
        ):
            self.assertEqual(account_content.public_https_url(url), "", url)
        result, requests = await self.read(self.response(list=[{
            "item_id": "id", "cover": "https://10.0.0.1/private", "share_url": "javascript:alert(1)",
        }]))
        self.assertEqual(result.items[0].cover_url, "")
        self.assertEqual(result.items[0].share_url, "")
        self.assertEqual(len(requests), 1)

    async def test_invalid_token_or_account_binding_never_calls_provider(self):
        for credentials in (
            {"refresh_token": "private-refresh-token"},
            {"access_token": "private-access-token\r\nInjected: secret"},
            {"access_token": self.secret, "open_id": "different-account"},
        ):
            with self.subTest(credentials=credentials):
                self.update_account(
                    credential_blob=channel_credentials.encrypt_channel_credentials(credentials),
                )
                result, requests = await self.read()
                self.assertEqual(result.status, "authorization_required")
                self.assertEqual(requests, [])
                self.assert_safe(result.model_dump())

    async def test_provider_timeout_and_overlong_page_fail_safely(self):
        def timeout(request):
            raise httpx.ReadTimeout(self.secret, request=request)

        with self.assertRaises(account_content.AccountContentProviderError) as caught:
            await self.read(handler=timeout)
        self.assertEqual(str(caught.exception), account_content.PROVIDER_ERROR)
        with self.assertRaises(account_content.AccountContentProviderError):
            await self.read(self.response(list=[{"item_id": "id"}] * 2), count=1)

    async def test_provider_errors_invalid_json_structure_and_size_are_safe(self):
        payloads = [
            [], {}, {"data": []}, self.response(error_code=42, description=self.secret),
            {"data": self.response()["data"], "extra": {"error_code": 42}},
            self.response(list={}), self.response(has_more=1),
            self.response(cursor="123"), self.response(cursor=-1),
            self.response(cursor=account_content.MAX_CURSOR + 1),
            self.response(has_more=True, cursor=0), self.response(list=[{}]),
            self.response(list=[{"item_id": "id", "statistics": {"play_count": -1}}]),
            self.response(list=[{"item_id": "id", "statistics": []}]),
            self.response(list=[{"item_id": "id", "title": {}}]),
        ]
        for payload in payloads:
            with self.subTest(payload=payload), self.assertRaises(
                account_content.AccountContentProviderError,
            ) as caught:
                await self.read(handler=lambda request, payload=payload: httpx.Response(200, json=payload))
            self.assertEqual(str(caught.exception), account_content.PROVIDER_ERROR)
            self.assertNotIn(self.secret, str(caught.exception))
        for response in (
            httpx.Response(200, content=b"invalid-json-with-private-access-token"),
            httpx.Response(403, content=self.secret.encode()),
            httpx.Response(302, headers={"location": "https://evil.example.com"}),
            httpx.Response(200, content=b"x" * (account_content.MAX_RESPONSE_BYTES + 1)),
        ):
            with self.assertRaises(account_content.AccountContentProviderError):
                await self.read(handler=lambda request, response=response: response)
        with patch.object(
            account_content, "_platform_page",
            new=AsyncMock(side_effect=account_content.AccountContentProviderError(self.secret)),
        ):
            response = self.client.get(self.path, headers=self.headers())
        self.assertEqual(response.status_code, 502)
        self.assert_safe(response.json())

    async def test_local_accepted_records_separate_from_remote_no_fallback(self):
        with sqlite3.connect(self.db_path) as conn:
            for plan_id, project, account, status in (
                ("accepted-plan", self.project.id, "account-1", "published"),
                ("draft-plan", self.project.id, "account-1", "draft"),
                ("other-plan", self.other.id, "other-account", "published"),
            ):
                conn.execute("""
                    INSERT INTO project_publications (
                        id, project_id, portfolio_id, channel_account_id, created_by_user_id,
                        status, name, copy_title, copy_text, created_at, updated_at
                    ) VALUES (?, ?, '', ?, ?, ?, 'Plan name', 'Actual title', ?, '2026-01-01', '2026-01-01')
                """, (plan_id, project, account, self.owner["id"], status, "Actual content\nSecond paragraph"))
            conn.execute("""
                INSERT INTO publication_executions (
                    plan_id, attempt_id, state, started_at, heartbeat_at, published_at, platform_post_id
                ) VALUES ('accepted-plan', 'attempt', 'succeeded', '2026-01-01', '2026-01-01',
                          '2026-01-01 12:00:00', 'unverified-id')
            """)
            for image_id, key, position in (("second", "snapshot/second.png", 1), ("first", "snapshot/first.png", 0)):
                conn.execute("""
                    INSERT INTO publication_contents (
                        id, plan_id, name, media_type, mime_type, object_key, position, created_at, updated_at
                    ) VALUES (?, 'accepted-plan', 'Image', 'image', 'image/png', ?, ?, '2026-01-01', '2026-01-01')
                """, (image_id, key, position))
        self.update_account(scopes="[]")
        result, requests = await self.read(source="marventa", base_url="https://app.example.com")
        self.assertEqual(requests, [])
        self.assertEqual(result.status, "ready")
        self.assertEqual(result.account.content_status, "scope_required")
        self.assertEqual([p.id for p in result.items], ["accepted-plan"])
        post = result.items[0]
        self.assertEqual(post.title, "Actual title")
        self.assertEqual(post.content, "Actual content\nSecond paragraph")
        self.assertEqual(post.plan_id, "accepted-plan")
        self.assertEqual(post.visibility, "accepted")
        self.assertEqual(post.share_url, "")
        self.assertEqual(post.cover_url, "https://app.example.com/media/snapshot/first.png")
        self.assertEqual(post.image_urls, [
            "https://app.example.com/media/snapshot/first.png",
            "https://app.example.com/media/snapshot/second.png",
        ])
        self.assertEqual(post.published_at, "2026-01-01T12:00:00Z")
        self.assertIsNone(post.statistics.likes)
        for base_url in ("http://127.0.0.1:8765", "http://localhost:8765", "https://app.example.com"):
            with self.subTest(base_url=base_url):
                local, local_requests = await self.read(source="marventa", base_url=base_url)
                self.assertEqual(local_requests, [])
                self.assertEqual(local.items[0].cover_url, f"{base_url}/media/snapshot/first.png")
                self.assertEqual(local.items[0].image_urls, [
                    f"{base_url}/media/snapshot/first.png",
                    f"{base_url}/media/snapshot/second.png",
                ])
        response = self.client.get(self.path, params={"source": "marventa"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["items"][0]["image_urls"], [
            "http://testserver/media/snapshot/first.png",
            "http://testserver/media/snapshot/second.png",
        ])
        result, requests = await self.read(source="platform")
        self.assertEqual(result.status, "scope_required")
        self.assertEqual(result.items, [])
        self.assertEqual(requests, [])
        self.update_account(scopes='["video.list"]')
        result, _ = await self.read(self.response())
        self.assertEqual(result.items, [])
        with self.assertRaises(account_content.AccountContentProviderError):
            await self.read(handler=lambda request: httpx.Response(403, content=self.secret.encode()))

    async def test_local_video_media_is_scoped_and_playable_without_platform_read_access(self):
        with sqlite3.connect(self.db_path) as conn:
            for plan_id, project, account, status in (
                ("own-video", self.project.id, "account-1", "published"),
                ("draft-video", self.project.id, "account-1", "draft"),
                ("other-video", self.other.id, "other-account", "published"),
            ):
                conn.execute("""
                    INSERT INTO project_publications (
                        id, project_id, portfolio_id, channel_account_id, created_by_user_id,
                        status, name, media_mode, created_at, updated_at
                    ) VALUES (?, ?, '', ?, ?, ?, 'Video', 'video', '2026-01-01', '2026-01-01')
                """, (plan_id, project, account, self.owner["id"], status))
                conn.execute("""
                    INSERT INTO publication_contents (
                        id, plan_id, name, media_type, mime_type, object_key, position, created_at, updated_at
                    ) VALUES (?, ?, 'Video', 'video', 'video/mp4', ?, 0, '2026-01-01', '2026-01-01')
                """, (f"{plan_id}-media", plan_id, f"snapshot/{plan_id} clip.mp4"))
        self.update_account(scopes="[]")
        for base_url in ("http://127.0.0.1:8765", "https://app.example.com"):
            with self.subTest(base_url=base_url):
                result, requests = await self.read(source="marventa", base_url=base_url)
                self.assertEqual(requests, [])
                self.assertEqual([post.id for post in result.items], ["own-video"])
                self.assertEqual(result.items[0].media_type, "video")
                self.assertEqual(result.items[0].video_url, f"{base_url}/media/snapshot/own-video%20clip.mp4")
                self.assertEqual(result.items[0].image_urls, [])
        response = self.client.get(self.path, params={"source": "marventa"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["items"][0]["video_url"],
                         "http://testserver/media/snapshot/own-video%20clip.mp4")

    async def test_platform_video_ids_remain_exact_strings_and_only_enable_public_video_embedding(self):
        base = {"item_id": "post", "video_id": 9007199254740993, "media_type": 4, "video_status": 1}
        post = account_content._parse_post(base)
        self.assertEqual(post.platform_video_id, "9007199254740993")
        self.assertEqual(post.video_url, "")
        for changes in (
            {"video_id": True}, {"video_id": -1}, {"video_id": "123"}, {"video_id": 1.5},
            {"video_id": account_content.MAX_CURSOR + 1}, {"media_type": 2},
            {"media_type": 4.0}, {"video_status": True}, {"video_status": 4}, {"video_status": 2},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(account_content._parse_post({**base, **changes}).platform_video_id, "")

    async def test_official_iframe_request_uses_public_video_id_without_tokens_and_returns_only_safe_url(self):
        self.update_account(scopes="[]", credential_blob="")
        requests = []
        video_id = "9007199254740993"

        def transport(request):
            requests.append(request)
            return httpx.Response(200, json={
                "err_no": 0, "err_msg": "", "data": {
                    "iframe_code": f'<script>{self.secret}</script><iframe onload="bad()" '
                                   f'src="https://open.douyin.com/player/video?vid={video_id}&amp;autoplay=1"></iframe>',
                },
            })

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            result = await account_content.get_account_content_player(
                self.owner["id"], self.project.id, "account-1", video_id, client=client,
            )
        request = requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(str(request.url).split("?")[0], account_content.DOUYIN_PLAYER_URL)
        self.assertEqual(dict(request.url.params), {"video_id": video_id})
        self.assertNotIn("access-token", request.headers)
        self.assertNotIn("authorization", request.headers)
        self.assertEqual(request.content, b"")
        self.assertEqual(request.extensions["timeout"]["read"], 15.0)
        self.assertEqual(result.model_dump(), {
            "video_id": video_id,
            "player_url": f"https://open.douyin.com/player/video?vid={video_id}&autoplay=0",
        })
        self.assert_safe(result.model_dump())

    async def test_iframe_api_rechecks_account_scope_and_input_before_external_requests(self):
        with patch.object(account_content, "_get_provider_json", new_callable=AsyncMock) as provider:
            path = self.path + "/player"
            self.assertEqual(self.client.get(path, params={"video_id": "123"}).status_code, 401)
            for user in (self.outsider, self.member):
                response = self.client.get(path, params={"video_id": "123"}, headers=self.headers(user))
                self.assertEqual(response.status_code, 404)
            for value in ("", "0", "-1", "1e2", "123&autoplay=1", str(account_content.MAX_CURSOR + 1)):
                self.assertEqual(self.client.get(path, params={"video_id": value}, headers=self.headers()).status_code, 422)
            self.update_account(platform="xiaohongshu")
            self.assertEqual(self.client.get(path, params={"video_id": "123"}, headers=self.headers()).status_code, 422)
            provider.assert_not_awaited()
        self.update_account(platform="douyin")
        with patch.object(account_content, "_get_provider_json", new_callable=AsyncMock) as provider:
            provider.return_value = {"err_no": 0, "data": {
                "iframe_code": '<iframe src="https://open.douyin.com/player/video?vid=123"></iframe>',
            }}
            response = self.client.get(self.path + "/player", params={"video_id": "123"}, headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["player_url"], "https://open.douyin.com/player/video?vid=123&autoplay=0")

    async def test_iframe_response_errors_and_unsafe_sources_are_rejected_without_leaking_provider_data(self):
        video_id = "123"
        codes = [
            "", "<iframe></iframe>", '<iframe src="javascript:alert(1)"></iframe>',
            '<iframe src="http://open.douyin.com/player/video?vid=123"></iframe>',
            '<iframe src="https://attacker.example.com/player/video?vid=123"></iframe>',
            '<iframe src="https://open.douyin.com/other?vid=123"></iframe>',
            '<iframe src="https://open.douyin.com/player/video?vid=456"></iframe>',
            '<iframe src="https://open.douyin.com/player/video?vid=123&amp;vid=456"></iframe>',
            '<iframe src="https://open.douyin.com/player/video?vid=123#fragment"></iframe>',
            '<iframe src="https://open.douyin.com/player/video?vid=123"></iframe>' * 2,
        ]
        payloads = [{"err_no": 0, "data": {"iframe_code": code}} for code in codes]
        payloads += [
            [], {}, {"err_no": True, "data": {}},
            {"err_no": 28003004, "err_msg": self.secret, "data": {}},
            {"err_no": 0, "data": []}, {"err_no": 0, "data": {"iframe_code": 123}},
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                async with httpx.AsyncClient(transport=httpx.MockTransport(
                    lambda request, payload=payload: httpx.Response(200, json=payload),
                )) as client:
                    with self.assertRaises(account_content.AccountContentProviderError) as caught:
                        await account_content.get_account_content_player(
                            self.owner["id"], self.project.id, "account-1", video_id, client=client,
                        )
                self.assertEqual(str(caught.exception), account_content.PLAYER_ERROR)
        for response in (
            httpx.Response(302, headers={"location": "https://attacker.example.com"}),
            httpx.Response(200, content=b"x" * (account_content.MAX_PLAYER_RESPONSE_BYTES + 1)),
            httpx.Response(200, content=self.secret.encode()),
        ):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request, response=response: response,
            )) as client:
                with self.assertRaises(account_content.AccountContentProviderError):
                    await account_content.get_account_content_player(
                        self.owner["id"], self.project.id, "account-1", video_id, client=client,
                    )
        with patch.object(account_content, "_get_provider_json", new_callable=AsyncMock) as provider:
            provider.side_effect = account_content.AccountContentProviderError(self.secret)
            result = self.client.get(self.path + "/player", params={"video_id": video_id}, headers=self.headers())
        self.assertEqual(result.status_code, 502)
        self.assert_safe(result.json())

    async def test_local_history_paginates_beyond_four_pages_without_truncation(self):
        with sqlite3.connect(self.db_path) as conn:
            for index in range(6):
                conn.execute("""
                    INSERT INTO project_publications (
                        id, project_id, portfolio_id, channel_account_id, created_by_user_id,
                        status, name, created_at, updated_at
                    ) VALUES (?, ?, '', 'account-1', ?, 'published', ?, '2026-01-01', '2026-01-01')
                """, (f"history-{index}", self.project.id, self.owner["id"], f"History {index}"))
        cursor = "0"
        seen = []
        with patch.object(account_content, "_platform_page", new_callable=AsyncMock) as provider:
            for page in range(1, 7):
                response = self.client.get(
                    self.path,
                    params={"source": "marventa", "count": 1, "page": page, "cursor": cursor},
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()["data"]
                self.assertFalse(data["limited"])
                self.assertEqual(data["has_more"], page < 6)
                self.assertNotIn("four-page limit", data["message"])
                seen.extend(item["id"] for item in data["items"])
                self.assertTrue(all(item["visibility"] == "accepted" for item in data["items"]))
                if page < 6:
                    self.assertIsInstance(data["next_cursor"], str)
                    cursor = data["next_cursor"]
                else:
                    self.assertIsNone(data["next_cursor"])
            self.assertEqual(len(set(seen)), 6)
            for invalid_cursor in ("-1", "9223372036854775808", "not-an-offset"):
                response = self.client.get(
                    self.path,
                    params={"source": "marventa", "page": 5, "cursor": invalid_cursor},
                    headers=self.headers(),
                )
                self.assertEqual(response.status_code, 422)
            response = self.client.get(
                self.path, params={"source": "platform", "page": 5, "cursor": "4"},
                headers=self.headers(),
            )
            self.assertEqual(response.status_code, 422)
            provider.assert_not_awaited()

    async def test_optional_oauth_scope_validation_and_actual_grant_required(self):
        for invalid in ("", "video.list", "user_info,", "user_info,user_info", "user_info,video.list\r\nsecret"):
            with (
                patch.object(channel_oauth, "DOUYIN_CHANNEL_SCOPES", invalid),
                self.assertRaises(channel_oauth.ChannelOAuthConfigurationError),
            ):
                channel_oauth.configured_douyin_scopes()
        with (
            patch.multiple(
                channel_oauth,
                DOUYIN_CHANNEL_SCOPES="user_info,video.create.bind,video.list",
                DOUYIN_CHANNEL_CLIENT_KEY="key", DOUYIN_CHANNEL_CLIENT_SECRET="secret",
                DOUYIN_CHANNEL_REDIRECT_URI="https://app.example.com/oauth",
            ),
            patch.object(channel_oauth, "ensure_channel_credential_encryption"),
            patch.object(channel_oauth, "ensure_project_channel_access"),
            patch.object(channel_oauth, "create_channel_authorization_state", return_value="state"),
        ):
            start = await channel_oauth.start_channel_authorization(self.owner["id"], self.project.id, "douyin")
            scopes = parse_qs(urlsplit(start.authorization_url).query)["scope"]
            self.assertEqual(scopes, ["user_info,video.create.bind,video.list"])
            self.update_account(scopes='["user_info","video.create.bind"]')
            result, requests = await self.read()
        self.assertEqual(result.status, "scope_required")
        self.assertEqual(requests, [])


if __name__ == "__main__":
    unittest.main()
