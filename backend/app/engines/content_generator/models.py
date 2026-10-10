from __future__ import annotations

from typing import Literal, Protocol
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    field_validator,
    model_validator,
)


class ChatReference(BaseModel):
    id: str
    kind: Literal["insight", "case", "material"]
    title: str

class ImageReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deliverable_id: str = Field(min_length=1)
    index: int = Field(ge=0)

class MessageReferencePosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offset: int = Field(ge=0, le=20_000)
    id: str
    kind: Literal["image", "insight", "case", "material"]

class AgentMessageEvent(BaseModel):
    type: Literal["message"] = "message"
    id: str
    content: str
    streaming: bool = False
    phase: Literal["commentary", "answer"] = "commentary"

class AgentToolEvent(BaseModel):
    type: Literal["tool"] = "tool"
    id: str
    tool: Literal["read_context", "list_materials", "import_material", "generate_image", "compose_work"]
    status: Literal["running", "completed", "failed", "cancelled"]
    section: str = ""
    details: list[str] = Field(default_factory=list)

AgentConversationEvent = AgentMessageEvent | AgentToolEvent

class AgentProgressCallback(Protocol):
    def __call__(self, stage: str, message: str = "", event: AgentConversationEvent | None = None) -> None: ...

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    client_message_id: UUID | None = None
    references: list[ChatReference] = Field(default_factory=list)
    image_reference: ImageReference | None = None
    reference_positions: list[MessageReferencePosition] = Field(default_factory=list)
    agent_events: list[AgentConversationEvent] = Field(default_factory=list)

class CreativeDeliverable(BaseModel):
    id: str
    media_kind: Literal["image", "video"]
    title: str = Field(default="", max_length=200)
    publication_copy: str = Field(default="", max_length=20_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    visual_prompt: str = Field(default="", max_length=4000)
    image_material_id: str = ""
    image_url: str = ""
    additional_image_material_ids: list[str] = Field(default_factory=list)
    additional_image_urls: list[str] = Field(default_factory=list)
    video_url: str = ""
    video_material_id: str = ""
    source_version_id: str = ""
    video_script: str = Field(default="", max_length=20_000)
    storyboard: list[str] = Field(default_factory=list, max_length=30)
    created_at: str

    @model_validator(mode="after")
    def require_work_content(self):
        media = [self.video_url] if self.media_kind == "video" else [self.image_url, *self.additional_image_urls]
        if not any(url.strip() for url in media) and not self.title.strip() and not self.publication_copy.strip():
            raise ValueError("Work requires media or text")
        return self

class CreationPlan(BaseModel):
    id: str
    title: str
    content: str
    created_at: str

class AgentTurnResult(BaseModel):
    intent: Literal["explore", "create"]
    reply: str = Field(min_length=1, max_length=20_000)
    deliverable: CreativeDeliverable | None = None
    revisions: list[CreativeDeliverable] = Field(default_factory=list)
    plans: list[CreationPlan] = Field(default_factory=list)
    owned_media_keys: list[str] = Field(default_factory=list, exclude=True)
    agent_events: list[AgentConversationEvent] = Field(default_factory=list)

class CreationActivity(BaseModel):
    id: str
    activity_type: Literal[
        "work_generation_started",
        "agent_explored",
        "deliverable_created",
    ]
    work_id: str = ""
    work_title: str = ""
    created_at: str

class SessionCreate(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=80)
    creation_kind: Literal["image", "video"] = "image"

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
    deliverables: list[CreativeDeliverable] = Field(default_factory=list)
    creation_kind: Literal["image", "video"] = "image"
    plans: list[CreationPlan] = Field(default_factory=list)
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
    agent_mode: Literal["auto", "explore", "create"] = "auto"
    client_message_id: UUID | None = None
    image_reference: ImageReference | None = None
    reference_positions: list[MessageReferencePosition] = Field(default_factory=list, max_length=100)

    @field_validator("material_ids")
    @classmethod
    def unique_material_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

class RewriteUserMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=20_000)
    agent_mode: Literal["auto", "explore", "create"] = "auto"

class RegenerateReplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_mode: Literal["auto", "explore", "create"] = "auto"

class RestoreDeliverableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version_id: str
