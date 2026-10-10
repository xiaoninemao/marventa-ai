"""Schemas for projects, channel accounts, materials and publication plans."""

from __future__ import annotations

import unicodedata
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ProjectMember(BaseModel):
    user_id: str
    username: str
    email: str = ""
    nickname: str
    avatar_url: str = ""
    role: str
    joined_at: str


class BrandProfile(BaseModel):
    model_config = {"extra": "forbid"}

    tone: str = Field(default="", max_length=1000)
    audience: str = Field(default="", max_length=2000)
    value_proposition: str = Field(default="", max_length=2000)
    visual_style: str = Field(default="", max_length=2000)
    prohibited_terms: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("prohibited_terms")
    @classmethod
    def normalize_prohibited_terms(cls, value: list[str]) -> list[str]:
        normalized = [term.strip() for term in value if term.strip()]
        if any(len(term) > 100 for term in normalized):
            raise ValueError("Each prohibited term must be at most 100 characters")
        return list(dict.fromkeys(normalized))


class ContentProject(BaseModel):
    id: str
    user_id: str
    title: str
    xhs_account: str = ""
    source_session_id: str
    content_type: str = "mixed"
    platform_hint: str = ""
    final_snapshot: dict[str, Any] = {}
    notes: str = ""
    status: str = "active"
    role: str = "owner"
    avatar_color: str = "#bfdbfe"
    avatar_icon: str = "💡"
    brand_profile: BrandProfile = Field(default_factory=BrandProfile)
    members: list[ProjectMember] = []
    member_count: int = 0
    created_at: str
    updated_at: str


class ProjectMemberInvite(BaseModel):
    email: str
    role: str = "member"


class ProjectMemberRole(BaseModel):
    role: str


class ProjectChannelAccount(BaseModel):
    id: str
    project_id: str
    platform: Literal["xiaohongshu", "douyin"]
    account_name: str
    platform_user_id: str = ""
    profile_url: str = ""
    notes: str = ""
    created_by_user_id: str = ""
    creator_name: str = ""
    creator_avatar_url: str = ""
    authorization_status: str = "active"
    token_expires_at: str = ""
    refresh_token_expires_at: str = ""
    created_at: str
    updated_at: str


AccountContentStatus = Literal[
    "ready", "unsupported_platform", "authorization_required",
    "scope_required", "configuration_required",
]


class AccountContentAccount(ProjectChannelAccount):
    project_title: str = ""
    content_status: AccountContentStatus
    required_scope: str = ""
    content_message: str = ""


class AccountContentStatistics(BaseModel):
    likes: int | None = None
    comments: int | None = None
    views: int | None = None
    shares: int | None = None


class AccountContentPost(BaseModel):
    id: str
    is_simulated: bool = False
    title: str = ""
    content: str = ""
    cover_url: str = ""
    image_urls: list[str] = Field(default_factory=list)
    video_url: str = ""
    platform_video_id: str = ""
    share_url: str = ""
    published_at: str = ""
    media_type: Literal["video", "image_text", "unknown"] = "unknown"
    visibility: Literal[
        "published", "reviewing", "not_public", "unknown", "accepted",
    ] = "unknown"
    statistics: AccountContentStatistics = Field(default_factory=AccountContentStatistics)
    plan_id: str = ""


class AccountContentPlayer(BaseModel):
    video_id: str
    player_url: str


class AccountContentPage(BaseModel):
    account: AccountContentAccount
    source: Literal["platform", "marventa"]
    status: AccountContentStatus
    items: list[AccountContentPost] = Field(default_factory=list)
    next_cursor: str | None = None
    has_more: bool = False
    page: int
    page_size: int
    limited: bool = False
    message: str


LeadTrackingRunStatus = Literal["completed", "partial", "unavailable", "failed"]


class LeadTrackingComment(BaseModel):
    comment_id: str
    comment_user_id: str
    content: str
    create_time: int
    digg_count: int
    reply_comment_total: int
    top: bool
    item_id: str
    interaction_score: int


class LeadTrackingCommentInsight(BaseModel):
    status: LeadTrackingRunStatus
    date: str
    timezone: str
    top_limit: int = 50
    items: list[LeadTrackingComment] = Field(default_factory=list)
    is_simulated: bool = False
    limited: bool = False
    message: str = ""
    last_synced_at: str = ""


LeadIntent = Literal["high", "medium", "low"]
LeadReviewStatus = Literal["pending", "confirmed", "dismissed"]


class LeadTrackingLead(BaseModel):
    comment_id: str
    comment_user_id: str
    content: str
    create_time: int
    item_id: str
    score: int
    intent: LeadIntent
    demand_labels: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    recommended_action: str
    review_status: LeadReviewStatus = "pending"
    reviewed_at: str = ""


class LeadTrackingAnalysis(BaseModel):
    status: Literal["completed", "unavailable", "failed"]
    date: str
    timezone: str
    analysis_method: Literal["rules", "ai"] = "rules"
    model: str = ""
    rule_version: str = ""
    is_simulated: bool = False
    items: list[LeadTrackingLead] = Field(default_factory=list)
    analyzed_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    pending_count: int = 0
    generated_at: str = ""
    message: str = ""


