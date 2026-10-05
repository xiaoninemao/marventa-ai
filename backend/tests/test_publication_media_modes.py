import sqlite3
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from app import media_storage
from app.auth import storage as auth_storage
from app.engines.publishing import publication_contents, publication_plans, storage
from tests import test_publication_contents as contents_tests


class PublicationMediaModeTests(unittest.TestCase):
    setUp = contents_tests.PublicationContentTests.setUp
    headers = contents_tests.PublicationContentTests.headers
    own_upload = contents_tests.PublicationContentTests.own_upload
    upload = contents_tests.PublicationContentTests.upload
    pick = contents_tests.PublicationContentTests.pick
    items = contents_tests.PublicationContentTests.items
    delete_item = contents_tests.PublicationContentTests.delete_item
    save_copy = contents_tests.PublicationContentTests.save_copy
    load_copy = contents_tests.PublicationContentTests.load_copy
    account = contents_tests.PublicationContentTests.account
    schedule = contents_tests.PublicationContentTests.schedule
    cancel = contents_tests.PublicationContentTests.cancel
    migrate_to_memory = contents_tests.PublicationContentTests.migrate_to_memory

    def mode(self, value, user=None):
        return self.client.patch(self.path, headers=self.headers(user), json={"media_mode": value})

    def order(self, ids, user=None):
        return self.client.patch(
            self.contents + "/order", headers=self.headers(user), json={"content_ids": ids},
        )

    def test_mode_defaults_create_validation_and_persistence(self):
        self.assertEqual(self.plan["media_mode"], "image_text")
        created = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Video plan", "media_mode": "video",
        })
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["data"]["media_mode"], "video")
        self.assertEqual(self.mode("invalid").status_code, 422)
        self.assertEqual(self.mode(None).status_code, 422)
        self.assertEqual(self.mode("video").status_code, 200)
        storage.init_db()
        plan = self.client.patch(self.path, headers=self.headers(), json={"note": "Saved"}).json()["data"]
        self.assertEqual(plan["media_mode"], "video")
        listed = self.client.get(self.plans, headers=self.headers()).json()["data"]
        self.assertEqual(next(p for p in listed if p["id"] == self.plan["id"])["media_mode"], "video")

    def test_switch_incompatible_media_rejected_without_deletion_or_copy_changes(self):
        copy = self.save_copy().json()["data"]
        document = self.own_upload("copy.txt", b"Snapshot").json()["data"]
        image = self.own_upload().json()["data"]
        before = self.items()
        response = self.mode("video")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Video mode does not support images")
        self.assertEqual(self.items(), before)
        self.assertEqual(self.delete_item(image).status_code, 200)
        self.assertEqual(self.mode("video").status_code, 200)
        video = self.own_upload("clip.mp4", b"video").json()["data"]
        self.assertEqual(self.mode("image_text").json()["detail"], "Image-text mode does not support videos")
        self.assertEqual(self.delete_item(video).status_code, 200)
        self.assertEqual(self.mode("image_text").status_code, 200)
        self.assertEqual(self.load_copy().json()["data"], copy)
        self.assertEqual([item["id"] for item in self.items()], [document["id"]])

    def test_upload_mode_and_video_maximum_enforced_before_storage_writes(self):
        with patch.object(publication_contents, "put_media_bytes") as put:
            wrong = self.own_upload("clip.mp4", b"video")
            self.assertEqual(wrong.status_code, 400)
            put.assert_not_called()
        self.mode("video")
        self.assertEqual(self.own_upload().status_code, 400)
        first = self.own_upload("clip.mp4", b"first")
        self.assertEqual(first.status_code, 200, first.text)
        with patch.object(publication_contents, "put_media_bytes") as put:
            second = self.own_upload("second.mp4", b"second")
            self.assertEqual(second.status_code, 400)
            self.assertEqual(second.json()["detail"], "Video mode supports only one video")
            put.assert_not_called()
        self.assertEqual(self.own_upload("doc.txt", b"Document").status_code, 200)
        self.assertEqual(self.save_copy().status_code, 200)
        self.assertEqual(self.delete_item(first.json()["data"]).status_code, 200)
        self.assertEqual(self.own_upload("replacement.mp4", b"replacement").status_code, 200)

    def test_bulk_import_rejects_wrong_types_and_multiple_videos_atomically(self):
        image = self.upload("source.png", b"image").json()["data"]
        video = self.upload("source.mp4", b"video").json()["data"]
        second_video = self.upload("second.mp4", b"video2").json()["data"]
        doc = self.upload("source.txt", b"Document").json()["data"]
        with patch.object(publication_contents, "put_media_bytes") as put:
            self.assertEqual(self.pick(doc["id"], image["id"], video["id"]).status_code, 400)
            self.assertEqual(self.items(), [])
            put.assert_not_called()
        self.mode("video")
        for ids in ((doc["id"], image["id"]), (video["id"], second_video["id"])):
            self.assertEqual(self.pick(*ids).status_code, 400)
            self.assertEqual(self.items(), [])
        added = self.pick(doc["id"], video["id"])
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual([item["position"] for item in added.json()["data"]], [0, 1])
        self.assertEqual(self.pick(second_video["id"]).status_code, 400)
        self.assertEqual(len(self.items()), 2)
        self.assertTrue(media_storage.media_exists(video["object_key"]))

    def test_video_schedule_requires_one_video_and_cancellation_before_deletion(self):
        self.account()
        self.save_copy()
        self.assertEqual(self.schedule().status_code, 200)
        self.assertEqual(
            self.mode("video").json()["detail"], "Scheduled plans cannot be edited; cancel the schedule first",
        )
        self.cancel()
        self.client.patch(self.path, headers=self.headers(), json={"status": "draft", "scheduled_for": ""})
        self.mode("video")
        self.own_upload("doc.txt", b"Document")
        self.assertEqual(self.schedule().json()["detail"], "Video mode requires one video to schedule")
        video = self.own_upload("clip.mp4", b"video").json()["data"]
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        self.assertEqual(self.save_copy(content="").status_code, 200)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "cancelled")
        self.save_copy()
        self.assertEqual(self.delete_item(video).status_code, 200)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["status"], plan["has_copy"]), ("cancelled", True))
        self.assertEqual((plan["media_mode"], plan["video_count"]), ("video", 0))
        self.assertEqual(plan["document_count"], 2)
        self.assertEqual(self.mode("image_text").status_code, 200)
        self.assertEqual(self.schedule().status_code, 200)

    def test_cancelled_video_plan_can_be_rescheduled_without_explicit_status(self):
        self.account()
        self.mode("video")
        video = self.own_upload("clip.mp4", b"video").json()["data"]
        self.save_copy()
        self.assertEqual(self.schedule().status_code, 200)
        cancelled = self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()["data"]["status"], "cancelled")
        items_before = self.items()
        copy_before = self.load_copy().json()["data"]
        for schedule in ("2026-10-01T10:00:00Z", "2026-10-02T12:30:00Z"):
            with self.subTest(schedule=schedule):
                self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
                response = self.client.patch(self.path, headers=self.headers(), json={
                    "channel_account_id": "account", "scheduled_for": schedule,
                })
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["data"]["status"], "scheduled")
                self.assertEqual(response.json()["data"]["scheduled_for"], schedule)
                self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "scheduled")
                self.assertEqual(self.items(), items_before)
                self.assertEqual(self.load_copy().json()["data"], copy_before)
        self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        self.assertEqual(self.delete_item(video).status_code, 200)
        rejected = self.client.patch(self.path, headers=self.headers(), json={
            "channel_account_id": "account", "scheduled_for": "2026-10-03T12:30:00Z",
        })
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertEqual(rejected.json()["detail"], "Video mode requires one video to schedule")
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "cancelled")

    def test_cancelled_schedule_settings_without_time_returns_to_draft(self):
        self.account()
        self.own_upload()
        self.assertEqual(self.schedule().status_code, 200)
        self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        unchanged = self.client.patch(self.path, headers=self.headers(), json={"note": "Keep cancelled"})
        self.assertEqual(unchanged.json()["data"]["status"], "cancelled")
        response = self.client.patch(self.path, headers=self.headers(), json={"scheduled_for": ""})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["status"], "draft")
        self.assertEqual(response.json()["data"]["scheduled_for"], "")

    def test_order_persists_preserves_document_slots_and_dates_and_appends_after_max(self):
        first = self.own_upload("first.png").json()["data"]
        doc = self.own_upload("middle.txt", b"Document").json()["data"]
        second = self.own_upload("second.png").json()["data"]
        third = self.own_upload("third.png").json()["data"]
        before = {item["id"]: item for item in self.items()}
        response = self.order([third["id"], first["id"], second["id"]])
        self.assertEqual(response.status_code, 200, response.text)
        expected_ids = [third["id"], doc["id"], first["id"], second["id"]]
        self.assertEqual([item["id"] for item in response.json()["data"]], expected_ids)
        storage.init_db()
        self.assertEqual([item["id"] for item in self.items()], expected_ids)
        self.assertEqual(next(i for i in self.items() if i["id"] == doc["id"]), doc)
        for item in self.items():
            for field in ("name", "created_at", "updated_at", "source_material_id", "file_url"):
                self.assertEqual(item[field], before[item["id"]][field])
        self.delete_item(first)
        appended = self.own_upload("last.png").json()["data"]
        self.assertEqual(appended["position"], 4)
        self.assertEqual(self.items()[-1]["id"], appended["id"])
        self.delete_item(appended)
        replacement = self.own_upload("replacement.png").json()["data"]
        self.assertEqual(replacement["position"], max(item["position"] for item in self.items()))

    def test_order_rejects_incomplete_duplicate_foreign_and_nonimage_ids_atomically(self):
        first = self.own_upload("first.png").json()["data"]
        second = self.own_upload("second.png").json()["data"]
        doc = self.own_upload("copy.txt", b"Document").json()["data"]
        other = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Other",
        }).json()["data"]
        foreign = self.client.post(
            f"{self.plans}/{other['id']}/contents", headers=self.headers(),
            files={"file": ("foreign.png", b"image")},
        ).json()["data"]
        before = self.items()
        for ids in (
            [], [first["id"]], [first["id"], first["id"]],
            [first["id"], "missing"], [first["id"], foreign["id"]],
            [first["id"], second["id"], doc["id"]],
            [first["id"], second["id"], "missing"],
        ):
            response = self.order(ids)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "Image order must include every current image exactly once")
            self.assertEqual(self.items(), before)
        for item in (first, second):
            self.delete_item(item)
        self.assertEqual(self.order([]).json()["data"], [doc])
        self.mode("video")
        self.assertEqual(self.order([]).json()["detail"], "Image ordering is only available in image-text mode")

    def test_order_permissions_current_organization_and_published_plan(self):
        item = self.own_upload().json()["data"]
        self.assertEqual(self.order([item["id"]], self.member).status_code, 403)
        self.assertEqual(self.mode("image_text", self.member).status_code, 403)
        self.assertEqual(self.order([item["id"]], self.admin).status_code, 200)
        self.assertEqual(self.order([item["id"]], self.outsider).status_code, 404)
        self.assertEqual(self.client.patch(self.contents + "/order", json={"content_ids": []}).status_code, 401)
        organization = auth_storage.get_current_organization(self.owner["id"])
        other = auth_storage.create_organization(self.owner["id"], "Order organization")
        auth_storage.switch_organization(self.owner["id"], other["id"])
        self.assertEqual(self.order([item["id"]]).status_code, 404)
        self.assertEqual(self.mode("image_text").status_code, 404)
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET status = 'published' WHERE id = ?", (self.plan["id"],))
        self.assertEqual(self.order([item["id"]]).status_code, 400)
        self.assertEqual(self.mode("image_text").status_code, 400)
        self.assertEqual(len(self.items()), 1)

    def test_order_rollback_on_database_failure(self):
        first = self.own_upload("first.png").json()["data"]
        second = self.own_upload("second.png").json()["data"]
        before = self.items()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TRIGGER reject_second_position BEFORE UPDATE OF position ON publication_contents "
                f"WHEN NEW.id = '{first['id']}' BEGIN SELECT RAISE(ABORT, 'reject position'); END",
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.order([second["id"], first["id"]])
        self.assertEqual(self.items(), before)

    def test_legacy_migration_infers_mode_orders_rows_and_keeps_invalid_media(self):
        self.save_copy()
        other = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Video legacy",
        }).json()["data"]
        rows = [
            ("c", self.plan["id"], "video", "2026-01-01"),
            ("a", self.plan["id"], "image", "2026-01-01"),
            ("b", self.plan["id"], "document", "2025-01-01"),
            ("video-b", other["id"], "video", "2026-01-01"),
            ("video-a", other["id"], "video", "2026-01-01"),
        ]
        with sqlite3.connect(self.db_path) as conn:
            for item_id, plan_id, kind, created in rows:
                conn.execute(
                    "INSERT INTO publication_contents "
                    "(id, plan_id, name, media_type, mime_type, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 'legacy', ?, ?)",
                    (item_id, plan_id, item_id, kind, created, created),
                )
            conn.execute("DROP INDEX idx_publication_contents_position")
            conn.execute("ALTER TABLE publication_contents DROP COLUMN position")
            conn.execute("ALTER TABLE project_publications DROP COLUMN media_mode")
        storage.init_db()
        storage.init_db()
        items = self.items()
        self.assertEqual([(item["id"], item["position"]) for item in items], [("b", 0), ("a", 1), ("c", 2)])
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["media_mode"], "image_text")
        video_plan = self.client.get(f"{self.plans}/{other['id']}", headers=self.headers()).json()["data"]
        self.assertEqual((video_plan["media_mode"], video_plan["video_count"]), ("video", 2))
        self.assertEqual(self.own_upload().status_code, 400)
        self.assertEqual(self.own_upload("doc.txt", b"Document").status_code, 400)
        self.assertEqual(self.save_copy().status_code, 200)
        self.assertEqual(self.delete_item({"id": "c"}).status_code, 200)
        self.assertEqual(self.own_upload().status_code, 200)
        self.path, self.contents = f"{self.plans}/{other['id']}", f"{self.plans}/{other['id']}/contents"
        self.assertEqual(self.own_upload("clip.mp4", b"video").status_code, 400)
        self.account()
        self.assertEqual(self.schedule().json()["detail"], "Video mode supports only one video")
        self.assertEqual(self.delete_item({"id": "video-b"}).status_code, 200)
        self.assertEqual(self.schedule().status_code, 200)

    def test_concurrent_video_uploads_allow_only_one_and_images_append_distinct_positions(self):
        self.mode("video")

        def simultaneous_uploads(media_type, filename):
            barrier = Barrier(2)

            def upload(index):
                barrier.wait(timeout=5)
                try:
                    return publication_contents.upload_publication_content(
                        self.owner["id"], self.plan["id"], filename=filename,
                        media_type=media_type, data=str(index).encode(),
                    )
                except ValueError as exc:
                    return str(exc)

            with ThreadPoolExecutor(max_workers=2) as executor:
                return list(executor.map(upload, range(2)))

        results = simultaneous_uploads("video", "clip.mp4")
        self.assertEqual(sum(isinstance(result, str) for result in results), 1)
        self.assertIn("Video mode supports only one video", results)
        video = self.items()[0]
        self.delete_item(video)
        self.mode("image_text")
        results = simultaneous_uploads("image", "photo.png")
        self.assertTrue(all(not isinstance(result, str) for result in results))
        self.assertEqual([item["position"] for item in self.items()], [0, 1])

    def test_images_have_only_per_batch_limit_and_order_accepts_all_current_images(self):
        sources = [self.upload(f"image{index}.png", b"image").json()["data"]["id"] for index in range(11)]
        self.assertEqual(self.pick(*sources[:10]).status_code, 200)
        self.assertEqual(self.pick(sources[10]).status_code, 200)
        ids = [item["id"] for item in self.items()]
        response = self.order(list(reversed(ids)))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["id"] for item in response.json()["data"]], list(reversed(ids)))

    def test_concurrent_import_upload_and_mode_switch_share_plan_lock(self):
        self.mode("video")
        source = self.upload("source.mp4", b"video").json()["data"]

        def race(actions):
            barrier = Barrier(2)

            def run(action):
                barrier.wait(timeout=5)
                try:
                    return action()
                except ValueError as exc:
                    return str(exc)

            with ThreadPoolExecutor(max_workers=2) as executor:
                return list(executor.map(run, actions))

        results = race([
            lambda: publication_contents.import_publication_materials(
                self.owner["id"], self.plan["id"], [source["id"]],
            ),
            lambda: publication_contents.upload_publication_content(
                self.owner["id"], self.plan["id"], filename="clip.mp4", media_type="video", data=b"video",
            ),
        ])
        self.assertEqual(sum(isinstance(result, str) for result in results), 1)
        self.assertEqual(len(self.items()), 1)
        self.delete_item(self.items()[0])
        self.mode("image_text")
        results = race([
            lambda: publication_plans.update_publication_plan(self.owner["id"], self.plan["id"], media_mode="video"),
            lambda: publication_contents.upload_publication_content(
                self.owner["id"], self.plan["id"], filename="image.png", media_type="image", data=b"image",
            ),
        ])
        self.assertEqual(sum(isinstance(result, str) for result in results), 1)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertIn((plan["media_mode"], plan["image_count"]), (("video", 0), ("image_text", 1)))

    def test_preupgrade_sqlite_to_postgres_transfer_backfills_without_changing_source(self):
        self.mode("video")
        video = self.own_upload("clip.mp4", b"video").json()["data"]
        document = self.own_upload("copy.txt", b"Document").json()["data"]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE publication_contents SET created_at = '2025-01-01' WHERE id = ?", (document["id"],),
            )
        target = self.migrate_to_memory(legacy_media=True)
        self.assertEqual(target.execute(
            "SELECT media_mode FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()["media_mode"], "video")
        self.assertEqual(
            [(row["id"], row["position"]) for row in target.execute(
                "SELECT id, position FROM publication_contents ORDER BY position",
            )],
            [(document["id"], 0), (video["id"], 1)],
        )
        with sqlite3.connect(self.db_path) as conn:
            self.assertNotIn("media_mode", {row[1] for row in conn.execute("PRAGMA table_info(project_publications)")})
