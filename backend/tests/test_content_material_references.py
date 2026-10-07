import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app import media_storage
from app.api import content_generator as api
from app.auth import storage as auth_storage
from app.database import _postgres_sql
from app.engines.content_generator import ai_analyzer as ai
from app.engines.content_generator import material_references
from app.engines.content_generator import storage
from app.engines.content_generator.material_references import (
    MAX_MATERIAL_CONTEXT_CHARS,
    MAX_MATERIAL_TEXT_CHARS,
    MaterialVisualInput,
)
from app.engines.content_generator.models import (
    ChatMessage,
    ChatReference,
    ContentCard,
    QualityIssue,
    QualityReport,
    SessionResponse,
)
from app.engines.portfolio import storage as portfolio_storage
from app.engines.publishing import project_materials
from app.engines.publishing import storage as publishing_storage
from app.engines.publishing.models import BrandProfile
from tests import test_material_copy as material_tests


class ContentMaterialReferenceTests(unittest.TestCase):
    headers = material_tests.MaterialCopyTests.headers
    upload = material_tests.MaterialCopyTests.upload
    legacy = material_tests.MaterialCopyTests.legacy

    def setUp(self):
        material_tests.MaterialCopyTests.setUp(self)
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(portfolio_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(
            material_references,
            "CONTENT_STUDIO_MULTIMODAL_ENABLED",
            False,
        ))
        self.client.app.include_router(api.router)
        self.chat = self.enterContext(patch.object(api, "chat", return_value="AI reply"))
        self.creation = storage.create_session(self.owner["id"], self.project.id, "Creation")
        self.path = f"/api/v1/content_generator/sessions/{self.creation.id}"
        self.copy = self.create_copy()
        self.image = self.upload("product.png", b"image", "image/png").json()["data"]
        self.video = self.upload("product.mp4", b"video", "video/mp4").json()["data"]
        api._document_jobs.clear()
        self.addCleanup(api._document_jobs.clear)

    def create_copy(self, content="<p>Real <strong>product copy</strong></p>", title="Product"):
        return project_materials.create_project_material(
            self.owner["id"], self.project.id, name=title, media_type="document",
            mime_type="text/html", file_size=0, object_key="",
            material_set_id=self.material_set.id, content_html=content,
        )

    def send(self, ids=None, **changes):
        return self.client.post(self.path + "/chat", headers=self.headers(), json={
            "message": "Use this source", "material_ids": ids or [], **changes,
        })

    def context(self, ids=None, user=None):
        return ai.build_reference_context(
            [], [], (user or self.owner)["id"],
            material_ids=ids or [self.copy.id], project_id=self.project.id,
        )

    def test_api_defaults_dedupe_titles_cumulative_rename_list_get(self):
        old = self.client.post(self.path + "/chat", headers=self.headers(), json={"message": "old client"})
        self.assertEqual(old.status_code, 200, old.text)
        self.assertEqual(old.json()["data"]["session"]["material_ids"], [])
        sent = self.send([self.copy.id, self.copy.id, self.image["id"]])
        self.assertEqual(sent.status_code, 200, sent.text)
        session = sent.json()["data"]["session"]
        self.assertEqual(session["material_ids"], [self.copy.id, self.image["id"]])
        self.assertEqual(session["messages"][-2]["references"], [
            {"id": self.copy.id, "kind": "material", "title": "Product"},
            {"id": self.image["id"], "kind": "material", "title": self.image["name"]},
        ])
        self.send([self.video["id"]])
        expected = [self.copy.id, self.image["id"], self.video["id"]]
        self.assertEqual(storage.get_session(self.creation.id).material_ids, expected)
        renamed = self.client.patch(self.path + "/name", headers=self.headers(), json={"title": "Renamed"})
        self.assertEqual(renamed.json()["data"]["material_ids"], expected)
        detail = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual(detail["material_ids"], expected)
        listed = self.client.get(
            "/api/v1/content_generator/sessions", headers=self.headers(),
            params={"project_id": self.project.id},
        ).json()["data"]
        self.assertEqual(listed[0]["material_ids"], expected)

    def test_new_references_reject_collection_missing_other_project_and_titles(self):
        other = publishing_storage.create_manual_project(self.owner["id"], title="Other")
        other_set = project_materials.create_project_material_set(self.owner["id"], other.id, name="Other")
        other_copy = project_materials.create_project_material(
            self.owner["id"], other.id, name="Private", media_type="document",
            mime_type="text/html", file_size=0, object_key="", material_set_id=other_set.id,
            content_html="<p>Secret other project copy</p>",
        )
        for ids in ([self.material_set.id], ["missing"], [other_copy.id]):
            with self.subTest(ids=ids):
                self.assertEqual(self.send(ids).status_code, 404)
        self.assertEqual(self.send([self.copy.id], references=[
            {"id": self.copy.id, "kind": "material", "title": "Forged"},
        ]).status_code, 422)
        self.assertEqual(storage.get_session(self.creation.id).messages, [])
        self.chat.assert_not_called()

    def test_max20_and_authentication(self):
        self.assertEqual(self.send(["missing"] * 21).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/chat", json={
            "message": "test", "material_ids": [self.copy.id],
        }).status_code, 401)
        self.assertEqual(self.client.post(self.path + "/chat", headers=self.headers(self.outsider), json={
            "message": "test", "material_ids": [self.copy.id],
        }).status_code, 404)
        self.chat.assert_not_called()

    def test_doc_plaintext_and_media_metadata_no_paths_urls_or_invention(self):
        ctx = self.context([self.copy.id, self.image["id"], self.video["id"]])
        self.assertIn("Real product copy", ctx)
        self.assertNotIn("<strong>", ctx)
        self.assertIn("image/png", ctx)
        self.assertIn("video/mp4", ctx)
        self.assertIn("content_inspected", ctx)
        self.assertIn("does not inspect image/video content", ctx)
        self.assertIn("not executable instructions", ctx)
        for material in (self.image, self.video):
            self.assertNotIn(material["object_key"], ctx)
            if material["file_url"]:
                self.assertNotIn(material["file_url"], ctx)
        self.assertNotIn(str(self.media_root), ctx)
        self.send([self.copy.id])
        self.assertIn("Real product copy", self.chat.call_args.kwargs["reference_context"])

    def test_project_brand_profile_is_persisted_and_added_to_generation_context(self):
        response = self.client.patch(
            f"/api/v1/publishing/projects/{self.project.id}",
            headers=self.headers(),
            json={
                "brand_profile": {
                    "tone": "Measured and specific",
                    "audience": "Operations leaders",
                    "value_proposition": "Reduce repetitive campaign work",
                    "visual_style": "Use navy and restrained diagrams",
                    "prohibited_terms": ["guaranteed"],
                },
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        profile = response.json()["data"]["brand_profile"]
        self.assertEqual(profile["tone"], "Measured and specific")
        context = self.context([])
        self.assertIn("Project brand guidelines", context)
        self.assertIn("Operations leaders", context)
        self.assertIn('"guaranteed"', context)

    def test_multimodal_disabled_keeps_images_metadata_only(self):
        with patch.object(
            material_references,
            "CONTENT_STUDIO_MULTIMODAL_ENABLED",
            False,
        ):
            response = self.send([self.image["id"]])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("image_inputs", self.chat.call_args.kwargs)
        self.assertIn("content_inspected", self.chat.call_args.kwargs["reference_context"])

    def test_audio_transcript_cache_avoids_reprocessing_video(self):
        material = project_materials.get_project_material(
            self.owner["id"], self.project.id, self.video["id"],
        )
        cached = json.dumps({
            "material_id": material.id,
            "status": "completed",
            "text": "Cached speech",
            "segments": [],
        })
        with (
            patch.object(
                material_references,
                "get_cached_material_transcript",
                return_value=cached,
            ),
            patch.object(material_references, "materialize_media") as materialize,
        ):
            result = material_references._transcribe_video_audio(
                material,
                self.owner["id"],
            )
        self.assertEqual(result, cached)
        materialize.assert_not_called()

    def test_audio_context_is_bounded_to_authorized_video_references(self):
        transcript = json.dumps({
            "material_id": self.video["id"],
            "status": "completed",
            "text": "Spoken launch message",
            "segments": [{"start": 0.0, "end": 1.2, "text": "Spoken launch message"}],
        })
        with (
            patch.object(material_references, "CONTENT_STUDIO_TRANSCRIPTION_ENABLED", True),
            patch.object(
                material_references,
                "_transcribe_video_audio",
                return_value=transcript,
            ) as transcribe,
        ):
            context = material_references.build_material_audio_context(
                [self.image["id"], self.video["id"]],
                self.project.id,
                self.owner["id"],
            )
        self.assertIn("untrusted source data", context)
        self.assertIn("Spoken launch message", context)
        transcribe.assert_called_once()

    def test_audio_transcription_extracts_timestamped_segments_and_caches_them(self):
        material = project_materials.get_project_material(
            self.owner["id"], self.project.id, self.video["id"],
        )
        transcription = MagicMock()
        transcription.audio.transcriptions.create.return_value = SimpleNamespace(
            text="Opening hook",
            segments=[{"start": 0.0, "end": 1.5, "text": "Opening hook"}],
        )
        provider = MagicMock()
        provider.client.return_value = transcription

        def run(command, **_kwargs):
            if "-select_streams" in command:
                return SimpleNamespace(stdout="0\n")
            with open(command[-1], "wb") as handle:
                handle.write(b"audio")
            return SimpleNamespace(stdout="")

        with (
            patch.object(material_references, "CONTENT_STUDIO_TRANSCRIPTION_MODEL", "speech-model"),
            patch.object(
                material_references,
                "get_cached_material_transcript",
                return_value="",
            ),
            patch.object(
                material_references,
                "materialize_media",
                return_value=(os.path.join(self.media_root, self.video["object_key"]), False),
            ),
            patch.object(material_references.shutil, "which", return_value="/usr/bin/tool"),
            patch.object(material_references.subprocess, "run", side_effect=run),
            patch.object(material_references, "get_ai_provider", return_value=provider),
            patch.object(material_references, "save_material_transcript") as save,
        ):
            payload = material_references._transcribe_video_audio(
                material,
                self.owner["id"],
            )
        parsed = json.loads(payload)
        self.assertEqual(parsed["text"], "Opening hook")
        self.assertEqual(parsed["segments"][0]["end"], 1.5)
        self.assertEqual(
            transcription.audio.transcriptions.create.call_args.kwargs["model"],
            "speech-model",
        )
        self.assertEqual(save.call_args.args[-1], payload)

    def test_quality_check_uses_project_brand_profile_and_returns_report(self):
        publishing_storage.update_project(
            self.owner["id"],
            self.project.id,
            brand_profile=BrandProfile(
                tone="Measured",
                prohibited_terms=["guaranteed"],
            ),
        )
        card = ContentCard(
            id="copy",
            card_type="copy",
            title="Copy",
            preview="Preview",
            content="Body",
            tips=[],
        )
        storage.update_session(self.creation.id, cards=[card], status="completed")
        report = QualityReport(
            ready=False,
            summary="Remove the prohibited term.",
            issues=[QualityIssue(
                category="brand",
                severity="blocking",
                card_id="copy",
                evidence="Configured prohibited term: guaranteed",
                suggestion="Remove it.",
            )],
            checked_at="2026-10-07T00:00:00+00:00",
        )
        with patch.object(api, "evaluate_content_quality", return_value=report) as evaluate:
            response = self.client.post(
                self.path + "/quality-check",
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["data"]["ready"])
        self.assertEqual(
            evaluate.call_args.args[1]["prohibited_terms"],
            ["guaranteed"],
        )

    def test_prohibited_term_blocks_work_generation_without_ai_call(self):
        publishing_storage.update_project(
            self.owner["id"],
            self.project.id,
            brand_profile=BrandProfile(prohibited_terms=["guaranteed"]),
        )
        storage.update_session(
            self.creation.id,
            cards=[ContentCard(
                id="copy",
                card_type="copy",
                title="Copy",
                preview="Preview",
                content="Guaranteed results",
                tips=[],
            )],
            status="completed",
        )
        with patch.object(api, "generate_document") as generate:
            response = self.client.post(
                self.path + "/generate_document",
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("prohibited term", response.json()["detail"])
        generate.assert_not_called()

    def test_multimodal_enabled_sends_images_and_video_keyframes(self):
        frames = [
            MaterialVisualInput(
                data_url="data:image/jpeg;base64,ZnJhbWU=",
                label="Video product, keyframe 1 of 1 in chronological order",
            ),
        ]
        with (
            patch.object(
                material_references,
                "CONTENT_STUDIO_MULTIMODAL_ENABLED",
                True,
            ),
            patch.object(
                material_references,
                "_video_frame_inputs",
                return_value=(frames, 5),
            ),
        ):
            response = self.send([self.image["id"], self.video["id"]])
        self.assertEqual(response.status_code, 200, response.text)
        visuals = self.chat.call_args.kwargs["image_inputs"]
        self.assertEqual(len(visuals), 2)
        self.assertTrue(visuals[0].data_url.startswith("data:image/png;base64,"))
        self.assertEqual(visuals[1], frames[0])
        self.assertNotIn(self.image["object_key"], visuals[0].data_url)
        stored = storage.get_session(self.creation.id).model_dump_json()
        self.assertNotIn("data:image/", stored)
        self.assertIn(self.image["id"], stored)

    def test_video_frames_are_temporary_bounded_and_labeled(self):
        material = project_materials.get_project_material(
            self.owner["id"],
            self.project.id,
            self.video["id"],
        )
        with tempfile.NamedTemporaryFile(suffix=".mp4") as source:
            def extract(command, **_kwargs):
                output = command[-1].replace("%02d", "01")
                with open(output, "wb") as handle:
                    handle.write(b"jpeg-frame")
                return MagicMock()

            with (
                patch.object(
                    material_references,
                    "materialize_media",
                    return_value=(source.name, False),
                ),
                patch.object(
                    material_references,
                    "_video_duration",
                    return_value=10.0,
                ),
                patch.object(
                    material_references.shutil,
                    "which",
                    return_value="/usr/bin/ffmpeg",
                ),
                patch.object(
                    material_references.subprocess,
                    "run",
                    side_effect=extract,
                ) as run,
            ):
                frames, total = material_references._video_frame_inputs(material)
        self.assertEqual(total, len(b"jpeg-frame"))
        self.assertEqual(len(frames), 1)
        self.assertIn("keyframe 1 of 1", frames[0].label)
        self.assertTrue(frames[0].data_url.startswith("data:image/jpeg;base64,"))
        command = run.call_args.args[0]
        self.assertIn("-frames:v", command)
        self.assertIn("4", command)
        self.assertFalse(os.path.exists(command[-1].replace("%02d", "01")))

    def test_regenerate_rebuilds_images_from_latest_user_references(self):
        with patch.object(
            material_references,
            "CONTENT_STUDIO_MULTIMODAL_ENABLED",
            True,
        ):
            self.assertEqual(self.send([self.image["id"]]).status_code, 200)
            response = self.client.post(
                self.path + "/chat/regenerate",
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.chat.call_args.kwargs["image_inputs"]), 1)

    def test_card_generation_uses_latest_turn_images(self):
        class InlineThread:
            def __init__(self, target, daemon):
                self.target = target

            def start(self):
                self.target()

        with patch.object(
            material_references,
            "CONTENT_STUDIO_MULTIMODAL_ENABLED",
            True,
        ):
            self.assertEqual(self.send([self.image["id"]]).status_code, 200)
            with patch.object(ai.threading, "Thread", InlineThread), patch.object(
                ai,
                "generate_cards",
                return_value=[],
            ) as generate:
                ai.generate_async(self.creation.id, user_id=self.owner["id"])
        self.assertEqual(len(generate.call_args.kwargs["image_inputs"]), 1)

    def test_multimodal_limits_fail_before_accepting_message(self):
        extra = self.upload("second.png", b"second", "image/png").json()["data"]
        with (
            patch.object(
                material_references,
                "CONTENT_STUDIO_MULTIMODAL_ENABLED",
                True,
            ),
            patch.object(
                material_references,
                "CONTENT_STUDIO_MULTIMODAL_MAX_IMAGES",
                1,
            ),
        ):
            response = self.send([self.image["id"], extra["id"]])
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(storage.get_session(self.creation.id).messages, [])
        self.chat.assert_not_called()

    def test_legacy_text_markdown_pdf_docx_use_existing_parser_without_network(self):
        materials = [
            self.legacy(".txt", b"Legacy actual text"),
            self.legacy(".md", b"# Legacy heading\n\n![remote](https://example.com/image.png)\n\nBody"),
            self.legacy(".pdf", material_tests.MaterialCopyTests.pdf_bytes("Actual PDF body")),
            self.legacy(".docx", material_tests.MaterialCopyTests.docx_bytes()),
        ]
        with patch.object(media_storage, "_s3_client", side_effect=AssertionError("No network")):
            ctx = self.context([item["id"] for item in materials])
        for expected in ("Legacy actual text", "Legacy heading", "Actual PDF body", "Document title"):
            self.assertIn(expected, ctx)
        self.assertNotIn("https://example.com", ctx)

    def test_truncation_bounded_per_material_and_total_and_cumulative_cap(self):
        ids = [self.create_copy("<p>" + "x" * 15_000 + "</p>", f"Copy {index}").id for index in range(21)]
        ctx = self.context(ids)
        self.assertLessEqual(len(ctx), MAX_MATERIAL_CONTEXT_CHARS)
        records = [json.loads(line) for line in ctx.splitlines()[1:]]
        for record in records:
            if "text" in record:
                self.assertEqual(len(record["text"]), MAX_MATERIAL_TEXT_CHARS)
                self.assertTrue(record["text_truncated"])
        self.assertIn("context limit", ctx)
        self.assertIn("material limit", ctx)

    def test_twenty_old_references_do_not_hide_newly_sent_material(self):
        old_ids = [self.create_copy(f"<p>Old source {index}</p>", f"Old {index}").id for index in range(20)]
        storage.accept_user_message(
            self.creation.id, self.owner["id"],
            ChatMessage(role="user", content="Old references"), [], [], [], old_ids,
        )
        newest = self.create_copy("<p>NEWEST SOURCE MUST REACH CHAT</p>", "Newest")
        response = self.send([newest.id])
        self.assertEqual(response.status_code, 200, response.text)
        context = self.chat.call_args.kwargs["reference_context"]
        self.assertIn("NEWEST SOURCE MUST REACH CHAT", context)
        self.assertIn("material limit", context)
        records = [json.loads(line) for line in context.splitlines()[1:]]
        self.assertEqual(sum("id" in record for record in records), 20)
        self.assertLessEqual(len(context), MAX_MATERIAL_CONTEXT_CHARS)
        session = storage.get_session(self.creation.id)
        self.assertEqual(session.material_ids, old_ids + [newest.id])
        self.assertEqual([reference.id for reference in session.messages[0].references], old_ids)

    def test_reselected_old_material_prioritized_in_all_generation_paths(self):
        ids = [self.create_copy(f"<p>UNIQUE SOURCE {index}</p>", f"Source {index}").id for index in range(21)]
        storage.accept_user_message(
            self.creation.id, self.owner["id"],
            ChatMessage(role="user", content="Old references"), [], [], [], ids[:20],
        )
        storage.accept_user_message(
            self.creation.id, self.owner["id"],
            ChatMessage(role="user", content="Newest reference"), [], [], [], ids[20:],
        )
        self.assertEqual(self.send(ids[:1]).status_code, 200)
        self.assertIn("UNIQUE SOURCE 0", self.chat.call_args.kwargs["reference_context"])
        for action, body in (("regenerate", {}), ("rewrite", {"message": "Rewritten"})):
            response = self.client.post(self.path + "/chat/" + action, headers=self.headers(), json=body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("UNIQUE SOURCE 0", self.chat.call_args.kwargs["reference_context"])
        card = ContentCard(id="copy", card_type="copy", title="Copy", preview="", content="Content")
        storage.update_session(self.creation.id, cards=[card])
        with patch.object(api, "modify_card", return_value=card) as modify:
            response = self.client.post(
                self.path + "/cards/copy/modify", headers=self.headers(), json={"instruction": "Improve"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("UNIQUE SOURCE 0", modify.call_args.kwargs["reference_context"])
        with patch.object(api, "generate_document", return_value="Report") as report:
            response = self.client.post(self.path + "/generate_document", headers=self.headers())
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("UNIQUE SOURCE 0", report.call_args.kwargs["reference_context"])
        class InlineThread:
            def __init__(self, target, daemon):
                self.target = target
            def start(self):
                self.target()
        with patch.object(ai.threading, "Thread", InlineThread), patch.object(ai, "generate_cards", return_value=[card]) as cards:
            ai.generate_async(self.creation.id, user_id=self.owner["id"])
            self.assertIn("UNIQUE SOURCE 0", cards.call_args.kwargs["reference_context"])
        self.assertEqual(storage.get_session(self.creation.id).material_ids, ids)

    def test_deleted_reference_preserves_caption_replay_and_safe_context(self):
        message_id = str(uuid4())
        sent = self.send([self.copy.id], client_message_id=message_id).json()["data"]["session"]
        project_materials.delete_project_material(self.owner["id"], self.project.id, self.copy.id)
        self.assertEqual(self.send([self.copy.id]).status_code, 404)
        replay = self.send(["also missing"], client_message_id=message_id)
        self.assertEqual(replay.status_code, 200, replay.text)
        replay_session = replay.json()["data"]["session"]
        for field in ("id", "messages", "material_ids", "created_at", "updated_at"):
            self.assertEqual(replay_session[field], sent[field])
        self.assertEqual(self.chat.call_count, 1)
        ctx = self.context()
        self.assertIn("unavailable", ctx)
        self.assertNotIn("Real product copy", ctx)
        self.assertNotIn("Product", ctx)
        self.assertEqual(storage.get_session(self.creation.id).messages[0].references[0].title, "Product")
        regenerated = self.client.post(self.path + "/chat/regenerate", headers=self.headers())
        self.assertEqual(regenerated.status_code, 200, regenerated.text)
        ctx = self.chat.call_args.kwargs["reference_context"]
        self.assertIn("unavailable", ctx)
        self.assertNotIn("Real product copy", ctx)

    def test_revoke_project_and_current_org_no_content_leak(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "DELETE FROM project_memberships WHERE user_id = ? AND project_id = ?",
                (self.member["id"], self.project.id),
            )
        self.assertIn("unavailable", self.context(user=self.member))
        self.assertNotIn("Real product copy", self.context(user=self.member))
        organization = auth_storage.create_organization(self.owner["id"], "Other org")
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        self.assertEqual(self.send([self.copy.id]).status_code, 404)
        self.assertIn("unavailable", self.context())
        self.assertNotIn("Real product copy", self.context())
        self.chat.assert_not_called()

    def test_missing_media_object_new_reference_rejected_and_existing_context_unavailable(self):
        media_storage.delete_media(self.image["object_key"])
        self.assertEqual(self.send([self.image["id"]]).status_code, 404)
        ctx = self.context([self.image["id"]])
        self.assertIn("unavailable", ctx)
        self.assertNotIn(self.image["name"], ctx)
        self.chat.assert_not_called()

    def test_transaction_rechecks_deleted_material_and_trusts_server_title(self):
        forged = ChatMessage(role="user", content="use", references=[
            ChatReference(id=self.copy.id, kind="material", title="Forged title"),
        ])
        accepted = storage.accept_user_message(
            self.creation.id, self.owner["id"], forged, [], [], [], [self.copy.id],
        )
        self.assertEqual(accepted.messages[0].references[0].title, "Product")
        project_materials.delete_project_material(self.owner["id"], self.project.id, self.copy.id)
        with self.assertRaises(LookupError):
            storage.accept_user_message(
                self.creation.id, self.owner["id"], ChatMessage(role="user", content="new"),
                [], [], [], material_ids=[self.copy.id],
            )
        self.assertEqual(len(storage.get_session(self.creation.id).messages), 1)

    def test_concurrent_storage_replay_and_merges_do_not_lose_refs(self):
        storage.init_db()
        message_id = uuid4()
        def accept(index):
            return storage.accept_user_message(
                self.creation.id, self.owner["id"],
                ChatMessage(role="user", content="same", client_message_id=message_id),
                [], [], [], material_ids=[self.copy.id],
            )
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(accept, range(4)))
        self.assertEqual(sum(result._user_message_accepted for result in results), 1)
        self.assertEqual(len(storage.get_session(self.creation.id).messages), 1)
        def add(material_id):
            storage.accept_user_message(
                self.creation.id, self.owner["id"], ChatMessage(role="user", content="new"),
                [], [], [], material_ids=[material_id],
            )
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(add, [self.image["id"], self.video["id"]]))
        result = storage.get_session(self.creation.id)
        self.assertEqual(set(result.material_ids), {self.copy.id, self.image["id"], self.video["id"]})
        self.assertEqual(len(result.messages), 3)

    def test_api_duplicate_accepted_concurrently_does_not_call_ai_twice(self):
        original_accept = storage.accept_user_message
        def concurrently_accept(*args, **kwargs):
            original_accept(*args, **kwargs)
            return original_accept(*args, **kwargs)
        with patch.object(api, "accept_user_message", side_effect=concurrently_accept):
            response = self.send([self.copy.id], client_message_id=str(uuid4()))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["data"]["session"]["messages"]), 1)
        self.chat.assert_not_called()

    def test_regenerate_rewrite_modify_report_and_card_generation_keep_context(self):
        self.send([self.copy.id])
        for action, body in (("regenerate", {}), ("rewrite", {"message": "Rewritten"})):
            response = self.client.post(self.path + "/chat/" + action, headers=self.headers(), json=body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("Real product copy", self.chat.call_args.kwargs["reference_context"])
        card = ContentCard(id="copy", card_type="copy", title="Copy", preview="Preview", content="Content")
        storage.update_session(self.creation.id, cards=[card])
        with patch.object(api, "modify_card", return_value=card) as modify:
            response = self.client.post(
                self.path + "/cards/copy/modify", headers=self.headers(), json={"instruction": "Improve"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("Real product copy", modify.call_args.kwargs["reference_context"])
        with patch.object(api, "generate_document", return_value="Report") as report:
            response = self.client.post(self.path + "/generate_document", headers=self.headers())
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("Real product copy", report.call_args.kwargs["reference_context"])
        class InlineThread:
            def __init__(self, target, daemon):
                self.target = target
            def start(self):
                self.target()
        with patch.object(ai.threading, "Thread", InlineThread), patch.object(ai, "generate_cards", return_value=[card]) as cards:
            ai.generate_async(self.creation.id, user_id=self.owner["id"])
            self.assertIn("Real product copy", cards.call_args.kwargs["reference_context"])

    def test_additive_migration_defaults_json_guard_and_postgres_sql(self):
        storage.accept_user_message(
            self.creation.id, self.owner["id"],
            ChatMessage(role="user", content="Historical message"), [], [], [],
        )
        card = ContentCard(id="legacy", card_type="copy", title="Legacy", preview="", content="Historical card")
        storage.update_session(self.creation.id, cards=[card])
        original = storage.get_session(self.creation.id)
        old_payload = original.model_dump(exclude={"material_ids"})
        self.assertEqual(SessionResponse.model_validate(old_payload).material_ids, [])
        with sqlite3.connect(self.db_path) as conn:
            for suffix in ("insert", "update"):
                conn.execute(f"DROP TRIGGER trg_creation_sessions_material_ids_json_{suffix}")
            conn.execute("ALTER TABLE creation_sessions DROP COLUMN material_ids")
        storage.init_db()
        migrated = storage.get_session(self.creation.id)
        self.assertEqual(migrated.material_ids, [])
        self.assertEqual(migrated.title, original.title)
        self.assertEqual(migrated.created_at, original.created_at)
        self.assertEqual(migrated.messages, original.messages)
        self.assertEqual(migrated.cards, original.cards)
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute(
                "SELECT material_ids FROM creation_sessions WHERE id = ?", (self.creation.id,),
            ).fetchone()[0], "[]")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE creation_sessions SET material_ids = 'not json' WHERE id = ?", (self.creation.id,))
        sql = "ALTER TABLE creation_sessions ADD COLUMN material_ids TEXT NOT NULL DEFAULT '[]'"
        self.assertEqual(_postgres_sql(sql), sql)
        self.assertEqual(_postgres_sql(
            "SELECT material_ids FROM creation_sessions WHERE id = ? FOR UPDATE",
        ), "SELECT material_ids FROM creation_sessions WHERE id = %s FOR UPDATE")

    def test_background_job_rechecks_revoked_access(self):
        card = ContentCard(id="copy", card_type="copy", title="Copy", preview="", content="Content")
        storage.update_session(self.creation.id, cards=[card], material_ids=[self.copy.id])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?", (
                self.project.id, self.owner["id"],
            ))
        with patch.object(api, "generate_document") as report, patch.object(api, "update_script"), patch.object(api.logger, "exception"):
            api._generate_document_job(self.creation.id, self.owner["id"], "work")
            report.assert_not_called()
        class InlineThread:
            def __init__(self, target, daemon):
                self.target = target
            def start(self):
                self.target()
        with patch.object(ai.threading, "Thread", InlineThread), patch.object(ai, "generate_cards") as cards:
            ai.generate_async(self.creation.id, user_id=self.owner["id"])
            cards.assert_not_called()

    def test_postgres_migration_uses_additive_guard_without_sqlite_trigger_syntax(self):
        statements = []
        original_connect = storage._get_conn
        class RecordingConnection:
            def __init__(self):
                self.conn = original_connect()
            def execute(self, sql, *args):
                if "DO $$" in sql:
                    statements.append(_postgres_sql(sql))
                    return None
                return self.conn.execute(sql, *args)
            def commit(self):
                self.conn.commit()
            def close(self):
                self.conn.close()
        with patch.object(storage, "_get_conn", RecordingConnection), patch.object(storage, "is_postgresql", return_value=True):
            storage.init_db()
        self.assertEqual(len(statements), 1)
        sql = statements[0]
        self.assertIn("IF NOT EXISTS", sql)
        self.assertIn("jsonb_typeof(material_ids::jsonb) = 'array'", sql)
        self.assertIn("NOT VALID", sql)
        self.assertNotIn("json_valid", sql)
        self.assertEqual(storage.get_session(self.creation.id).material_ids, [])

    def test_modify_and_report_provider_prompts_include_material_source(self):
        from tests.test_content_card_format import ContentCardFormatTests
        card = ContentCard(id="copy", card_type="copy", title="Copy", preview="", content="Body")
        client = MagicMock()
        client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=card.model_dump_json()))],
        )
        ctx = self.context()
        with patch.object(ai, "_get_modify_client", return_value=client):
            ai.modify_card(card, "Improve", [], reference_context=ctx)
        self.assertIn("Real product copy", client.chat.completions.create.call_args.kwargs["messages"][0]["content"])
        client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=ContentCardFormatTests()._valid_work_report()))],
        )
        with patch.object(ai, "_get_client", return_value=client):
            ai.generate_document([card], reference_context=ctx)
        self.assertIn("Real product copy", client.chat.completions.create.call_args.kwargs["messages"][0]["content"])


if __name__ == "__main__":
    unittest.main()
