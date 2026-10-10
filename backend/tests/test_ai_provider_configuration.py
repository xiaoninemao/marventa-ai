import json
import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import config as runtime_config
from app.ai_provider import (
    AIProviderArea,
    AIProviderConfigurationError,
    get_ai_provider,
    get_content_image_provider,
)
from app.engines.case_library import ai_analyzer
from app.engines.market_insight import ai_analyzer as insight_ai
from app.engines.publishing import lead_analysis


def valid_case_analysis_payload(video: bool = False) -> dict:
    return {
        "content_analysis": "该案例通过清晰的内容结构、视觉表达和叙事推进建立用户认知，并在关键信息节点持续强化产品价值与互动理由。内容从真实问题切入，再通过场景演示、细节证明和结果呈现完成完整说服链路。",
        "marketing_angle": "以真实使用场景和情绪价值作为核心切入点，降低用户理解门槛并增强内容记忆，同时通过可信体验细节承接转化。",
        "target_audience": "目标受众为关注生活品质、愿意主动搜索解决方案并重视真实体验反馈的年轻消费人群，他们通常会比较细节并参考他人评价。",
        "experience_extraction": "可复用经验包括前置信息钩子、场景化卖点表达、可信细节证明以及低门槛互动引导，适合迁移到同类内容。执行时应保持单一信息重点，并在结尾设置明确的互动或行动路径。",
        "key_highlights": ["开场信息明确有吸引力", "卖点与使用场景结合紧密", "互动问题降低参与门槛"],
        "improvement_suggestions": ["增加结果对比强化说服力", "补充更明确的行动引导"],
        "similar_approaches": ["用户体验型内容结构", "场景问题解决型表达", "情绪价值驱动型叙事"],
        "hook_analysis": "开头通过明确问题和结果预期快速建立观看理由，使用户愿意继续了解后续内容，同时用具体场景和视觉反差强化首屏注意力。",
        "title_suggestions": ["真实体验后的三个发现", "这个场景下它真的很好用"],
        "tag_suggestions": ["真实体验", "场景种草", "实用建议"],
        "rewrite_examples": ["从具体使用场景切入，并用真实细节说明产品如何解决用户问题。"],
        "opening_hook": "前三秒直接展示核心冲突和最终效果，配合简短口播建立继续观看的理由。" if video else "",
        "pacing_analysis": "前段快速建立问题，中段用连续画面解释卖点，结尾放慢节奏完成互动引导。" if video else "",
        "shot_structure": "镜头依次覆盖问题场景、产品特写、使用过程、效果对比和结尾行动提示。" if video else "",
        "script_structure": "口播采用问题提出、方案解释、体验证明和行动号召的递进结构完成表达。" if video else "",
    }