class LeadTrackingReviewRequest(BaseModel):
    status: LeadReviewStatus


class ProjectChannelAuthorizationRequest(BaseModel):
    platform: Literal["xiaohongshu", "douyin"]


class ProjectChannelAuthorizationPollRequest(BaseModel):
    state: str = Field(min_length=1)


class PublicationPlan(BaseModel):
    id: str
    name: str = ""
    media_mode: Literal["image_text", "video"] = "image_text"
    project_id: str
    project_title: str = ""
    portfolio_id: str
    portfolio_title: str = ""
    channel_account_id: str
    platform: Literal["xiaohongshu", "douyin", ""]
    account_name: str
    created_by_user_id: str
    creator_name: str = ""
    creator_avatar_url: str = ""
    status: Literal["draft", "scheduled", "publishing", "cancelled", "published", "failed"]
    scheduled_for: str = ""
    published_at: str = ""
    platform_post_id: str = ""
    platform_video_id: str = ""
    last_error: str = ""
    outcome_unknown: bool = False
    note: str = ""
    publishing_ready: bool = False
    missing_scope: str = ""
    content_count: int = 0
    image_count: int = 0
    video_count: int = 0
    document_count: int = 0
    has_copy: bool = False
    created_at: str
    updated_at: str


class PublicationPlanCreate(BaseModel):
    model_config = {"extra": "forbid"}

    project_id: str = Field(min_length=1)
    name: str = Field(default="", max_length=120)


class PublicationWorkSelection(BaseModel):
    model_config = {"extra": "forbid"}
    portfolio_id: str = Field(min_length=1)


class PublicationPlanUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, max_length=120)
    channel_account_id: str | None = None
    scheduled_for: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)
    status: Literal["draft", "scheduled", "cancelled"] | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_fields(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("Publication fields cannot be null")
        return value


class PublicationCopy(BaseModel):
    model_config = {"extra": "forbid"}

    title: str = Field(max_length=255)
    content: str = Field(max_length=1024 * 1024)
    tags: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=5,
        description=(
            "Up to 5 tags, at most 200 input code points each and 50 after trimming "
            "and removing leading ASCII/full-width hash markers. Case-sensitive duplicates are removed. "
            "Empty tags, controls and line breaks are invalid."
        ),
    )

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, tags: list[str]) -> list[str]:
        normalized = []
        for tag in tags:
            if any(unicodedata.category(char) in {"Cc", "Cs"} or char in "\u2028\u2029" for char in tag):
                raise ValueError("Publication tag contains invalid characters")
            tag = tag.strip()
            while tag.startswith(("#", "\uff03")):
                tag = tag[1:].strip()
            if not tag:
                raise ValueError("Publication tag contains invalid characters")
            if len(tag) > 50:
                raise ValueError("Publication tags must be at most 50 characters")
            if tag not in normalized:
                normalized.append(tag)
        return normalized

    @field_validator("tags", mode="before")
    @classmethod
    def bound_tag_count(cls, tags: Any) -> Any:
        if isinstance(tags, list) and len(tags) > 5:
            raise ValueError("At most 5 publication tags are allowed")
        return tags


class PublicationContent(BaseModel):
    id: str
    plan_id: str
    position: int = 0
    name: str
    media_type: Literal["image", "video", "document"]
    mime_type: str
    file_url: str = ""
    source_material_id: str = ""
    object_key: str = Field(default="", exclude=True, repr=False)
    created_at: str
    updated_at: str


class MaterialCover(BaseModel):
    id: str
    media_type: Literal["image", "video"]
    object_key: str
    file_url: str = ""


class ProjectMaterial(BaseModel):
    id: str
    project_id: str
    parent_id: str = ""
    node_type: Literal["collection", "file"] = "file"
    name: str
    media_type: Literal["image", "video", "document"]
    mime_type: str
    file_size: int
    object_key: str
    content_html: str | None = Field(default=None, exclude=True, repr=False)
    file_url: str = ""
    material_count: int = 0
    image_count: int = 0
    video_count: int = 0
    document_count: int = 0
    covers: list[MaterialCover] = Field(default_factory=list)
    created_by_user_id: str
    creator_name: str = ""
    creator_avatar_url: str = ""
    created_at: str
    updated_at: str


class ProjectMaterialSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectMaterialSetUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectMaterialUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectMaterialCopyCreate(BaseModel):
    material_set_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=1024 * 1024)


class ProjectMaterialContentUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    content: str = Field(min_length=1, max_length=1024 * 1024)




class ManualProjectRequest(BaseModel):
    title: str = ""
    platform_hint: str = ""
    content_type: str = "mixed"
    xhs_account: str = ""
    final_snapshot: dict[str, Any] = {}
    notes: str = ""


class UpdateProjectRequest(BaseModel):
    model_config = {"extra": "forbid"}

    title: str | None = None
    notes: str | None = None
    avatar_color: str | None = None
    avatar_icon: str | None = None
    brand_profile: BrandProfile | None = None
