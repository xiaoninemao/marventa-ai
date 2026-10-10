import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from app import media_storage
from app.engines.publishing import publication_contents, publication_plans, storage
from tests import test_publication_contents as contents_tests


class PublicationMediaModeTests(unittest.TestCase):
    setUp = contents_tests.PublicationContentTests.setUp
    headers = contents_tests.PublicationContentTests.headers
    create_work = contents_tests.PublicationContentTests.create_work
    select_work = contents_tests.PublicationContentTests.select_work
    items = contents_tests.PublicationContentTests.items
    load_copy = contents_tests.PublicationContentTests.load_copy
    account = contents_tests.PublicationContentTests.account
    schedule = contents_tests.PublicationContentTests.schedule
    cancel = contents_tests.PublicationContentTests.cancel
    migrate_to_memory = contents_tests.PublicationContentTests.migrate_to_memory

    def test_mode_is_derived_from_work_and_direct_mode_edits_are_rejected(self):
        self.assertEqual(self.plan["media_mode"], "image_text")
        for endpoint in (self.plans, self.path):
            response = self.client.request(
                "POST" if endpoint == self.plans else "PATCH", endpoint,
                headers=self.headers(), json={"project_id": self.project.id, "name": "Old", "media_mode": "video"},
            )
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.select_work(kind="video", assets=[("clip.mp4", b"video")]).status_code, 200)
        storage.init_db()
        current = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((current["media_mode"], current["video_count"]), ("video", 1))
        self.assertEqual(self.select_work().status_code, 200)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["media_mode"], "image_text")

    def test_selection_rejects_multiple_videos_before_writing_and_preserves_snapshot(self):
        self.assertEqual(self.select_work().status_code, 200)
        before, copy = self.items(), self.load_copy().json()["data"]
        invalid = self.create_work(kind="video", assets=[("first.mp4", b"one"), ("second.mp4", b"two")])
        with patch.object(publication_contents, "put_media_bytes") as put:
            response = self.select_work(invalid)
            self.assertEqual(response.status_code, 400, response.text)
            put.assert_not_called()
        self.assertEqual(self.items(), before)
        self.assertEqual(self.load_copy().json()["data"], copy)

    def test_video_schedule_locks_selection_and_cancelled_plan_can_be_rescheduled(self):
        self.account()
        self.assertEqual(self.select_work(kind="video", assets=[("clip.mp4", b"video")]).status_code, 200)
        self.assertEqual(self.schedule().status_code, 200)
        self.assertEqual(self.select_work().status_code, 400)
        self.cancel()
        before, copy = self.items(), self.load_copy().json()["data"]
        response = self.client.patch(self.path, headers=self.headers(), json={
            "channel_account_id": "account", "scheduled_for": "2026-10-03T12:30:00Z",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["status"], "scheduled")
        self.assertEqual(self.items(), before)
        self.assertEqual(self.load_copy().json()["data"], copy)

    def test_clearing_cancelled_schedule_returns_to_draft_without_changing_snapshot(self):
        self.account()
        self.assertEqual(self.select_work().status_code, 200)
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        before = self.items()
        response = self.client.patch(self.path, headers=self.headers(), json={"scheduled_for": ""})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["data"]["status"], response.json()["data"]["scheduled_for"]), ("draft", ""))
        self.assertEqual(self.items(), before)

    def test_empty_media_legacy_plans_cannot_schedule_even_with_copy(self):
        self.account()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET copy_text='Copy' WHERE id=?", (self.plan["id"],))
        self.assertEqual(self.schedule().status_code, 400)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET media_mode='video' WHERE id=?", (self.plan["id"],))
        self.assertEqual(self.schedule().status_code, 400)

    def test_concurrent_work_replacement_leaves_one_complete_snapshot_without_orphans(self):
        works = [self.create_work(kind="video", assets=[(f"clip{i}.mp4", bytes([i]))]) for i in range(2)]
        barrier = Barrier(2)

        def replace(work_id):
            barrier.wait(timeout=5)
            return publication_plans.select_publication_work(self.owner["id"], self.plan["id"], portfolio_id=work_id)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(replace, works))
        self.assertEqual([result.video_count for result in results], [1, 1])
        items = self.items()
        self.assertEqual(len(items), 1)
        keys = media_storage.list_media_keys("publishing")
        self.assertEqual(keys, [media_storage.media_key_from_url(items[0]["file_url"])])

    def test_migration_preserves_snapshot_positions_copy_and_media_mode(self):
        self.assertEqual(self.select_work(kind="video", assets=[("clip.mp4", b"video")]).status_code, 200)
        target = self.migrate_to_memory()
        row = target.execute("SELECT media_mode,copy_text FROM project_publications WHERE id=?", (self.plan["id"],)).fetchone()
        self.assertEqual(tuple(row), ("video", "Saved body"))
        self.assertEqual(target.execute("SELECT position FROM publication_contents").fetchone()[0], 0)
