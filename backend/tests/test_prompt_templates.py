import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.content_generator import _preference_prefix
from app.engines.case_library import ai_analyzer as case_ai
from app.engines.content_generator import ai_analyzer as content_ai
from app.engines.content_generator.creation_agent import ACTION_SYSTEM_PROMPT
from app.engines.market_insight import ai_analyzer as insight_ai
from app.engines.market_insight.models import ParsedDocument
from app.shared.prompts import (
    MASTER_SYSTEM_PROMPT,
    OUTPUT_LANGUAGE_INSTRUCTION,
    build_system_prompt,
)
from test_ai_provider_configuration import valid_case_analysis_payload


def completion(value):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=value))])


class EnglishMasterPromptTests(unittest.TestCase):
    def test_active_tasks_share_the_master_with_their_intended_language_policy(self):
        for prompt, policy in (
            (ACTION_SYSTEM_PROMPT, None),
            (case_ai.SYSTEM_PROMPT, "The user's explicitly requested output language is Simplified Chinese (zh-CN)."),
            (insight_ai.SYSTEM_PROMPT, "The user's explicitly requested output language is Simplified Chinese (zh-CN)."),
        ):
            with self.subTest(task=prompt[len(MASTER_SYSTEM_PROMPT):][:70]):
                self.assertTrue(prompt.isascii())
                self.assertTrue(prompt.startswith(MASTER_SYSTEM_PROMPT))
                self.assertEqual(prompt.count(MASTER_SYSTEM_PROMPT), 1)
                if policy:
                    self.assertEqual(prompt.count(policy), 1)
                else:
                    self.assertNotIn(OUTPUT_LANGUAGE_INSTRUCTION, prompt)
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
            patch.object(
                insight_ai,
                "get_ai_provider",
                return_value=SimpleNamespace(configured=True, model="test-model"),
            ),
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
