from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, Field, PrivateAttr

AnalysisLocale = Literal["zh-CN", "en"]


class CodeBlock(BaseModel):
    language: str = ""
    code: str


class Section(BaseModel):
    heading: str
    level: int
    content: str
    subsections: list["Section"] = []


class ResearchSource(BaseModel):
    id: str
    title: str
    url: str | None
    kind: Literal["web", "document"]
    retrieved_at: str
    excerpt: str


class ResearchClaim(BaseModel):
    id: str
    text: str
    kind: Literal["fact", "inference"]
    source_ids: list[str]
    quote: str


class ResearchCompetitor(BaseModel):
    name: str
    comparison: str
    source_ids: list[str]


class InsightResearch(BaseModel):
    status: Literal["completed", "partial", "unavailable", "edited"]
    sources: list[ResearchSource] = Field(default_factory=list)
    claims: list[ResearchClaim] = Field(default_factory=list)
    competitors: list[ResearchCompetitor] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    searched_at: str | None = None


class AIAnalysis(BaseModel):
    product_name: str = ""
    product_category: str = ""
    product_description: str = ""
    product_images: list[str] = []
    similar_products: list[str] = []
    strengths: list[str] = []
    weaknesses: list[str] = []
    product_summary: str = ""
    target_audience: str = ""
    use_cases: list[str] = []
    market_positioning: str = ""
    tech_highlights: list[str] = []
    suggested_marketing_angles: list[str] = []
    marketing_stage: str = ""
    research: InsightResearch | None = None


class ParsedDocument(BaseModel):
    # Keep the dispatch claim with its input, not in public API serialization.
    _analysis_attempt_id: str = PrivateAttr(default="")
    _analysis_guard: Callable[[], None] | None = PrivateAttr(default=None)
    _analysis_deadline: float | None = PrivateAttr(default=None)

    title: str
    source_type: str
    sections: list[Section] = []
    code_blocks: list[CodeBlock] = []
    tech_stack: list[str] = []
    features: list[str] = []
    raw_text: str = ""
    ai_analysis: AIAnalysis | None = None
    ai_model: str = ""


class HistoryRecord(BaseModel):
    id: str
    filename: str
    file_size: int
    upload_time: str
    source_type: str
    title: str
    ai_model: str = ""
    ai_analysis: AIAnalysis | None = None
    is_edited: bool = False
    status: str = "completed"
    owner_id: str = ""
    creator_name: str = ""
    organization_id: str = ""
    project_id: str
    project_title: str = ""
    project_role: str = "member"


class InsightSource(BaseModel):
    id: str
    insight_id: str
    filename: str
    file_size: int
    source_type: str
    upload_time: str
    has_source_file: bool = False


class HistoryUpdateRequest(BaseModel):
    ai_analysis: AIAnalysis


class InsightRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class ManualInsightRequest(BaseModel):
    project_id: str
    ai_analysis: AIAnalysis


class ParseRequest(BaseModel):
    repo_url: str = Field(..., description="GitHub or GitLab repository URL")
    project_id: str
    locale: AnalysisLocale = "zh-CN"
