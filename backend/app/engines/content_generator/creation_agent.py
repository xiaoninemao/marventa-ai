from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from openai import NOT_GIVEN, OpenAI
from openai.types import ImagesResponse
from pydantic import BaseModel, Field

from app import config
from app.ai_provider import AIProvider, get_ai_provider, get_content_image_provider
from app.engines.content_generator.agent_conversation import (
    context_details,
    creation_client,
    measure_model_call,
    model_call_timings,
    model_clients,
    stream_turn,
    upsert_event,
    user_message,
)
from app.engines.content_generator.agent_jobs import check_current_job, register_media
from app.engines.content_generator.ai_analyzer import (
    _parse_json_response,
    with_image_inputs,
)
from app.engines.content_generator.material_references import MaterialVisualInput
from app.engines.content_generator.models import (
    AgentConversationEvent,
    AgentMessageEvent,
    AgentProgressCallback,
    AgentToolEvent,
    AgentTurnResult,
    CreationPlan,
    CreativeDeliverable,
    ImageReference,
)
from app.engines.content_generator.work_tools import WorkToolbox, work_tool_definitions
from app.engines.publishing.project_materials import ensure_project_material_access
from app.media_storage import (
    media_key_from_url,
    media_url,
    put_media_bytes,
    read_media_bytes,
)
from app.shared.prompts import build_system_prompt

logger = logging.getLogger(__name__)

ACTION_SYSTEM_PROMPT = build_system_prompt("""Act as the Action sub-agent in a marketing creation system.

- Execute the objective supplied by the Router.
- The creation kind is immutable. Image creation accepts images and copy only.
- Video creation accepts an existing video and copy/scripts only. Video generation
  is not available; do not generate images as a substitute for video.
- You alone can modify the right-hand work canvas, using compose_work.
- Generating or importing media does NOT put it on the canvas. Call compose_work
  with returned media handles to assemble it with title, copy and tags.
- Media-only and text-only deliverables are valid. For media-only requests, leave
  unrequested title/copy empty rather than inventing text. Text-only deliverables
  can be saved to Portfolio as drafts; only deliverables with media are publishable.
- For text-only requests, preserve existing media unless the user wants it removed.
- When a single image is referenced, replace only that slot and preserve all others.
- Image references must be passed to generate_image through reference_media_ids.
  The selected image is included automatically; do not approximate it using text alone.
- Use import_material to bring an authorized project image/video/document into the work.
- Never invent media handles, URLs, or claim a canvas change without compose_work.
- Treat the supplied project brand guidelines as durable, mandatory constraints on
  the title, publication copy, tags, and visual prompt in every turn.
- A user's creative direction may narrow those guidelines but must not override them.
- Keep tags concise and return them without leading commentary.
- Write a precise visual_prompt suitable for an image-generation model. It is data for a tool, not an instruction to the user.
- Use read_context when authorized project context is relevant; do not claim to have
  read a context section unless the tool returned it.
- Work as one conversational assistant, not a staged workflow report. Explain useful
  findings and next actions naturally while working, then use tools as needed.
- Before tools, assistant content is ordinary user-facing prose, never a JSON
  envelope, handoff, hidden reasoning, or internal agent/router terminology.
- Request independent context sections together rather than one per model round.
- Return the final JSON only when no more tools are needed.

Return JSON only:
{
  "intent": "create",
  "reply": "Concise user-facing response after composing the work"
}""", language_mode="model")


class ActionResult(BaseModel):
    intent: Literal["create"]
    reply: str = Field(min_length=1, max_length=20_000)


SubAgentName = Literal["chat", "plan", "action"]


class RouterDecision(BaseModel):
    next_agent: Literal["chat", "plan", "action", "finish"]
    objective: str = Field(default="", max_length=4000)
    final_response: str = Field(default="", max_length=20_000)
    allow_image_generation: bool = True


class WorkerResult(BaseModel):
    reply: str = Field(min_length=1, max_length=20_000)
    needs_user_input: bool = False
    handoff: str = Field(default="", max_length=20_000)
    title: str = Field(default="", max_length=80)

