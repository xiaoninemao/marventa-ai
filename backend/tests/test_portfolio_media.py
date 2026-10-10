import base64
import json
import unittest
from unittest.mock import patch

from app import media_storage
from app.api import portfolio as portfolio_api
from app.engines.content_generator import storage as creation_storage
from app.engines.content_generator.models import CreativeDeliverable
from app.engines.portfolio import storage
from app.engines.portfolio.models import ScriptEdit
from tests import test_content_material_references as references


class PortfolioMediaTests(unittest.TestCase):
    headers = references.ContentMaterialReferenceTests.headers
    upload = references.ContentMaterialReferenceTests.upload
    legacy = references.ContentMaterialReferenceTests.legacy
    create_copy = references.ContentMaterialReferenceTests.create_copy

    @staticmethod
    def png_bytes():
        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )

    def setUp(self):
        references.ContentMaterialReferenceTests.setUp(self)
        self.client.app.include_router(portfolio_api.router)

    def save_work(self, kind="image"):
        urls = []
        for index in range(3 if kind == "image" else 1):
            key = f"content-generator/org/{self.project.id}/asset-{index}.{'png' if kind == 'image' else 'mp4'}"
            media_storage.put_media_bytes(key, b"media", content_type="image/png" if kind == "image" else "video/mp4")
            urls.append(media_storage.media_url(key, "http://testserver"))
        work = CreativeDeliverable(
            id="native-work", media_kind=kind, title="Saved title", publication_copy="原文文案 / Original copy",
            tags=["brand"], image_url=urls[0] if kind == "image" else "",
            additional_image_urls=urls[1:] if kind == "image" else [],
            video_url=urls[0] if kind == "video" else "", created_at="2026-10-09T00:00:00Z",
        )
        creation_storage.update_session(self.creation.id, deliverables=[work])
        response = self.client.post(self.path + "/save-work", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        work_id = response.json()["data"]["work_id"]
        response = self.client.get(f"/api/v1/portfolio/scripts/{work_id}", headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"], urls

    def edit_title(self, work_id, title):
        current = storage.get_script(work_id)
        return storage.edit_script(self.owner["id"], work_id, ScriptEdit(
            title=title, content=current.content, tags=current.tags,
            media_ids=[item.id for item in current.media], expected_updated_at=current.updated_at,
        ), [])

    def test_saved_work_keeps_original_media_copy_and_order_without_another_ai_call(self):
        with patch("app.ai_provider.get_ai_provider", side_effect=AssertionError("Saving must not call AI")):
            work, urls = self.save_work()
        self.assertEqual(work["content"], "原文文案 / Original copy")
        self.assertEqual(work["title"], "Saved title")
        self.assertEqual(work["tags"], ["brand"])
        self.assertEqual(len(work["media"]), 3)
        self.assertEqual(work["source_version_id"], "native-work")
        for item in work["media"]:
            self.assertTrue(item["object_key"].startswith("portfolio/"))
            self.assertEqual(media_storage.read_media_bytes(item["object_key"]), b"media")
        for url in urls:
            media_storage.delete_media(media_storage.media_key_from_url(url))
        for item in work["media"]:
            self.assertTrue(media_storage.media_exists(item["object_key"]))

    def test_reordering_is_persistent_and_repeat_saves_do_not_reset_it(self):
        work, _ = self.save_work()
        order = [item["id"] for item in reversed(work["media"])]
        path = f"/api/v1/portfolio/scripts/{work['id']}"
        response = self.client.put(path, headers=self.headers(), json={
            "media_order": order, "expected_updated_at": work["updated_at"],
        })
        self.assertEqual(response.status_code, 200, response.text)
        saved = self.client.get(path, headers=self.headers()).json()["data"]
        self.assertEqual([item["id"] for item in saved["media"]], order)
        replay = self.client.post(self.path + "/save-work", headers=self.headers())
        self.assertEqual(replay.json()["data"]["work_id"], work["id"])
        self.assertEqual([item.id for item in storage.get_script(work["id"]).media], order)
        self.assertEqual(self.client.put(path, headers=self.headers(), json={
            "media_order": order, "expected_updated_at": work["updated_at"],
        }).status_code, 409)

    def test_invalid_or_foreign_reorder_cannot_change_media(self):
        work, _ = self.save_work()
        path = f"/api/v1/portfolio/scripts/{work['id']}"
        for order in [[], ["unknown"], [item["id"] for item in work["media"][:-1]],
                      [work["media"][0]["id"]] * 3]:
            response = self.client.put(path, headers=self.headers(), json={
                "media_order": order, "expected_updated_at": work["updated_at"],
            })
            self.assertEqual(response.status_code, 409, response.text)
        response = self.client.put(path, headers=self.headers(self.outsider), json={
            "media_order": [item["id"] for item in work["media"]],
            "expected_updated_at": work["updated_at"],
        })
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(len(storage.get_script(work["id"]).media), 3)

    def test_video_work_saves_one_video_and_rejects_reordering(self):
        work, _ = self.save_work("video")
        self.assertEqual(work["media_kind"], "video")
        self.assertEqual(len(work["media"]), 1)
        self.assertEqual(work["media"][0]["media_type"], "video")
        response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}", headers=self.headers(), json={
            "media_order": [work["media"][0]["id"]], "expected_updated_at": work["updated_at"],
        })
        self.assertEqual(response.status_code, 409, response.text)

    def test_publication_import_keeps_saved_media_order_and_original_copy(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        order = [item["id"] for item in reversed(work["media"])]
        storage.reorder_media(self.owner["id"], work["id"], order, work["updated_at"])
        plan = publication_plans.create_publication_plan(
            self.owner["id"], project_id=self.project.id, name=work["name"],
        )
        plan = publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
        items = publication_contents.list_publication_contents(self.owner["id"], plan.id)
        original_by_id = {item["id"]: item["name"] for item in work["media"]}
        self.assertEqual([item.name for item in items], [original_by_id[item] for item in order])
        copy = publication_contents.get_publication_copy(self.owner["id"], plan.id)
        self.assertEqual(copy.content, work["content"])
        self.assertEqual(copy.tags, ["brand"])
        storage.delete_script(work["id"])
        for item in items:
            self.assertTrue(media_storage.media_exists(item.object_key))

    def test_failed_copy_does_not_leave_a_partial_portfolio_work(self):
        source = CreativeDeliverable(
            id="missing", media_kind="image", title="Missing", publication_copy="Copy",
            image_url="http://testserver/media/content-generator/org/project/missing.png",
            created_at="2026-10-09T00:00:00Z",
        )
        creation_storage.update_session(self.creation.id, deliverables=[source])
        response = self.client.post(self.path + "/save-work", headers=self.headers())
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(storage.list_scripts(self.owner["id"], self.project.id), [])

    def test_failed_later_copy_cleans_already_written_snapshot_files(self):
        key = f"content-generator/org/{self.project.id}/existing.png"
        media_storage.put_media_bytes(key, b"image", content_type="image/png")
        work = CreativeDeliverable(
            id="partial", media_kind="image", title="Partial", publication_copy="Copy",
            image_url=media_storage.media_url(key, "http://testserver"),
            additional_image_urls=["http://testserver/media/content-generator/missing.png"],
            created_at="2026-10-09T00:00:00Z",
        )
        creation_storage.update_session(self.creation.id, deliverables=[work])
        response = self.client.post(self.path + "/save-work", headers=self.headers())
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(media_storage.list_media_keys("portfolio"), [])
        self.assertTrue(media_storage.media_exists(key))

    def test_text_edits_invalidate_older_media_order_versions(self):
        work, _ = self.save_work()
        self.edit_title(work["id"], "Renamed")
        with self.assertRaisesRegex(ValueError, "Work changed"):
            storage.reorder_media(self.owner["id"], work["id"], [item["id"] for item in work["media"]], work["updated_at"])

    def test_atomic_edit_updates_text_tags_uploads_removals_and_order(self):
        work, source_urls = self.save_work()
        removed = work["media"][0]
        kept = work["media"][1:]
        image = self.png_bytes()
        response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}/edit", headers=self.headers(),
            data={"metadata": json.dumps({
                "title": "Edited title", "content": "Edited copy", "tags": ["#new", "new", "brand"],
                "media_ids": [kept[1]["id"], "upload:0", kept[0]["id"]],
                "expected_updated_at": work["updated_at"],
            })},
            files=[("files", ("new.png", image, "image/png"))],
        )
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()["data"]
        self.assertEqual(saved["title"], "Edited title")
        self.assertEqual(saved["content"], "Edited copy")
        self.assertEqual(saved["tags"], ["new", "brand"])
        self.assertEqual([saved["media"][index]["id"] for index in (0, 2)], [kept[1]["id"], kept[0]["id"]])
        self.assertEqual(media_storage.read_media_bytes(saved["media"][1]["object_key"]), image)
        self.assertFalse(media_storage.media_exists(removed["object_key"]))
        self.assertTrue(media_storage.media_exists(media_storage.media_key_from_url(source_urls[0])))
        loaded = self.client.get(f"/api/v1/portfolio/scripts/{work['id']}", headers=self.headers()).json()["data"]
        self.assertEqual(loaded["media"], saved["media"])

    def test_failed_edit_keeps_existing_work_and_cleans_new_uploads(self):
        work, _ = self.save_work()
        original_keys = media_storage.list_media_keys("portfolio")
        response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}/edit", headers=self.headers(),
            data={"metadata": json.dumps({
                "title": "Must not persist", "content": "New copy", "tags": [],
                "media_ids": ["upload:0", "upload:1"], "expected_updated_at": work["updated_at"],
            })},
            files=[("files", ("good.png", self.png_bytes(), "image/png")),
                   ("files", ("bad.png", b"not an image", "image/png"))],
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(sorted(media_storage.list_media_keys("portfolio")), sorted(original_keys))
        self.assertEqual(storage.get_script(work["id"]).title, work["title"])

    def test_edit_checks_conflicts_access_and_video_count(self):
        work, _ = self.save_work("video")
        data = {"title": "Edit", "content": "Copy", "tags": [],
                "media_ids": [work["media"][0]["id"]], "expected_updated_at": "stale"}
        path = f"/api/v1/portfolio/scripts/{work['id']}/edit"
        response = self.client.put(path, headers=self.headers(), data={"metadata": json.dumps(data)})
        self.assertEqual(response.status_code, 409, response.text)
        data["expected_updated_at"] = work["updated_at"]
        response = self.client.put(path, headers=self.headers(self.outsider), data={"metadata": json.dumps(data)})
        self.assertEqual(response.status_code, 404, response.text)
        data["media_ids"].append("upload:0")
        response = self.client.put(path, headers=self.headers(), data={"metadata": json.dumps(data)},
            files=[("files", ("another.mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4"))])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(len(storage.get_script(work["id"]).media), 1)

    def test_video_edit_replaces_the_existing_video_without_adding_a_second(self):
        work, _ = self.save_work("video")
        old_key = work["media"][0]["object_key"]
        response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}/edit", headers=self.headers(),
            data={"metadata": json.dumps({
                "title": work["title"], "content": "Updated video copy", "tags": ["video"],
                "media_ids": ["upload:0"], "expected_updated_at": work["updated_at"],
            })}, files=[("files", ("replacement.mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4"))])
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()["data"]
        self.assertEqual(updated["media_kind"], "video")
        self.assertEqual(len(updated["media"]), 1)
        self.assertEqual(updated["media"][0]["media_type"], "video")
        self.assertFalse(media_storage.media_exists(old_key))

    def test_material_and_local_upload_are_copied_into_the_requested_order(self):
        work, _ = self.save_work()
        keep = work["media"][0]["id"]
        data = {"title": "Material work", "content": "Copy", "tags": ["material"],
                "media_ids": [f"material:{self.image['id']}", keep, "upload:0"],
                "expected_updated_at": work["updated_at"]}
        response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}/edit", headers=self.headers(),
            data={"metadata": json.dumps(data)},
            files=[("files", ("local.png", self.png_bytes(), "image/png"))])
        self.assertEqual(response.status_code, 200, response.text)
        media = response.json()["data"]["media"]
        self.assertEqual(len(media), 3)
        self.assertEqual(media[0]["name"], self.image["name"])
        self.assertEqual(media[1]["id"], keep)
        self.assertEqual(media[2]["name"], "local.png")
        self.assertNotEqual(media[0]["object_key"], self.image["object_key"])
        media_storage.delete_media(self.image["object_key"])
        self.assertEqual(media_storage.read_media_bytes(media[0]["object_key"]), b"image")

    def test_material_import_rejects_other_projects_and_wrong_media_types(self):
        from app.engines.publishing import project_materials
        from app.engines.publishing import storage as publishing_storage

        work, _ = self.save_work()
        other = publishing_storage.create_manual_project(self.owner["id"], title="Other project")
        other_set = project_materials.create_project_material_set(self.owner["id"], other.id, name="Other images")
        foreign = project_materials.create_project_material(
            self.owner["id"], other.id, name="Foreign", media_type="image",
            mime_type="image/png", file_size=5, object_key=self.image["object_key"],
            material_set_id=other_set.id,
        )
        path = f"/api/v1/portfolio/scripts/{work['id']}/edit"
        for material_id, expected in ((foreign.id, 404), (self.video["id"], 422), ("missing", 404)):
            response = self.client.put(path, headers=self.headers(), data={"metadata": json.dumps({
                "title": "Must not change", "content": "Copy", "tags": [],
                "media_ids": [f"material:{material_id}"], "expected_updated_at": work["updated_at"],
            })})
            self.assertEqual(response.status_code, expected, response.text)
            self.assertEqual(storage.get_script(work["id"]).title, work["title"])

    def test_named_work_creation_persists_type_without_requiring_copy_or_media(self):
        with patch("app.ai_provider.get_ai_provider", side_effect=AssertionError("Creation must not call AI")):
            for kind in ("image", "video"):
                response = self.client.post("/api/v1/portfolio/scripts", headers=self.headers(), json={
                    "name": "  New work  ", "project_id": self.project.id, "media_kind": kind,
                })
                self.assertEqual(response.status_code, 200, response.text)
                work = response.json()["data"]
                self.assertEqual(work["name"], "New work")
                self.assertEqual(work["title"], "")
                self.assertEqual(work["project_title"], self.project.title)
                self.assertEqual(work["media_kind"], kind)
                self.assertEqual(work["status"], "draft")
                self.assertEqual(work["content"], "")
                self.assertEqual(work["media"], [])
                self.assertEqual(work["tags"], [])
                loaded = self.client.get(f"/api/v1/portfolio/scripts/{work['id']}", headers=self.headers()).json()["data"]
                self.assertEqual(loaded["media_kind"], kind)
                self.assertEqual(loaded["name"], "New work")
                self.assertEqual(loaded["title"], "")
        self.assertEqual(len(storage.list_scripts(self.owner["id"])), 2)
        self.assertEqual(media_storage.list_media_keys("portfolio"), [])

    def test_named_work_creation_validates_names_types_and_project_access(self):
        data = {"name": "New work", "project_id": self.project.id, "media_kind": "image"}
        for overrides in [{"name": " "}, {"name": "x" * 201}, {"media_kind": "audio"}]:
            response = self.client.post("/api/v1/portfolio/scripts", headers=self.headers(), json={**data, **overrides})
            self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post("/api/v1/portfolio/scripts", headers=self.headers(self.outsider), json=data)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(storage.list_scripts(self.owner["id"]), [])

    def test_media_can_be_added_to_a_named_empty_work_without_mandatory_copy(self):
        for kind in ("image", "video"):
            response = self.client.post("/api/v1/portfolio/scripts", headers=self.headers(), json={
                "name": "Empty work", "project_id": self.project.id, "media_kind": kind,
            })
            self.assertEqual(response.status_code, 200, response.text)
            work = response.json()["data"]
            file = ("image.png", self.png_bytes(), "image/png") if kind == "image" else (
                "video.mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4")
            response = self.client.put(f"/api/v1/portfolio/scripts/{work['id']}/edit", headers=self.headers(),
                data={"metadata": json.dumps({
                    "title": work["title"], "content": "", "tags": [], "media_ids": ["upload:0"],
                    "expected_updated_at": work["updated_at"],
                })}, files=[("files", file)])
            self.assertEqual(response.status_code, 200, response.text)
            saved = response.json()["data"]
            self.assertEqual(saved["content"], "")
            self.assertEqual(saved["name"], "Empty work")
            self.assertEqual(saved["title"], "")
            self.assertEqual(saved["project_title"], self.project.title)
            self.assertEqual(saved["media_kind"], kind)
            self.assertEqual(saved["status"], "completed")
            self.assertEqual(saved["media"][0]["media_type"], kind)
            self.assertEqual(len(saved["media"]), 1)

    def test_work_names_and_publication_titles_are_independent_and_version_fenced(self):
        work, _ = self.save_work()
        path = f"/api/v1/portfolio/scripts/{work['id']}"
        renamed = self.client.put(path, headers=self.headers(), json={"name": "Management name"})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        named = renamed.json()["data"]
        self.assertEqual(named["name"], "Management name")
        self.assertEqual(named["title"], work["title"])
        metadata = {"title": "Public title", "content": work["content"], "tags": work["tags"],
                    "media_ids": [item["id"] for item in work["media"]], "expected_updated_at": work["updated_at"]}
        self.assertEqual(self.client.put(path + "/edit", headers=self.headers(),
            data={"metadata": json.dumps(metadata)}).status_code, 409)
        metadata["expected_updated_at"] = named["updated_at"]
        response = self.client.put(path + "/edit", headers=self.headers(), data={"metadata": json.dumps(metadata)})
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()["data"]
        self.assertEqual(saved["name"], "Management name")
        self.assertEqual(saved["title"], "Public title")
        replay = self.client.post(self.path + "/save-work", headers=self.headers())
        self.assertEqual(replay.json()["data"]["work_id"], work["id"])
        loaded = self.client.get(path, headers=self.headers()).json()["data"]
        self.assertEqual((loaded["name"], loaded["title"]), ("Management name", "Public title"))
        for invalid in [" ", "x" * 201, None]:
            response = self.client.put(path, headers=self.headers(), json={"name": invalid})
            self.assertEqual(response.status_code, 422, response.text)
        response = self.client.put(path, headers=self.headers(self.outsider), json={"name": "Foreign rename"})
        self.assertEqual(response.status_code, 404, response.text)

    def test_publication_plan_uses_the_work_name_and_imports_only_the_content_title(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        storage.update_script(work["id"], name="Portfolio display name")
        self.edit_title(work["id"], "Publication headline")
        plan = publication_plans.create_publication_plan(
            self.owner["id"], project_id=self.project.id, name="Portfolio display name",
        )
        plan = publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
        self.assertEqual(plan.name, "Portfolio display name")
        self.assertEqual(plan.portfolio_title, "Portfolio display name")
        copy = publication_contents.get_publication_copy(self.owner["id"], plan.id)
        self.assertEqual(copy.title, "Publication headline")
        storage.update_script(work["id"], name="New management name")
        self.assertEqual(publication_contents.get_publication_copy(self.owner["id"], plan.id).title, "Publication headline")

    def test_existing_names_are_migrated_once_without_rebinding_after_content_title_changes(self):
        work, _ = self.save_work()
        conn = storage._get_conn()
        conn.execute("ALTER TABLE portfolio DROP COLUMN name")
        conn.commit()
        conn.close()
        storage.init_db()
        migrated = storage.get_script(work["id"])
        self.assertEqual(migrated.name, work["title"])
        self.assertEqual(migrated.updated_at, work["updated_at"])
        self.edit_title(work["id"], "Different public title")
        storage.init_db()
        loaded = storage.get_script(work["id"])
        self.assertEqual(loaded.name, work["title"])
        self.assertEqual(loaded.title, "Different public title")

    def publication_account(self, platform="douyin"):
        conn = storage._get_conn()
        conn.execute(
            "INSERT INTO project_channel_accounts (id, project_id, platform, account_name, platform_user_id, "
            "created_by_user_id, authorization_status, scopes, credential_blob, created_at, updated_at) "
            "VALUES ('scheduled-account', ?, ?, 'Account', 'open-check', ?, 'active', '[]', '', '2026-01-01', '2026-01-01')",
            (self.project.id, platform, self.owner["id"]),
        )
        conn.commit()
        conn.close()
        return "scheduled-account"

    def test_work_selection_then_settings_commits_ready_plan(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        account = self.publication_account()
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"):
            plan = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Release")
            plan = publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
            plan = publication_plans.update_publication_plan(
                self.owner["id"], plan.id,
                channel_account_id=account, scheduled_for="2026-10-12T09:00:00+08:00",
            )
        self.assertEqual(plan.status, "scheduled")
        self.assertEqual(plan.image_count, 3)
        self.assertEqual(plan.channel_account_id, account)
        copy = publication_contents.get_publication_copy(self.owner["id"], plan.id)
        self.assertEqual(copy.title, work["title"])
        self.assertEqual(copy.content, work["content"])
        assets = publication_contents.list_publication_contents(self.owner["id"], plan.id)
        self.assertTrue(all(item.object_key not in {value["object_key"] for value in work["media"]} for item in assets))

    def test_invalid_settings_preserve_draft_and_copied_files(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work()
        account = self.publication_account()
        plan = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Draft")
        publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
        original_keys = sorted(media_storage.list_media_keys("publishing"))
        for overrides in [
            {"channel_account_id": "missing"}, {"scheduled_for": "2026-10-09T09:00:00Z"},
            {"scheduled_for": "2026-10-12T09:00:00"},
        ]:
            values = {"channel_account_id": account, "scheduled_for": "2026-10-12T09:00:00+08:00"}
            values.update(overrides)
            with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"), self.assertRaises((ValueError, LookupError)):
                publication_plans.update_publication_plan(self.owner["id"], plan.id, **values)
        conn = storage._get_conn()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM project_publications").fetchone()[0], 1)
        conn.close()
        self.assertEqual(sorted(media_storage.list_media_keys("publishing")), original_keys)

    def test_selection_cleans_media_when_post_import_read_fails(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work()
        plan = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Draft")
        original_keys = sorted(media_storage.list_media_keys("publishing"))
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"), patch.object(
            publication_plans, "_row_to_plan", side_effect=ValueError("Invalid media"),
        ), self.assertRaisesRegex(ValueError, "Invalid media"):
            publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
        self.assertEqual(sorted(media_storage.list_media_keys("publishing")), original_keys)

    def test_video_settings_reject_unsupported_accounts(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work("video")
        account = self.publication_account()
        plan = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Video")
        publication_plans.select_publication_work(self.owner["id"], plan.id, portfolio_id=work["id"])
        values = {"channel_account_id": account, "scheduled_for": "2026-10-12T09:00:00+08:00"}
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"):
            plan = publication_plans.update_publication_plan(self.owner["id"], plan.id, **values)
        self.assertEqual(plan.status, "scheduled")
        self.assertEqual(plan.video_count, 1)
        conn = storage._get_conn()
        conn.execute("UPDATE project_channel_accounts SET platform = 'xiaohongshu' WHERE id = ?", (account,))
        conn.commit()
        conn.close()
        publication_plans.update_publication_plan(self.owner["id"], plan.id, status="cancelled")
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"), self.assertRaisesRegex(
            ValueError, "Xiaohongshu",
        ):
            publication_plans.update_publication_plan(self.owner["id"], plan.id, **values)

    def test_draft_plan_selects_work_later_without_creating_a_second_plan(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        account = self.publication_account()
        draft = publication_plans.create_publication_plan(
            self.owner["id"], project_id=self.project.id, name="Independent plan name",
        )
        self.assertEqual(draft.status, "draft")
        self.assertEqual(draft.content_count, 0)
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"):
            publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=work["id"])
            scheduled = publication_plans.update_publication_plan(
                self.owner["id"], draft.id, channel_account_id=account,
                scheduled_for="2026-10-12T09:00:00+08:00",
            )
        self.assertEqual(scheduled.id, draft.id)
        self.assertEqual(scheduled.name, "Independent plan name")
        self.assertEqual(scheduled.status, "scheduled")
        self.assertEqual(scheduled.image_count, 3)
        self.assertEqual(publication_contents.get_publication_copy(self.owner["id"], draft.id).title, work["title"])
        with self.assertRaisesRegex(ValueError, "Scheduled plans"):
            publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=work["id"])

    def test_failed_work_selection_preserves_an_existing_draft_snapshot(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        draft = publication_plans.create_publication_plan(
            self.owner["id"], project_id=self.project.id, name="Existing draft",
        )
        publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=work["id"])
        originals = publication_contents.list_publication_contents(self.owner["id"], draft.id)
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"), patch.object(
            publication_plans, "_row_to_plan", side_effect=ValueError("Validation failed"),
        ), self.assertRaisesRegex(ValueError, "Validation failed"):
            publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=work["id"])
        restored = publication_plans.get_publication_plan(self.owner["id"], draft.id)
        self.assertEqual(restored.status, "draft")
        self.assertEqual([item.id for item in publication_contents.list_publication_contents(self.owner["id"], draft.id)],
            [item.id for item in originals])
        self.assertTrue(all(media_storage.media_exists(item.object_key) for item in originals))

    def test_work_selection_endpoint_checks_scope_and_updates_the_same_plan(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work("video")
        draft = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Video plan")
        path = f"/api/v1/publishing/publications/{draft.id}/work"
        data = {"portfolio_id": work["id"]}
        response = self.client.put(path, headers=self.headers(self.outsider), json=data)
        self.assertEqual(response.status_code, 404, response.text)
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 00:00:00"):
            response = self.client.put(path, headers=self.headers(), json=data)
        self.assertEqual(response.status_code, 200, response.text)
        scheduled = response.json()["data"]
        self.assertEqual(scheduled["id"], draft.id)
        self.assertEqual(scheduled["name"], "Video plan")
        self.assertEqual(scheduled["media_mode"], "video")
        self.assertEqual(scheduled["video_count"], 1)

    def test_scheduling_tomorrow_uses_the_request_timezone_not_server_calendar_day(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work()
        account = self.publication_account()
        draft = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Midnight plan")
        with patch.object(publication_plans, "_clock", return_value="2026-10-10 15:00:00"):
            publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=work["id"])
            scheduled = publication_plans.update_publication_plan(
                self.owner["id"], draft.id, channel_account_id=account,
                scheduled_for="2026-10-11T00:00:00+08:00",
            )
        self.assertEqual(scheduled.status, "scheduled")

    def test_selecting_work_requires_no_publication_settings_and_does_not_schedule(self):
        from app.engines.publishing import publication_contents, publication_plans

        work, _ = self.save_work()
        draft = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Work only")
        path = f"/api/v1/publishing/publications/{draft.id}/work"
        response = self.client.put(path, headers=self.headers(), json={"portfolio_id": work["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        selected = response.json()["data"]
        self.assertEqual(selected["id"], draft.id)
        self.assertEqual(selected["status"], "draft")
        self.assertEqual(selected["scheduled_for"], "")
        self.assertEqual(selected["channel_account_id"], "")
        self.assertEqual(selected["image_count"], 3)
        self.assertEqual(publication_contents.get_publication_copy(self.owner["id"], draft.id).title, work["title"])
        response = self.client.put(path, headers=self.headers(self.outsider), json={"portfolio_id": work["id"]})
        self.assertEqual(response.status_code, 404, response.text)
        response = self.client.put(path, headers=self.headers(), json={"portfolio_id": "missing"})
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(publication_plans.get_publication_plan(self.owner["id"], draft.id).image_count, 3)

    def test_media_only_and_copy_only_agent_works_can_be_saved_with_correct_readiness(self):
        from app.engines.publishing import publication_plans

        for kind in ("image", "video"):
            with self.subTest(kind=kind):
                key = f"content-generator/org/{self.project.id}/partial-{'image.png' if kind == 'image' else 'video.mp4'}"
                media_storage.put_media_bytes(key, self.png_bytes() if kind == "image" else b"\x00\x00\x00\x18ftypisom",
                    content_type="image/png" if kind == "image" else "video/mp4")
                source = CreativeDeliverable(
                    id=f"media-only-{kind}", media_kind=kind, title="", publication_copy="",
                    image_url=media_storage.media_url(key, "http://testserver") if kind == "image" else "",
                    video_url=media_storage.media_url(key, "http://testserver") if kind == "video" else "",
                    created_at="2026-10-10T00:00:00Z",
                )
                creation_storage.update_session(self.creation.id, deliverables=[source])
                response = self.client.post(self.path + "/save-work", headers=self.headers())
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["data"]["status"], "completed")
                media_work = storage.get_script(response.json()["data"]["work_id"])
                self.assertEqual(media_work.content, "")
                self.assertEqual(media_work.title, "")
                self.assertEqual(len(media_work.media), 1)

                copy_source = CreativeDeliverable(id=f"copy-only-{kind}", media_kind=kind,
                    publication_copy="Only publication copy", created_at="2026-10-10T00:00:00Z")
                creation_storage.update_session(self.creation.id, deliverables=[copy_source])
                response = self.client.post(self.path + "/save-work", headers=self.headers())
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["data"]["status"], "draft")
                copy_id = response.json()["data"]["work_id"]
                copy_work = storage.get_script(copy_id)
                self.assertEqual(copy_work.status, "draft")
                self.assertEqual(copy_work.content, "Only publication copy")
                self.assertEqual(copy_work.media, [])
                self.edit_title(copy_id, "Editable draft title")
                self.assertEqual(storage.get_script(copy_id).status, "draft")
                draft = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Cannot publish copy")
                with self.assertRaisesRegex(ValueError, "matching media"):
                    publication_plans.select_publication_work(self.owner["id"], draft.id, portfolio_id=copy_id)

    def test_removing_last_media_turns_work_into_a_draft_and_copy_only_plan_cannot_schedule(self):
        from app.engines.publishing import publication_plans

        work, _ = self.save_work()
        source = storage.get_script(work["id"])
        edited = storage.edit_script(self.owner["id"], work["id"], ScriptEdit(
            title=source.title, content=source.content, tags=source.tags, media_ids=[],
            expected_updated_at=source.updated_at,
        ), [])
        self.assertEqual(edited.status, "draft")
        self.assertEqual(edited.content, source.content)
        plan = publication_plans.create_publication_plan(self.owner["id"], project_id=self.project.id, name="Copy only")
        conn = storage._get_conn()
        conn.execute("UPDATE project_publications SET copy_title='Copy title', copy_text='Copy body' WHERE id=?", (plan.id,))
        conn.commit()
        conn.close()
        account = self.publication_account()
        with self.assertRaisesRegex(ValueError, "at least one image"):
            publication_plans.update_publication_plan(self.owner["id"], plan.id,
                channel_account_id=account, scheduled_for="2026-10-12T09:00:00+08:00", status="scheduled")
