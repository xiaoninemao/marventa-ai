import inspect
import unittest

from fastapi import FastAPI
from pydantic import ValidationError

from app.api import content_generator, portfolio
from app.engines.portfolio import models, storage


class PortfolioRetirementTests(unittest.TestCase):
    def test_old_report_and_analysis_routes_are_absent_while_native_work_routes_remain(self):
        app = FastAPI()
        app.include_router(content_generator.router)
        app.include_router(portfolio.router)
        paths = app.openapi()["paths"]
        prefix = "/api/v1/content_generator/sessions/{session_id}"
        self.assertNotIn(prefix + "/generate_document", paths)
        self.assertNotIn("/api/v1/portfolio/scripts/create", paths)
        self.assertFalse(any("analy" in path or "generate" in path for path in paths if "/portfolio/" in path))
        self.assertIn("post", paths[prefix + "/save-work"])
        for path, method in [
            ("/api/v1/portfolio/scripts", "post"),
            ("/api/v1/portfolio/scripts/{script_id}", "put"),
            ("/api/v1/portfolio/scripts/{script_id}/edit", "put"),
        ]:
            self.assertIn(method, paths[path])

    def test_retired_creation_helpers_and_dtos_are_removed(self):
        self.assertFalse(hasattr(models, "ScriptMediaCreate"))
        self.assertFalse(hasattr(storage, "create_media_script"))
        self.assertFalse(hasattr(storage, "_write_work"))
        self.assertEqual(set(inspect.signature(storage.update_script).parameters), {"script_id", "name"})
        self.assertEqual(set(models.ScriptCreate.model_fields), {"name", "project_id", "media_kind"})
        self.assertEqual(set(models.ScriptUpdate.model_fields), {"name", "media_order", "expected_updated_at"})
        with self.assertRaises(ValidationError):
            models.ScriptCreate.model_validate({"title": "Old report", "content": "Report", "project_id": "project"})
        with self.assertRaises(ValidationError):
            models.ScriptUpdate.model_validate({"title": "Bypass atomic editing"})