ROUTER_SYSTEM_PROMPT = build_system_prompt("""Act as the Router for three marketing sub-agents.

Sub-agents:
- chat: communicate with the user, clarify intent, summarize decisions, and ask at
  most two necessary questions. It does not create plans or deliverables.
- plan: design, reason, compare approaches, and produce an actionable creation plan.
  It can read context but cannot generate images or other media.
- action: execute the goal and produce a deliverable. It can read context and use
  generation tools.

Routing rules:
- Respect the supplied allowed_agents list.
- plan mode allows only chat and plan.
- action mode allows chat, plan, and action, and should reach action when enough
  information exists.
- auto mode allows all agents and you decide the next useful step.
- Sub-agent handoffs are working memory. Route another agent when its distinct
  capability is needed.
- Choose finish when the user goal for this turn is met or the latest sub-agent reply
  should be returned to the user.
- Do not rewrite a completed sub-agent answer or generate a second full response.
  Leave final_response empty when the latest sub-agent reply already answers the user.
- Set allow_image_generation to false when the user explicitly requests text-only
  output, declines image generation, or the selected Action does not need an image.
- Never claim a tool or sub-agent ran unless it appears in completed_handoffs.

Return JSON only:
{
  "next_agent": "chat" | "plan" | "action" | "finish",
  "objective": "Specific objective for the selected sub-agent",
  "final_response": "Required when next_agent is finish; otherwise empty",
  "allow_image_generation": true
}""", language_mode="model")


CHAT_SYSTEM_PROMPT = build_system_prompt("""Act as the Chat sub-agent.

- Communicate naturally with the user and clarify the current goal.
- Read authorized context only when it materially helps the conversation.
- Ask at most two focused questions.
- Do not produce a formal plan, image, video, or final deliverable.
- Return a concise handoff containing confirmed facts and unresolved questions for
  the Router.
- Speak as the same assistant throughout the conversation. Intermediate commentary
  is plain user-facing prose; JSON and handoffs are internal final-output contracts.

Return JSON only:
{
  "reply": "User-facing conversational response",
  "needs_user_input": true,
  "handoff": "Confirmed facts and unresolved questions"
}""", language_mode="model")


PLAN_SYSTEM_PROMPT = build_system_prompt("""Act as the Plan sub-agent.

- Design, reason, compare directions, and produce an actionable content plan.
- Read authorized brand, insight, case, material, or previous-deliverable context
  when needed.
- Do not generate images, videos, or a final publication deliverable.
- Identify goals, audience, message strategy, format, constraints, execution steps,
  and remaining decisions.
- Set needs_user_input only when planning cannot responsibly continue without an
  answer. Ask at most two questions.
- Return a complete handoff that an Action sub-agent can execute without re-planning.
- Generate a short, specific title summarizing the plan itself. Do not copy the
  user's request or Router objective into the title. Prefer 6-32 Chinese characters
  or a concise English phrase; never exceed 80 characters.
- Keep reply conversational and concise. Put the full machine-readable plan in
  handoff, not in the user-facing reply. Tell the user what was prepared and any
  essential remaining decision, without dumping the complete plan into chat.
- Before tools, use plain conversational commentary, not a partial final JSON object.

Return JSON only:
{
  "title": "Short plan title summarized from its content",
  "reply": "User-facing plan or planning question",
  "needs_user_input": false,
  "handoff": "Structured executable plan"
}""", language_mode="model")


