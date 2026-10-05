import asyncio
import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from cryptography.fernet import Fernet

from app.engines.publishing import channel_credentials, platform_publisher
from app.engines.publishing.platform_publisher import PlatformPublisher
from app.engines.publishing.publication_executor import (
    PublicationExecutionError,
    PublicationExecutor,
    PublicationResult,
)
from tests import test_publication_contents as contents_tests


class FakePublisher:
    def __init__(self, error=None):
        self.jobs = []
        self.error = error

    async def publish(self, job, before_submit):
        self.jobs.append(job)
        before_submit()
        if self.error:
            raise self.error
        return PublicationResult("platform-post-123", "platform-video-123")


class PublicationExecutorTests(unittest.IsolatedAsyncioTestCase):
    setUp = contents_tests.PublicationContentTests.setUp
    headers = contents_tests.PublicationContentTests.headers
    own_upload = contents_tests.PublicationContentTests.own_upload
    account = contents_tests.PublicationContentTests.account
    schedule = contents_tests.PublicationContentTests.schedule
    cancel = contents_tests.PublicationContentTests.cancel
    save_copy = contents_tests.PublicationContentTests.save_copy
    items = contents_tests.PublicationContentTests.items
    load_copy = contents_tests.PublicationContentTests.load_copy

    def executor(self, publisher=None):
        return PublicationExecutor(
            publisher or FakePublisher(),
            clock=lambda: datetime(2026, 10, 1, 11, tzinfo=timezone.utc),
        )

    def prepare(self):
        self.account()
        self.own_upload("a.png", b"a")
        self.own_upload("b.png", b"b")
        self.save_copy(title="Post title", content="Line one\nLine two")
        response = self.schedule()
        self.assertEqual(response.status_code, 200, response.text)

    def plan_detail(self):
        return self.client.get(self.path, headers=self.headers()).json()["data"]

    async def test_due_plan_publishes_once_records_result_and_locks_content(self):
        self.prepare()
        publisher = FakePublisher()
        executor = self.executor(publisher)
        before = self.items()
        self.assertTrue(await executor.run_once())
        self.assertFalse(await executor.run_once())
        self.assertEqual(len(publisher.jobs), 1)
        job = publisher.jobs[0]
        self.assertEqual(job.title, "Post title")
        self.assertEqual(job.content, "Line one\nLine two")
        self.assertEqual([asset.name for asset in job.assets], ["a.png", "b.png"])
        detail = self.plan_detail()
        self.assertEqual(detail["status"], "published")
        self.assertEqual(detail["platform_post_id"], "platform-post-123")
        self.assertEqual(detail["platform_video_id"], "platform-video-123")
        self.assertTrue(detail["published_at"])
        self.assertEqual(self.items(), before)
        self.assertEqual(self.save_copy(content="cannot change").status_code, 400)
        self.assertEqual(self.own_upload("extra.png").status_code, 400)
        self.assertEqual(self.client.patch(self.path, headers=self.headers(), json={"name": "Rename"}).status_code, 400)

    async def test_future_cancelled_and_draft_plans_are_not_published(self):
        self.prepare()
        executor = self.executor()
        self.cancel()
        self.client.patch(self.path, headers=self.headers(), json={"scheduled_for": "2026-10-02T10:00:00+08:00"})
        self.assertFalse(await executor.run_once())
        self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        self.assertFalse(await executor.run_once())
        self.client.patch(self.path, headers=self.headers(), json={"status": "draft", "scheduled_for": ""})
        self.assertFalse(await executor.run_once())

    async def test_failure_keeps_content_and_allows_manual_rescheduling(self):
        self.prepare()
        before = self.items()
        executor = self.executor(FakePublisher(PublicationExecutionError("Provider rejected post (code 1001)")))
        self.assertTrue(await executor.run_once())
        detail = self.plan_detail()
        self.assertEqual(detail["status"], "failed")
        self.assertIn("1001", detail["last_error"])
        self.assertFalse(detail["outcome_unknown"])
        self.assertEqual(self.items(), before)
        self.assertFalse(await executor.run_once())
        response = self.client.patch(self.path, headers=self.headers(), json={"scheduled_for": "2026-10-01T10:00:00Z"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["status"], "scheduled")
        self.assertTrue(await self.executor().run_once())
        self.assertEqual(self.plan_detail()["status"], "published")

    async def test_ambiguous_provider_result_is_failed_not_automatically_retried(self):
        self.prepare()
        publisher = FakePublisher(PublicationExecutionError("Verify platform before retry", outcome_unknown=True))
        executor = self.executor(publisher)
        self.assertTrue(await executor.run_once())
        self.assertTrue(self.plan_detail()["outcome_unknown"])
        self.assertFalse(await executor.run_once())
        self.assertEqual(len(publisher.jobs), 1)

    async def test_concurrent_claims_are_exclusive_and_freeze_snapshot(self):
        self.prepare()
        executor = self.executor()
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = list(pool.map(lambda _: executor.claim(), range(2)))
        self.assertEqual(sum(job is not None for job in jobs), 1)
        self.assertEqual(self.plan_detail()["status"], "publishing")
        self.assertEqual(self.save_copy(content="changed").status_code, 400)
        self.assertEqual(self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"}).status_code, 400)

    async def test_expired_submission_recovers_to_failed_without_duplicate_publication(self):
        self.prepare()
        executor = self.executor()
        job = executor.claim()
        self.assertIsNotNone(job)
        executor.before_submit(job)
        recovery = PublicationExecutor(FakePublisher(), clock=lambda: executor.clock() + timedelta(minutes=4))
        self.assertEqual(recovery.recover_expired(), 1)
        detail = self.plan_detail()
        self.assertEqual(detail["status"], "failed")
        self.assertTrue(detail["outcome_unknown"])
        self.assertFalse(await recovery.run_once())
        with self.assertRaises(PublicationExecutionError):
            executor.before_submit(job)

    async def test_heartbeat_prevents_recovery_and_pre_submit_crash_can_retry(self):
        self.prepare()
        executor = self.executor()
        job = executor.claim()
        self.assertIsNotNone(job)
        fresh = PublicationExecutor(FakePublisher(), clock=lambda: executor.clock() + timedelta(minutes=2))
        self.assertTrue(fresh.heartbeat(job))
        recovery = PublicationExecutor(FakePublisher(), clock=lambda: executor.clock() + timedelta(minutes=4))
        self.assertEqual(recovery.recover_expired(), 0)
        recovery.clock = lambda: executor.clock() + timedelta(minutes=6)
        self.assertEqual(recovery.recover_expired(), 1)
        self.assertFalse(self.plan_detail()["outcome_unknown"])

    async def test_no_credentials_are_exposed_in_public_plan_response(self):
        self.prepare()
        executor = self.executor()
        job = executor.claim()
        self.assertIsNotNone(job)
        detail = self.plan_detail()
        for key in ("credential_blob", "access_token", "refresh_token", "scopes"):
            self.assertNotIn(key, detail)

    async def test_graceful_stop_leaves_claim_for_safe_recovery(self):
        self.prepare()
        started = asyncio.Event()

        class BlockingPublisher:
            async def publish(self, job, before_submit):
                before_submit()
                started.set()
                await asyncio.Event().wait()

        executor = self.executor(BlockingPublisher())
        task = asyncio.create_task(executor.run_once())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(self.plan_detail()["status"], "publishing")

    async def test_real_adapter_pipeline_records_both_ids_and_freezes_saved_content(self):
        self.prepare()
        requests = []

        async def transport(request):
            requests.append(request.url.path)
            self.assertEqual(self.plan_detail()["status"], "publishing")
            self.assertEqual(self.save_copy(content="Cannot edit during upload").status_code, 400)
            if request.url.path.endswith("/upload_image/"):
                data = {"image": {"image_id": f"upload-{len(requests)}"}}
            else:
                data = {"item_id": "real-adapter-item", "video_id": "real-adapter-work"}
            return httpx.Response(200, json={"data": {"error_code": 0, **data}, "extra": {"error_code": 0}})

        with patch.object(channel_credentials, "CHANNEL_CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii")):
            credential_blob = channel_credentials.encrypt_channel_credentials({"access_token": "test-token", "open_id": "user"})
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("UPDATE project_channel_accounts SET credential_blob = ? WHERE id = 'account'", (credential_blob,))
            with patch.object(platform_publisher, "read_media_bytes", return_value=b"image"):
                async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                    self.assertTrue(await self.executor(PlatformPublisher(client=client)).run_once())
        detail = self.plan_detail()
        self.assertEqual(detail["status"], "published")
        self.assertEqual(detail["platform_post_id"], "real-adapter-item")
        self.assertEqual(detail["platform_video_id"], "real-adapter-work")
        self.assertEqual(len(requests), 3)
        self.assertEqual(self.save_copy(content="Cannot edit after publish").status_code, 400)


if __name__ == "__main__":
    unittest.main()
