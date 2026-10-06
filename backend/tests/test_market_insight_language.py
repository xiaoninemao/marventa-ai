import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api import market_insight as api
from app.engines.market_insight import ai_analyzer, storage
from app.engines.market_insight.models import ParsedDocument
from app.shared.prompts import BILINGUAL_REPORT_INSTRUCTION, build_system_prompt
from tests import test_project_memberships as membership_tests


class MarketInsightPromptLanguageTests(unittest.TestCase):
    def analyze(self, locale=None):
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"product_name":"Example"}'))],
        )
        document = ParsedDocument(title="English document", source_type="markdown", raw_text="English source material")
        with patch.object(
            ai_analyzer,
            "get_ai_provider",
            return_value=SimpleNamespace(configured=True, model="test-model"),
        ), patch.object(ai_analyzer, "_get_case_ai_client", return_value=client):
            if locale is None:
                ai_analyzer.analyze_document(document)
            else:
                ai_analyzer.analyze_document(document, locale=locale)
        return client.chat.completions.create.call_args.kwargs["messages"]

    def test_default_is_chinese_even_with_english_source(self):
        messages = self.analyze()
        self.assertIn("Simplified Chinese", messages[0]["content"])
        self.assertNotIn("Use English by default", messages[0]["content"])
        self.assertIn("English source material", messages[1]["content"])

    def test_explicit_english_and_chinese_are_honored_without_changing_json_keys(self):
        for locale, language in (("en", "English"), ("zh-CN", "Simplified Chinese")):
            with self.subTest(locale=locale):
                messages = self.analyze(locale)
                self.assertIn(f"requested output language is {language}", messages[0]["content"])
                self.assertIn('"product_summary"', messages[1]["content"])
                self.assertIn("under 120 characters", messages[1]["content"])
                self.assertIn("Keep JSON field names", messages[0]["content"])

    def test_selected_locale_does_not_override_bilingual_report_contract(self):
        for locale in ("zh-CN", "en"):
            prompt = build_system_prompt("Report", language_mode="bilingual_report", output_locale=locale)
            self.assertIn(BILINGUAL_REPORT_INSTRUCTION, prompt)
            self.assertNotIn("explicitly requested output language", prompt)
        with self.assertRaisesRegex(ValueError, "Unsupported output locale"):
            build_system_prompt("Task", output_locale="fr")


class MarketInsightRequestLanguageTests(unittest.TestCase):
    setUp = membership_tests.ProjectMembershipTests.setUp
    headers = staticmethod(membership_tests.ProjectMembershipTests.headers)

    def test_file_upload_passes_language_to_background_worker(self):
        for locale in ("zh-CN", "en"):
            with self.subTest(locale=locale), patch.object(api, "analyze_async") as worker:
                response = self.client.post("/api/v1/market_insight/parse", headers=self.headers(self.owner["id"]),
                    data={"project_id": self.project.id, "locale": locale},
                    files={"files": ("source.md", b"# English product\nEnglish documentation", "text/markdown")})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(worker.call_args.kwargs["locale"], locale)

    def test_repo_upload_passes_language_to_background_worker(self):
        doc = ParsedDocument(title="Repository", source_type="repo", raw_text="English source")
        with patch.object(api, "parse_document", return_value=doc), patch.object(api, "analyze_async") as worker:
            response = self.client.post("/api/v1/market_insight/parse_repo", headers=self.headers(self.owner["id"]),
                json={"project_id": self.project.id, "repo_url": "https://github.com/owner/repo", "locale": "en"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(worker.call_args.kwargs["locale"], "en")

    def test_retry_uses_requested_interface_language(self):
        doc = ParsedDocument(title="Retry", source_type="markdown", raw_text="English documentation")
        record = storage.save_insight(doc, "source.md", 20, self.owner["id"], self.project.id, "failed")
        storage.add_insight_source(record.id, "source.md", 20, "markdown", doc.raw_text)
        with patch.object(api, "analyze_async") as worker:
            response = self.client.post(f"/api/v1/market_insight/history/{record.id}/retry?locale=zh-CN",
                headers=self.headers(self.owner["id"]))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(worker.call_args.kwargs["locale"], "zh-CN")

    def test_missing_locale_defaults_to_chinese_and_unknown_locale_is_rejected(self):
        with patch.object(api, "analyze_async") as worker:
            response = self.client.post("/api/v1/market_insight/parse", headers=self.headers(self.owner["id"]),
                data={"project_id": self.project.id},
                files={"files": ("source.md", b"# English product", "text/markdown")})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(worker.call_args.kwargs["locale"], "zh-CN")
        with patch.object(api, "analyze_async") as worker:
            response = self.client.post("/api/v1/market_insight/parse", headers=self.headers(self.owner["id"]),
                data={"project_id": self.project.id, "locale": "fr"},
                files={"files": ("source.md", b"# Source", "text/markdown")})
            self.assertEqual(response.status_code, 422, response.text)
            worker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