def _image_bytes(value: str) -> tuple[bytes, str, str]:
    if len(value) > 4 * ((config.CONTENT_STUDIO_IMAGE_MAX_BYTES + 2) // 3):
        raise ValueError("Generated image exceeds the configured size limit")
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Image provider returned invalid base64 data") from exc
    return _validate_image_bytes(data)


def _validate_image_bytes(data: bytes) -> tuple[bytes, str, str]:
    if not data or len(data) > config.CONTENT_STUDIO_IMAGE_MAX_BYTES:
        raise ValueError("Generated image exceeds the configured size limit")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "image/png", ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return data, "image/jpeg", ".jpg"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return data, "image/webp", ".webp"
    raise ValueError("Image provider returned an unsupported image format")


def _generate_image(
    *,
    prompt: str,
    title: str,
    user_id: str,
    project_id: str,
    base_url: str,
    reference_images: list[bytes] | None = None,
) -> tuple[str, str]:
    provider = get_content_image_provider()
    response_format = NOT_GIVEN if provider.model.startswith("gpt-image") else "b64_json"
    if reference_images:
        if len(reference_images) > 5 or sum(len(data) for data in reference_images) > config.CONTENT_STUDIO_MULTIMODAL_MAX_TOTAL_BYTES:
            raise ValueError("Image generation references exceed the configured limits")
        files = []
        for index, data in enumerate(reference_images):
            data, mime, extension = _validate_image_bytes(data)
            files.append((f"reference-{index}{extension}", data, mime))
        organization_id = ensure_project_material_access(user_id, project_id)
        with measure_model_call("image_edit", provider.model):
            client = creation_client(provider)
            if len(files) == 1:
                response = client.images.edit(
                    model=provider.model, prompt=prompt, n=1, size=config.CONTENT_STUDIO_IMAGE_SIZE,
                    response_format=response_format, image=files[0],
                )
            else:
                # The installed SDK's images.edit accepts one file, not arrays.
                body = {"model": provider.model, "prompt": prompt, "n": 1, "size": config.CONTENT_STUDIO_IMAGE_SIZE}
                if not provider.model.startswith("gpt-image"):
                    body["response_format"] = "b64_json"
                response = client.post(
                    "/images/edits", cast_to=ImagesResponse, body=body,
                    files=[("image[]", file) for file in files],
                    options={"headers": {"Content-Type": "multipart/form-data"}},
                )
    else:
        organization_id = ensure_project_material_access(user_id, project_id)
        with measure_model_call("image_generation", provider.model):
            response = creation_client(provider).images.generate(
                model=provider.model, prompt=prompt, n=1, size=config.CONTENT_STUDIO_IMAGE_SIZE,
                response_format=response_format,
            )
    if not response.data or not response.data[0].b64_json:
        raise ValueError("Image provider did not return base64 image data")
    data, mime_type, extension = _image_bytes(response.data[0].b64_json)
    safe_title = re.sub(r"[^\w\-]+", "-", title, flags=re.UNICODE).strip("-")[:80]
    filename = f"{safe_title or 'agent-image'}{extension}"
    object_key = (
        f"content-generator/{organization_id}/{project_id}/"
        f"{uuid.uuid4().hex[:12]}_{filename}"
    )
    register_media(object_key)
    put_media_bytes(object_key, data, content_type=mime_type)
    return "", media_url(object_key, base_url)


def _read_context_tool(sections: dict[str, str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "read_context",
            "description": "Read one authorized project context section before using it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": list(sections),
                    },
                },
                "required": ["section"],
                "additionalProperties": False,
            },
        },
    }


