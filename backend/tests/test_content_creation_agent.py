import base64
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.engines.content_generator import creation_agent


class Completion:
    def __init__(self, message):
        self.choices = [SimpleNamespace(message=message)]

    def __iter__(self):
        message = self.choices[0].message
        content = message.content or ""
        for index in range(0, len(content), 8):
            yield SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content=content[index:index + 8], tool_calls=[]),
                finish_reason=None,
            )])
        calls = list(getattr(message, "tool_calls", None) or [])
        if calls:
            yield SimpleNamespace(choices=[SimpleNamespace(
                delta=SimpleNamespace(content=None, tool_calls=[
                    SimpleNamespace(index=index, id=call.id, function=call.function)
                    for index, call in enumerate(calls)
                ]), finish_reason=None,
            )])
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=None, tool_calls=[]),
            finish_reason="tool_calls" if calls else "stop",
        )])

    def close(self):
        pass


def completion(payload):
    return Completion(SimpleNamespace(content=json.dumps(payload, ensure_ascii=False)))


def tool_completion(name, arguments, content=""):
    return Completion(SimpleNamespace(
                content=content,
                tool_calls=[SimpleNamespace(
                    id="tool-call",
                    function=SimpleNamespace(
                        name=name,
                        arguments=json.dumps(arguments),
                    ),
                )],
            ))


def natural_completion(content):
    return Completion(SimpleNamespace(content=content, tool_calls=[]))


def action_turn(payload, media_ids=None):
    work = payload["deliverable"]
    return [
        tool_completion("compose_work", {
            "title": work["title"], "publication_copy": work["publication_copy"],
            "tags": work["tags"], "media_ids": media_ids or [],
            "visual_prompt": work.get("visual_prompt", ""),
            "video_script": work.get("video_script", ""), "storyboard": work.get("storyboard", []),
        }, "I will assemble the work."),
        completion({"intent": "create", "reply": payload["reply"]}),
        completion({"next_agent": "finish", "final_response": payload["reply"]}),
    ]


