import json
import re
import threading
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, Field, model_validator
from app.ai_provider import get_ai_provider
from app.engines.content_generator.models import ContentCard
from app.shared.prompts import build_system_prompt

SYSTEM_PROMPT = build_system_prompt("""Guide a conversation to understand the user's product, target audience, preferred platform, and content needs before producing high-quality social marketing content.

Establish the content format:
- Short video for Douyin, Kuaishou, WeChat Channels, or Bilibili needs a storyboard, shot descriptions, voiceover, and timing, with a strong visual hook in the first three seconds.
- Image-text posts for Xiaohongshu, WeChat Official Accounts, or Weibo need image copy, body layout, and cover concepts, with visual storytelling and compelling prose.
- Adapt to platform conventions: entertainment and pacing on Douyin; authentic recommendations on Xiaohongshu; professionalism and trust on WeChat Channels; substantive content and community fit on Bilibili.
- Ask about the format and platform if unspecified. If the user has no preference or does not answer, infer the best fit from the product.

Conversation:
- Ask only one or two important questions at a time about product benefits, audience, platform, or style.
- Prioritize confirming short video versus image-text and the target platform.
- Keep responses natural, concise, and actionable.
- Once enough information is available, tell the user that content generation can begin.

Response format:
- Use plain text only, with no Markdown formatting, tables, code blocks, or code snippets.
- Organize information with paragraphs, line breaks, and indentation.
- Use natural enumeration appropriate to the response language.""")

CARD_SYSTEM_PROMPT = build_system_prompt("""Generate exactly five content cards from the conversation, with one card for each card_type: script, title, copy, hashtags, and visual.

Use the agreed platform and exactly one content format for the entire set: short video or image-text. Never mix formats within a result.

For short video on Douyin, Kuaishou, WeChat Channels, or Bilibili:
1. script: a complete storyboard with a first-three-second hook, voiceover, shot descriptions, and timing.
2. title: 5-8 compelling video headlines adapted to the platform.
3. copy: accompanying publication copy, an engagement prompt, and a suggested pinned comment.
4. hashtags: 10-15 relevant hashtags grouped by popularity and relevance.
5. visual: filming style, palette, composition, locations, props, and lighting.

For image-text posts on Xiaohongshu, WeChat Official Accounts, or Weibo:
1. script: a publishing plan with image order, copy for each image, and an opening hook, narrative development, and closing engagement prompt.
2. title: 5-8 compelling post or cover headlines adapted to the platform.
3. copy: complete post copy with a hook, developed paragraphs, and an engagement prompt in the platform's style.
4. hashtags: 10-15 relevant hashtags grouped by popularity and relevance.
5. visual: photography or design style, filters, layout, and cover concepts.

If format or platform is unspecified, infer the best fit from the product and conversation. Keep prose fields in plain text without Markdown formatting.

Return only a JSON object, with no preamble or explanation:
{
  "cards": [
    {
      "id": "card_1",
      "card_type": "script",
      "title": "Content plan",
      "preview": "A publishing plan tailored to the selected format and platform...",
      "content": "A complete plan using only the selected content format...",
      "tips": ["Keep the format consistent", "Close with an engagement prompt"]
    },
    {
      "id": "card_2",
      "card_type": "title",
      "title": "Headline options",
      "preview": "Five compelling headline options...",
      "content": "1. First headline tailored to the platform\\n2. Second headline tailored to the platform\\n...",
      "tips": ["Use specific benefits and engaging language", "A/B test alternative headlines"]
    },
    {
      "id": "card_3",
      "card_type": "copy",
      "title": "Post copy",
      "preview": "Complete publication copy tailored to the platform...",
      "content": "Post body...\\n\\nEngagement prompt...",
      "tips": ["Make the first three lines compelling", "End with a question to encourage comments"]
    },
    {
      "id": "card_4",
      "card_type": "hashtags",
      "title": "Hashtags",
      "preview": "A combination of popular and precisely targeted hashtags...",
      "content": "Popular: #example\\nTargeted: #example\\nTrending: #example",
      "tips": ["Provide 10-15 relevant hashtags", "Balance broad, mid-range, and niche reach"]
    },
    {
      "id": "card_5",
      "card_type": "visual",
      "title": "Visual plan",
      "preview": "Visual direction and production recommendations...",
      "content": "Style: ...\\nPalette: ...\\nComposition: ...\\nLocations and props: ...",
      "tips": ["Maintain a consistent visual style", "Make the opening visual compelling"]
    }
  ]
}""")


