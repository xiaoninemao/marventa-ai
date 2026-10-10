import json
import re

from app.engines.content_generator.material_references import MaterialVisualInput
from app.engines.content_generator.models import CreativeDeliverable


def build_reference_context(
    insight_ids: list[str],
    case_ids: list[str],
    user_id: str | None = None,
    material_ids: list[str] | None = None,
    project_id: str = "",
    material_priority_ids: list[str] | None = None,
    include_brand: bool = True,
) -> str:
    """Fetch authorized references; project copy is source data, media metadata only."""
    if not insight_ids and not case_ids and not material_ids and not project_id:
        return ""

    parts: list[str] = []

    if include_brand and project_id and user_id:
        from app.engines.publishing.projects import get_project
        project = get_project(project_id, user_id)
        if project:
            profile = project.brand_profile
            if any((
                profile.tone,
                profile.audience,
                profile.value_proposition,
                profile.visual_style,
                profile.prohibited_terms,
            )):
                parts.append(
                    "Project brand guidelines. Follow these project-level requirements. "
                    "A user request may add narrower creative direction but must not override "
                    "configured prohibited terms:\n"
                    + json.dumps(profile.model_dump(), ensure_ascii=False)
                )

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
        from app.engines.content_generator.material_references import (
            build_material_context,
        )
        parts.append(build_material_context(
            material_ids, project_id, user_id, priority_ids=material_priority_ids,
        ))
    return "\n".join(parts).strip()


def with_image_inputs(
    messages: list[dict],
    image_inputs: list[MaterialVisualInput | str] | None = None,
) -> list[dict]:
    if not image_inputs:
        return messages
    result = [dict(message) for message in messages]
    user_index = next(
        (
            index for index in range(len(result) - 1, -1, -1)
            if result[index].get("role") == "user"
        ),
        -1,
    )
    if user_index < 0:
        raise ValueError("Multimodal input requires a user message")
    text = result[user_index].get("content")
    if not isinstance(text, str):
        raise ValueError("Multimodal user message must contain text")
    content: list[dict] = [{"type": "text", "text": text}]
    for index, value in enumerate(image_inputs, start=1):
        visual = (
            value
            if isinstance(value, MaterialVisualInput)
            else MaterialVisualInput(
                data_url=value,
                label=f"Visual reference {index}",
            )
        )
        content.extend([
            {"type": "text", "text": visual.label},
            {
                "type": "image_url",
                "image_url": {"url": visual.data_url, "detail": "low"},
            },
        ])
    result[user_index]["content"] = content
    return result






















def find_prohibited_term_issues(
    work: CreativeDeliverable,
    brand_profile: dict,
) -> list[str]:
    prohibited_terms = [
        str(term).strip()
        for term in brand_profile.get("prohibited_terms", [])
        if str(term).strip()
    ]
    searchable = "\n".join([
        work.title, work.publication_copy, work.visual_prompt, work.video_script,
        *work.tags, *work.storyboard,
    ]).casefold()
    return [term for term in prohibited_terms if term.casefold() in searchable]

















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
