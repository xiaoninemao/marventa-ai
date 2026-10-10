import io
import json
import sqlite3
import unittest
import uuid
from contextlib import redirect_stdout
from unittest.mock import patch

from app import config, media_storage
from app.auth import storage as auth_storage
from app.engines.portfolio import storage as portfolio_storage
from app.engines.publishing import publication_contents, publication_plans, storage
from app.storage_schema import resolve_user_organization_id
from scripts import migrate_sqlite_to_postgres
from tests import test_material_copy as material_tests


class PublicationContentTests(unittest.TestCase):
    headers = material_tests.MaterialCopyTests.headers
    create_copy = material_tests.MaterialCopyTests.create_copy
    upload = material_tests.MaterialCopyTests.upload
    legacy = material_tests.MaterialCopyTests.legacy

    def setUp(self):
        material_tests.MaterialCopyTests.setUp(self)
        self.enterContext(patch.object(portfolio_storage, "DB_PATH", self.db_path))
        portfolio_storage.init_db()
        self.enterContext(patch.object(publication_plans, "_clock", return_value="2026-09-30T00:00:00Z"))
        self.plans = "/api/v1/publishing/publications"
        response = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Release",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.plan = response.json()["data"]
        self.path = f"{self.plans}/{self.plan['id']}"
        self.contents = self.path + "/contents"

    def create_work(self, *, kind="image", title="Copy title", content="Saved body", tags=None, assets=None):
        work_id = uuid.uuid4().hex
        media = []
        for index, (name, data) in enumerate(assets if assets is not None else [("image.png", b"image")]):
            key = f"portfolio/{work_id}/{name}"
            mime = "video/mp4" if kind == "video" else "image/png"
            media_storage.put_media_bytes(key, data, content_type=mime)
            media.append({
                "id": f"{work_id}-{index}", "name": name, "media_type": kind, "mime_type": mime,
                "object_key": key, "file_size": len(data),
            })
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO portfolio (id, user_id, name, title, content, tags, project_id, "
                "status, media_kind, media, organization_id, created_at, updated_at) "
                "VALUES (?, ?, 'Work name', ?, ?, ?, ?, 'completed', ?, ?, ?, '2026-01-01', '2026-01-01')",
                (work_id, self.owner["id"], title, content, json.dumps(tags or []),
                 self.project.id, kind, json.dumps(media), resolve_user_organization_id(conn, self.owner["id"])),
            )
        return work_id

    def select_work(self, work_id=None, user=None, **values):
        return self.client.put(
            self.path + "/work", headers=self.headers(user),
            json={"portfolio_id": work_id or self.create_work(**values)},
        )

    def items(self):
        return self.client.get(self.contents, headers=self.headers()).json()["data"]

    def load_copy(self, user=None):
        return self.client.get(self.path + "/copy", headers=self.headers(user))

    def account(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_channel_accounts "
                "(id, project_id, platform, account_name, platform_user_id, created_by_user_id, "
                "authorization_status, scopes, created_at, updated_at) "
                "VALUES ('account', ?, 'douyin', 'Account', 'user', ?, 'active', "
                "'[\"video.create.bind\"]', '2026-01-01', '2026-01-01')",
                (self.project.id, self.owner["id"]),
            )
        return "account"

    def schedule(self):
        return self.client.patch(self.path, headers=self.headers(), json={
            "channel_account_id": "account", "scheduled_for": "2026-10-01T10:00:00Z",
            "status": "scheduled",
        })

    def cancel(self):
        response = self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_selected_snapshot_preserves_plaintext_tags_order_and_independent_name(self):
        content = "<b>literal</b> &amp;\n原文 👩‍💻"
        response = self.select_work(content=content, tags=[" #Launch ", "Launch", "＃新品"],
                                    assets=[("b.png", b"b"), ("a.png", b"a")])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["name"], "Release")
        self.assertEqual(response.json()["data"]["content_count"], 3)
        self.assertEqual(response.json()["data"]["document_count"], 1)
        self.assertEqual(self.load_copy().json()["data"], {
            "title": "Copy title", "content": content, "tags": ["Launch", "新品"],
        })
        items = self.items()
        self.assertEqual([item["name"] for item in items], ["b.png", "a.png"])
        self.assertEqual([item["position"] for item in items], [0, 1])
        self.assertTrue(all("content_html" not in item and "object_key" not in item for item in items))
        storage.init_db()
        self.assertEqual(self.items(), items)
        self.assertEqual(self.load_copy().json()["data"]["content"], content)

    def test_snapshot_survives_source_edit_delete_and_plan_delete_preserves_source(self):
        work_id = self.create_work()
        self.assertEqual(self.select_work(work_id).status_code, 200)
        item = self.items()[0]
        key = media_storage.media_key_from_url(item["file_url"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE portfolio SET content = 'Changed' WHERE id = ?", (work_id,))
            conn.execute("DELETE FROM portfolio WHERE id = ?", (work_id,))
        media_storage.delete_media_prefix(f"portfolio/{work_id}")
        self.assertEqual(media_storage.read_media_bytes(key), b"image")
        self.assertEqual(self.load_copy().json()["data"]["content"], "Saved body")
        second = self.create_work()
        self.assertEqual(self.select_work(second).status_code, 200)
        replacement_key = media_storage.media_key_from_url(self.items()[0]["file_url"])
        self.assertFalse(media_storage.media_exists(key))
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).status_code, 200)
        self.assertFalse(media_storage.media_exists(replacement_key))
        self.assertTrue(media_storage.list_media_keys(f"portfolio/{second}"))

    def test_selection_permissions_current_organization_and_member_creator(self):
        work_id = self.create_work()
        for user, expected in ((self.member, 403), (self.outsider, 404), (self.admin, 200)):
            response = self.select_work(work_id, user)
            self.assertEqual(response.status_code, expected, response.text)
        self.assertEqual(self.load_copy(self.member).status_code, 200)
        self.assertEqual(self.load_copy(self.outsider).status_code, 404)
        organization = auth_storage.get_current_organization(self.owner["id"])
        other = auth_storage.create_organization(self.owner["id"], "Other organization")
        auth_storage.switch_organization(self.owner["id"], other["id"])
        self.assertEqual(self.select_work(work_id).status_code, 404)
        self.assertEqual(self.load_copy().status_code, 404)
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        created = self.client.post(self.plans, headers=self.headers(self.member), json={
            "project_id": self.project.id, "name": "Member plan",
        }).json()["data"]
        response = self.client.put(f"{self.plans}/{created['id']}/work",
                                   headers=self.headers(self.member), json={"portfolio_id": work_id})
        self.assertEqual(response.status_code, 200, response.text)

    def test_selection_failure_rolls_back_rows_copy_and_cleans_partial_media(self):
        original = self.create_work()
        self.assertEqual(self.select_work(original).status_code, 200)
        before, copy = self.items(), self.load_copy().json()["data"]
        keys = sorted(media_storage.list_media_keys("publishing"))
        replacement = self.create_work(assets=[("a.png", b"a"), ("b.png", b"b")])
        put = publication_contents.put_media_bytes
        calls = 0

        def fail_second(key, data, **kwargs):
            nonlocal calls
            calls += 1
            put(key, data, **kwargs)
            if calls == 2:
                raise OSError("Storage failed")

        with patch.object(publication_contents, "put_media_bytes", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "Storage failed"):
                publication_plans.select_publication_work(self.owner["id"], self.plan["id"], portfolio_id=replacement)
        self.assertEqual(self.items(), before)
        self.assertEqual(self.load_copy().json()["data"], copy)
        self.assertEqual(sorted(media_storage.list_media_keys("publishing")), keys)
        with patch.object(publication_plans, "_row_to_plan", side_effect=RuntimeError("Read failed")):
            with self.assertRaisesRegex(RuntimeError, "Read failed"):
                publication_plans.select_publication_work(self.owner["id"], self.plan["id"], portfolio_id=replacement)
        self.assertEqual(self.items(), before)
        self.assertEqual(sorted(media_storage.list_media_keys("publishing")), keys)

    def test_project_deletion_removes_owned_media_and_rows(self):
        self.assertEqual(self.select_work().status_code, 200)
        key = media_storage.media_key_from_url(self.items()[0]["file_url"])
        response = self.client.delete(self.base, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(media_storage.media_exists(key))
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM publication_contents").fetchone()[0], 0)

    def test_migration_transfers_snapshot_columns_and_owned_keys(self):
        self.assertEqual(self.select_work(tags=["新品", "👩‍💻"]).status_code, 200)
        with sqlite3.connect(self.db_path) as conn:
            expected = conn.execute("SELECT * FROM publication_contents ORDER BY id").fetchall()
        target = self.migrate_to_memory()
        self.assertEqual([tuple(row) for row in target.execute("SELECT * FROM publication_contents ORDER BY id")], expected)
        migrated = target.execute(
            "SELECT copy_title, copy_text, copy_tags, media_mode FROM project_publications WHERE id = ?",
            (self.plan["id"],),
        ).fetchone()
        self.assertEqual(tuple(migrated), ("Copy title", "Saved body", '["新品", "👩‍💻"]', "image_text"))

    def test_legacy_empty_plans_survive_schema_upgrade_and_cannot_schedule(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DROP TABLE publication_contents")
            conn.execute("ALTER TABLE project_publications DROP COLUMN copy_tags")
            conn.execute("UPDATE project_publications SET portfolio_id = 'legacy' WHERE id = ?", (self.plan["id"],))
        storage.init_db()
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"]["tags"], [])
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["portfolio_id"], "legacy")
        self.account()
        self.assertEqual(self.schedule().status_code, 400)
        self.assertLess(migrate_sqlite_to_postgres._TABLE_ORDER.index("project_publications"),
                        migrate_sqlite_to_postgres._TABLE_ORDER.index("publication_contents"))

    def migrate_to_memory(self, *, legacy_media=False, legacy_copy=False, legacy_tags=False):
        class MigrationTarget(sqlite3.Connection):
            def execute(self, sql, parameters=()):
                if "information_schema.columns" in sql:
                    return super().execute("SELECT 1 WHERE 0")
                return super().execute(sql, parameters)

            def close(self):
                pass

        target = sqlite3.connect(":memory:", factory=MigrationTarget)
        target.row_factory = sqlite3.Row
        self.addCleanup(sqlite3.Connection.close, target)
        with sqlite3.connect(self.db_path) as conn:
            schemas = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").fetchall()
        for (sql,) in schemas:
            target.execute(sql)
        target.execute("PRAGMA foreign_keys = ON")
        if legacy_media:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("DROP INDEX idx_publication_contents_position")
                conn.execute("ALTER TABLE publication_contents DROP COLUMN position")
                conn.execute("ALTER TABLE project_publications DROP COLUMN media_mode")
        if legacy_copy:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("ALTER TABLE project_publications DROP COLUMN copy_text")
        if legacy_tags:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("ALTER TABLE project_publications DROP COLUMN copy_tags")
        with (
            patch.object(config, "DATABASE_URL", ""),
            patch.object(migrate_sqlite_to_postgres, "_initialize_postgres"),
            patch("app.database.connect_database", return_value=target),
            patch("sys.argv", ["migrate", "--sqlite-path", self.db_path, "--database-url", "postgresql://not-used"]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(migrate_sqlite_to_postgres.main(), 0)
        return target