def strip_markdown(text: str) -> str:
    """Remove markdown formatting symbols while preserving the text content."""
    # Remove bold: **text** or __text__
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    # Remove italic: *text* or _text_ (but not bullet * at line start)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"\1", text)
    # Remove strikethrough: ~~text~~
    text = re.sub(r"~~(.+?)~~", r"\1", text)
    # Remove inline code: `text`
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # Remove links: [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    # Remove images: ![alt](url) → alt
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    # Remove heading markers: # at line start
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Remove blockquote: > at line start
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    # Remove unordered list markers: - * + at line start
    text = re.sub(r"^[\-\*\+]\s+", "", text, flags=re.MULTILINE)
    # Remove ordered list markers: 1. 2. etc at line start
    text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)
    # Remove horizontal rules
    text = re.sub(r"^[\-\*\_]{3,}\s*$", "", text, flags=re.MULTILINE)
    return text.strip()


def _get_client() -> OpenAI:
    return get_ai_provider("content_studio").client()


def _get_modify_client() -> OpenAI:
    return get_ai_provider("content_studio").client()


def build_reference_context(
    insight_ids: list[str],
    case_ids: list[str],
    user_id: str | None = None,
    material_ids: list[str] | None = None,
    project_id: str = "",
    material_priority_ids: list[str] | None = None,
) -> str:
    """Fetch authorized references; project copy is source data, media metadata only."""
    if not insight_ids and not case_ids and not material_ids:
        return ""

    parts: list[str] = []

    if insight_ids:
        from app.engines.market_insight.storage import get_insight
        parts.append("Reference material: market insights")
        for iid in insight_ids:
            insight = get_insight(iid, user_id) if user_id else get_insight(iid)
            if insight is None:
                continue
            a = insight.ai_analysis
            if a is None:
                parts.append(f"- Product: {insight.product_name} (no AI analysis available)")
                continue
            parts.append(
                f"- Product: {a.product_name or insight.product_name}\n"
                f"  Positioning: {a.market_positioning or 'None'}\n"
                f"  Strengths: {a.strengths or 'None'}\n"
                f"  Target audience: {a.target_audience or 'None'}\n"
                f"  Marketing angles: {a.suggested_marketing_angles or 'None'}"
            )
        parts.append("")

    if case_ids:
        from app.engines.case_library.storage import get_case
        parts.append("Reference material: case studies")
        for cid in case_ids:
            case = get_case(cid, user_id) if user_id else get_case(cid)
            if case is None:
                continue
            ct = "short video" if case.content_type == "video" else "image-text"
            parts.append(
                f"- Title: {case.title} ({ct})\n"
                f"  Description: {case.description or 'None'}\n"
                f"  Tags: {', '.join(case.tags) if case.tags else 'None'}"
            )
            if case.ai_analysis:
                a = case.ai_analysis
                parts.append(
                    f"  Content analysis: {a.content_analysis or 'None'}\n"
                    f"  Marketing angle: {a.marketing_angle or 'None'}\n"
                    f"  Reusable lessons: {a.experience_extraction or 'None'}\n"
                    f"  Highlights: {', '.join(a.key_highlights) if a.key_highlights else 'None'}"
                )
        parts.append("")

    if material_ids:
        from app.engines.content_generator.material_references import build_material_context
        parts.append(build_material_context(
            material_ids, project_id, user_id, priority_ids=material_priority_ids,
        ))
    return "\n".join(parts).strip()


