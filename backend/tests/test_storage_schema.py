from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.auth.dependencies import can_manage_organization_record
from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.models import ChatMessage
from app.engines.portfolio import storage as portfolio_storage
from app.storage_schema import (
    ensure_organization_scope,
    ensure_parent_organization_scope,
    ensure_project_scope,
    resolve_user_organization_id,
)


class OrganizationStorageSchemaTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE organizations (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                default_for_user_id TEXT
            );
            CREATE TABLE organization_memberships (
                organization_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL
            );
            CREATE TABLE user_organization_preferences (
                user_id TEXT PRIMARY KEY,
                organization_id TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO organizations VALUES
                ('org-default', 'user-1', 'user-1'),
                ('org-current', 'user-2', NULL),
                ('org-user-2', 'user-2', 'user-2');
            INSERT INTO organization_memberships VALUES
                ('org-default', 'user-1', 'owner'),
                ('org-current', 'user-1', 'member'),
                ('org-user-2', 'user-2', 'owner');
            INSERT INTO user_organization_preferences VALUES
                ('user-1', 'org-current', '2026-01-01');
            CREATE TABLE records (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL
            );
            INSERT INTO records VALUES
                ('current-record', 'user-1'),
                ('default-record', 'user-2'),
                ('guest-record', '');
        """)

    def test_backfills_current_then_default_organization_and_is_idempotent(self):
        ensure_organization_scope(self.conn, "records", "user_id")
        ensure_organization_scope(self.conn, "records", "user_id")

        rows = dict(self.conn.execute(
            "SELECT id, organization_id FROM records"
        ).fetchall())
        self.assertEqual(rows["current-record"], "org-current")
        self.assertEqual(rows["default-record"], "org-user-2")
        self.assertEqual(rows["guest-record"], "")
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM storage_schema_migrations "
                "WHERE name = 'organization-scope-v1:records'"
            ).fetchone()[0],
            1,
        )
        index_names = {
            row[1] for row in self.conn.execute("PRAGMA index_list(records)")
        }
        self.assertIn("idx_records_organization", index_names)
        self.assertIn("idx_records_organization_user", index_names)
        self.assertEqual(
            resolve_user_organization_id(self.conn, "user-1"),
            "org-current",
        )

        self.conn.execute("INSERT INTO records VALUES ('new-record', 'user-1', '')")
        self.assertEqual(
            self.conn.execute(
                "SELECT organization_id FROM records WHERE id = 'new-record'"
            ).fetchone()[0],
            "org-current",
        )

    def test_repeat_organization_backfill_does_not_update_unscoped_legacy_rows(self):
        self.conn.execute("INSERT INTO records VALUES ('unknown-owner', 'missing-user')")
        ensure_organization_scope(self.conn, "records", "user_id")
        self.conn.executescript("""
            CREATE TABLE content_projects (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
            INSERT INTO content_projects VALUES
                ('current-project', 'org-current'), ('default-project', 'org-user-2');
            ALTER TABLE records ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
            UPDATE records SET project_id = 'current-project' WHERE id = 'current-record';
            UPDATE records SET project_id = 'default-project' WHERE id = 'default-record';
        """)
        ensure_project_scope(self.conn, "records")

        ensure_organization_scope(self.conn, "records", "user_id")

        self.assertEqual(dict(self.conn.execute(
            "SELECT id, organization_id FROM records WHERE project_id = ''",
        )), {"guest-record": "", "unknown-owner": ""})
        with self.assertRaisesRegex(sqlite3.IntegrityError, "project_id is required"):
            self.conn.execute("""
                INSERT INTO records (id, user_id, organization_id)
                VALUES ('invalid', 'user-1', 'org-current')
            """)

    def test_parent_rows_inherit_organization_scope(self):
        ensure_organization_scope(self.conn, "records", "user_id")
        self.conn.executescript("""
            CREATE TABLE record_versions (
                id TEXT PRIMARY KEY,
                record_id TEXT NOT NULL
            );
            INSERT INTO record_versions VALUES
                ('version-1', 'current-record'),
                ('orphan-version', 'missing-record');
        """)

        ensure_parent_organization_scope(
            self.conn, "record_versions", "records", "record_id",
        )

        rows = dict(self.conn.execute(
            "SELECT id, organization_id FROM record_versions"
        ).fetchall())
        self.assertEqual(rows["version-1"], "org-current")
        self.assertEqual(rows["orphan-version"], "")

        self.conn.execute(
            "INSERT INTO record_versions VALUES ('version-2', 'current-record', '')"
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT organization_id FROM record_versions WHERE id = 'version-2'"
            ).fetchone()[0],
            "org-current",
        )

    def test_schema_can_initialize_before_organization_tables_exist(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute("CREATE TABLE standalone (id TEXT PRIMARY KEY, owner_id TEXT)")
        conn.execute("INSERT INTO standalone VALUES ('record-1', 'user-1')")

        ensure_organization_scope(conn, "standalone", "owner_id")

        self.assertEqual(
            conn.execute(
                "SELECT organization_id FROM standalone WHERE id = 'record-1'"
            ).fetchone()[0],
            "",
        )

    def test_session_lists_follow_the_users_current_organization(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "organization-scope.db")
        with sqlite3.connect(db_path) as conn:
            conn.executescript("""
                CREATE TABLE organizations (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    default_for_user_id TEXT
                );
                CREATE TABLE organization_memberships (
                    organization_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL
                );
                CREATE TABLE user_organization_preferences (
                    user_id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO organizations VALUES
                    ('org-a', 'user-1', 'user-1'),
                    ('org-b', 'user-1', NULL);
                INSERT INTO organization_memberships VALUES
                    ('org-a', 'user-1', 'owner'),
                    ('org-b', 'user-1', 'owner');
                INSERT INTO user_organization_preferences
                VALUES ('user-1', 'org-a', '2026-01-01');
            """)

        with patch.object(content_storage, "DB_PATH", db_path):
            session_a = content_storage.create_session("user-1")
            content_storage.update_session(
                session_a.id,
                messages=[ChatMessage(role="user", content="Organization A")],
            )
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE user_organization_preferences "
                    "SET organization_id = 'org-b' WHERE user_id = 'user-1'"
                )
            session_b = content_storage.create_session("user-1")
            content_storage.update_session(
                session_b.id,
                messages=[ChatMessage(role="user", content="Organization B")],
            )
            self.assertEqual(
                [item.id for item in content_storage.list_sessions("user-1")],
                [session_b.id],
            )
            self.assertIsNone(content_storage.get_session(session_a.id, "user-1"))
            self.assertEqual(
                content_storage.get_session(session_b.id, "user-1").id,
                session_b.id,
            )
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    "UPDATE user_organization_preferences "
                    "SET organization_id = 'org-a' WHERE user_id = 'user-1'"
                )
            self.assertEqual(
                [item.id for item in content_storage.list_sessions("user-1")],
                [session_a.id],
            )
            self.assertIsNone(content_storage.get_session(session_b.id, "user-1"))

    def test_organization_members_share_business_records_with_role_based_management(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "collaboration.db")
        with sqlite3.connect(db_path) as conn:
            conn.executescript("""
                CREATE TABLE organizations (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    default_for_user_id TEXT
                );
                CREATE TABLE organization_memberships (
                    organization_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL
                );
                CREATE TABLE user_organization_preferences (
                    user_id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO organizations VALUES ('org-team', 'user-owner', 'user-owner');
                INSERT INTO organization_memberships VALUES
                    ('org-team', 'user-owner', 'owner'),
                    ('org-team', 'user-member', 'member');
                INSERT INTO user_organization_preferences VALUES
                    ('user-owner', 'org-team', '2026-01-01'),
                    ('user-member', 'org-team', '2026-01-01');
            """)

        with patch.object(portfolio_storage, "DB_PATH", db_path):
            document = portfolio_storage.create_script(
                "user-owner", "Shared document", "Organization content",
            )
            self.assertEqual(
                [item.id for item in portfolio_storage.list_scripts("user-member")],
                [document.id],
            )
            self.assertEqual(
                portfolio_storage.get_script(document.id, "user-member").id,
                document.id,
            )

        member = {"id": "user-member", "organization_role": "member"}
        admin = {"id": "user-admin", "organization_role": "admin"}
        self.assertFalse(can_manage_organization_record(member, "user-owner"))
        self.assertTrue(can_manage_organization_record(admin, "user-owner"))
        self.assertTrue(can_manage_organization_record(member, "user-member"))


if __name__ == "__main__":
    unittest.main()
