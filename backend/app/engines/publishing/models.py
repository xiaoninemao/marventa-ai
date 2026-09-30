"""Schemas for projects, channel accounts, materials and publication plans."""

from __future__ import annotations

import unicodedata
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.engines.content_generator.models import ContentCard


class ProjectMember(BaseModel):
    user_id: str
    username: str
    email: str = ""
    nickname: str
    avatar_url: str = ""
    role: str
    joined_at: str


class ContentProject(BaseModel):
    id: str
    user_id: str
    title: str
    xhs_account: str = ""
    source_session_id: str
    source_card_id: str = ""
    content_type: str = "mixed"
    platform_hint: str = ""
    cards_snapshot: list[ContentCard] = []
    final_snapshot: dict[str, Any] = {}
    notes: str = ""
    status: str = "active"
    role: str = "owner"
    avatar_color: str = "#bfdbfe"
    avatar_icon: str = "💡"
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
    project_id: str = Field(min_length=1)
    name: str = Field(default="", max_length=120)
    media_mode: Literal["image_text", "video"] = "image_text"
    portfolio_id: str = ""
    channel_account_id: str = ""
    scheduled_for: str = Field(default="", max_length=40)
    note: str = Field(default="", max_length=500)


class PublicationPlanUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, max_length=120)
    media_mode: Literal["image_text", "video"] | None = None
    portfolio_id: str | None = None
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
            "Empty tags, controls and line breaks are invalid. Omit on PATCH to preserve; [] clears."
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


class PublicationContentsFromMaterials(BaseModel):
    model_config = {"extra": "forbid"}

    material_ids: list[str] = Field(min_length=1, max_length=10)


class PublicationContentOrder(BaseModel):
    model_config = {"extra": "forbid"}

    content_ids: list[str]


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


class CreateProjectRequest(BaseModel):
    source_session_id: str
    source_card_id: str = ""
    title: str = ""
    xhs_account: str = ""
    content_type: str = "mixed"
    platform_hint: str = ""
    notes: str = ""


class ManualProjectRequest(BaseModel):
    title: str = ""
    platform_hint: str = ""
    content_type: str = "mixed"
    xhs_account: str = ""
    final_snapshot: dict[str, Any] = {}
    notes: str = ""


class UpdateProjectRequest(BaseModel):
    title: str | None = None
    notes: str | None = None
    avatar_color: str | None = None
    avatar_icon: str | None = None
