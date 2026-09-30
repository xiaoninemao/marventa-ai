import os
import sqlite3
import unittest
import uuid


POSTGRES_URL = os.getenv("TEST_POSTGRES_URL", "")


@unittest.skipUnless(
    POSTGRES_URL.startswith(("postgresql://", "postgres://")),
    "TEST_POSTGRES_URL is not configured",
)
class PostgreSQLIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg

        from app import config

        cls.original_database_url = config.DATABASE_URL
        config.DATABASE_URL = POSTGRES_URL
        with psycopg.connect(POSTGRES_URL, autocommit=True) as conn:
            conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
            conn.execute("CREATE SCHEMA public")

        from app.auth.storage import init_users_db
        from app.engines.case_library.import_tasks import init_import_tasks_db
        from app.engines.case_library.storage import init_db as init_case_library_db
        from app.engines.content_generator.storage import init_db as init_content_generator_db
        from app.engines.market_insight.storage import init_db as init_market_insight_db
        from app.engines.portfolio.storage import init_db as init_portfolio_db
        from app.engines.publishing.storage import init_db as init_publishing_db
        from app.notifications.storage import init_notifications_db

        init_users_db()
        init_notifications_db()
        init_publishing_db()
        init_case_library_db()
        init_import_tasks_db()
        init_content_generator_db()
        init_portfolio_db()
        init_market_insight_db()

    @classmethod
    def tearDownClass(cls):
        import psycopg

        from app import config

        with psycopg.connect(POSTGRES_URL, autocommit=True) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid != pg_backend_pid()",
            )
            conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
            conn.execute("CREATE SCHEMA public")
        config.DATABASE_URL = cls.original_database_url

    def test_core_organization_project_and_asset_flow(self):
        from app.auth import storage as auth_storage
        from app.engines.case_library.storage import create_case, get_case
        from app.engines.portfolio.storage import create_script
        from app.engines.publishing.publication_plans import (
            create_publication_plan,
            get_publication_plan,
            list_publication_plans,
            update_publication_plan,
        )
        from app.engines.publishing.publication_contents import (
            delete_publication_content,
            get_publication_copy,
            get_publication_document,
            import_publication_materials,
            list_publication_contents,
            update_publication_copy,
        )
        from app.engines.publishing.project_materials import (
            create_project_material,
            create_project_material_set,
            delete_project_material,
            list_project_materials,
        )
        from app.engines.publishing.projects import (
            create_manual_project,
            get_project,
        )
        from app.database import connect_database

        suffix = uuid.uuid4().hex[:8]
        user = auth_storage.create_user(
            f"pg-{suffix}",
            f"pg-{suffix}@example.com",
            "hash",
        )
        organization = auth_storage.get_current_organization(user["id"])
        self.assertIsNotNone(organization)
        project = create_manual_project(
            user["id"],
            title=f"PostgreSQL {suffix}",
        )
        loaded = get_project(project.id, user["id"])
        self.assertIsNotNone(loaded)
        case = create_case(
            title="PostgreSQL case",
            content_type="image_text",
            description="Database integration",
            tags=["postgresql"],
            video_url="",
            image_urls=[],
            owner_id=user["id"],
            project_id=project.id,
        )
        loaded_case = get_case(case.id, user["id"])
        self.assertIsNotNone(loaded_case)
        self.assertEqual(loaded_case.organization_id, organization["id"])
        self.assertEqual(loaded_case.project_id, project.id)
        work = create_script(
            user["id"],
            "PostgreSQL work",
            "Content",
            project_id=project.id,
        )
        account_id = f"account-{suffix}"
        conn = connect_database("")
        try:
            conn.execute(
                """
                INSERT INTO project_channel_accounts (
                    id, project_id, platform, account_name, platform_user_id,
                    created_by_user_id, authorization_status, scopes,
                    created_at, updated_at
                ) VALUES (?, ?, 'douyin', ?, ?, ?, 'active', ?, ?, ?)
                """,
                (
                    account_id, project.id, "PostgreSQL account",
                    f"open-{suffix}", user["id"], '["user_info"]',
                    "2026-01-01", "2026-01-01",
                ),
            )
            conn.commit()
        finally:
            conn.close()
        plan = create_publication_plan(
            user["id"],
            project_id=project.id,
            portfolio_id=work.id,
            channel_account_id=account_id,
        )
        self.assertEqual(
            [item.id for item in list_publication_plans(user["id"], project.id)],
            [plan.id],
        )
        draft = create_publication_plan(
            user["id"], project_id=project.id, name="Name-only draft",
        )
        self.assertEqual(draft.name, "Name-only draft")
        self.assertEqual(draft.status, "draft")
        self.assertEqual(draft.platform, "")
        self.assertFalse(draft.publishing_ready)
        self.assertIn(
            draft.id,
            [item.id for item in list_publication_plans(user["id"], project.id)],
        )
        material_set = create_project_material_set(
            user["id"],
            project.id,
            name="Campaign",
        )
        copy = create_project_material(
            user["id"], project.id, name="Publication text",
            media_type="document", mime_type="text/html", file_size=0, object_key="",
            material_set_id=material_set.id, content_html="<p>Snapshot</p>",
        )
        content = import_publication_materials(user["id"], plan.id, [copy.id])[0]
        self.assertEqual(get_publication_plan(user["id"], plan.id).document_count, 1)
        self.assertEqual([item.id for item in list_publication_contents(user["id"], plan.id)], [content.id])
        with self.assertRaisesRegex(ValueError, "already added"):
            import_publication_materials(user["id"], plan.id, [copy.id])
        delete_project_material(user["id"], project.id, copy.id)
        self.assertEqual(get_publication_document(user["id"], plan.id, content.id), "<p>Snapshot</p>")
        self.assertEqual(update_publication_plan(
            user["id"], plan.id, scheduled_for="2026-10-01T10:00:00Z", status="scheduled",
        ).status, "scheduled")
        delete_publication_content(user["id"], plan.id, content.id)
        self.assertEqual(get_publication_plan(user["id"], plan.id).status, "draft")
        saved_copy = update_publication_copy(
            user["id"], plan.id, title="Copy title", content="Saved body", tags=[" #Launch ", "Launch"],
        )
        self.assertEqual(get_publication_copy(user["id"], plan.id), saved_copy)
        self.assertEqual(saved_copy.tags, ["Launch"])
        copy_plan = get_publication_plan(user["id"], plan.id)
        self.assertTrue(copy_plan.has_copy)
        self.assertEqual((copy_plan.content_count, copy_plan.document_count), (1, 1))
        self.assertEqual(update_publication_plan(
            user["id"], plan.id, scheduled_for="2026-10-01T10:00:00Z", status="scheduled",
        ).status, "scheduled")
        update_publication_copy(user["id"], plan.id, title="", content=" \n ")
        self.assertEqual(get_publication_copy(user["id"], plan.id).tags, ["Launch"])
        update_publication_copy(user["id"], plan.id, title="", content="", tags=[])
        self.assertEqual(get_publication_copy(user["id"], plan.id).tags, [])
        cleared_plan = get_publication_plan(user["id"], plan.id)
        self.assertEqual((cleared_plan.status, cleared_plan.scheduled_for), ("draft", ""))
        self.assertFalse(cleared_plan.has_copy)
        material = create_project_material(
            user["id"],
            project.id,
            name="brief.md",
            media_type="document",
            mime_type="text/markdown",
            file_size=12,
            object_key=f"project-materials/{project.id}/brief.md",
            material_set_id=material_set.id,
        )
        self.assertEqual(
            [item.id for item in list_project_materials(
                user["id"], project.id, material_set.id,
            )],
            [material.id],
        )
        self.assertEqual(
            delete_project_material(user["id"], project.id, material_set.id),
            [material.object_key],
        )
        self.assertEqual(
            list_project_materials(user["id"], project.id),
            [],
        )

    def test_metadata_and_conflict_compatibility(self):
        from app.database import connect_database, is_postgresql

        conn = connect_database("")
        try:
            self.assertTrue(is_postgresql(conn))
            columns = {
                row[1]
                for row in conn.execute(
                    "PRAGMA table_info(project_memberships)",
                ).fetchall()
            }
            self.assertEqual(
                columns,
                {"project_id", "user_id", "role", "created_at"},
            )
            tables = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'",
                ).fetchall()
            }
            self.assertIn("content_projects", tables)
            self.assertIn("project_channel_accounts", tables)
            self.assertIn("project_publications", tables)
            self.assertIn("publication_contents", tables)
            self.assertIn("project_materials", tables)
        finally:
            conn.close()

    def test_publication_modes_concurrent_upload_and_image_ordering(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from unittest.mock import patch

        from app.auth import storage as auth_storage
        from app.engines.publishing import publication_contents, publication_plans
        from app.engines.publishing.projects import create_manual_project

        suffix = uuid.uuid4().hex[:8]
        user = auth_storage.create_user(f"mode-{suffix}", f"mode-{suffix}@example.com", "hash")
        project = create_manual_project(user["id"], title=f"Media {suffix}")
        plan = publication_plans.create_publication_plan(
            user["id"], project_id=project.id, name="Video race", media_mode="video",
        )
        barrier = Barrier(2)

        def upload_video(index):
            barrier.wait(timeout=5)
            try:
                return publication_contents.upload_publication_content(
                    user["id"], plan.id, filename=f"clip{index}.mp4", media_type="video", data=b"video",
                )
            except ValueError as exc:
                return str(exc)

        with (
            patch.object(publication_contents, "put_media_bytes"),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            results = list(executor.map(upload_video, range(2)))
        self.assertEqual(sum(isinstance(result, str) for result in results), 1)
        self.assertEqual(publication_plans.get_publication_plan(user["id"], plan.id).video_count, 1)
        image_plan = publication_plans.create_publication_plan(user["id"], project_id=project.id, name="Images")
        with patch.object(publication_contents, "put_media_bytes"):
            images = [
                publication_contents.upload_publication_content(
                    user["id"], image_plan.id, filename=f"image{index}.png", media_type="image", data=b"image",
                ) for index in range(3)
            ]
        ordered = publication_contents.reorder_publication_images(
            user["id"], image_plan.id, [image.id for image in reversed(images)],
        )
        self.assertEqual([item.id for item in ordered], [image.id for image in reversed(images)])
        self.assertEqual([item.position for item in ordered], [0, 1, 2])

    def test_postgres_scope_trigger_rejects_cross_project_rows(self):
        from app.auth import storage as auth_storage
        from app.database import connect_database
        from app.engines.publishing.projects import create_manual_project

        suffix = uuid.uuid4().hex[:8]
        first = auth_storage.create_user(
            f"first-{suffix}",
            f"first-{suffix}@example.com",
            "hash",
        )
        second = auth_storage.create_user(
            f"second-{suffix}",
            f"second-{suffix}@example.com",
            "hash",
        )
        project = create_manual_project(first["id"], title=f"Scope {suffix}")
        second_org = auth_storage.get_current_organization(second["id"])
        conn = connect_database("")
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO cases (
                        id, title, content_type, owner_id,
                        organization_id, project_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"cross-{suffix}",
                        "Cross project",
                        "image_text",
                        second["id"],
                        second_org["id"],
                        project.id,
                        "2026-01-01",
                        "2026-01-01",
                    ),
                )
            conn.rollback()
        finally:
            conn.close()
