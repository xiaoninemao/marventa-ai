from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PortfolioMedia(BaseModel):
    id: str
    name: str
    media_type: Literal["image", "video"]
    object_key: str
    mime_type: str
    file_url: str = ""


class ScriptDocument(BaseModel):
    id: str
    name: str
    user_id: str
    creator_name: str = ""
    project_id: str = ""
    project_title: str = ""
    project_role: str = "member"
    status: str = "completed"
    title: str
    content: str
    source_session_id: str = ""
    source_version_id: str = ""
    media_kind: Literal["image", "video"] | None = None
    media: list[PortfolioMedia] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ScriptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    project_id: str = Field(min_length=1)
    media_kind: Literal["image", "video"]

    @model_validator(mode="after")
    def validate_native_work(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Work name is required")
        return self


class ScriptUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=200)
    media_order: list[str] | None = None
    expected_updated_at: str | None = None

    @model_validator(mode="before")
    @classmethod
    def validate_changes(cls, value: Any) -> Any:
        if isinstance(value, dict):
            if not value or any(item is None for item in value.values()):
                raise ValueError("Work updates cannot be empty or contain null fields")
            if "expected_updated_at" in value and "media_order" not in value:
                raise ValueError("A version is only accepted with media order")
        return value

    @model_validator(mode="after")
    def validate_name(self):
        if self.name is not None:
            self.name = self.name.strip()
            if not self.name:
                raise ValueError("Work name is required")
        return self


class ScriptEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=200)
    content: str = Field(max_length=20_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    media_ids: list[str] = Field(default_factory=list)
    expected_updated_at: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_content(self):
        self.title = self.title.strip()
        normalized = [tag.strip().lstrip("#").strip() for tag in self.tags]
        if any(not tag or len(tag) > 200 or "\n" in tag or "\r" in tag for tag in normalized):
            raise ValueError("Invalid work tags")
        self.tags = list(dict.fromkeys(normalized))
        if len(set(self.media_ids)) != len(self.media_ids):
            raise ValueError("Invalid media order")
        return self