def _run_read_only_agent(
    *,
    agent: Literal["chat", "plan"],
    objective: str,
    messages: list[dict],
    handoffs: list[dict],
    context_sections: dict[str, str],
    image_inputs: list[MaterialVisualInput | str] | None,
    progress: AgentProgressCallback | None,
) -> WorkerResult:
    provider = get_ai_provider("content_studio")
    system = CHAT_SYSTEM_PROMPT if agent == "chat" else PLAN_SYSTEM_PROMPT
    if context_sections.get("brand"):
        system += (
            "\n\nMandatory project brand constraints. Apply these requirements to all "
            "advice and planning:\n" + context_sections["brand"]
        )
    conversation = "\n".join(
        f"{'User' if message['role'] == 'user' else 'Assistant'}: {message['content']}"
        for message in messages
    )
    prompt = (
        f"Router objective:\n{objective}\n\n"
        f"Completed handoffs:\n{json.dumps(handoffs, ensure_ascii=False)}\n\n"
        f"Conversation:\n{conversation}"
    )
    agent_messages = [
        {"role": "system", "content": system},
        *with_image_inputs([{"role": "user", "content": prompt}], image_inputs),
    ]
    sections = {
        key: value for key, value in context_sections.items() if value.strip()
    }
    tools = [_read_context_tool(sections)] if sections else []
    context_stages = {
        "brand": "reading_brand_guidelines",
        "insights": "reading_insights",
        "cases": "reading_cases",
        "materials": "analyzing_materials",
        "previous_deliverable": "reading_previous_deliverable",
        "plans": "reading_plans",
    }
    for _turn in range(6):
        check_current_job()
        kwargs = {
            "max_tokens": 4096,
            "temperature": 0.4,
        }
        if tools:
            kwargs.update({"tools": tools, "tool_choice": "auto"})
        assistant = stream_turn(provider, agent_messages, progress=progress, call_kind=agent, **kwargs)
        tool_calls = list(getattr(assistant, "tool_calls", None) or [])
        if not tool_calls:
            try:
                outcome = WorkerResult.model_validate(
                    _parse_json_response(assistant.content or ""),
                )
                if agent == "plan" and not outcome.title.strip():
                    raise ValueError("Plan Agent must summarize a plan title")
                if agent == "plan" and not outcome.needs_user_input and not outcome.handoff.strip():
                    raise ValueError("Plan Agent must provide an executable plan")
                latest_user = next((message["content"] for message in reversed(messages) if message["role"] == "user"), "")
                if agent == "plan" and outcome.title.strip() in {objective.strip(), latest_user.strip()}:
                    raise ValueError("Plan title must summarize the content, not copy the request")
                return outcome
            except ValueError:
                if not assistant.content or not assistant.content.strip():
                    raise
                agent_messages.extend([
                    {"role": "assistant", "content": assistant.content},
                    {
                        "role": "user",
                        "content": (
                            "Continue from your response and return the final JSON object "
                            "required by the system prompt, including a short title summarized from "
                            "the plan content, not copied from the request, for a plan."
                        ),
                    },
                ])
                continue
        if any(call.function.name != "read_context" for call in tool_calls):
            raise ValueError(f"{agent} Agent requested an unauthorized tool")
        assistant_content = assistant.content or ""
        agent_messages.append({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                }
                for call in tool_calls
            ],
        })
        for call in tool_calls:
            if call.function.name != "read_context":
                raise ValueError(f"{agent} Agent requested an unauthorized tool")
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError as exc:
                raise ValueError(f"{agent} Agent returned invalid tool arguments") from exc
            if not isinstance(arguments, dict):
                raise ValueError(f"{agent} Agent tool arguments must be an object")
            section = str(arguments.get("section", ""))
            if section not in sections:
                raise ValueError(f"{agent} Agent requested unavailable project context")
            if progress:
                progress(context_stages.get(section, "reading_context"), "")
                event_id = f"{uuid.uuid4().hex}:{call.id}"
                progress("reading_context", "", AgentToolEvent(
                    id=event_id, tool="read_context", status="running", section=section,
                    details=context_details(section, sections[section]),
                ))
                progress("reading_context", "", AgentToolEvent(
                    id=event_id, tool="read_context",
                    status="completed", section=section,
                    details=context_details(section, sections[section]),
                ))
            agent_messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "name": call.function.name,
                "content": sections[section],
            })
    raise ValueError(f"{agent} Agent exceeded the tool-call limit")