class ContentCreationAgentTests(unittest.TestCase):
    def assert_update(self, progress, text):
        self.assertTrue(any(
            len(call.args) == 3 and call.args[0] == "agent_response"
            and getattr(call.args[2], "content", None) == text
            for call in progress.call_args_list
        ), f"Missing conversational update: {text}")

    def provider(self, payload):
        client = MagicMock()
        if payload["intent"] == "explore":
            worker_payload = {
                "reply": payload["reply"],
                "needs_user_input": True,
                "handoff": payload["reply"],
            }
            next_agent = "chat"
            objective = "Clarify the user's goal."
        else:
            worker_payload = payload
            next_agent = "action"
            objective = "Produce the requested deliverable."
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": next_agent,
                "objective": objective,
                "final_response": "",
            }),
            *(action_turn(worker_payload) if next_agent == "action" else [completion(worker_payload)]),
        ]
        provider = MagicMock(model="agent-model")
        provider.client.return_value = client
        return provider, client

    def test_auto_mode_can_continue_exploration_without_using_image_tool(self):
        provider, client = self.provider({
            "intent": "explore",
            "reply": "Who is the primary audience?",
            "deliverable": None,
        })
        with (
            patch.object(creation_agent, "get_ai_provider", return_value=provider),
            patch.object(creation_agent, "_generate_image") as generate_image,
        ):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Help me think through the direction"}],
                mode="auto",
                reference_context="",
                preference_keys=[],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
            )
        self.assertEqual(result.intent, "explore")
        self.assertIsNone(result.deliverable)
        generate_image.assert_not_called()
        request = client.chat.completions.create.call_args_list[0].kwargs
        self.assertIn("Selected mode: auto", request["messages"][1]["content"])
        system_prompt = request["messages"][0]["content"]
        self.assertNotIn("primary language of the user's latest request", system_prompt)
        self.assertNotIn("Use English by default", system_prompt)

    def test_plan_mode_can_route_chat_then_plan_but_not_action(self):
        provider, client = self.provider({
            "intent": "explore",
            "reply": "unused",
            "deliverable": None,
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "chat",
                "objective": "Confirm the campaign goal.",
                "final_response": "",
            }),
            completion({
                "reply": "The goal is sufficiently clear.",
                "needs_user_input": False,
                "handoff": "Goal: build awareness.",
            }),
            completion({
                "next_agent": "plan",
                "objective": "Create the content plan.",
                "final_response": "",
            }),
            completion({
                "title": "Awareness campaign plan",
                "reply": "Here is the proposed content plan.",
                "needs_user_input": False,
                "handoff": "Plan: insight, message, format, review.",
            }),
            completion({
                "next_agent": "finish",
                "objective": "",
                "final_response": "The plan is ready.",
            }),
        ]
        progress = MagicMock()
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Plan the campaign"}],
                mode="explore",
                reference_context="",
                preference_keys=[],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
            )
        self.assertEqual(result.intent, "explore")
        self.assertEqual(result.reply, "Here is the proposed content plan.")
        self.assertEqual(result.plans[0].title, "Awareness campaign plan")
        progress.assert_any_call("chat_agent", "")
        progress.assert_any_call("plan_agent", "")

        disallowed, _client = self.provider({
            "intent": "explore",
            "reply": "unused",
            "deliverable": None,
        })
        disallowed.client.return_value.chat.completions.create.side_effect = [
            completion({
                "next_agent": "action",
                "objective": "Generate an image.",
                "final_response": "",
            }),
        ]
        with patch.object(creation_agent, "get_ai_provider", return_value=disallowed):
            with self.assertRaisesRegex(ValueError, "disallowed agent action"):
                creation_agent.run_creation_agent(
                    [{"role": "user", "content": "Plan the campaign"}],
                    mode="explore",
                    reference_context="",
                    preference_keys=[],
                    image_inputs=[],
                    user_id="user",
                    project_id="project",
                    base_url="http://testserver",
                )

    def test_action_mode_can_route_chat_plan_then_action(self):
        provider, client = self.provider({
            "intent": "create",
            "reply": "unused",
            "deliverable": {
                "media_kind": "image",
                "title": "unused",
                "publication_copy": "unused",
                "tags": [],
                "generate_image": False,
                "visual_prompt": "unused",
                "video_script": "",
                "storyboard": [],
            },
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "chat",
                "objective": "Confirm the execution goal.",
                "final_response": "",
            }),
            completion({
                "reply": "The execution goal is clear.",
                "needs_user_input": False,
                "handoff": "Create concise launch copy.",
            }),
            completion({
                "next_agent": "plan",
                "objective": "Plan the execution.",
                "final_response": "",
            }),
            completion({
                "title": "Benefit-led execution plan",
                "reply": "The execution plan is ready.",
                "needs_user_input": False,
                "handoff": "Use a direct benefit-led message.",
            }),
            completion({
                "next_agent": "action",
                "objective": "Execute the approved plan.",
                "final_response": "",
            }),
            *action_turn({
                "intent": "create",
                "reply": "The copy deliverable is ready.",
                "deliverable": {
                    "media_kind": "image",
                    "title": "Launch clearly",
                    "publication_copy": "Benefit-led publication copy.",
                    "tags": ["launch"],
                    "generate_image": False,
                    "visual_prompt": "Future visual direction",
                    "video_script": "",
                    "storyboard": [],
                },
            }),
        ]
        progress = MagicMock()
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Execute the campaign"}],
                mode="create",
                reference_context="",
                preference_keys=["image_text"],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
            )
        self.assertEqual(result.intent, "create")
        self.assertEqual(result.deliverable.title, "Launch clearly")
        progress.assert_any_call("chat_agent", "")
        progress.assert_any_call("plan_agent", "")
        progress.assert_any_call("action_agent", "")

    def test_agent_reads_authorized_context_through_a_real_tool_turn(self):
        provider, client = self.provider({
            "intent": "explore",
            "reply": "Which audience segment should lead?",
            "deliverable": None,
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "chat",
                "objective": "Review evidence before asking a question.",
                "final_response": "",
            }),
            tool_completion(
                "read_context",
                {"section": "insights"},
                "I will review the market evidence first.",
            ),
            completion({
                "reply": "Which audience segment should lead?",
                "needs_user_input": True,
                "handoff": "Market evidence reviewed.",
            }),
        ]
        progress = MagicMock()
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Help me choose a direction"}],
                mode="auto",
                reference_context="",
                preference_keys=[],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
                context_sections={"insights": "Authorized market evidence"},
            )
        self.assertEqual(result.intent, "explore")
        self.assert_update(progress, "I will review the market evidence first.")
        progress.assert_any_call("reading_insights", "")
        second_messages = client.chat.completions.create.call_args_list[2].kwargs["messages"]
        self.assertEqual(second_messages[-1]["role"], "tool")
        self.assertEqual(second_messages[-1]["content"], "Authorized market evidence")

    def test_chat_and_plan_cannot_access_canvas_or_generation_tools(self):
        for agent in ("chat", "plan"):
            for tool in ("compose_work", "import_material", "generate_image", "generate_video"):
                with self.subTest(agent=agent, tool=tool):
                    provider, client = self.provider({"intent": "explore", "reply": "unused"})
                    client.chat.completions.create.side_effect = [
                        tool_completion(tool, {}, "I will do this."),
                    ]
                    with patch.object(creation_agent, "get_ai_provider", return_value=provider):
                        with self.assertRaisesRegex(ValueError, "unauthorized tool"):
                            creation_agent._run_read_only_agent(
                                agent=agent, objective="Plan", messages=[], handoffs=[],
                                context_sections={"brand": "Use an understated tone"},
                                image_inputs=[], progress=None,
                            )
                    names = [tool["function"]["name"] for tool in client.chat.completions.create.call_args.kwargs["tools"]]
                    self.assertEqual(names, ["read_context"])
                    self.assertIn("understated", client.chat.completions.create.call_args.kwargs["messages"][0]["content"])

    def test_create_mode_finishes_after_action_without_an_extra_router_call(self):
        provider, client = self.provider({
            "intent": "create", "reply": "Work composed",
            "deliverable": {"title": "Work", "publication_copy": "Copy", "tags": []},
        })
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Write copy"}], mode="create",
                reference_context="", preference_keys=[], image_inputs=[],
                user_id="user", project_id="project", base_url="http://testserver",
            )
        self.assertEqual(len(result.revisions), 1)
        self.assertEqual(client.chat.completions.create.call_count, 3)
        self.assertEqual(result.reply, "Work composed")
        self.assertEqual(result.deliverable.title, "Work")
        provider.client.assert_called_once_with(timeout=180)
        client.close.assert_called_once()

    def test_natural_language_after_tool_becomes_an_intermediate_agent_update(self):
        provider, client = self.provider({
            "intent": "explore",
            "reply": "Which audience segment should lead?",
            "deliverable": None,
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "chat",
                "objective": "Review evidence before asking a question.",
                "final_response": "",
            }),
            tool_completion(
                "read_context",
                {"section": "insights"},
                "I will inspect the market evidence.",
            ),
            natural_completion("I found one strong direction in the market evidence."),
            completion({
                "reply": "Which audience segment should lead?",
                "needs_user_input": True,
                "handoff": "Market evidence reviewed.",
            }),
        ]
        progress = MagicMock()
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Help me choose a direction"}],
                mode="auto",
                reference_context="",
                preference_keys=[],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
                context_sections={"insights": "Authorized market evidence"},
            )
        self.assertEqual(result.reply, "Which audience segment should lead?")
        self.assert_update(progress, "I found one strong direction in the market evidence.")
        final_messages = client.chat.completions.create.call_args_list[3].kwargs["messages"]
        self.assertIn("return the final JSON object", final_messages[-1]["content"])

    def test_tool_call_without_content_uses_tool_events_without_a_narration_model_call(self):
        provider, client = self.provider({
            "intent": "explore",
            "reply": "Which audience segment should lead?",
            "deliverable": None,
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "chat",
                "objective": "Review evidence before asking a question.",
                "final_response": "",
            }),
            tool_completion("read_context", {"section": "insights"}),
            completion({
                "reply": "Which audience segment should lead?",
                "needs_user_input": True,
                "handoff": "Market evidence reviewed.",
            }),
        ]
        progress = MagicMock()
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Help me choose a direction"}],
                mode="auto",
                reference_context="",
                preference_keys=[],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
                context_sections={"insights": "Authorized market evidence"},
            )
        self.assertEqual(result.intent, "explore")
        self.assertEqual(client.chat.completions.create.call_count, 3)
        self.assertTrue(any(
            len(call.args) == 3 and getattr(call.args[2], "tool", "") == "read_context"
            and getattr(call.args[2], "status", "") == "completed"
            for call in progress.call_args_list
        ))

    def test_agent_does_not_prescribe_a_response_language(self):
        provider, client = self.provider({
            "intent": "create",
            "reply": "中文成品已生成。",
            "deliverable": {
                "media_kind": "image",
                "title": "中文标题",
                "publication_copy": "中文发布文案。",
                "tags": ["中文标签"],
                "generate_image": False,
                "visual_prompt": "中文视觉提示词",
                "video_script": "",
                "storyboard": [],
            },
        })
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "请为新品写一条中文图文内容"}],
                mode="create",
                reference_context="",
                preference_keys=["image_text"],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
            )
        system_prompt = client.chat.completions.create.call_args_list[1].kwargs["messages"][0]["content"]
        self.assertNotIn("primary language", system_prompt)
        self.assertNotIn("output language", system_prompt)
        self.assertNotIn("Use English by default", system_prompt)
        self.assertEqual(result.reply, "中文成品已生成。")
        self.assertEqual(result.deliverable.title, "中文标题")
        self.assertEqual(result.deliverable.visual_prompt, "中文视觉提示词")

    def test_create_mode_returns_direct_package_and_uses_image_tool(self):
        provider, client = self.provider({
            "intent": "create",
            "reply": "The complete image post is ready.",
            "deliverable": {
                "media_kind": "image",
                "title": "A clear launch title",
                "publication_copy": "Complete publication copy.",
                "tags": ["launch", "product"],
                "visual_prompt": "Editorial product photograph on a blue background",
                "video_script": "",
                "storyboard": [],
            },
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "action",
                "objective": "Produce the requested deliverable.",
                "final_response": "",
            }),
            tool_completion(
                "generate_image",
                {
                    "prompt": "Editorial product photograph on a blue background",
                    "title": "A clear launch title",
                },
                "The direction is set; I am generating the key visual.",
            ),
            *action_turn({
                "intent": "create",
                "reply": "The complete image post is ready.",
                "deliverable": {
                    "media_kind": "image",
                    "title": "A clear launch title",
                    "publication_copy": "Complete publication copy.",
                    "tags": ["launch", "product"],
                    "visual_prompt": "Editorial product photograph on a blue background",
                    "video_script": "",
                    "storyboard": [],
                },
            }, ["generated:test"]),
        ]
        with (
            patch.object(creation_agent, "get_ai_provider", return_value=provider),
            patch.object(
                creation_agent,
                "_generate_image",
                return_value=("material", "http://testserver/media/generated.png"),
            ) as generate_image,
            patch("app.engines.content_generator.work_tools.uuid.uuid4",
                  return_value=SimpleNamespace(hex="test")),
        ):
            progress = MagicMock()
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Create the image post now"}],
                mode="create",
                reference_context="Brand voice: clear",
                preference_keys=["image_text"],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
                progress=progress,
            )
        self.assertEqual(result.intent, "create")
        self.assertEqual(result.deliverable.image_material_id, "material")
        self.assertEqual(result.deliverable.tags, ["launch", "product"])
        self.assert_update(progress, "The direction is set; I am generating the key visual.")
        progress.assert_any_call("generating_image", "")
        generate_image.assert_called_once()

    def test_image_creation_rejects_video_script(self):
        provider, _client = self.provider({
            "intent": "create",
            "reply": "Ready.",
            "deliverable": {
                "media_kind": "video",
                "title": "Video",
                "publication_copy": "Copy",
                "tags": [],
                "generate_image": False,
                "visual_prompt": "Key visual",
                "video_script": "Video script",
                "storyboard": [],
            },
        })
        with patch.object(creation_agent, "get_ai_provider", return_value=provider):
            with self.assertRaisesRegex(ValueError, "cannot contain a video script"):
                creation_agent.run_creation_agent(
                    [{"role": "user", "content": "Create a video"}],
                    mode="create",
                    reference_context="",
                    preference_keys=["short_video"],
                    image_inputs=[],
                    user_id="user",
                    project_id="project",
                    base_url="http://testserver",
                )

    def test_explicit_text_only_creation_does_not_use_image_tool(self):
        provider, client = self.provider({
            "intent": "create",
            "reply": "Text deliverable ready.",
            "deliverable": {
                "media_kind": "image",
                "title": "Text-only title",
                "publication_copy": "Text-only publication copy",
                "tags": ["copy"],
                "generate_image": False,
                "visual_prompt": "Optional future visual direction",
                "video_script": "",
                "storyboard": [],
            },
        })
        client.chat.completions.create.side_effect = [
            completion({
                "next_agent": "action",
                "objective": "Produce text-only publication copy.",
                "final_response": "",
                "allow_image_generation": False,
            }),
            *action_turn({
                "intent": "create",
                "reply": "Text deliverable ready.",
                "deliverable": {
                    "media_kind": "image",
                    "title": "Text-only title",
                    "publication_copy": "Text-only publication copy",
                    "tags": ["copy"],
                    "generate_image": False,
                    "visual_prompt": "Optional future visual direction",
                    "video_script": "",
                    "storyboard": [],
                },
            }),
        ]
        with (
            patch.object(creation_agent, "get_ai_provider", return_value=provider),
            patch.object(creation_agent, "_generate_image") as generate_image,
        ):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Only write the copy. Do not generate an image."}],
                mode="create",
                reference_context="",
                preference_keys=["image_text"],
                image_inputs=[],
                user_id="user",
                project_id="project",
                base_url="http://testserver",
            )
        self.assertEqual(result.deliverable.image_url, "")
        self.assertEqual(result.deliverable.publication_copy, "Text-only publication copy")
        action_request = client.chat.completions.create.call_args_list[1].kwargs
        self.assertNotIn("generate_image", [tool["function"]["name"] for tool in action_request["tools"]])
        generate_image.assert_not_called()

    def test_generated_image_data_must_be_bounded_supported_media(self):
        png = b"\x89PNG\r\n\x1a\nimage"
        data, mime_type, extension = creation_agent._image_bytes(
            base64.b64encode(png).decode(),
        )
        self.assertEqual(data, png)
        self.assertEqual((mime_type, extension), ("image/png", ".png"))
        with self.assertRaisesRegex(ValueError, "unsupported"):
            creation_agent._image_bytes(base64.b64encode(b"text").decode())

    def test_generated_image_stays_with_deliverable_without_creating_material(self):
        png = b"\x89PNG\r\n\x1a\nimage"
        client = MagicMock()
        client.images.generate.return_value = SimpleNamespace(data=[
            SimpleNamespace(b64_json=base64.b64encode(png).decode()),
        ])
        provider = MagicMock(model="image-model")
        provider.client.return_value = client
        with (
            patch.object(creation_agent, "get_content_image_provider", return_value=provider),
            patch.object(creation_agent, "ensure_project_material_access", return_value="org"),
            patch.object(creation_agent, "put_media_bytes") as put_media,
            patch.object(
                creation_agent,
                "media_url",
                return_value="http://testserver/media/generated.png",
            ),
        ):
            material_id, image_url = creation_agent._generate_image(
                prompt="Product photo",
                title="Launch",
                user_id="user",
                project_id="project",
                base_url="http://testserver",
            )
        self.assertEqual(material_id, "")
        self.assertEqual(image_url, "http://testserver/media/generated.png")
        object_key = put_media.call_args.args[0]
        self.assertTrue(object_key.startswith("content-generator/org/project/"))

    def test_oversized_base64_is_rejected_before_decoding(self):
        with patch.object(creation_agent.config, "CONTENT_STUDIO_IMAGE_MAX_BYTES", 3), patch.object(
            creation_agent.base64, "b64decode",
        ) as decode, self.assertRaisesRegex(ValueError, "size limit"):
            creation_agent._image_bytes("A" * 8)
        decode.assert_not_called()

    def test_reference_image_bytes_are_sent_to_edit_endpoint_not_text_generation(self):
        png = b"\x89PNG\r\n\x1a\nreference"
        provider = MagicMock(model="gpt-image-1")
        client = provider.client.return_value
        client.images.edit.return_value = SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png).decode())])
        with patch.object(creation_agent, "get_content_image_provider", return_value=provider), patch.object(
            creation_agent, "ensure_project_material_access", return_value="org",
        ), patch.object(creation_agent, "put_media_bytes"):
            creation_agent._generate_image(
                prompt="Keep the product; change the background", title="Edit", user_id="user",
                project_id="project", base_url="http://testserver", reference_images=[png],
            )
        client.images.generate.assert_not_called()
        request = client.images.edit.call_args.kwargs
        self.assertEqual(request["image"], ("reference-0.png", png, "image/png"))
        self.assertIs(request["response_format"], creation_agent.NOT_GIVEN)

    def test_invalid_or_oversized_reference_images_do_not_call_provider(self):
        provider = MagicMock(model="image-model")
        for refs in ([b"text"], [b"\x89PNG\r\n\x1a\n"] * 6):
            with self.subTest(refs=len(refs)), patch.object(
                creation_agent, "get_content_image_provider", return_value=provider,
            ), self.assertRaises(ValueError):
                creation_agent._generate_image(
                    prompt="Edit", title="Edit", user_id="user", project_id="project",
                    base_url="http://testserver", reference_images=refs,
                )
        provider.client.assert_not_called()

    def test_selected_image_is_automatically_sent_as_reference_and_other_slot_is_preserved(self):
        from app.engines.content_generator.models import (
            CreativeDeliverable,
            ImageReference,
        )

        current = CreativeDeliverable(
            id="old", media_kind="image", title="Title", publication_copy="Copy",
            image_url="http://testserver/media/content-generator/org/project/first.png",
            additional_image_urls=["http://testserver/media/content-generator/org/project/second.png"],
            created_at="2026-10-11T00:00:00Z",
        )
        provider = MagicMock(model="agent-model")
        client = provider.client.return_value
        client.chat.completions.create.side_effect = [
            completion({"next_agent": "action", "objective": "Replace only the second image"}),
            tool_completion("generate_image", {"prompt": "Keep the product; change the background", "title": "Edit"}),
            tool_completion("compose_work", {"media_ids": ["current:0", "generated:new"]}),
            completion({"intent": "create", "reply": "Replaced the second image."}),
        ]
        png = b"\x89PNG\r\n\x1a\nreference"
        with patch.object(creation_agent, "get_ai_provider", return_value=provider), patch.object(
            creation_agent, "ensure_project_material_access", return_value="org",
        ), patch.object(creation_agent, "read_media_bytes", return_value=png) as read, patch.object(
            creation_agent, "_generate_image",
            return_value=("", "http://testserver/media/content-generator/org/project/new.png"),
        ) as generate, patch(
            "app.engines.content_generator.work_tools.uuid.uuid4", return_value=SimpleNamespace(hex="new"),
        ):
            result = creation_agent.run_creation_agent(
                [{"role": "user", "content": "Replace the second image"}], mode="create",
                reference_context="", preference_keys=[], image_inputs=[], user_id="user",
                project_id="project", base_url="http://testserver", current_work=current,
                image_reference=ImageReference(deliverable_id="old", index=1),
            )
        read.assert_called_once_with("content-generator/org/project/second.png", max_bytes=creation_agent.config.CONTENT_STUDIO_IMAGE_MAX_BYTES)
        self.assertEqual(generate.call_args.kwargs["reference_images"], [png])
        self.assertEqual(result.deliverable.image_url, current.image_url)
        self.assertEqual(result.deliverable.additional_image_urls, ["http://testserver/media/content-generator/org/project/new.png"])
        self.assertEqual(client.chat.completions.create.call_count, 4)

    def test_real_sdk_sends_reference_as_multipart_without_unsupported_gpt_format(self):
        import httpx
        from openai import OpenAI

        png = b"\x89PNG\r\n\x1a\nreference"
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"created": 1, "data": [{"b64_json": base64.b64encode(png).decode()}]})

        provider = creation_agent.AIProvider(
            area="content_studio", source="override", api_key="test-key",
            base_url="https://images.test/v1", model="gpt-image-1",
        )
        with OpenAI(
            api_key="test-key", base_url=provider.base_url,
            http_client=httpx.Client(transport=httpx.MockTransport(respond)),
        ) as client, patch.object(creation_agent, "get_content_image_provider", return_value=provider), patch.object(
            creation_agent.AIProvider, "client", return_value=client,
        ), patch.object(creation_agent, "ensure_project_material_access", return_value="org"), patch.object(
            creation_agent, "put_media_bytes",
        ):
            creation_agent._generate_image(
                prompt="Keep the product", title="Edit", user_id="user", project_id="project",
                base_url="http://testserver", reference_images=[png],
            )
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, "/v1/images/edits")
        self.assertIn("multipart/form-data", requests[0].headers["content-type"])
        self.assertIn(png, requests[0].content)
        self.assertIn(b'filename="reference-0.png"', requests[0].content)
        self.assertNotIn(b'name="response_format"', requests[0].content)

    def test_real_sdk_sends_multiple_references_as_bounded_multipart_files(self):
        import httpx
        from openai import OpenAI

        png = b"\x89PNG\r\n\x1a\nfirst"
        jpeg = b"\xff\xd8\xffsecond"
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"created": 1, "data": [{"b64_json": base64.b64encode(png).decode()}]})

        provider = creation_agent.AIProvider(
            area="content_studio", source="override", api_key="test-key",
            base_url="https://images.test/v1", model="gpt-image-1",
        )
        with OpenAI(
            api_key="test-key", base_url=provider.base_url,
            http_client=httpx.Client(transport=httpx.MockTransport(respond)),
        ) as client, patch.object(creation_agent, "get_content_image_provider", return_value=provider), patch.object(
            creation_agent.AIProvider, "client", return_value=client,
        ), patch.object(creation_agent, "ensure_project_material_access", return_value="org"), patch.object(
            creation_agent, "put_media_bytes",
        ):
            creation_agent._generate_image(
                prompt="Combine references", title="Edit", user_id="user", project_id="project",
                base_url="http://testserver", reference_images=[png, jpeg],
            )
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, "/v1/images/edits")
        self.assertEqual(requests[0].content.count(b'name="image[]"'), 2)
        self.assertIn(png, requests[0].content)
        self.assertIn(jpeg, requests[0].content)
        self.assertNotIn(b'name="response_format"', requests[0].content)

    def test_selected_foreign_project_image_is_rejected_before_read_or_paid_generation(self):
        from app.engines.content_generator.models import (
            CreativeDeliverable,
            ImageReference,
        )

        current = CreativeDeliverable(
            id="old", media_kind="image", title="Title",
            image_url="http://testserver/media/content-generator/other-org/project/image.png",
            created_at="2026-10-11T00:00:00Z",
        )
        provider = MagicMock(model="agent-model")
        provider.client.return_value.chat.completions.create.side_effect = [
            completion({"next_agent": "action", "objective": "Edit the reference"}),
            tool_completion("generate_image", {"prompt": "Edit", "title": "Edit"}),
        ]
        with patch.object(creation_agent, "get_ai_provider", return_value=provider), patch.object(
            creation_agent, "ensure_project_material_access", return_value="org",
        ), patch.object(creation_agent, "read_media_bytes") as read, patch.object(
            creation_agent, "_generate_image",
        ) as generate, self.assertRaisesRegex(ValueError, "does not belong"):
            creation_agent.run_creation_agent(
                [{"role": "user", "content": "Edit"}], mode="create", reference_context="",
                preference_keys=[], image_inputs=[], user_id="user", project_id="project",
                base_url="http://testserver", current_work=current,
                image_reference=ImageReference(deliverable_id="old", index=0),
            )
        read.assert_not_called()
        generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
