import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.content_generator import _preference_prefix
from app.engines.case_library import ai_analyzer as case_ai
from app.engines.content_generator import ai_analyzer as content_ai
from app.engines.content_generator.models import ContentCard
from app.engines.market_insight import ai_analyzer as insight_ai
from app.engines.market_insight.models import ParsedDocument
from app.shared.prompts import (
    BILINGUAL_REPORT_INSTRUCTION,
    EDIT_LANGUAGE_INSTRUCTION,
    MASTER_SYSTEM_PROMPT,
    OUTPUT_LANGUAGE_INSTRUCTION,
    build_system_prompt,
)
from test_ai_provider_configuration import valid_case_analysis_payload


def completion(value):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=value))])


class EnglishMasterPromptTests(unittest.TestCase):
    def test_all_six_tasks_share_the_master_with_their_intended_language_policy(self):
        for prompt, policy in (
            (content_ai.SYSTEM_PROMPT, OUTPUT_LANGUAGE_INSTRUCTION),
            (content_ai.CARD_SYSTEM_PROMPT, OUTPUT_LANGUAGE_INSTRUCTION),
            (content_ai.MODIFY_SYSTEM_PROMPT, EDIT_LANGUAGE_INSTRUCTION),
            (content_ai.DOCUMENT_SYSTEM_PROMPT, BILINGUAL_REPORT_INSTRUCTION),
            (case_ai.SYSTEM_PROMPT, "The user's explicitly requested output language is Simplified Chinese (zh-CN)."),
            (insight_ai.SYSTEM_PROMPT, "The user's explicitly requested output language is Simplified Chinese (zh-CN)."),
        ):
            with self.subTest(task=prompt[len(MASTER_SYSTEM_PROMPT):][:70]):
                self.assertTrue(prompt.isascii())
                self.assertTrue(prompt.startswith(MASTER_SYSTEM_PROMPT))
                self.assertEqual(prompt.count(MASTER_SYSTEM_PROMPT), 1)
                self.assertEqual(prompt.count(policy), 1)
        self.assertNotIn(OUTPUT_LANGUAGE_INSTRUCTION, content_ai.DOCUMENT_SYSTEM_PROMPT)
        self.assertTrue(case_ai.ANALYSIS_PROMPT.isascii())
        self.assertTrue(insight_ai.ANALYSIS_PROMPT.isascii())

    def test_unknown_language_policy_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unsupported prompt language mode"):
            build_system_prompt("Task", language_mode="unsupported")

    def test_reference_labels_are_english_without_translating_source_values(self):
        insight = SimpleNamespace(
            product_name="原始产品",
            ai_analysis=SimpleNamespace(
                product_name="原始产品", market_positioning="原始定位", strengths=["原始优势"],
                target_audience="原始受众", suggested_marketing_angles=["原始角度"],
            ),
        )
        case = SimpleNamespace(
            title="原始案例", content_type="video", description="原始描述", tags=["原始标签"],
            ai_analysis=SimpleNamespace(
                content_analysis="原始分析", marketing_angle="原始角度",
                experience_extraction="原始经验", key_highlights=["原始亮点"],
            ),
        )
        with (
            patch("app.engines.market_insight.storage.get_insight", return_value=insight) as get_insight,
            patch("app.engines.case_library.storage.get_case", return_value=case) as get_case,
        ):
            context = content_ai.build_reference_context(["insight"], ["case"], "owner")
        get_insight.assert_called_once_with("insight", "owner")
        get_case.assert_called_once_with("case", "owner")
        self.assertIn("Reference material: market insights", context)
        self.assertIn("Reference material: case studies", context)
        self.assertIn("Product: 原始产品", context)
        self.assertIn("Title: 原始案例 (short video)", context)
        self.assertIn("Reusable lessons: 原始经验", context)
        self.assertIn("Tags: 原始标签", context)
        self.assertEqual(content_ai.build_reference_context([], []), "")

    def test_missing_reference_metadata_uses_english_placeholders(self):
        insight = SimpleNamespace(product_name="Product", ai_analysis=None)
        case = SimpleNamespace(
            title="Case", content_type="image_text", description="", tags=[], ai_analysis=None,
        )
        with (
            patch("app.engines.market_insight.storage.get_insight", return_value=insight),
            patch("app.engines.case_library.storage.get_case", return_value=case),
        ):
            context = content_ai.build_reference_context(["insight"], ["case"])
        self.assertTrue(context.isascii())
        self.assertIn("no AI analysis available", context)
        self.assertIn("Description: None", context)

    def test_chat_keeps_master_first_and_user_language_request_unchanged(self):
        client = MagicMock()
        client.chat.completions.create.return_value = completion("中文答复")
        messages = [{"role": "user", "content": "请用中文回答，保留原产品名"}]
        with patch.object(content_ai, "_get_client", return_value=client):
            result = content_ai.chat(messages, reference_context="Product: 原始产品")
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertEqual(result, "中文答复")
        self.assertTrue(sent[0]["content"].startswith(MASTER_SYSTEM_PROMPT))
        self.assertEqual(sent[0]["content"].count(OUTPUT_LANGUAGE_INSTRUCTION), 1)
        self.assertIn("Reference context:\nProduct: 原始产品", sent[0]["content"])
        self.assertEqual(sent[1:], messages)

    def test_card_generation_and_format_retry_are_english(self):
        cards = [{
            "id": kind, "card_type": kind, "title": "Launch plan",
            "preview": "Launch preview", "content": "Launch details", "tips": [],
        } for kind in ("script", "title", "copy", "hashtags", "visual")]
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            completion('{"cards": []}'), completion(json.dumps({"cards": cards})),
        ]
        with patch.object(content_ai, "_get_client", return_value=client):
            generated = content_ai.generate_cards(
                [{"role": "user", "content": "Plan a launch."}],
                reference_context="Product: Example",
                preference_keys=["short_video", "douyin"],
            )
        self.assertEqual(len(generated), 5)
        calls = client.chat.completions.create.call_args_list
        self.assertEqual(len(calls), 2)
        for call in calls:
            sent = call.kwargs["messages"]
            self.assertTrue(all(message["content"].isascii() for message in sent))
            self.assertTrue(sent[0]["content"].startswith(MASTER_SYSTEM_PROMPT))
            self.assertEqual(sent[0]["content"].count(MASTER_SYSTEM_PROMPT), 1)
            self.assertIn("User: Plan a launch.", sent[1]["content"])
            self.assertIn("short_video, douyin", sent[1]["content"])
        self.assertIn("Correction: the content format is short video.", calls[1].kwargs["messages"][1]["content"])

    def test_edit_request_is_english_and_retains_language_preservation_rule(self):
        client = MagicMock()
        client.chat.completions.create.return_value = completion('{"content": "Updated copy"}')
        card = ContentCard(
            id="copy", card_type="copy", title="Post copy", preview="Summary", content="Original copy",
        )
        with patch.object(content_ai, "_get_modify_client", return_value=client):
            content_ai.modify_card(card, "Make the benefit clearer.", [])
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertTrue(all(message["content"].isascii() for message in sent))
        self.assertIn(EDIT_LANGUAGE_INSTRUCTION, sent[0]["content"])
        self.assertIn("Requested changes: Make the benefit clearer.", sent[1]["content"])
        self.assertEqual(card.content, "Original copy")

    def test_report_request_and_retry_preserve_bilingual_contract(self):
        client = MagicMock()
        client.chat.completions.create.return_value = completion("{}")
        card = ContentCard(
            id="copy", card_type="copy", title="Original title", preview="Summary", content="Original copy",
        )
        with patch.object(content_ai, "_get_client", return_value=client):
            with self.assertRaisesRegex(ValueError, "invalid work report"):
                content_ai.generate_document([card])
        calls = client.chat.completions.create.call_args_list
        self.assertEqual(len(calls), 2)
        sent = calls[1].kwargs["messages"]
        self.assertTrue(all(message["content"].isascii() for message in sent))
        self.assertIn(BILINGUAL_REPORT_INSTRUCTION, sent[0]["content"])
        positions = [sent[0]["content"].index(section) for section in content_ai.REQUIRED_WORK_SECTIONS]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("Content cards:\nCard: Original title\nOriginal copy", sent[1]["content"])
        self.assertIn("JSON Schema validation", sent[-1]["content"])
        self.assertIn("both Chinese and English", sent[-1]["content"])
        self.assertEqual(calls[1].kwargs["response_format"], {"type": "json_object"})
        self.assertEqual(calls[1].kwargs["max_tokens"], 8192)

    def test_case_multimodal_request_and_retry_use_english_instructions(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            completion("{}"), completion(json.dumps(valid_case_analysis_payload(video=True))),
        ]
        with (
            patch.object(case_ai, "_get_client", return_value=client),
            patch.object(case_ai, "_image_to_data_url", return_value="data:image/png;base64,example"),
        ):
            case_ai.analyze_case("Example", "video", "", [], ["frame.png"], "clip.mp4")
        calls = client.chat.completions.create.call_args_list
        self.assertEqual(len(calls), 2)
        sent = calls[1].kwargs["messages"]
        self.assertTrue(sent[0]["content"].isascii())
        self.assertTrue(sent[1]["content"][-1]["text"].isascii())
        self.assertEqual(sent[1]["content"][0]["image_url"]["url"], "data:image/png;base64,example")
        self.assertIn("Video file: clip.mp4", sent[1]["content"][-1]["text"])
        self.assertIn("(No description)", sent[1]["content"][-1]["text"])
        self.assertTrue(sent[-1]["content"].isascii())
        self.assertIn("video-specific", sent[-1]["content"])
        self.assertEqual(calls[1].kwargs["response_format"], {"type": "json_object"})

    def test_insight_request_is_english_and_keeps_compact_limits(self):
        client = MagicMock()
        client.chat.completions.create.return_value = completion('{"product_name": "Example"}')
        with (
            patch.object(insight_ai, "CASE_AI_API_KEY", "test-key"),
            patch.object(insight_ai, "_get_case_ai_client", return_value=client),
        ):
            insight_ai.analyze_document(ParsedDocument(
                title="Example", source_type="markdown", raw_text="Original product documentation",
            ))
        sent = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertTrue(all(message["content"].isascii() for message in sent))
        self.assertIn("Original product documentation", sent[1]["content"])
        self.assertIn("under 120 characters", sent[1]["content"])
        self.assertIn("at most 3 short items", sent[1]["content"])

    def test_preference_metadata_uses_english_without_changing_keys(self):
        keys = ["short_video", "douyin", "short_video"]
        self.assertEqual(_preference_prefix(keys), "Selected preferences: Short video, Douyin\n\n")
        self.assertEqual(keys, ["short_video", "douyin", "short_video"])
        self.assertEqual(_preference_prefix([]), "")
        self.assertTrue(_preference_prefix([
            "image_text", "xiaohongshu", "kuaishou", "weibo", "bilibili", "wechat_mp", "shipinhao",
        ]).isascii())


if __name__ == "__main__":
    unittest.main()