def _route_next_agent(
    *,
    mode: Literal["auto", "explore", "create"],
    messages: list[dict],
    handoffs: list[dict],
    allowed_agents: list[SubAgentName],
    brand_constraints: str = "",
) -> RouterDecision:
    provider = get_ai_provider("content_studio")
    conversation = "\n".join(
        f"{'User' if message['role'] == 'user' else 'Assistant'}: {message['content']}"
        for message in messages
    )
    prompt = (
        f"Selected mode: {mode}\n"
        f"Allowed agents: {', '.join(allowed_agents)}\n\n"
        f"Completed handoffs:\n{json.dumps(handoffs, ensure_ascii=False)}\n\n"
        f"Conversation:\n{conversation}"
    )
    with measure_model_call("routing", provider.model):
        response = creation_client(provider).chat.completions.create(
            model=provider.model,
            messages=[
                {"role": "system", "content": ROUTER_SYSTEM_PROMPT + (
                    "\n\nMandatory project brand constraints:\n" + brand_constraints if brand_constraints else ""
                )},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1000,
            temperature=0.2,
        )
    decision = RouterDecision.model_validate(
        _parse_json_response(response.choices[0].message.content or ""),
    )
    if decision.next_agent != "finish" and decision.next_agent not in allowed_agents:
        raise ValueError(
            f"Router selected disallowed agent {decision.next_agent} for {mode} mode",
        )
    return decision


def _run_action_agent(
    messages: list[dict],
    *,
    mode: Literal["auto", "explore", "create"],
    reference_context: str,
    preference_keys: list[str],
    image_inputs: list[MaterialVisualInput | str] | None,
    user_id: str,
    project_id: str,
    base_url: str,
    progress: AgentProgressCallback | None = None,
    context_sections: dict[str, str] | None = None,
    orchestration_context: str = "",
    allow_image_generation: bool = True,
    toolbox: WorkToolbox,
) -> AgentTurnResult:
    conversation = "\n".join(
        f"{'User' if message['role'] == 'user' else 'Assistant'}: {message['content']}"
        for message in messages
    )
    prompt = (
        f"Mode: {mode}\n"
        f"Selected preferences: {', '.join(preference_keys) or 'None'}\n\n"
        f"Image generation available for this turn: {allow_image_generation}\n\n"
        f"Router handoff:\n{orchestration_context or 'None'}\n\n"
        f"Work canvas and media handles:\n{json.dumps(toolbox.describe(), ensure_ascii=False)}\n\n"
        f"Conversation:\n{conversation}"
    )
    system = ACTION_SYSTEM_PROMPT
    if reference_context and not context_sections:
        system += "\n\nAuthorized project context:\n" + reference_context
    agent_messages = [
        {"role": "system", "content": system},
        *with_image_inputs(
            [{"role": "user", "content": prompt}],
            image_inputs,
        ),
    ]
    tools: list[dict] = work_tool_definitions()
    sections = {
        key: value for key, value in (context_sections or {}).items() if value.strip()
    }
    if sections.get("brand"):
        system += (
            "\n\nMandatory project brand constraints. Apply these requirements to every "
            "deliverable field and image prompt:\n" + sections["brand"]
        )
        agent_messages[0]["content"] = system
    if sections:
        tools.append({
            "type": "function",
            "function": {
                "name": "read_context",
                "description": "Read one authorized project context section before using it.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "section": {
                            "type": "string",
                            "enum": list(sections),
                        },
                    },
                    "required": ["section"],
                    "additionalProperties": False,
                },
            },
        })
    if allow_image_generation and toolbox.kind == "image":
        tools.append({
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": "Generate and persist one image for the current Agent deliverable.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string"},
                        "title": {"type": "string"},
                        "reference_media_ids": {
                            "type": "array", "items": {"type": "string"}, "maxItems": 5,
                            "description": "Existing image handles to preserve as visual references. The selected image is always included when replacing it.",
                        },
                    },
                    "required": ["prompt", "title"],
                    "additionalProperties": False,
                },
            },
        })
    provider = get_ai_provider("content_studio")
    plan: ActionResult | None = None
    context_stages = {
        "brand": "reading_brand_guidelines",
        "insights": "reading_insights",
        "cases": "reading_cases",
        "materials": "analyzing_materials",
        "previous_deliverable": "reading_previous_deliverable",
        "plans": "reading_plans",
    }
    for _turn in range(8):
        check_current_job()
        kwargs = {
            "max_tokens": 4096,
            "temperature": 0.4,
        }
        if tools:
            kwargs.update({"tools": tools, "tool_choice": "auto"})
        assistant = stream_turn(provider, agent_messages, progress=progress, call_kind="action", **kwargs)
        tool_calls = list(getattr(assistant, "tool_calls", None) or [])
        if not tool_calls:
            try:
                plan = ActionResult.model_validate(
                    _parse_json_response(assistant.content or ""),
                )
                if not toolbox.composed:
                    raise ValueError("Call compose_work before reporting the work is complete")
                break
            except ValueError:
                if not assistant.content or not assistant.content.strip():
                    raise
                agent_messages.extend([
                    {
                        "role": "assistant",
                        "content": assistant.content,
                    },
                    {
                        "role": "user",
                        "content": (
                            "Before finishing, call compose_work to assemble the requested work "
                            "using valid media handles. Then return the final JSON object "
                            "required by the system prompt. Do not repeat the progress update."
                        ),
                    },
                ])
                continue
        assistant_content = assistant.content or ""
        allowed_tools = {tool["function"]["name"] for tool in tools}
        if any(call.function.name not in allowed_tools for call in tool_calls):
            raise ValueError("Action Agent requested an unauthorized tool")
        serialized_calls = [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                },
            }
            for call in tool_calls
        ]
        agent_messages.append({
            "role": "assistant",
            "content": assistant_content,
            "tool_calls": serialized_calls,
        })
        for call in tool_calls:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError as exc:
                raise ValueError("Creation Agent returned invalid tool arguments") from exc
            if not isinstance(arguments, dict):
                raise ValueError("Action Agent tool arguments must be an object")
            event_id = f"{uuid.uuid4().hex}:{call.id}"
            details = [str(arguments["title"])] if arguments.get("title") else []
            if progress:
                progress("reading_context", "", AgentToolEvent(
                    id=event_id, tool=call.function.name, status="running",
                    section=str(arguments.get("section", "")), details=details,
                ))
            if call.function.name == "read_context":
                section = str(arguments.get("section", ""))
                if section not in sections:
                    raise ValueError("Creation Agent requested unavailable project context")
                if progress:
                    progress(context_stages.get(section, "reading_context"), "")
                result = sections[section]
            elif call.function.name == "generate_image":
                if not allow_image_generation or toolbox.kind != "image":
                    raise ValueError("Image generation is not authorized for this turn")
                image_prompt = str(arguments.get("prompt", "")).strip()
                image_title = str(arguments.get("title", "")).strip()
                if not image_prompt or not image_title:
                    raise ValueError("Image generation requires prompt and title")
                if progress:
                    progress("generating_image", "")
                reference_ids = arguments.get("reference_media_ids", [])
                if not isinstance(reference_ids, list) or any(not isinstance(handle, str) for handle in reference_ids):
                    raise ValueError("Image reference handles must be a list of strings")
                if toolbox.selected_index is not None:
                    reference_ids = [toolbox.initial_media[toolbox.selected_index], *reference_ids]
                reference_ids = list(dict.fromkeys(reference_ids))
                if len(reference_ids) > 5:
                    raise ValueError("Image generation supports at most five references")
                reference_images = []
                for handle in reference_ids:
                    if handle not in toolbox.media:
                        raise ValueError("Unknown image reference handle")
                    key = media_key_from_url(toolbox.media[handle][0])
                    organization_id = ensure_project_material_access(user_id, project_id)
                    if not any(key.startswith(f"{prefix}/{organization_id}/{project_id}/") for prefix in ("content-generator", "portfolio")):
                        raise ValueError("Image reference does not belong to this project")
                    reference_images.append(read_media_bytes(key, max_bytes=config.CONTENT_STUDIO_IMAGE_MAX_BYTES))
                for visual in image_inputs or []:
                    value = visual.data_url if isinstance(visual, MaterialVisualInput) else visual
                    if not value.startswith("data:image/") or ";base64," not in value:
                        raise ValueError("Image generation references must be bounded image data")
                    data = _image_bytes(value.split(";base64,", 1)[1])[0]
                    if data not in reference_images:
                        reference_images.append(data)
                if len(reference_images) > 5 or sum(len(image) for image in reference_images) > config.CONTENT_STUDIO_MULTIMODAL_MAX_TOTAL_BYTES:
                    raise ValueError("Image generation references exceed the configured limits")
                material_id, url = _generate_image(
                    prompt=image_prompt,
                    title=image_title,
                    user_id=user_id,
                    project_id=project_id,
                    base_url=base_url,
                    reference_images=reference_images,
                )
                result = json.dumps({
                    "success": True,
                    "media_id": toolbox.add_generated_image(url, material_id),
                })
            elif call.function.name == "import_material":
                if progress:
                    progress("importing_material", "")
                result = json.dumps(toolbox.import_material(str(arguments.get("material_id", ""))), ensure_ascii=False)
            elif call.function.name == "list_materials":
                if progress:
                    progress("analyzing_materials", "")
                result = json.dumps(toolbox.list_materials(str(arguments.get("collection_id", ""))), ensure_ascii=False)
            elif call.function.name == "compose_work":
                if progress:
                    progress("composing_work", "")
                work = toolbox.compose(arguments)
                result = json.dumps({"version_id": work.id, "staged_for_canvas": True})
            else:
                raise ValueError(f"Unsupported Creation Agent tool: {call.function.name}")
            if call.function.name == "import_material":
                imported = json.loads(result)
                details = [imported["name"]]
            elif call.function.name == "list_materials":
                details = [item["name"] for item in json.loads(result)]
            elif call.function.name == "read_context":
                details = context_details(section, result)
            if progress:
                progress("reading_context", "", AgentToolEvent(
                    id=event_id, tool=call.function.name, status="completed",
                    section=str(arguments.get("section", "")), details=details,
                ))
            agent_messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "name": call.function.name,
                "content": result,
            })
    if plan is None:
        raise ValueError("Creation Agent exceeded the tool-call limit")
    if progress:
        progress("finalizing", "")
    return AgentTurnResult(
        intent="create",
        reply=plan.reply,
        deliverable=toolbox.current,
        revisions=list(toolbox.revisions),
    )


