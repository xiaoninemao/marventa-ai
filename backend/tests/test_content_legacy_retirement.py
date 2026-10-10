import unittest

from fastapi import FastAPI

from app.api.content_generator import router as creation_router
from app.engines.content_generator import ai_analyzer, creation_agent, material_references, models, storage


class ContentLegacyRetirementTests(unittest.TestCase):
    def test_card_generation_rewrite_quality_and_version_routes_are_removed(self):
        app = FastAPI()
        app.include_router(creation_router)
        paths = app.openapi()["paths"]
        prefix = "/api/v1/content_generator/sessions/{session_id}"
        for suffix in (
            "/generate", "/cards/{card_id}/modify", "/quality-check",
            "/versions", "/versions/{version_id}/restore",
            "/generate_document",
        ):
            with self.subTest(path=suffix):
                self.assertNotIn(prefix + suffix, paths)
        for suffix in (
            "/chat", "/chat/rewrite", "/chat/regenerate", "/save-work",
            "/deliverables/{version_id}/restore", "/agent-jobs/active",
        ):
            with self.subTest(path=suffix):
                self.assertIn(prefix + suffix, paths)

    def test_card_models_and_generation_helpers_are_removed(self):
        for module, names in (
            (models, ("ContentCard", "ContentVersion", "ModifyCardRequest", "QualityReport")),
            (ai_analyzer, ("generate_cards", "modify_card", "generate_async", "chat", "MULTIMODAL_INSTRUCTION")),
            (storage, ("save_next_version", "get_versions", "get_version", "retitle_plans")),
            (creation_agent, ("summarize_plan_title", "PlanTitle")),
            (material_references, ("latest_material_reference_ids",)),
        ):
            for name in names:
                with self.subTest(name=name):
                    self.assertFalse(hasattr(module, name))
        self.assertNotIn("cards", models.SessionResponse.model_fields)
        self.assertIn("deliverables", models.SessionResponse.model_fields)
