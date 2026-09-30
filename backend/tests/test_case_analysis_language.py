import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.engines.case_library import ai_analyzer, storage
from tests import test_project_memberships as membership_tests
from tests.test_ai_provider_configuration import valid_case_analysis_payload


class CaseAnalysisPromptLanguageTests(unittest.TestCase):
    def messages(self, locale=None, video=False, retry=False):
        client = MagicMock()
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
            content=json.dumps(valid_case_analysis_payload(video=video)),
        ))])
        if retry:
            client.chat.completions.create.side_effect = [
                SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))]), response,
            ]
        else:
            client.chat.completions.create.return_value = response
        kwargs = {"locale": locale} if locale is not None else {}
        with patch.object(ai_analyzer, "_get_client", return_value=client):
            ai_analyzer.analyze_case(
                "Original English title", "video" if video else "image_text",
                "English source content", [], **kwargs,
            )
        return [call.kwargs["messages"] for call in client.chat.completions.create.call_args_list]

    def test_default_is_chinese_and_source_is_preserved(self):
        sent = self.messages()[0]
        self.assertIn("requested output language is Simplified Chinese", sent[0]["content"])
        self.assertNotIn("Use English by default", sent[0]["content"])
        self.assertIn("English source content", sent[1]["content"][-1]["text"])

    def test_image_and_video_use_the_requested_language(self):
        for locale, language in (("zh-CN", "Simplified Chinese"), ("en", "English")):
            for video in (False, True):
                with self.subTest(locale=locale, video=video):
                    sent = self.messages(locale, video)[0]
                    self.assertIn(f"requested output language is {language}", sent[0]["content"])
                    self.assertIn("Keep JSON field names", sent[0]["content"])

    def test_schema_retry_keeps_the_selected_language(self):
        for locale, language in (("zh-CN", "Simplified Chinese"), ("en", "English")):
            calls = self.messages(locale, retry=True)
            self.assertEqual(len(calls), 2)
            for sent in calls:
                self.assertIn(f"requested output language is {language}", sent[0]["content"])

    def test_background_worker_preserves_language(self):
        targets = []
        with patch.object(ai_analyzer.threading, "Thread",
            side_effect=lambda target, daemon: SimpleNamespace(start=lambda: targets.append(target))):
            ai_analyzer.analyze_async("case", "Title", "image_text", "Source", [], locale="en")
        with patch.object(ai_analyzer, "analyze_case", return_value=None) as analyze, patch.object(storage, "update_case_ai"):
            targets[0]()
        self.assertEqual(analyze.call_args.kwargs["locale"], "en")


class CaseAnalysisRequestLanguageTests(unittest.TestCase):
    setUp = membership_tests.ProjectMembershipTests.setUp
    headers = staticmethod(membership_tests.ProjectMembershipTests.headers)

    def case(self):
        return storage.create_case(
            title="Title", content_type="image_text", description="English source",
            tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            project_id=self.project.id,
        )

    def test_analysis_api_passes_requested_locale_and_defaults_to_chinese(self):
        for query, expected in (("", "zh-CN"), ("?locale=en", "en"), ("?locale=zh-CN", "zh-CN")):
            case = self.case()
            with patch.object(ai_analyzer, "analyze_async") as worker:
                response = self.client.post(
                    f"/api/v1/case_library/cases/{case.id}/analyze{query}",
                    headers=self.headers(self.owner["id"]),
                )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(worker.call_args.kwargs["locale"], expected)

    def test_unknown_locale_is_rejected_without_changing_status(self):
        case = self.case()
        with patch.object(ai_analyzer, "analyze_async") as worker:
            response = self.client.post(
                f"/api/v1/case_library/cases/{case.id}/analyze?locale=fr",
                headers=self.headers(self.owner["id"]),
            )
        self.assertEqual(response.status_code, 422, response.text)
        worker.assert_not_called()
        self.assertEqual(storage.get_case(case.id).ai_status, case.ai_status)


if __name__ == "__main__":
    unittest.main()
