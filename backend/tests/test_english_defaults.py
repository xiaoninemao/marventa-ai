import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.engines.case_library import ai_analyzer as case_ai
from app.engines.case_library import import_tasks
from app.engines.content_generator import ai_analyzer as content_ai
from app.engines.content_generator.models import ContentCard
from app.engines.market_insight import ai_analyzer as insight_ai
from app.engines.market_insight import storage as insight_storage
from app.engines.market_insight.models import AIAnalysis, ParsedDocument
from app.engines.publishing import projects
from app.shared.prompts import BILINGUAL_REPORT_INSTRUCTION, OUTPUT_LANGUAGE_INSTRUCTION


class EnglishOutputDefaultsTests(unittest.TestCase):
    @staticmethod
    def client_returning(value):
        client = MagicMock()
        client.chat.completions.create.return_value.choices[0].message.content = value
        return client

    @staticmethod
    def generated_cards(title=""):
        return [
            {
                "id": kind, "card_type": kind, "title": title,
                "preview": "A focused launch plan", "content": "Launch details", "tips": [],
            }
            for kind in ("script", "title", "copy", "hashtags", "visual")
        ]

    def test_content_prompts_default_to_english_and_allow_explicit_requests(self):
        for prompt in (
            content_ai.SYSTEM_PROMPT, content_ai.CARD_SYSTEM_PROMPT,
            content_ai.MODIFY_SYSTEM_PROMPT,
        ):
            with self.subTest(prompt=prompt[:40]):
                self.assertIn("Use English by default.", prompt)
                self.assertIn("Honor an explicit user request for another output language.", prompt)
                self.assertNotIn("用中文回复", prompt)
                self.assertNotIn("请用中文输出", prompt)
                self.assertNotIn("始终使用中文输出", prompt)
        self.assertNotIn("始终使用中文输出", insight_ai.ANALYSIS_PROMPT)

    def test_analysis_prompts_default_to_chinese_when_no_interface_locale_is_supplied(self):
        for prompt in (case_ai.SYSTEM_PROMPT, insight_ai.SYSTEM_PROMPT):
            self.assertIn("requested output language is Simplified Chinese", prompt)
            self.assertNotIn("Use English by default.", prompt)

    def test_chat_passes_explicit_language_request_and_preserves_response(self):
        client = self.client_returning("中文营销建议")
        messages = [{"role": "user", "content": "Please reply in Chinese about this launch."}]
        with patch.object(content_ai, "_get_client", return_value=client):
            self.assertEqual(content_ai.chat(messages), "中文营销建议")
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertEqual(sent[1:], messages)
        self.assertIn("Use English by default.", sent[0]["content"])

    def test_empty_chat_response_uses_english_fallback(self):
        client = self.client_returning("")
        with patch.object(content_ai, "_get_client", return_value=client):
            self.assertEqual(content_ai.chat([]), "Sorry, something went wrong. Please try again.")

    def test_generation_uses_english_fallback_card_titles(self):
        client = self.client_returning(json.dumps({"cards": self.generated_cards()}))
        with patch.object(content_ai, "_get_client", return_value=client):
            cards = content_ai.generate_cards([], preference_keys=["short_video"])
        self.assertEqual(cards[0].title, "Video storyboard")
        self.assertEqual(cards[1].title, "Headline options")
        self.assertTrue(all(card.title.isascii() for card in cards))
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("Use English by default.", sent[0]["content"])

    def test_generation_preserves_requested_language_in_generated_titles(self):
        client = self.client_returning(json.dumps(
            {"cards": self.generated_cards("中文方案")}, ensure_ascii=False,
        ))
        with patch.object(content_ai, "_get_client", return_value=client):
            cards = content_ai.generate_cards(
                [{"role": "user", "content": "请用中文生成内容"}],
                preference_keys=["image_text"],
            )
        self.assertTrue(all(card.title == "中文方案" for card in cards))
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("请用中文生成内容", sent[1]["content"])

    def test_card_edit_preserves_existing_language_and_missing_title(self):
        card = ContentCard(
            id="copy", card_type="copy", title="中文标题", preview="摘要",
            content="中文正文", tips=["现有要点"],
        )
        client = self.client_returning('{"content": "修改后的中文正文"}')
        with patch.object(content_ai, "_get_modify_client", return_value=client):
            edited = content_ai.modify_card(card, "改进内容但不要翻译", [])
        self.assertEqual(edited.title, card.title)
        self.assertEqual(edited.content, "修改后的中文正文")
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("preserve its language unless the user requests", sent[0]["content"])
        self.assertEqual(card.content, "中文正文")

    def test_card_edit_honors_requested_translation_of_title(self):
        card = ContentCard(
            id="copy", card_type="copy", title="中文标题", preview="摘要", content="中文正文",
        )
        client = self.client_returning(json.dumps({
            "title": "English title", "preview": "Summary", "content": "Translated copy",
        }))
        with patch.object(content_ai, "_get_modify_client", return_value=client):
            edited = content_ai.modify_card(card, "Translate the entire card into English.", [])
        self.assertEqual(edited.title, "English title")
        self.assertEqual(edited.content, "Translated copy")

    def test_content_format_detection_and_validation_support_english(self):
        self.assertEqual(content_ai._resolve_content_format(
            [], [], [{"title": "Video Storyboard", "content": "Voiceover and shot list"}],
        ), "short_video")
        self.assertEqual(content_ai._resolve_content_format(
            [], [], [{"title": "Image-text plan", "content": "Carousel post"}],
        ), "image_text")
        for content_format, conflicting in (
            ("short_video", "Carousel post"),
            ("image_text", "VIDEO SCRIPT with a voiceover"),
        ):
            with self.subTest(content_format=content_format):
                with self.assertRaisesRegex(ValueError, "mix content formats"):
                    content_ai._validate_content_format([{"content": conflicting}], content_format)

    def test_insight_request_has_no_chinese_only_length_constraint(self):
        client = self.client_returning('{"product_name":"Product"}')
        with (
            patch.object(insight_ai, "CASE_AI_API_KEY", "test-key"),
            patch.object(insight_ai, "_get_case_ai_client", return_value=client),
        ):
            result = insight_ai.analyze_document(ParsedDocument(
                title="原始资料", source_type="markdown", raw_text="原始中文资料",
            ), locale="en")
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("requested output language is English", sent[0]["content"])
        self.assertNotIn("Chinese characters", sent[1]["content"])
        self.assertIn("原始中文资料", sent[1]["content"])
        self.assertEqual(result.ai_analysis.product_name, "Product")

    def test_report_prompt_retains_required_bilingual_output(self):
        self.assertNotIn(OUTPUT_LANGUAGE_INSTRUCTION, content_ai.DOCUMENT_SYSTEM_PROMPT)
        self.assertIn(BILINGUAL_REPORT_INSTRUCTION, content_ai.DOCUMENT_SYSTEM_PROMPT)
        for name in ("title_zh", "title_en", "summary_zh", "summary_en"):
            self.assertIn(name, content_ai.GeneratedWorkReport.model_fields)
        for name in ("paragraphs_zh", "paragraphs_en"):
            self.assertIn(name, content_ai.GeneratedWorkSection.model_fields)

    def test_import_uses_english_fallback_but_keeps_supplied_title(self):
        for supplied_title, expected in (
            ("", "Link imported case"),
            ("用户指定标题", "用户指定标题"),
        ):
            with (
                self.subTest(title=supplied_title),
                patch.object(import_tasks, "_insert_task", return_value="task"),
                patch.object(import_tasks, "parse_shared_post_text", return_value={"title": supplied_title}),
                patch.object(import_tasks, "create_case", return_value=SimpleNamespace(id="case")) as create,
                patch.object(import_tasks, "update_case"),
                patch.object(import_tasks, "_update_task"),
                patch.object(import_tasks, "get_import_task", return_value={}),
                patch.object(import_tasks.threading, "Thread"),
            ):
                import_tasks.create_and_run_import_task(owner_id="user", raw_input="", project_id="project")
                self.assertEqual(create.call_args.kwargs["title"], expected)

    def test_project_uses_english_fallback_without_rewriting_saved_session_title(self):
        for session_title, expected in (("", "Untitled content project"), ("原始项目", "原始项目")):
            with (
                self.subTest(title=session_title),
                patch.object(projects, "_schema_initializer"),
                patch.object(projects, "get_session", return_value=SimpleNamespace(
                    id="session", title=session_title, user_id="user", cards=[],
                )),
                patch.object(projects, "_ensure_project_name_available"),
                patch.object(projects, "_connection_factory") as connection,
                patch.object(projects, "get_project"),
            ):
                projects.create_project_from_session("user", "session")
                insert = next(
                    call for call in connection.return_value.execute.call_args_list
                    if "INSERT INTO content_projects" in call.args[0]
                )
                self.assertIn(expected, insert.args[1])

    def test_manual_insight_uses_english_fallback_but_keeps_supplied_name(self):
        for product_name, expected in (("", "Untitled product"), ("中文产品", "中文产品")):
            with (
                self.subTest(product_name=product_name),
                patch.object(insight_storage, "init_db"),
                patch.object(insight_storage, "_get_conn"),
                patch.object(insight_storage, "_project_access", return_value={
                    "organization_id": "organization", "title": "Project", "role": "owner",
                }),
            ):
                record = insight_storage.save_manual_insight(
                    AIAnalysis(product_name=product_name), "user", "project",
                )
                self.assertEqual(record.title, expected)
                self.assertEqual(record.filename, expected)
                self.assertEqual(record.ai_analysis.product_name, product_name)
