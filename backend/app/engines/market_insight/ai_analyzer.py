from __future__ import annotations

import json
import logging
import re
import threading

from openai import OpenAI

from app.config import CASE_AI_API_KEY, CASE_AI_BASE_URL, CASE_AI_MODEL
from app.engines.market_insight.models import AIAnalysis, AnalysisLocale, ParsedDocument
from app.shared.prompts import build_system_prompt

logger = logging.getLogger(__name__)
ANALYSIS_HEARTBEAT_SECONDS = 15
_active_workers: set[object] = set()
_workers_changed = threading.Condition()

TASK_INSTRUCTIONS = """Analyze technical documentation as a marketing strategist and technology-product competitive analyst, extracting actionable business intelligence.

Return a structured analysis with these fields:
1. product_name: the product's accurate name from the document.
2. product_category: its market category, such as AI marketing platform, DevOps tool, database, or CRM.
3. product_description: a detailed description in 2-4 paragraphs covering functionality, key features, and value proposition in marketing language.
4. similar_products: 3-6 known competitors or comparable products in the category, such as Notion, Jira, or Salesforce.
5. strengths: 3-5 competitive advantages.
6. weaknesses: 2-4 limitations, gaps, or improvement opportunities supported by the documentation.
7. product_summary: a concise 2-3 sentence elevator pitch.
8. target_audience: a specific user profile including role, company size, and industry.
9. use_cases: 3-5 concrete real-world problems the product solves.
10. market_positioning: how to position the product against existing competitors.
11. tech_highlights: 3-5 technical innovations worth emphasizing in marketing.
12. suggested_marketing_angles: 3-5 angles for social media or technical blogs.
13. marketing_stage: the current stage, such as early market education, initial customer acquisition, scaling, mature brand maintenance, or competition in an established market, with a brief rationale.

If the request specifies a compact output budget, prioritize those length and list limits while retaining all fields and their intended meaning.
Be specific and insightful, ground every conclusion in details from the document, and do not use Markdown formatting in the output."""

SYSTEM_PROMPT = build_system_prompt(TASK_INSTRUCTIONS, output_locale="zh-CN")

ANALYSIS_PROMPT = """Analyze this technical document and return a structured JSON analysis.

Document title: {title}
Document type: {source_type}

--- Document content ---
{content}
--- End of document ---

Return a JSON object with exactly this structure:
{{
  "product_name": "...",
  "product_category": "...",
  "product_description": "...",
  "similar_products": ["...", "..."],
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "product_summary": "...",
  "target_audience": "...",
  "use_cases": ["...", "..."],
  "market_positioning": "...",
  "tech_highlights": ["...", "..."],
  "suggested_marketing_angles": ["...", "..."],
  "marketing_stage": "..."
}}

Return only the JSON object, with no preamble or explanation."""

def _has_case_ai_provider() -> bool:
    return bool(CASE_AI_API_KEY)


def _get_case_ai_client() -> OpenAI:
    if not CASE_AI_API_KEY:
        raise ValueError("CASE_AI_API_KEY is not configured")
    return OpenAI(api_key=CASE_AI_API_KEY, base_url=CASE_AI_BASE_URL)


def _analyze_text(doc: ParsedDocument, *, locale: AnalysisLocale = "zh-CN") -> AIAnalysis | None:
    if not _has_case_ai_provider():
        return None

    content = doc.raw_text[:60000]
    if len(doc.raw_text) > 60000:
        content += "\n\n[Content truncated due to length]"

    prompt = ANALYSIS_PROMPT.format(
        title=doc.title,
        source_type=doc.source_type,
        content=content,
    )

    prompt += (
        "\n\nKeep the JSON concise: each string must be under 120 characters; "
        "each list may contain at most 3 short items; keep the entire JSON under 2500 characters. "
        "Return every required key even when its value is empty."
    )

    client = _get_case_ai_client()
    response = client.chat.completions.create(
        model=CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT if locale == "zh-CN"
             else build_system_prompt(TASK_INSTRUCTIONS, output_locale=locale)},
            {"role": "user", "content": prompt},
        ],
        max_tokens=4096,
        temperature=0.3,
    )

    raw = response.choices[0].message.content or ""
    analysis_dict = _parse_json_response(raw)
    return AIAnalysis(**analysis_dict)


def analyze_document(
    doc: ParsedDocument, record_id: str = "", owner_id: str = "", *, locale: AnalysisLocale = "zh-CN",
) -> ParsedDocument:
    if not _has_case_ai_provider():
        return doc

    analysis = _analyze_text(doc, locale=locale)
    if analysis:
        doc.ai_analysis = analysis
        doc.ai_model = CASE_AI_MODEL
    return doc


