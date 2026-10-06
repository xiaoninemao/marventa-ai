from __future__ import annotations

import base64
import os
import threading
from typing import Literal

from openai import OpenAI

from app.ai_provider import get_ai_provider
from app.engines.case_library.models import (
    CaseAIAnalysis,
    validate_generated_case_analysis,
)
from app.shared.prompts import build_system_prompt

TASK_INSTRUCTIONS = """Analyze the supplied short-video or image-text marketing case and extract actionable insights grounded in its title, description, tags, content type, category, and supplied images or video screenshots.

Return these structured fields:
1. content_analysis: a comprehensive analysis of structure, core message, visual style, and storytelling; at least 80 characters.
2. marketing_angle: the central marketing strategy or angle; at least 40 characters.
3. target_audience: a specific profile of the audience attracted by this content; at least 40 characters.
4. experience_extraction: reusable lessons and key takeaways; at least 60 characters.
5. key_highlights: 3-5 elements that make the case effective.
6. improvement_suggestions: 2-4 actionable improvements.
7. similar_approaches: 3-5 related marketing approaches or styles.
8. hook_analysis: how the opening or first screen encourages continued viewing or reading; at least 40 characters.
9. title_suggestions: 2-4 more compelling headlines.
10. tag_suggestions: 3-6 relevant tags.
11. rewrite_examples: 1-3 directly usable examples, each at least 12 characters.

For video cases, also provide these fields with at least 30 characters each:
- opening_hook: the visual, spoken, or emotional hook in the first three seconds.
- pacing_analysis: pacing, information density, and transitions.
- shot_structure: shot sequence and visual organization.
- script_structure: narrative organization of subtitles, voiceover, or copy.
For non-video cases, return empty strings for all four video-specific fields.

Develop every text field fully and respect all array-size limits. Highlights, improvements, related approaches, and headline suggestions must each contain at least 6 characters per item. Ground every conclusion in the supplied evidence; avoid generic claims. Do not use Markdown formatting in the output."""

SYSTEM_PROMPT = build_system_prompt(TASK_INSTRUCTIONS, output_locale="zh-CN")

ANALYSIS_PROMPT = """Analyze this marketing case and return a structured JSON analysis.

Case title: {title}
Content type: {content_type}
Description: {description}
Tags: {tags}
{video_hint}

Return only a JSON object with these fields, following the system's length and item-count requirements:
{{
  "content_analysis": "...",
  "marketing_angle": "...",
  "target_audience": "...",
  "experience_extraction": "...",
  "key_highlights": ["...", "...", "..."],
  "improvement_suggestions": ["...", "..."],
  "similar_approaches": ["...", "...", "..."],
  "hook_analysis": "...",
  "title_suggestions": ["...", "..."],
  "tag_suggestions": ["...", "...", "..."],
  "rewrite_examples": ["...", "..."],
  "opening_hook": "",
  "pacing_analysis": "",
  "shot_structure": "",
  "script_structure": ""
}}"""

MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _get_client() -> OpenAI:
    return get_ai_provider("case_library").client()


def _image_to_data_url(path: str) -> str | None:
    """Read a local image file and return a base64 data URL."""
    try:
        ext = os.path.splitext(path)[1].lower()
        mime = MIME_MAP.get(ext, "image/jpeg")
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        return f"data:{mime};base64,{b64}"
    except Exception:
        return None


def analyze_case(
    title: str,
    content_type: str,
    description: str,
    tags: list[str],
    image_paths: list[str] | None = None,
    video_url: str = "",
    *,
    locale: Literal["zh-CN", "en"] = "zh-CN",
) -> CaseAIAnalysis:
    video_hint = ""
    if content_type == "video" and video_url:
        video_hint = (
            f"Video file: {video_url}\n"
            "This is a video file path, not video content. Base the analysis on the supplied case text."
        )

    prompt = ANALYSIS_PROMPT.format(
        title=title,
        content_type=content_type,
        description=description or "(No description)",
        tags=", ".join(tags) if tags else "(No tags)",
        video_hint=video_hint,
    )

    # Build multimodal message content
    user_content: list[dict] = []

    # Add images (limit to 5)
    image_paths = (image_paths or [])[:5]
    for path in image_paths:
        data_url = _image_to_data_url(path)
        if data_url:
            user_content.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })

    user_content.append({"type": "text", "text": prompt})

    client = _get_client()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT if locale == "zh-CN"
         else build_system_prompt(TASK_INSTRUCTIONS, output_locale=locale)},
        {"role": "user", "content": user_content},
    ]
    last_error: Exception | None = None
    for attempt in range(2):
        response = client.chat.completions.create(
            model=get_ai_provider("case_library").model,
            messages=messages,
            response_format={"type": "json_object"},
            max_tokens=8192,
            temperature=0.3,
        )
        raw = response.choices[0].message.content or ""
        try:
            import json
            return validate_generated_case_analysis(json.loads(raw), content_type)
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                messages = [
                    *messages,
                    {"role": "assistant", "content": raw},
                    {
                        "role": "user",
                        "content": (
                            "The previous output failed JSON Schema validation. Include every "
                            "field and obey the text-length, array-size, and video-specific "
                            "field requirements. Return only the complete JSON object."
                        ),
                    },
                ]
    raise ValueError("AI returned an invalid case analysis") from last_error


def analyze_async(
    case_id: str,
    title: str,
    content_type: str,
    description: str,
    tags: list[str],
    image_paths: list[str] | None = None,
    video_url: str = "",
    cleanup_paths: list[str] | None = None,
    *,
    locale: Literal["zh-CN", "en"] = "zh-CN",
) -> None:
    """Run AI analysis in a background thread and update the DB on completion."""

    def _run():
        from app.engines.case_library.storage import update_case_ai
        try:
            analysis = analyze_case(
                title, content_type, description, tags,
                image_paths=image_paths, video_url=video_url, locale=locale,
            )
            update_case_ai(case_id, "completed", analysis)
        except Exception:
            update_case_ai(case_id, "failed")
        finally:
            for path in cleanup_paths or []:
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()