def _orchestrate_creation_agent(
    messages: list[dict],
    *,
    mode: Literal["auto", "explore", "create"],
    reference_context: str,
    preference_keys: list[str],
    image_inputs: list[MaterialVisualInput | str] | None,
    user_id: str,
    project_id: str,
    base_url: str,
    progress: AgentProgressCallback | None = None,
    context_sections: dict[str, str] | None = None,
    creation_kind: Literal["image", "video"] = "image",
    current_work: CreativeDeliverable | None = None,
    image_reference: ImageReference | None = None,
    toolbox: WorkToolbox,
) -> AgentTurnResult:
    allowed_agents: list[SubAgentName] = (
        ["chat", "plan"]
        if mode == "explore"
        else ["chat", "plan", "action"]
    )
    sections = {
        key: value for key, value in (context_sections or {}).items() if value.strip()
    }
    messages = [*messages, {"role": "system", "content": (
        f"Creation type is {creation_kind}. Video generation is unavailable. "
        "Plans are intermediate results; only Action can compose or modify the work. "
        + (f"The user references image {image_reference.index + 1} in the current work. "
           "When replacing it, keep all other images unchanged." if image_reference else "")
    )}]
    plans: list[CreationPlan] = []
    handoffs: list[dict] = []
    last_reply = ""
    image_generation_allowed = True
    for _step in range(6):
        check_current_job()
        if progress:
            progress("routing_agent", "")
        decision = _route_next_agent(
            mode=mode,
            messages=messages,
            handoffs=handoffs,
            allowed_agents=allowed_agents,
            brand_constraints=sections.get("brand", ""),
        )
        image_generation_allowed = (
            image_generation_allowed and decision.allow_image_generation
        )
        if decision.next_agent == "finish":
            completed_agents = {handoff["agent"] for handoff in handoffs}
            if mode == "create" and "action" not in completed_agents:
                decision = RouterDecision(
                    next_agent="action",
                    objective=(
                        "Execute the user's goal using the completed handoffs and produce "
                        "the final deliverable."
                    ),
                )
            elif mode == "explore" and "plan" not in completed_agents:
                decision = RouterDecision(
                    next_agent="plan",
                    objective=(
                        "Produce the requested design, reasoning, or plan using the "
                        "conversation and completed handoffs."
                    ),
                )
            elif mode == "auto" and not handoffs:
                decision = RouterDecision(
                    next_agent="chat",
                    objective="Respond to the user and clarify the goal if necessary.",
                )
            else:
                reply = last_reply or user_message(decision.final_response)
                if not reply:
                    raise ValueError("Router finished without a user-facing response")
                return AgentTurnResult(
                    intent="create" if toolbox.revisions else "explore", reply=reply,
                    deliverable=toolbox.current if toolbox.revisions else None,
                    revisions=toolbox.revisions, plans=plans,
                )
        if decision.next_agent in {"chat", "plan"}:
            selected = decision.next_agent
            if progress:
                progress(f"{selected}_agent", "")
            outcome = _run_read_only_agent(
                agent=selected,
                objective=decision.objective,
                messages=messages,
                handoffs=handoffs,
                context_sections=sections,
                image_inputs=image_inputs,
                progress=progress,
            )
            reply = outcome.reply
            last_reply = reply
            handoffs.append({
                "agent": selected,
                "objective": decision.objective,
                "result": outcome.handoff or reply,
            })
            if selected == "plan":
                saved_plan = CreationPlan(
                    id=uuid.uuid4().hex[:12], title=outcome.title.strip(),
                    content=outcome.handoff or reply,
                    created_at=datetime.now(timezone.utc).isoformat(),
                )
                plans.append(saved_plan)
                sections["plans"] = sections.get("plans", "") + "\n" + saved_plan.model_dump_json()
            if outcome.needs_user_input:
                return AgentTurnResult(
                    intent="create" if toolbox.revisions else "explore", reply=reply,
                    deliverable=toolbox.current if toolbox.revisions else None,
                    revisions=toolbox.revisions, plans=plans,
                )
            if mode == "explore" and selected == "plan":
                return AgentTurnResult(intent="explore", reply=reply, plans=plans)
            continue
        if decision.next_agent == "action":
            if progress:
                progress("action_agent", "")
            orchestration_context = json.dumps({"objective": decision.objective, "handoffs": handoffs}, ensure_ascii=False)
            toolbox.composed = False
            outcome = _run_action_agent(
                messages,
                mode="create",
                reference_context=reference_context,
                preference_keys=preference_keys,
                image_inputs=image_inputs,
                user_id=user_id,
                project_id=project_id,
                base_url=base_url,
                progress=progress,
                context_sections=sections,
                orchestration_context=orchestration_context,
                allow_image_generation=image_generation_allowed,
                toolbox=toolbox,
            )
            last_reply = outcome.reply
            handoffs.append({
                "agent": "action", "objective": decision.objective,
                "result": {"reply": outcome.reply, "work": toolbox.describe()},
            })
            if mode == "create":
                return AgentTurnResult(
                    intent="create", reply=outcome.reply, deliverable=toolbox.current,
                    revisions=toolbox.revisions, plans=plans,
                )
    raise ValueError("Creation Agent orchestration exceeded the step limit")


