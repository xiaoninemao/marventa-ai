import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.engines.case_library import ai_analyzer as case_ai
from app.engines.case_library import import_tasks
from app.engines.content_generator.creation_agent import ACTION_SYSTEM_PROMPT
from app.engines.market_insight import ai_analyzer as insight_ai
from app.engines.market_insight import storage as insight_storage
from app.engines.market_insight.models import AIAnalysis, ParsedDocument
from app.shared.prompts import OUTPUT_LANGUAGE_INSTRUCTION


class EnglishOutputDefaultsTests(unittest.TestCase):
    @staticmethod
    def client_returning(value):
        client = MagicMock()
        client.chat.completions.create.return_value.choices[0].message.content = value
        return client


    def test_content_agent_does_not_force_a_fixed_output_language(self):
        for prompt in (
            ACTION_SYSTEM_PROMPT,
        ):
            with self.subTest(prompt=prompt[:40]):
                self.assertNotIn(OUTPUT_LANGUAGE_INSTRUCTION, prompt)
                self.assertNotIn("用中文回复", prompt)
                self.assertNotIn("请用中文输出", prompt)
                self.assertNotIn("始终使用中文输出", prompt)
        self.assertNotIn("始终使用中文输出", insight_ai.ANALYSIS_PROMPT)

    def test_analysis_prompts_default_to_chinese_when_no_interface_locale_is_supplied(self):
        for prompt in (case_ai.SYSTEM_PROMPT, insight_ai.SYSTEM_PROMPT):
            self.assertIn("requested output language is Simplified Chinese", prompt)
            self.assertNotIn("Use English by default.", prompt)







    def test_insight_request_has_no_chinese_only_length_constraint(self):
        client = self.client_returning('{"product_name":"Product"}')
        with (
            patch.object(
                insight_ai,
                "get_ai_provider",
                return_value=SimpleNamespace(configured=True, model="test-model"),
            ),
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