def chat(messages: list[dict], reference_context: str = "") -> str:
    """Send chat messages to AI and get a conversational response."""
    system = SYSTEM_PROMPT
    if reference_context:
        system += "\n\nReference context:\n" + reference_context

    client = _get_client()
    response = client.chat.completions.create(
        model=get_ai_provider("content_studio").model,
        messages=[
            {"role": "system", "content": system},
            *messages,
        ],
        max_tokens=1024,
        temperature=0.7,
    )
    raw = response.choices[0].message.content or "Sorry, something went wrong. Please try again."
    return strip_markdown(raw)


FIXED_TITLES = {
    "title": "Headline options",
    "copy": "Post copy",
    "hashtags": "Hashtags",
    "visual": "Visual plan",
}

SCRIPT_TITLES = {
    "short_video": "Video storyboard",
    "image_text": "Image-text publishing plan",
}

_VIDEO_PREFERENCES = {"short_video", "douyin", "kuaishou", "shipinhao", "bilibili"}
_IMAGE_TEXT_PREFERENCES = {"image_text", "xiaohongshu", "weibo", "wechat_mp"}
_VIDEO_FORMAT_TERMS = (
    "短视频", "分镜", "镜头", "口播", "时长", "前3秒", "抖音", "快手", "视频号", "b站",
    "short video", "storyboard", "voiceover", "shot list", "video script",
)
_IMAGE_TEXT_FORMAT_TERMS = (
    "图文", "图片", "正文", "排版", "封面图", "小红书", "公众号", "微博",
    "image-text", "carousel", "post copy", "cover image",
)
_VIDEO_EXCLUSIVE_TERMS = (
    "短视频", "分镜", "镜头", "口播", "视频画面", "拍摄脚本", "时长标注",
    "short video", "storyboard", "voiceover", "shot list", "video script",
)
_IMAGE_TEXT_EXCLUSIVE_TERMS = (
    "图文", "图片顺序", "配图", "正文排版", "图文正文", "第1张图", "第一张图",
    "image-text", "carousel post",
)
_REQUIRED_CARD_TYPES = {"script", "title", "copy", "hashtags", "visual"}


def _resolve_content_format(
    preference_keys: list[str],
    messages: list[dict],
    cards_data: list[dict],
) -> str:
    if any(key in _VIDEO_PREFERENCES for key in preference_keys):
        return "short_video"
    if any(key in _IMAGE_TEXT_PREFERENCES for key in preference_keys):
        return "image_text"

    generated_text = "\n".join(
        str(card.get(field, ""))
        for card in cards_data
        for field in ("title", "preview", "content")
    )
    conversation_text = "\n".join(str(message.get("content", "")) for message in messages)
    evidence = f"{generated_text}\n{conversation_text}".casefold()
    video_score = sum(evidence.count(term) for term in _VIDEO_FORMAT_TERMS)
    image_text_score = sum(evidence.count(term) for term in _IMAGE_TEXT_FORMAT_TERMS)
    return "short_video" if video_score > image_text_score else "image_text"


def _validate_content_format(cards_data: list[dict], content_format: str) -> None:
    evidence = "\n".join(
        str(card.get(field, ""))
        for card in cards_data
        for field in ("title", "preview", "content")
    )
    conflicting_terms = (
        _IMAGE_TEXT_EXCLUSIVE_TERMS
        if content_format == "short_video"
        else _VIDEO_EXCLUSIVE_TERMS
    )
    conflicts = [term for term in conflicting_terms if term in evidence.casefold()]
    if conflicts:
        raise ValueError(
            f"Generated cards mix content formats: {', '.join(conflicts)}"
        )


def _validate_generated_cards(cards_data: list[dict], content_format: str) -> None:
    card_types = [str(card.get("card_type", "")) for card in cards_data]
    if len(cards_data) != len(_REQUIRED_CARD_TYPES) or set(card_types) != _REQUIRED_CARD_TYPES:
        raise ValueError("AI must return exactly one card for each required card type")
    _validate_content_format(cards_data, content_format)