class AIProviderConfigurationTests(unittest.TestCase):
    def load_config(self, environment):
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(Path(__file__).resolve().parents[1] / "app" / "config.py"))

    def test_unified_provider_names_are_read(self):
        config = self.load_config({
            "AI_API_KEY": " unified-key ",
            "AI_BASE_URL": " https://unified.example/v1 ",
            "AI_MODEL": " unified-model ",
        })
        self.assertEqual(config["AI_API_KEY"], "unified-key")
        self.assertEqual(config["AI_BASE_URL"], "https://unified.example/v1")
        self.assertEqual(config["AI_MODEL"], "unified-model")

    def test_reserved_seedream_and_seedance_configuration_is_empty_by_default(self):
        config = self.load_config({})
        example = (Path(__file__).resolve().parents[1] / ".env.example").read_text()
        for provider in ("SEEDREAM", "SEEDANCE"):
            for field in ("API_KEY", "BASE_URL", "MODEL"):
                key = f"CONTENT_STUDIO_{provider}_{field}"
                with self.subTest(key=key):
                    self.assertEqual(config[key], "")
                    self.assertIn(f"{key}=\n", example)
        self.assertFalse(config["CONTENT_STUDIO_IMAGE_GENERATION_ENABLED"])

    def test_reserved_vendor_credentials_are_read_without_enabling_or_overriding_generation(self):
        environment = {
            f"CONTENT_STUDIO_{provider}_{field}": f" {provider.lower()}-{field.lower()} "
            for provider in ("SEEDREAM", "SEEDANCE")
            for field in ("API_KEY", "BASE_URL", "MODEL")
        }
        environment.update({
            "CONTENT_STUDIO_IMAGE_API_KEY": "existing-key",
            "CONTENT_STUDIO_IMAGE_BASE_URL": "https://existing.example/v1",
            "CONTENT_STUDIO_IMAGE_MODEL": "existing-model",
        })
        config = self.load_config(environment)
        for key, value in environment.items():
            with self.subTest(key=key):
                self.assertEqual(config[key], value.strip())
        self.assertFalse(config["CONTENT_STUDIO_IMAGE_GENERATION_ENABLED"])
        self.assertFalse(config["CONTENT_STUDIO_AI_OVERRIDE_ENABLED"])

    def test_legacy_case_ai_names_feed_unified_provider_only(self):
        config = self.load_config({
            "CASE_AI_API_KEY": "legacy-key",
            "CASE_AI_BASE_URL": "https://legacy.example/v1",
            "CASE_AI_MODEL": "legacy-model",
        })
        self.assertEqual(config["AI_API_KEY"], "legacy-key")
        self.assertEqual(config["AI_BASE_URL"], "https://legacy.example/v1")
        self.assertEqual(config["AI_MODEL"], "legacy-model")
        self.assertNotIn("CASE_AI_API_KEY", config)

    def test_business_override_values_require_explicit_switch(self):
        config = self.load_config({
            "CASE_LIBRARY_AI_OVERRIDE_ENABLED": "true",
            "CASE_LIBRARY_AI_API_KEY": "analysis-key",
            "CASE_LIBRARY_AI_BASE_URL": "https://analysis.example/v1",
            "CASE_LIBRARY_AI_MODEL": "vision-model",
        })
        self.assertTrue(config["CASE_LIBRARY_AI_OVERRIDE_ENABLED"])
        self.assertEqual(config["CASE_LIBRARY_AI_API_KEY"], "analysis-key")
        self.assertEqual(config["CASE_LIBRARY_AI_BASE_URL"], "https://analysis.example/v1")
        self.assertEqual(config["CASE_LIBRARY_AI_MODEL"], "vision-model")

    def test_removed_provider_names_are_not_read_or_exported(self):
        config = self.load_config({
            "DEEPSEEK_API_KEY": "old-key",
            "DEEPSEEK_BASE_URL": "https://old.example/v1",
            "DEEPSEEK_MODEL": "old-model",
            "QWEN_API_KEY": "old-analysis-key",
            "QWEN_BASE_URL": "https://old-analysis.example/v1",
            "QWEN_MODEL": "old-analysis-model",
        })
        self.assertEqual(config["AI_API_KEY"], "")
        self.assertEqual(config["AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["AI_MODEL"], "qwen3.8-flash")
        self.assertFalse(any(key.startswith(("QWEN_", "DEEPSEEK_")) for key in config))

    def test_removed_legacy_key_cannot_enable_ai(self):
        config = self.load_config({"LWAN_API_KEY_3RD": "legacy-key"})
        self.assertNotIn("LWAN_API_KEY_3RD", config)
        self.assertEqual(config["AI_API_KEY"], "")
        self.assertEqual(config["AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["AI_MODEL"], "qwen3.8-flash")

    def test_resolver_uses_unified_provider_until_override_is_enabled(self):
        with patch.multiple(
            runtime_config,
            AI_API_KEY="unified-key",
            AI_BASE_URL="https://unified.example/v1",
            AI_MODEL="unified-model",
            CASE_LIBRARY_AI_OVERRIDE_ENABLED=False,
        ):
            provider = get_ai_provider("case_library")
        self.assertEqual(provider.source, "unified")
        self.assertEqual(provider.api_key, "unified-key")
        self.assertEqual(provider.model, "unified-model")

    def test_each_business_area_can_use_a_complete_override(self):
        prefixes: dict[AIProviderArea, str] = {
            "market_insight": "MARKET_INSIGHT_AI",
            "case_library": "CASE_LIBRARY_AI",
            "content_studio": "CONTENT_STUDIO_AI",
            "lead_tracking": "LEAD_TRACKING_AI",
        }
        for area, prefix in prefixes.items():
            with self.subTest(area=area), patch.multiple(
                runtime_config,
                **{
                    f"{prefix}_OVERRIDE_ENABLED": True,
                    f"{prefix}_API_KEY": f"{area}-key",
                    f"{prefix}_BASE_URL": f"https://{area}.example/v1",
                    f"{prefix}_MODEL": f"{area}-model",
                },
            ):
                provider = get_ai_provider(area)
            self.assertEqual(provider.source, "override")
            self.assertEqual(provider.api_key, f"{area}-key")
            self.assertEqual(provider.model, f"{area}-model")

    def test_incomplete_enabled_override_fails_explicitly(self):
        with patch.multiple(
            runtime_config,
            LEAD_TRACKING_AI_OVERRIDE_ENABLED=True,
            LEAD_TRACKING_AI_API_KEY="",
            LEAD_TRACKING_AI_BASE_URL="https://lead.example/v1",
            LEAD_TRACKING_AI_MODEL="lead-model",
        ), self.assertRaisesRegex(
            AIProviderConfigurationError,
            "LEAD_TRACKING_AI_OVERRIDE_ENABLED requires",
        ):
            get_ai_provider("lead_tracking")

    def test_content_image_tool_uses_its_own_explicit_provider(self):
        with patch.multiple(
            runtime_config,
            CONTENT_STUDIO_IMAGE_GENERATION_ENABLED=True,
            CONTENT_STUDIO_IMAGE_API_KEY="image-key",
            CONTENT_STUDIO_IMAGE_BASE_URL="https://images.example/v1",
            CONTENT_STUDIO_IMAGE_MODEL="image-model",
        ):
            provider = get_content_image_provider()
        self.assertEqual(provider.api_key, "image-key")
        self.assertEqual(provider.base_url, "https://images.example/v1")
        self.assertEqual(provider.model, "image-model")

    def test_content_image_tool_never_silently_uses_chat_provider(self):
        with patch.object(
            runtime_config,
            "CONTENT_STUDIO_IMAGE_GENERATION_ENABLED",
            False,
        ), self.assertRaisesRegex(
            AIProviderConfigurationError,
            "image generation is not enabled",
        ):
            get_content_image_provider()


class CaseAnalysisProviderTests(unittest.TestCase):
    def setUp(self):
        self.client = MagicMock()
        self.provider = MagicMock(model="analysis-model")
        self.provider.client.return_value = self.client
        self.enterContext(patch.object(
            ai_analyzer,
            "get_ai_provider",
            return_value=self.provider,
        ))

    def test_case_analyzer_uses_new_provider_configuration(self):
        self.client.chat.completions.create.return_value.choices[0].message.content = (
            json.dumps(valid_case_analysis_payload(), ensure_ascii=False)
        )
        result = ai_analyzer.analyze_case("Title", "image_text", "Body", [])
        self.provider.client.assert_called_once_with()
        call = self.client.chat.completions.create.call_args
        self.assertEqual(call.kwargs["model"], "analysis-model")
        self.assertEqual(call.kwargs["response_format"], {"type": "json_object"})
        self.assertIn("内容结构", result.content_analysis)

    def test_case_analyzer_retries_invalid_structured_output_once(self):
        invalid = MagicMock()
        invalid.choices[0].message.content = "{}"
        valid = MagicMock()
        valid.choices[0].message.content = json.dumps(
            valid_case_analysis_payload(), ensure_ascii=False,
        )
        self.client.chat.completions.create.side_effect = [invalid, valid]
        result = ai_analyzer.analyze_case("Title", "image_text", "Body", [])

        self.assertIn("内容结构", result.content_analysis)
        self.assertEqual(self.client.chat.completions.create.call_count, 2)

    def test_video_analysis_requires_video_specific_fields(self):
        payload = valid_case_analysis_payload()
        with self.assertRaisesRegex(ValueError, "video-specific"):
            ai_analyzer.validate_generated_case_analysis(payload, "video")


class CapabilityRoutingTests(unittest.TestCase):
    def provider(self):
        provider = MagicMock(model="test-model")
        provider.client.return_value = MagicMock()
        return provider

    def test_content_studio_provider_is_shared_with_the_agent(self):
        from app.engines.content_generator import creation_agent
        self.assertIs(creation_agent.get_ai_provider, get_ai_provider)

    def test_market_analysis_and_research_share_one_provider(self):
        provider = self.provider()
        with patch.object(insight_ai, "get_ai_provider", return_value=provider) as resolve:
            insight_ai._get_case_ai_client()
            insight_ai._get_research_ai_client()
        self.assertEqual(
            [call.args for call in resolve.call_args_list],
            [("market_insight",), ("market_insight",)],
        )

    def test_case_and_lead_analysis_use_their_product_providers(self):
        provider = self.provider()
        with patch.object(ai_analyzer, "get_ai_provider", return_value=provider) as case_resolve:
            ai_analyzer._get_client()
        with patch.object(lead_analysis, "get_ai_provider", return_value=provider) as lead_resolve:
            lead_analysis._get_ai_client()
        case_resolve.assert_called_once_with("case_library")
        lead_resolve.assert_called_once_with("lead_tracking")



if __name__ == "__main__":
    unittest.main()
