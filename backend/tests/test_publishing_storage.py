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

from app.engines.content_generator.models import ContentCard
from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.storage import create_session, update_session
from app.auth import storage as auth_storage
from app.engines.publishing import storage as publishing_storage
from app.engines.publishing.storage import (
    create_manual_project,
    create_project_from_session,
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
        self.cards = [
            ContentCard(
                id="title-card",
                card_type="title",
                title="标题版本",
                preview="标题 A / 标题 B",
                content="1. 三分钟看懂新品卖点\n2. 这款新品解决了什么痛点",
                tips=["保留痛点钩子"],
            ),
            ContentCard(
                id="copy-card",
                card_type="copy",
                title="正文版本",
                preview="正文 A",
                content="痛点开场，场景展开，最后引导评论。",
                tips=["评论区引导"],
            ),
        ]
        update_session(
            self.session.id,
            title="新品上市内容方案",
            cards=self.cards,
            status="completed",
        )

    def test_project_keeps_creation_snapshot(self):
        project = create_project_from_session(
            self.user_id,
            self.session.id,
            title="新品上市 Q2",
            xhs_account="品牌小红书号",
        )
        update_session(self.session.id, cards=[], title="Changed source")
        saved = get_project(project.id, self.user_id)
        self.assertEqual(saved.source_session_id, self.session.id)
        self.assertEqual(saved.cards_snapshot[0].id, "title-card")
        self.assertEqual(saved.final_snapshot["title"], "标题版本")
        self.assertIn(project.avatar_color, publishing_storage.PROJECT_AVATAR_COLORS)
        self.assertIn(project.avatar_icon, publishing_storage.PROJECT_AVATAR_ICONS)

        projects = list_projects(self.user_id, xhs_account="品牌小红书号")
        self.assertEqual([item.id for item in projects], [project.id])

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
            create_project_from_session(
                self.user_id,
                self.session.id,
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