def generate_cards(
    messages: list[dict],
    reference_context: str = "",
    preference_keys: list[str] | None = None,
) -> list[ContentCard]:
    """Generate 5 content cards from the conversation context."""
    preference_keys = preference_keys or []
    convo_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in messages
    )
    prompt = (
        "Generate five content cards from the following conversation. "
        "Choose exactly one format for the entire set: short video or image-text. "
        "Do not mix formats.\n\n"
        f"{convo_text}\n\n"
        f"Selected preference keys: {', '.join(preference_keys) or 'None'}\n\n"
        "Follow the required JSON structure exactly."
    )

    system = CARD_SYSTEM_PROMPT
    if reference_context:
        system += "\n\nReference context:\n" + reference_context

    def request_cards(request_prompt: str) -> list[dict]:
        client = _get_client()
        response = client.chat.completions.create(
            model=get_ai_provider("content_studio").model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": request_prompt},
            ],
            max_tokens=4096,
            temperature=0.7,
        )
        raw = response.choices[0].message.content or ""
        return _parse_json_response(raw).get("cards", [])

    cards_data = request_cards(prompt)
    content_format = _resolve_content_format(preference_keys, messages, cards_data)
    try:
        _validate_generated_cards(cards_data, content_format)
    except ValueError:
        format_label = "short video" if content_format == "short_video" else "image-text"
        cards_data = request_cards(
            f"{prompt}\n\n"
            f"Correction: the content format is {format_label}. All five cards must "
            f"serve only {format_label}. Do not use structures, terminology, platform "
            "recommendations, or examples from the other format."
        )
        _validate_generated_cards(cards_data, content_format)

    cards = []
    for c in cards_data:
        try:
            ct = c.get("card_type", "")
            c["title"] = strip_markdown(c.get("title", "")) or (
                SCRIPT_TITLES[content_format]
                if ct == "script"
                else FIXED_TITLES.get(ct, strip_markdown(c.get("title", "")))
            )
            c["preview"] = strip_markdown(c.get("preview", ""))
            c["content"] = strip_markdown(c.get("content", ""))
            c["tips"] = [strip_markdown(t) for t in c.get("tips", [])]
            cards.append(ContentCard(**c))
        except Exception:
            pass
    return cards


MODIFY_SYSTEM_PROMPT = build_system_prompt("""Edit the supplied content card according to the user's requested changes and return the complete revised card.

Editing rules:
- Change only the requested parts; preserve everything else.
- Preserve the original style and tone.
- Use plain text in prose fields, without Markdown formatting.
- When content changes, update tips to accurately reflect the revised content instead of retaining outdated points.

Return only a JSON object:
{
  "title": "Card title",
  "preview": "Preview summary",
  "content": "Complete revised content",
  "tips": ["First key point", "Second key point"]
}""", language_mode="edit")


def modify_card(
    card: ContentCard, instruction: str, messages: list[dict], reference_context: str = "",
) -> ContentCard:
    """Modify a single content card based on user instruction."""
    convo_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in messages
    )
    card_json = card.model_dump_json(indent=2)

    prompt = (
        f"Conversation context:\n{convo_text}\n\n"
        f"Current card ({card.card_type}):\n{card_json}\n\n"
        f"Requested changes: {instruction}\n\n"
        "Apply the requested changes and return the complete card as JSON."
    )

    client = _get_modify_client()
    response = client.chat.completions.create(
        model=get_ai_provider("content_studio").model,
        messages=[
            {"role": "system", "content": MODIFY_SYSTEM_PROMPT + (
                "\n\nReference context:\n" + reference_context if reference_context else ""
            )},
            {"role": "user", "content": prompt},
        ],
        max_tokens=2048,
        temperature=0.7,
    )

    raw = response.choices[0].message.content or ""
    result = _parse_json_response(raw)

    ct = card.card_type
    content_format = _resolve_content_format([], [], [card.model_dump()])
    _validate_content_format([{
        "title": card.title,
        "preview": result.get("preview", card.preview),
        "content": result.get("content", card.content),
    }], content_format)
    return ContentCard(
        id=card.id,
        card_type=ct,
        title=strip_markdown(result.get("title", "")) or card.title,
        preview=strip_markdown(result.get("preview", card.preview)),
        content=strip_markdown(result.get("content", card.content)),
        tips=[strip_markdown(t) for t in result.get("tips", card.tips)],
    )


