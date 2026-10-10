import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import content_generator, publishing
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.ai_analyzer import build_reference_context
from app.engines.content_generator.models import AgentTurnResult
from app.engines.publishing import models as publishing_models
from app.engines.publishing import project_memberships, projects, storage


class PublishingRetirementTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(
            tempfile.TemporaryDirectory(prefix=".retirement-", dir=Path(__file__).parent),
        )
        self.db_path = str(Path(directory) / "test.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(content_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.user = auth_storage.create_user("owner", "owner@example.com", "test-hash")
        self.headers = {"Authorization": "Bearer " + create_access_token(self.user["id"])}
        self.project = storage.create_manual_project(self.user["id"], title="Existing project")
        self.task = SimpleNamespace(id="legacy-task")
        self.account = SimpleNamespace(id="legacy-account", account_name="Existing account")
        self.memory = SimpleNamespace(id="legacy-memory", brand_positioning="Retired private context")
        now = "2025-01-01 00:00:00"
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT INTO publish_tasks (
                    id, user_id, project_id, source_session_id, status,
                    final_snapshot, metrics, review, created_at, updated_at
                ) VALUES (?, ?, ?, '', 'reviewed', ?, ?, ?, ?, ?)""",
                (
                    self.task.id, self.user["id"], self.project.id,
                    '{"title":"Historical draft"}', '{"views":100}',
                    '{"summary":"Historical review"}', now, now,
                ),
            )
            conn.execute(
                """INSERT INTO social_accounts (
                    id, user_id, platform, account_name, session_dir,
                    credential_blob, profile, created_at, updated_at
                ) VALUES (?, ?, 'xiaohongshu', ?, '', ?, ?, ?, ?)""",
                (
                    self.account.id, self.user["id"], self.account.account_name,
                    "synthetic-legacy-credential", '{"nickname":"Historical account"}', now, now,
                ),
            )
            conn.execute(
                """INSERT INTO account_memories (
                    id, user_id, account_name, brand_positioning,
                    ai_operation_lessons, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    self.memory.id, self.user["id"], self.account.account_name,
                    self.memory.brand_positioning, '["Historical lesson"]', now, now,
                ),
            )
            conn.execute(
                """INSERT INTO publish_metrics (
                    id, task_id, user_id, views, raw_data, created_at, updated_at
                ) VALUES ('legacy-metric', ?, ?, 100, ?, ?, ?)""",
                (self.task.id, self.user["id"], '{"views":100}', now, now),
            )
            conn.execute(
                """INSERT INTO publish_reviews (
                    id, task_id, user_id, summary, success_reasons, created_at, updated_at
                ) VALUES ('legacy-review', ?, ?, ?, ?, ?, ?)""",
                (
                    self.task.id, self.user["id"], "Historical review",
                    '["Historical reason"]', now, now,
                ),
            )
        storage.init_db()
        self.app = FastAPI()
        self.app.include_router(publishing.router)
        self.app.include_router(content_generator.router)
        self.client = self.enterContext(TestClient(self.app))

    def legacy_rows(self):
        with sqlite3.connect(self.db_path) as conn:
            return {
                table: conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                for table in (
                    "publish_tasks", "publish_metrics", "publish_reviews",
                    "social_accounts", "account_memories",
                )
            }

    def test_retired_routes_return_404_and_preserve_legacy_data(self):
        before = self.legacy_rows()
        routes = (
            ("POST", "/tasks/from_session"),
            ("POST", "/tasks/from_project"),
            ("GET", "/tasks"),
            ("GET", f"/tasks/{self.task.id}"),
            ("PUT", f"/tasks/{self.task.id}"),
            ("POST", f"/tasks/{self.task.id}/review"),
            ("GET", f"/tasks/{self.task.id}/review"),
            ("GET", f"/tasks/{self.task.id}/metrics"),
            ("PUT", f"/tasks/{self.task.id}/metrics"),
            ("POST", f"/tasks/{self.task.id}/publish"),
            ("GET", "/accounts"),
            ("POST", "/accounts/login/start"),
            ("POST", "/accounts/login/inspect"),
            ("POST", "/accounts/login/save"),
            ("PUT", f"/accounts/{self.account.id}"),
            ("POST", "/accounts/manual_import"),
            ("GET", "/account_memories"),
            ("POST", "/account_memories"),
        )
        for headers in ({}, self.headers):
            for method, path in routes:
                with self.subTest(method=method, path=path, authenticated=bool(headers)):
                    response = self.client.request(
                        method, "/api/v1/publishing" + path, headers=headers,
                        json={"project_id": self.project.id, "id": self.memory.id},
                    )
                    self.assertEqual(response.status_code, 404)
        storage.init_db()
        self.assertEqual(self.legacy_rows(), before)

    def test_openapi_exposes_projects_but_no_retired_routes_or_models(self):
        schema = self.app.openapi()
        paths = schema["paths"]
        for path in paths:
            self.assertFalse(path.startswith((
                "/api/v1/publishing/tasks",
                "/api/v1/publishing/accounts",
                "/api/v1/publishing/account_memories",
            )), path)
        expected_project_methods = {
            "/publications": {"get", "post"},
            "/publications/{plan_id}": {"get", "patch", "delete"},
            "/publications/{plan_id}/work": {"put"},
            "/publications/{plan_id}/copy": {"get"},
            "/publications/{plan_id}/contents": {"get"},
            "/projects": {"get"},
            "/projects/manual": {"post"},
            "/projects/{project_id}": {"get", "patch", "delete"},
            "/projects/{project_id}/members": {"get", "post"},
            "/projects/{project_id}/members/{member_user_id}": {"patch", "delete"},
            "/projects/{project_id}/channel-accounts": {"get"},
            "/projects/{project_id}/channel-accounts/authorization": {"post"},
            "/projects/{project_id}/channel-accounts/authorization/xiaohongshu/poll": {"post"},
            "/projects/{project_id}/channel-accounts/{account_id}": {"delete"},
            "/projects/{project_id}/materials": {"get", "post"},
            "/projects/{project_id}/materials/copy": {"post"},
            "/projects/{project_id}/materials/{material_id}/content": {"get", "patch"},
            "/projects/{project_id}/material-sets": {"post"},
            "/projects/{project_id}/material-sets/{material_set_id}": {"put"},
            "/projects/{project_id}/materials/{material_id}": {"delete", "put"},
            "/channel-accounts/oauth/douyin/callback": {"get"},
        }
        for path, methods in expected_project_methods.items():
            self.assertEqual(set(paths["/api/v1/publishing" + path]), methods)
        for path in (
            "/publications/{plan_id}/schedule-work",
            "/publications/{plan_id}/contents/from-materials",
            "/publications/{plan_id}/contents/order",
            "/publications/{plan_id}/contents/{content_id}/content",
            "/publications/{plan_id}/contents/{content_id}",
        ):
            self.assertNotIn("/api/v1/publishing" + path, paths)
        self.assertNotIn("/api/v1/publishing/projects/{project_id}/media", paths)
        self.assertNotIn("/api/v1/publishing/projects/{project_id}/media/{media_id}", paths)
        models = schema["components"]["schemas"]
        copy_model = models["ProjectMaterialCopyCreate"]
        self.assertEqual(set(copy_model["required"]), {"material_set_id", "title", "content"})
        self.assertEqual(copy_model["properties"]["title"]["maxLength"], 255)
        self.assertEqual(copy_model["properties"]["content"]["maxLength"], 1024 * 1024)
        self.assertEqual(
            set(models["ProjectMaterialContentUpdate"]["required"]), {"content"},
        )
        self.assertEqual(set(models["ProjectMaterialContentUpdate"]["properties"]), {"content"})
        self.assertFalse(models["ProjectMaterialContentUpdate"]["additionalProperties"])
        for name in (
            "CreateTaskRequest", "CreateTaskFromProjectRequest", "UpdateTaskRequest",
            "GenerateReviewRequest", "UpsertMetricRequest", "PublishExecuteRequest",
            "StartLoginRequest", "InspectLoginRequest", "SaveLoginRequest",
            "ManualAccountImportRequest", "UpdateSocialAccountRequest",
            "UpsertAccountMemoryRequest",
            "PublicationWorkSchedule", "PublicationContentsFromMaterials", "PublicationContentOrder",
        ):
            self.assertNotIn(name, models)
            self.assertFalse(hasattr(publishing_models, name))
        for name in ("ChatRequest", "SessionCreate"):
            self.assertFalse(set(models[name]["properties"]) & {
                "account_memory_id", "account_memory_ids", "account_name", "publish_task_id",
            })
        self.assertNotIn(
            "marketing_channels",
            models["UpdateProjectRequest"]["properties"],
        )

    def test_legacy_project_storage_exports_remain_compatible(self):
        for name in (
            "PROJECT_AVATAR_COLORS", "PROJECT_AVATAR_ICONS", "ProjectNameExists",
            "create_manual_project",
            "delete_project", "get_project", "list_projects",
            "update_project",
        ):
            with self.subTest(name=name):
                self.assertIs(getattr(storage, name), getattr(projects, name))
        for name in ("ProjectNotFound", "ProjectPermissionDenied"):
            with self.subTest(name=name):
                self.assertIs(getattr(storage, name), getattr(project_memberships, name))
        self.assertIs(storage.ContentProject, publishing_models.ContentProject)

    def test_retired_storage_apis_and_record_models_are_removed(self):
        for name in (
            "create_task_from_session", "create_task_from_project", "get_task", "update_task",
            "upsert_publish_metric", "get_publish_metric", "save_publish_review",
            "get_publish_review", "create_social_account", "list_social_accounts",
            "get_social_account", "update_social_account", "create_account_memory",
            "get_account_memory", "upsert_account_memory", "generate_review_for_task",
        ):
            with self.subTest(api=name):
                self.assertFalse(hasattr(storage, name))
        for name in (
            "PublishTask", "PublishMetric", "PublishReview",
            "SocialAccount", "AccountMemory", "ReviewConclusion",
        ):
            with self.subTest(model=name):
                self.assertFalse(hasattr(publishing_models, name))

    def test_project_crud_still_works_on_legacy_namespace(self):
        base = "/api/v1/publishing/projects"
        self.assertEqual(self.client.get(base).status_code, 401)
        response = self.client.post(
            base + "/manual", headers=self.headers, json={"title": "New project"},
        )
        self.assertEqual(response.status_code, 200)
        project_id = response.json()["data"]["id"]
        path = base + "/" + project_id
        response = self.client.get(base, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn(project_id, [item["id"] for item in response.json()["data"]])
        response = self.client.patch(path, headers=self.headers, json={"title": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["title"], "Renamed")
        response = self.client.get(path + "/members", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["user_id"], self.user["id"])
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("media_assets", response.json()["data"])
        self.assertEqual(self.client.post(path + "/media", headers=self.headers).status_code, 404)
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get(path, headers=self.headers).status_code, 404)

    def test_content_chat_and_project_snapshot_do_not_use_account_memory(self):
        before = self.legacy_rows()
        session = content_storage.create_session(self.user["id"], self.project.id, "Canvas")
        path = f"/api/v1/content_generator/sessions/{session.id}/chat"

        def draft_reply(messages, **kwargs):
            self.assertEqual(messages, [{"role": "user", "content": "Create a draft"}])
            self.assertEqual(kwargs["reference_context"], "")
            return AgentTurnResult(intent="explore", reply="Draft reply")

        response = self.client.post(path, headers=self.headers, json={
            "message": "Create a draft",
            "account_memory_ids": [self.memory.id],
            "account_name": self.account.account_name,
        })
        self.assertEqual(response.status_code, 422)
        with patch.object(
            content_generator,
            "run_creation_agent",
            side_effect=draft_reply,
        ) as agent:
            response = self.client.post(
                path, headers=self.headers, json={"message": "Create a draft"},
            )
        self.assertEqual(response.status_code, 200)
        agent.assert_called_once()
        self.assertNotIn("account_memory_ids", response.json()["data"]["session"])
        response = self.client.post(
            "/api/v1/publishing/projects/from_session", headers=self.headers,
            json={"source_session_id": session.id, "title": "Saved draft"},
        )
        self.assertEqual(response.status_code, 405)
        self.assertEqual(self.legacy_rows(), before)

    def test_content_reference_context_keeps_insights_and_cases(self):
        insight = SimpleNamespace(product_name="Product reference", ai_analysis=None)
        case = SimpleNamespace(
            title="Case reference", content_type="video", description="Useful example",
            tags=["campaign"], ai_analysis=None,
        )
        with (
            patch("app.engines.market_insight.storage.get_insight", return_value=insight) as get_insight,
            patch("app.engines.case_library.storage.get_case", return_value=case) as get_case,
        ):
            context = build_reference_context(["insight"], ["case"], self.user["id"])
        get_insight.assert_called_once_with("insight", self.user["id"])
        get_case.assert_called_once_with("case", self.user["id"])
        self.assertIn("Product reference", context)
        self.assertIn("Case reference", context)
        self.assertNotIn(self.memory.brand_positioning, context)