def drain_analysis_workers(timeout: float | None = None) -> bool:
    """Wait for this process's workers without cancelling them or their heartbeats.

    Quiesce analysis submissions first. Call in the serving process (off the async
    event loop), not a separate deployment CLI process. False means workers remain;
    a timeout does not stop them or make it safe to terminate the process.
    """
    with _workers_changed:
        return _workers_changed.wait_for(lambda: not _active_workers, timeout)


def analyze_async(
    doc: ParsedDocument, record_id: str, owner_id: str = "", *, locale: AnalysisLocale = "zh-CN",
) -> None:
    """Run a claimed attempt; stale workers cannot renew or publish results."""
    from app.engines.market_insight.storage import finish_analysis, renew_analysis_lease

    attempt_id = doc._analysis_attempt_id
    if not attempt_id:
        logger.warning("Insight analysis has no claim: record=%s", record_id)
        return
    stopped = threading.Event()
    worker = object()

    def _finished():
        stopped.set()
        with _workers_changed:
            _active_workers.discard(worker)
            _workers_changed.notify_all()

    def _fail_safely():
        try:
            finish_analysis(record_id, attempt_id)
        except Exception as exc:  # noqa: BLE001 -- Thread boundary; log no provider content.
            logger.error("Insight failure persistence failed: record=%s error=%s",
                         record_id, type(exc).__name__)

    def _heartbeat():
        try:
            while not stopped.wait(ANALYSIS_HEARTBEAT_SECONDS):
                if not renew_analysis_lease(record_id, attempt_id):
                    break
        except Exception as exc:  # noqa: BLE001 -- Thread boundary; log no provider content.
            logger.error("Insight heartbeat failed: record=%s error=%s",
                         record_id, type(exc).__name__)
            _fail_safely()
        finally:
            stopped.set()

    def _run():
        try:
            result = analyze_document(doc, record_id, owner_id, locale=locale)
            finish_analysis(record_id, attempt_id, result.ai_analysis)
        except Exception as exc:  # noqa: BLE001 -- Thread boundary; log no provider content.
            # Provider exceptions can embed document content; log only their type.
            logger.error("Insight analysis failed: record=%s error=%s",
                         record_id, type(exc).__name__)
            _fail_safely()
        finally:
            _finished()

    try:
        if not renew_analysis_lease(record_id, attempt_id):
            return
        with _workers_changed:
            _active_workers.add(worker)
        threading.Thread(target=_heartbeat, daemon=True).start()
        threading.Thread(target=_run, daemon=True).start()
    except Exception as exc:  # noqa: BLE001 -- Thread boundary; log no provider content.
        stopped.set()
        logger.error("Insight worker startup failed: record=%s error=%s",
                     record_id, type(exc).__name__)
        _fail_safely()
        _finished()


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()

    # Try multiple parse strategies
    result = None
    for attempt in range(3):
        try:
            result = json.loads(text)
            break
        except json.JSONDecodeError:
            if attempt == 0:
                # Remove trailing commas before ] or }
                text = re.sub(r",(\s*[}\]])", r"\1", text)
            elif attempt == 1:
                # Try extracting just the JSON object
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    text = re.sub(r",(\s*[}\]])", r"\1", match.group(0))
                else:
                    raise ValueError(f"Failed to parse AI response as JSON: {text[:200]}")

    if result is None:
        raise ValueError(f"Failed to parse AI response as JSON: {text[:200]}")

    # Normalize types and strip markdown
    string_fields = {"product_name", "product_category", "product_description", "product_summary",
                     "target_audience", "market_positioning", "marketing_stage"}
    array_fields = {"similar_products", "strengths", "weaknesses", "use_cases",
                    "tech_highlights", "suggested_marketing_angles", "product_images"}

    for key in list(result.keys()):
        if key in string_fields and isinstance(result[key], list):
            result[key] = "\n".join(str(v) for v in result[key])
        elif key in array_fields and isinstance(result[key], str):
            result[key] = [result[key]]

        if isinstance(result[key], str):
            result[key] = re.sub(r'\*\*(.+?)\*\*', r'\1', result[key])
            result[key] = re.sub(r'\*(.+?)\*', r'\1', result[key])
        elif isinstance(result[key], list):
            result[key] = [re.sub(r'\*\*(.+?)\*\*', r'\1', re.sub(r'\*(.+?)\*', r'\1', v)) if isinstance(v, str) else v for v in result[key]]
    return result