WorkSectionType = Literal[
    "project_background_and_goals",
    "target_audience",
    "core_communication_strategy",
    "content_ideas",
    "publishing_schedule",
    "risks_and_optimization",
    "next_steps",
]

REQUIRED_WORK_SECTIONS: tuple[WorkSectionType, ...] = (
    "project_background_and_goals",
    "target_audience",
    "core_communication_strategy",
    "content_ideas",
    "publishing_schedule",
    "risks_and_optimization",
    "next_steps",
)


class GeneratedWorkSection(BaseModel):
    section_type: WorkSectionType
    title_zh: str = Field(min_length=2, max_length=40)
    title_en: str = Field(min_length=2, max_length=80)
    paragraphs_zh: list[str] = Field(min_length=2, max_length=4)
    paragraphs_en: list[str] = Field(min_length=2, max_length=4)


class GeneratedWorkReport(BaseModel):
    schema_version: Literal[1] = 1
    title_zh: str = Field(min_length=5, max_length=120)
    title_en: str = Field(min_length=5, max_length=180)
    summary_zh: str = Field(min_length=40)
    summary_en: str = Field(min_length=80)
    sections: list[GeneratedWorkSection] = Field(
        min_length=len(REQUIRED_WORK_SECTIONS),
        max_length=len(REQUIRED_WORK_SECTIONS),
    )

    @model_validator(mode="after")
    def validate_section_order(self):
        section_types = tuple(section.section_type for section in self.sections)
        if section_types != REQUIRED_WORK_SECTIONS:
            raise ValueError("Work report sections must use the required order")
        for section in self.sections:
            if len(section.paragraphs_zh) != len(section.paragraphs_en):
                raise ValueError("Chinese and English sections must have matching paragraphs")
            if any(len(paragraph.strip()) < 30 for paragraph in section.paragraphs_zh):
                raise ValueError("Chinese work report paragraphs must contain actionable detail")
            if any(len(paragraph.strip()) < 60 for paragraph in section.paragraphs_en):
                raise ValueError("English work report paragraphs must contain actionable detail")
        return self


DOCUMENT_SYSTEM_PROMPT = build_system_prompt("""Create a formal, comprehensive marketing strategy report from the supplied content cards: script, headlines, copy, hashtags, and visual plan.

Report requirements:
- Reorganize, synthesize, and expand the content into a report instead of copying, concatenating, or listing the raw cards.
- Produce complete matching Chinese and English content, not just translated headings.
- title_zh and title_en must be specific, formal report titles, not generic labels such as "Comprehensive document". Use 5-120 characters for title_zh and 5-180 for title_en.
- Put the executive summaries only in summary_zh and summary_en; do not repeat them in sections. Use at least 40 characters for summary_zh and 80 for summary_en.
- Include exactly seven sections with these section_type values in this exact order:
  project_background_and_goals, target_audience, core_communication_strategy, content_ideas, publishing_schedule, risks_and_optimization, next_steps.
- Every section needs 2-4 substantive paragraphs per language explaining the rationale, execution, and expected outcome. Chinese and English paragraph counts must match.
- Each Chinese paragraph needs at least 30 characters; each English paragraph needs at least 60 characters. Section titles need 2-40 characters in Chinese and 2-80 in English.
- Include enough actionable detail for a client- or team-ready report, with coherent transitions and conclusions, rather than a brief outline.
- Avoid conversational phrases such as "based on the cards above" or "as you just mentioned".
- Return only one JSON object, with no Markdown code fences, preamble, or explanation.

JSON structure (the single section below illustrates the shape; include all seven required sections):
{
  "schema_version": 1,
  "title_zh": "A specific formal report title written in Chinese",
  "title_en": "English Formal Report Title",
  "summary_zh": "Chinese executive summary with at least 40 characters",
  "summary_en": "English executive summary with at least 80 characters",
  "sections": [
    {
      "section_type": "project_background_and_goals",
      "title_zh": "Project Background and Goals written in Chinese",
      "title_en": "Project Background and Goals",
      "paragraphs_zh": ["Chinese paragraph 1 with at least 30 characters", "Chinese paragraph 2 with at least 30 characters"],
      "paragraphs_en": ["English paragraph 1 with at least 60 characters", "English paragraph 2 with at least 60 characters"]
    }
  ]
}""", language_mode="bilingual_report")


