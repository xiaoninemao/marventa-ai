import unittest
from unittest.mock import MagicMock, patch

from app import config
from app.engines.publishing import storage


class PublishingSchemaInitializationTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(storage, "_initialized_postgres_databases", set()))
        self.connection = MagicMock()
        self.connection.__enter__.return_value = self.connection
        self.connection.dialect = "postgresql"
        self.factory = self.enterContext(patch.object(storage, "_get_conn", return_value=self.connection))
        self.initialize = self.enterContext(patch.object(storage, "_initialize_schema"))
        self.enterContext(patch.object(config, "DATABASE_URL", "postgresql://test/schema-one"))

    def test_postgres_skips_sqlite_table_definition_lookup(self):
        storage._migrate_project_material_collections(self.connection)
        statements = [call.args[0] for call in self.connection.execute.call_args_list]
        self.assertEqual(len(statements), 1)
        self.assertIn("CREATE TABLE IF NOT EXISTS project_materials", statements[0])
        self.assertNotIn("sqlite_master", statements[0])

    def test_failed_initialization_closes_connection_and_can_retry(self):
        self.initialize.side_effect = RuntimeError("Migration failed")
        with self.assertRaisesRegex(RuntimeError, "Migration failed"):
            storage._ensure_db_initialized()
        self.connection.close.assert_called_once()
        self.assertEqual(storage._initialized_postgres_databases, set())
        self.initialize.side_effect = None
        storage._ensure_db_initialized()
        self.assertEqual(self.initialize.call_count, 2)

    def test_postgres_runtime_calls_do_not_repeat_ddl_but_explicit_migrations_do(self):
        storage._ensure_db_initialized()
        storage._ensure_db_initialized()
        self.initialize.assert_called_once()
        storage.init_db()
        self.assertEqual(self.initialize.call_count, 2)
        with patch.object(config, "DATABASE_URL", "postgresql://test/schema-two"):
            storage._ensure_db_initialized()
        self.assertEqual(self.initialize.call_count, 3)

    def test_sqlite_runtime_initialization_preserves_existing_behavior(self):
        self.connection.dialect = "sqlite"
        with patch.object(config, "DATABASE_URL", ""):
            storage._ensure_db_initialized()
            storage._ensure_db_initialized()
        self.assertEqual(self.initialize.call_count, 2)
        self.assertEqual(storage._initialized_postgres_databases, set())


if __name__ == "__main__":
    unittest.main()