def run_creation_agent(
    messages: list[dict],
    *,
    mode: Literal["auto", "explore", "create"],
    reference_context: str,
    preference_keys: list[str],
    image_inputs: list[MaterialVisualInput | str] | None,
    user_id: str,
    project_id: str,
    base_url: str,
    progress: AgentProgressCallback | None = None,
    context_sections: dict[str, str] | None = None,
    creation_kind: Literal["image", "video"] = "image",
    current_work: CreativeDeliverable | None = None,
    image_reference: ImageReference | None = None,
) -> AgentTurnResult:
    toolbox = WorkToolbox(
        kind=creation_kind, user_id=user_id, project_id=project_id,
        base_url=base_url, current=current_work, image_reference=image_reference,
    )
    recorded: list[dict] = []
    timings: list[dict] = []
    timing_token = model_call_timings.set(timings)
    clients: dict[AIProvider, OpenAI] = {}
    clients_token = model_clients.set(clients)
    started = time.monotonic()

    def report(stage: str, message: str = "", event: AgentConversationEvent | None = None) -> None:
        if event:
            upsert_event(recorded, event.model_dump(mode="json"))
        if progress:
            progress(stage, message, event) if event else progress(stage, message)

    try:
        result = _orchestrate_creation_agent(
            messages, mode=mode, reference_context=reference_context,
            preference_keys=preference_keys, image_inputs=image_inputs,
            user_id=user_id, project_id=project_id, base_url=base_url,
            progress=report, context_sections=context_sections,
            creation_kind=creation_kind, current_work=current_work,
            image_reference=image_reference, toolbox=toolbox,
        )
        toolbox.discard_unused()
        result.owned_media_keys = list(toolbox.owned_keys)
        result.agent_events = [
            AgentMessageEvent.model_validate(event) if event["type"] == "message"
            else AgentToolEvent.model_validate(event)
            for event in recorded
        ]
        return result
    except Exception:
        toolbox.discard()
        raise
    finally:
        logger.info(
            "Creation turn mode=%s model_calls=%s model_elapsed_ms=%s total_elapsed_ms=%s",
            mode, len(timings), sum(timing["elapsed_ms"] for timing in timings),
            round((time.monotonic() - started) * 1000),
        )
        model_call_timings.reset(timing_token)
        model_clients.reset(clients_token)
        for client in clients.values():
            client.close()