def _serialize_generated_work(report: GeneratedWorkReport) -> str:
    return json.dumps(report.model_dump(), ensure_ascii=False)


def generate_document(cards: list[ContentCard], reference_context: str = "") -> str:
    """Generate a comprehensive marketing document from content cards."""
    cards_text = "\n\n".join(
        f"Card: {c.title}\n{c.content}"
        for c in cards
    )

    prompt = (
        f"Content cards:\n{cards_text}\n\n"
        "Reorganize these cards into a formal, comprehensive marketing strategy report. "
        "Do not copy each card verbatim; synthesize and expand the material into coherent report sections."
    )

    client = _get_client()
    messages = [
        {"role": "system", "content": DOCUMENT_SYSTEM_PROMPT + (
            "\n\nReference context:\n" + reference_context if reference_context else ""
        )},
        {"role": "user", "content": prompt},
    ]
    last_error: Exception | None = None
    for attempt in range(2):
        response = client.chat.completions.create(
            model=get_ai_provider("content_studio").model,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=8192,
            temperature=0.7,
        )
        raw = response.choices[0].message.content or ""
        try:
            report = GeneratedWorkReport.model_validate(_parse_json_response(raw))
            return _serialize_generated_work(report)
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                messages = [
                    *messages,
                    {"role": "assistant", "content": raw},
                    {
                        "role": "user",
                        "content": (
                            "The previous output failed JSON Schema validation. Return the "
                            "complete JSON with the required fields, section types, section order, "
                            "paragraph counts, and minimum lengths in both Chinese and English."
                        ),
                    },
                ]
    raise ValueError("AI returned an invalid work report") from last_error


def generate_async(session_id: str, user_id: str | None = None) -> None:
    """Run card generation in a background thread."""

    def _run():
        from app.engines.content_generator.material_references import latest_material_reference_ids
        from app.engines.content_generator.storage import (
            create_activity,
            get_session,
            save_next_version,
            update_session,
        )
        try:
            session = get_session(session_id, user_id)
            if not session:
                return
            if user_id is None:
                session = get_session(session_id, session.user_id)
                if not session:
                    return
            update_session(session_id, status="generating")
            ctx = build_reference_context(
                session.insight_ids, session.case_ids, user_id or session.user_id,
                material_ids=session.material_ids, project_id=session.project_id,
                material_priority_ids=latest_material_reference_ids(session.messages),
            )
            msg_dicts = [
                {"role": message.role, "content": message.content}
                for message in session.messages
            ]
            cards = generate_cards(
                msg_dicts,
                reference_context=ctx,
                preference_keys=session.preference_keys,
            )
            update_session(session_id, cards=cards, status="completed")
            save_next_version(
                session_id,
                cards,
                is_major_bump=True,
                activity=create_activity("cards_generated", card_count=len(cards)),
            )
        except Exception:
            update_session(session_id, status="failed")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Fix truncated JSON
    if not text.endswith("}"):
        brace_count = text.count("{") - text.count("}")
        quote_count = text.count('"') % 2
        if quote_count:
            text += '"'
        text += "}" * max(brace_count, 0)
        bracket_count = text.count("[") - text.count("]")
        text += "]" * max(bracket_count, 0)
        text += "}" * max(text.count("{") - text.count("}"), 0)

    result = None
    for attempt in range(3):
        try:
            result = json.loads(text)
            break
        except json.JSONDecodeError:
            if attempt == 0:
                text = re.sub(r",(\s*[}\]])", r"\1", text)
            elif attempt == 1:
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    text = re.sub(r",(\s*[}\]])", r"\1", match.group(0))
                else:
                    raise ValueError(f"Failed to parse AI response: {text[:200]}")

    if result is None:
        raise ValueError(f"Failed to parse AI response: {text[:200]}")
    return result
