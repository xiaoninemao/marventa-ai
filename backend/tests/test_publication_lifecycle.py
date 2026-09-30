import sqlite3
import unittest
from unittest.mock import patch

from app.engines.publishing import storage
from scripts import migrate_sqlite_to_postgres
from tests import test_publication_contents as content_tests


class PublicationLifecycleTests(unittest.TestCase):
    setUp = content_tests.PublicationContentTests.setUp
    headers = content_tests.PublicationContentTests.headers
    own_upload = content_tests.PublicationContentTests.own_upload
    save_copy = content_tests.PublicationContentTests.save_copy
    account = content_tests.PublicationContentTests.account
    create_copy = content_tests.PublicationContentTests.create_copy

    def seed_execution(self, *, state="running", status="scheduled", **results):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE project_publications SET status = ? WHERE id = ?",
                (status, self.plan["id"]),
            )
            conn.execute(
                "INSERT INTO publication_executions "
                "(plan_id, attempt_id, state, started_at, heartbeat_at, "
                "published_at, platform_post_id, platform_video_id, error_message, outcome_unknown) "
                "VALUES (?, 'attempt-one', ?, '2026-09-30T10:00:00Z', "
                "'2026-09-30T10:01:00Z', ?, ?, ?, ?, ?)",
                (
                    self.plan["id"], state, results.get("published_at", ""),
                    results.get("platform_post_id", ""), results.get("platform_video_id", ""),
                    results.get("error_message", ""),
                    results.get("outcome_unknown", 0),
                ),
            )

    def get_plan(self):
        response = self.client.get(self.path, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    def test_execution_model_defaults_and_running_status_preserve_stored_status(self):
        plan = self.get_plan()
        self.assertEqual(
            (plan["published_at"], plan["platform_post_id"], plan["platform_video_id"], plan["last_error"], plan["outcome_unknown"]),
            ("", "", "", "", False),
        )
        self.seed_execution(error_message="Old result", outcome_unknown=1)
        for plan in (
            self.get_plan(),
            self.client.get(self.plans, headers=self.headers()).json()["data"][0],
        ):
            self.assertEqual(plan["status"], "publishing")
            self.assertEqual(plan["last_error"], "Old result")
            self.assertTrue(plan["outcome_unknown"])
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(
                conn.execute("SELECT status FROM project_publications WHERE id = ?", (self.plan["id"],)).fetchone()[0],
                "scheduled",
            )

    def test_running_and_published_lock_every_content_mutation_and_cancel(self):
        image = self.own_upload().json()["data"]
        material = self.create_copy().json()["data"]
        self.save_copy()
        self.seed_execution()
        for status, state, message in (
            ("scheduled", "running", "Publishing plans cannot be edited"),
            ("published", "succeeded", "Published plans cannot be edited"),
        ):
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("UPDATE project_publications SET status = ? WHERE id = ?", (status, self.plan["id"]))
                conn.execute("UPDATE publication_executions SET state = ? WHERE plan_id = ?", (state, self.plan["id"]))
            requests = (
                ("patch", self.path, {"json": {"name": "Changed"}}),
                ("patch", self.path, {"json": {"status": "cancelled"}}),
                ("patch", self.path, {"json": {"scheduled_for": ""}}),
                ("patch", self.path, {"json": {"media_mode": "video"}}),
                ("patch", self.path + "/copy", {"json": {"title": "New", "content": "New"}}),
                ("post", self.contents, {"files": {"file": ("new.png", b"image", "image/png")}}),
                ("post", self.contents + "/from-materials", {"json": {"material_ids": [material["id"]]}}),
                ("patch", self.contents + "/order", {"json": {"content_ids": [image["id"]]}}),
                ("delete", self.contents + "/" + image["id"], {}),
                ("delete", self.path, {}),
            )
            with patch("app.engines.publishing.publication_contents.put_media_bytes") as save_media:
                for method, url, kwargs in requests:
                    with self.subTest(status=status, method=method, url=url, kwargs=kwargs):
                        response = getattr(self.client, method)(url, headers=self.headers(), **kwargs)
                        self.assertEqual(response.status_code, 400, response.text)
                        self.assertEqual(response.json()["detail"], message)
                save_media.assert_not_called()
            self.assertEqual(self.get_plan()["content_count"], 2)
            self.assertEqual(self.client.get(self.path + "/copy", headers=self.headers()).json()["data"]["content"], "Saved body")

    def test_failed_reschedule_and_draft_keep_execution_results_until_next_claim(self):
        self.account()
        self.save_copy()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET channel_account_id = 'account' WHERE id = ?", (self.plan["id"],))
        self.seed_execution(state="failed", status="failed", error_message="Network failed", outcome_unknown=1)
        for schedule, expected_status in (("2026-10-01T10:00:00Z", "scheduled"), ("", "draft")):
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("UPDATE project_publications SET status = 'failed' WHERE id = ?", (self.plan["id"],))
            response = self.client.patch(self.path, headers=self.headers(), json={"scheduled_for": schedule})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["data"]["status"], expected_status)
            self.assertEqual(response.json()["data"]["last_error"], "Network failed")
            self.assertTrue(response.json()["data"]["outcome_unknown"])
        response = self.client.patch(self.path, headers=self.headers(), json={
            "scheduled_for": "2026-10-01T10:00:00Z", "status": "cancelled",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["status"], "cancelled")

    def test_success_results_survive_schema_initialization(self):
        self.seed_execution(
            state="succeeded", status="published", published_at="2026-09-30T10:02:00Z",
            platform_post_id="remote-post",
            platform_video_id="remote-video",
        )
        storage.init_db()
        storage.init_db()
        plan = self.get_plan()
        self.assertEqual(plan["status"], "published")
        self.assertEqual(plan["published_at"], "2026-09-30T10:02:00Z")
        self.assertEqual(plan["platform_post_id"], "remote-post")
        self.assertEqual(plan["platform_video_id"], "remote-video")
        self.assertIn("publication_executions", migrate_sqlite_to_postgres._TABLE_ORDER)
        migrated = content_tests.PublicationContentTests.migrate_to_memory(self)
        self.assertEqual(
            tuple(migrated.execute("SELECT attempt_id, platform_post_id, platform_video_id FROM publication_executions").fetchone()),
            ("attempt-one", "remote-post", "remote-video"),
        )

    def test_existing_execution_table_adds_video_id_without_losing_results(self):
        self.seed_execution(state="succeeded", status="published", platform_post_id="original-post")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("ALTER TABLE publication_executions DROP COLUMN platform_video_id")
        storage.init_db()
        storage.init_db()
        plan = self.get_plan()
        self.assertEqual(plan["platform_video_id"], "")
        self.assertEqual(plan["platform_post_id"], "original-post")
        self.assertEqual(plan["status"], "published")

    def test_only_douyin_official_api_is_ready_even_with_xhs_write_scope(self):
        self.account()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET channel_account_id = 'account' WHERE id = ?", (self.plan["id"],))
        for platform, scopes, ready, missing in (
            ("douyin", '["video.create.bind"]', True, ""),
            ("douyin", '[]', False, "video.create.bind"),
            ("xiaohongshu", '["write_notes"]', False, ""),
            ("xiaohongshu", '[]', False, "write_notes"),
        ):
            with self.subTest(platform=platform, scopes=scopes):
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("UPDATE project_channel_accounts SET platform = ?, scopes = ? WHERE id = 'account'", (platform, scopes))
                plan = self.get_plan()
                self.assertEqual(plan["publishing_ready"], ready)
                self.assertEqual(plan["missing_scope"], missing)

    def test_project_and_account_deletion_cannot_cascade_locked_plans(self):
        self.account()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET channel_account_id = 'account' WHERE id = ?", (self.plan["id"],))
        self.seed_execution()
        for status, state in (("scheduled", "running"), ("published", "succeeded")):
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("UPDATE project_publications SET status = ? WHERE id = ?", (status, self.plan["id"]))
                conn.execute("UPDATE publication_executions SET state = ? WHERE plan_id = ?", (state, self.plan["id"]))
            with patch("app.api.publishing.delete_media_prefix") as delete_prefix:
                for url in (self.base + "/channel-accounts/account", self.base):
                    with self.subTest(status=status, url=url):
                        response = self.client.delete(url, headers=self.headers())
                        self.assertEqual(response.status_code, 400, response.text)
                delete_prefix.assert_not_called()
            with sqlite3.connect(self.db_path) as conn:
                for table in ("content_projects", "project_channel_accounts", "project_publications", "publication_executions"):
                    self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 1)

    def test_draft_deletion_cascades_execution_and_account_normally(self):
        self.account()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET channel_account_id = 'account' WHERE id = ?", (self.plan["id"],))
        self.seed_execution(state="failed", status="draft")
        response = self.client.delete(self.base + "/channel-accounts/account", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        with sqlite3.connect(self.db_path) as conn:
            for table in ("project_channel_accounts", "project_publications", "publication_executions"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_execution_schema_constraints_and_defaults(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            insert = (
                "INSERT INTO publication_executions "
                "(plan_id, attempt_id, state, started_at, heartbeat_at) VALUES (?, 'attempt', ?, 'now', 'now')"
            )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(insert, ("missing-plan", "running"))
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(insert, (self.plan["id"], "pending"))
            conn.execute(insert, (self.plan["id"], "running"))
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(insert, (self.plan["id"], "failed"))
            self.assertEqual(
                conn.execute(
                    "SELECT submission_started, published_at, platform_post_id, platform_video_id, error_message, outcome_unknown "
                    "FROM publication_executions WHERE plan_id = ?", (self.plan["id"],),
                ).fetchone(),
                (0, "", "", "", "", 0),
            )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE project_publications SET status = 'publishing' WHERE id = ?", (self.plan["id"],))


if __name__ == "__main__":
    unittest.main()
