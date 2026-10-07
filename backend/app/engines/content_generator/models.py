from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator


class ChatReference(BaseModel):
    id: str
    kind: Literal["insight", "case", "material"]
    title: str


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    client_message_id: UUID | None = None
    references: list[ChatReference] = Field(default_factory=list)


class ContentCard(BaseModel):
    id: str
    card_type: str  # "script" | "title" | "copy" | "hashtags" | "visual"
    title: str
    preview: str
    content: str
    tips: list[str] = []


class QualityIssue(BaseModel):
    category: Literal["brand", "platform", "repetition", "factuality", "compliance"]
    severity: Literal["warning", "blocking"]
    card_id: str = ""
    evidence: str = Field(min_length=1, max_length=500)
    suggestion: str = Field(min_length=1, max_length=1000)


class QualityReport(BaseModel):
    ready: bool
    summary: str = Field(min_length=1, max_length=1000)
    issues: list[QualityIssue] = Field(default_factory=list, max_length=50)
    checked_at: str


class CreationActivity(BaseModel):
    id: str
    activity_type: Literal["cards_generated", "card_modified", "work_generation_started"]
    card_id: str = ""
    card_title: str = ""
    card_count: int = 0
    created_at: str


class SessionCreate(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=80)


class SessionRename(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class PresenceHeartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: UUID


class SessionResponse(BaseModel):
    _user_message_accepted: bool = PrivateAttr(default=True)

    id: str
    user_id: str
    creator_name: str = ""
    project_id: str = ""
    organization_id: str = ""
    project_role: str = ""
    title: str
    messages: list[ChatMessage]
    cards: list[ContentCard]
    status: str
    insight_ids: list[str] = []
    case_ids: list[str] = []
    material_ids: list[str] = Field(default_factory=list)
    preference_keys: list[str] = []
    activities: list[CreationActivity] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=20_000)
    insight_ids: list[str] = Field(default_factory=list)
    case_ids: list[str] = Field(default_factory=list)
    material_ids: list[str] = Field(default_factory=list, max_length=20)
    preference_keys: list[str] = Field(default_factory=list, max_length=20)
    client_message_id: UUID | None = None

    @field_validator("material_ids")
    @classmethod
    def unique_material_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class RewriteUserMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=20_000)


class ModifyCardRequest(BaseModel):
    instruction: str


class ContentVersion(BaseModel):
    id: str
    session_id: str
    version_label: str
    major: int
    minor: int
    version_type: Literal["generation", "edit", "rollback"] = "generation"
    source_version_label: str = ""
    changed_card_ids: list[str] = Field(default_factory=list)
    cards: list[ContentCard]
    created_at: str
