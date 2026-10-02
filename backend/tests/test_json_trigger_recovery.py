import sqlite3
import unittest
from unittest.mock import patch

from app.storage_schema import ensure_json_columns


class JsonTriggerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.execute("""
            CREATE TABLE content_projects (
                id TEXT PRIMARY KEY,
                cards_snapshot TEXT DEFAULT '[]',
                final_snapshot TEXT DEFAULT '{}',
                media_assets TEXT DEFAULT '[]'
            )
        """)
        ensure_json_columns(
            self.conn, "content_projects",
            ("cards_snapshot", "final_snapshot", "media_assets"),
        )
        self.conn.execute("INSERT INTO content_projects (id) VALUES ('existing')")
        self.conn.commit()

    def add_removed_column_guards(self):
        for action in ("insert", "update"):
            event = "INSERT" if action == "insert" else "UPDATE OF marketing_channels"
            self.conn.execute(f"""
                CREATE TRIGGER trg_content_projects_marketing_channels_json_{action}
                BEFORE {event} ON content_projects
                WHEN NEW.marketing_channels IS NOT NULL
                    AND json_valid(NEW.marketing_channels) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'Invalid retired JSON');
                END
            """)

    def trigger_names(self):
        return {row[0] for row in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        )}

    def test_prunes_removed_column_guards_and_preserves_project_rows(self):
        self.add_removed_column_guards()
        with self.assertRaisesRegex(sqlite3.OperationalError, "NEW.marketing_channels"):
            self.conn.execute("INSERT INTO content_projects (id) VALUES ('before-repair')")

        for _ in range(2):
            ensure_json_columns(
                self.conn, "content_projects", ("cards_snapshot", "final_snapshot"),
            )

        self.conn.execute("INSERT INTO content_projects (id) VALUES ('after-repair')")
        self.conn.execute(
            "UPDATE content_projects SET final_snapshot = ? WHERE id = 'existing'",
            ('{"preserved": true}',),
        )
        self.assertEqual(
            {row[0] for row in self.conn.execute("SELECT id FROM content_projects")},
            {"existing", "after-repair"},
        )
        self.assertNotIn(
            "trg_content_projects_marketing_channels_json_insert", self.trigger_names(),
        )
        self.assertNotIn(
            "trg_content_projects_marketing_channels_json_update", self.trigger_names(),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "cards_snapshot"):
            self.conn.execute(
                "INSERT INTO content_projects (id, cards_snapshot) VALUES ('invalid', 'bad')",
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "final_snapshot"):
            self.conn.execute(
                "UPDATE content_projects SET final_snapshot = 'bad' WHERE id = 'existing'",
            )

    def test_preserves_existing_unrequested_guards_custom_triggers_and_other_tables(self):
        self.add_removed_column_guards()
        self.conn.executescript("""
            CREATE TRIGGER custom_project_guard
            BEFORE UPDATE ON content_projects WHEN NEW.id IS NULL
            BEGIN
                SELECT RAISE(ABORT, 'Project ID is required');
            END;
            CREATE TABLE other_records (id TEXT);
            CREATE TRIGGER trg_other_records_removed_json_insert
            BEFORE INSERT ON other_records WHEN NEW.removed IS NOT NULL
            BEGIN
                SELECT RAISE(ABORT, 'Retired field');
            END;
        """)
        ensure_json_columns(
            self.conn, "content_projects", ("cards_snapshot", "final_snapshot"),
        )
        for name in (
            "custom_project_guard",
            "trg_other_records_removed_json_insert",
            "trg_content_projects_media_assets_json_insert",
            "trg_content_projects_media_assets_json_update",
        ):
            self.assertIn(name, self.trigger_names())
        with self.assertRaisesRegex(sqlite3.IntegrityError, "media_assets"):
            self.conn.execute(
                "INSERT INTO content_projects (id, media_assets) VALUES ('invalid', 'bad')",
            )

    def test_missing_requested_column_still_raises_without_pruning(self):
        self.add_removed_column_guards()
        with self.assertRaisesRegex(RuntimeError, "content_projects.missing does not exist"):
            ensure_json_columns(self.conn, "content_projects", ("missing",))
        self.assertIn(
            "trg_content_projects_marketing_channels_json_insert", self.trigger_names(),
        )

    def test_postgresql_path_does_not_prune_sqlite_triggers(self):
        self.add_removed_column_guards()
        with patch("app.storage_schema.is_postgresql", return_value=True):
            ensure_json_columns(
                self.conn, "content_projects", ("cards_snapshot", "final_snapshot"),
            )
        self.assertIn(
            "trg_content_projects_marketing_channels_json_insert", self.trigger_names(),
        )

    def test_pruning_obeys_the_callers_transaction(self):
        self.add_removed_column_guards()
        self.conn.commit()
        self.conn.execute("BEGIN")
        ensure_json_columns(
            self.conn, "content_projects", ("cards_snapshot", "final_snapshot"),
        )
        self.assertNotIn(
            "trg_content_projects_marketing_channels_json_insert", self.trigger_names(),
        )
        self.conn.rollback()
        self.assertIn(
            "trg_content_projects_marketing_channels_json_insert", self.trigger_names(),
        )
