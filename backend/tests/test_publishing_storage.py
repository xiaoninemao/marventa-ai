import sys
import tempfile
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_stub)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.storage import create_session, update_session
from app.auth import storage as auth_storage
from app.engines.publishing import storage as publishing_storage
from app.engines.publishing.storage import (
    create_manual_project,
    get_project,
    list_projects,
    ProjectNameExists,
)


class PublishingStorageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix=".publishing-", dir=Path(__file__).parent)
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "publishing_test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", db_path))
        self.enterContext(patch.object(content_storage, "DB_PATH", db_path))
        self.enterContext(patch.object(publishing_storage, "DB_PATH", db_path))
        self.user_id = auth_storage.create_user(
            f"user-{uuid.uuid4().hex[:8]}",
            f"{uuid.uuid4().hex[:8]}@example.com",
            "test-password-hash",
        )["id"]
        self.session = create_session(self.user_id)
        update_session(
            self.session.id,
            title="新品上市内容方案",
            status="completed",
        )


    def test_manual_content_creates_project(self):
        project = create_manual_project(
            self.user_id,
            title="手写草稿",
            platform_hint="xiaohongshu",
            content_type="image_text",
            final_snapshot={"title": "手写标题", "body": "手写正文", "tags": "#新品"},
            notes="发布管理手动创建",
        )
        saved = get_project(project.id, self.user_id)
        self.assertEqual(saved.source_session_id, "")
        self.assertEqual(saved.status, "active")
        self.assertEqual(saved.final_snapshot["title"], "手写标题")
        self.assertNotIn("media_assets", saved.final_snapshot)

    def test_project_names_are_unique_within_organization(self):
        first = create_manual_project(self.user_id, title="Launch Plan")

        with self.assertRaisesRegex(ProjectNameExists, "Project name already exists"):
            create_manual_project(self.user_id, title="  launch plan  ")
        with self.assertRaisesRegex(ProjectNameExists, "Project name already exists"):
            create_manual_project(
                self.user_id,
                title="LAUNCH PLAN",
            )

        self.assertEqual([project.id for project in list_projects(self.user_id)], [first.id])

    def test_new_project_receives_random_persisted_avatar(self):
        with patch.object(
            publishing_storage.projects.secrets,
            "choice",
            side_effect=["#e9d5ff", "🚀"],
        ):
            project = create_manual_project(self.user_id, title="Avatar Project")

        self.assertEqual(project.avatar_color, "#e9d5ff")
        self.assertEqual(project.avatar_icon, "🚀")
        saved = list_projects(self.user_id)[0]
        self.assertEqual(saved.avatar_color, "#e9d5ff")
        self.assertEqual(saved.avatar_icon, "🚀")


if __name__ == "__main__":
    unittest.main()
