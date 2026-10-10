from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES
from app.engines.content_generator.agent_jobs import register_media
from app.engines.content_generator.material_references import (
    ensure_material_content_available,
)
from app.engines.content_generator.models import CreativeDeliverable, ImageReference
from app.engines.publishing.material_copy import copy_html_to_text
from app.engines.publishing.project_materials import (
    ensure_project_material_access,
    get_project_material,
    list_project_materials,
)
from app.engines.publishing.document_copy import read_material_document
from app.media_storage import (
    delete_media,
    media_key_from_url,
    media_url,
    put_media_bytes,
    read_media_bytes,
)


class ComposeWork(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(default="", max_length=200)
    publication_copy: str = Field(default="", max_length=20_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    visual_prompt: str = Field(default="", max_length=4000)
    media_ids: list[str] = Field(default_factory=list)
    video_script: str = Field(default="", max_length=20_000)
    storyboard: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, tags: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip().lstrip("#").strip() for tag in tags if tag.strip().lstrip("#").strip()))


def work_tool_definitions() -> list[dict]:
    return [
        {"type": "function", "function": {
            "name": "list_materials",
            "description": "List this project's material sets, or files in a set. Use IDs to import existing images, videos or documents.",
            "parameters": {
                "type": "object", "properties": {"collection_id": {"type": "string"}},
                "required": ["collection_id"], "additionalProperties": False,
            },
        }},
        {"type": "function", "function": {
            "name": "import_material",
            "description": "Read a project material by ID for this work. Images/videos return a media handle; documents return copy. Does not modify project originals.",
            "parameters": {
                "type": "object", "properties": {"material_id": {"type": "string"}},
                "required": ["material_id"], "additionalProperties": False,
            },
        }},
        {"type": "function", "function": {
            "name": "compose_work",
            "description": "Stage a snapshot for the right-hand work canvas. Media-only or text-only works are allowed; title and publication_copy may be omitted or empty. An entirely empty work is invalid. Image works have no fixed image-count limit; video works accept one video. Snapshots are committed together on successful completion. Use only returned media handles; preserve existing fields when not asked to change them. Each changed snapshot creates a revision.",
            "parameters": ComposeWork.model_json_schema(),
        }},
    ]


class WorkToolbox:
    """Only Action receives this capability; media handles are resolved server-side."""

    def __init__(
        self, *, kind: Literal["image", "video"], user_id: str, project_id: str,
        base_url: str, current: CreativeDeliverable | None,
        image_reference: ImageReference | None,
    ):
        self.kind = kind
        self.user_id = user_id
        self.project_id = project_id
        self.base_url = base_url
        self.current = current
        self.revisions: list[CreativeDeliverable] = []
        self.composed = False
        self.media: dict[str, tuple[str, str]] = {}
        self.owned_keys: list[str] = []
        self.initial_media: list[str] = []
        self.selected_index: int | None = None
        if current:
            if kind == "image":
                pairs = [(current.image_url, current.image_material_id), *[
                    (url, current.additional_image_material_ids[i] if i < len(current.additional_image_material_ids) else "")
                    for i, url in enumerate(current.additional_image_urls)
                ]]
            else:
                pairs = [(current.video_url, current.video_material_id)]
            for url, material_id in pairs:
                if url:
                    handle = f"current:{len(self.initial_media)}"
                    self.media[handle] = (url, material_id)
                    self.initial_media.append(handle)
        if image_reference:
            if (kind != "image" or not current or image_reference.deliverable_id != current.id
                    or image_reference.index >= len(self.initial_media)):
                raise ValueError("Selected image is no longer in the current work")
            self.selected_index = image_reference.index
        self.current_media_handles = list(self.initial_media)

    def describe(self) -> dict:
        return {
            "creation_kind": self.kind,
            "current_work": self.current.model_dump(exclude={
                "image_url", "additional_image_urls", "image_material_id",
                "additional_image_material_ids", "video_url", "video_material_id",
            }) if self.current else None,
            "media_handles": list(self.current_media_handles),
            "available_media_handles": list(self.media),
            "selected_image": self.initial_media[self.selected_index] if self.selected_index is not None else None,
            "video_generation_available": False,
        }

    def add_generated_image(self, url: str, material_id: str = "") -> str:
        if self.kind != "image":
            raise ValueError("Image generation is unavailable in video creation")
        handle = f"generated:{uuid.uuid4().hex[:12]}"
        self.media[handle] = (url, material_id)
        key = media_key_from_url(url)
        if key.startswith("content-generator/"):
            self.owned_keys.append(key)
        return handle

    def import_material(self, material_id: str) -> dict:
        material = get_project_material(self.user_id, self.project_id, material_id)
        if material.media_type == "document":
            text = copy_html_to_text(read_material_document({
                "content_html": material.content_html, "object_key": material.object_key,
                "mime_type": material.mime_type,
            }))
            return {"name": material.name, "copy": text[:20_000]}
        if material.media_type != self.kind:
            raise ValueError("Material media type does not match creation type")
        ensure_material_content_available(material)
        handle = f"material:{material.id}"
        if handle not in self.media:
            organization_id = ensure_project_material_access(self.user_id, self.project_id)
            data = read_media_bytes(
                material.object_key,
                max_bytes=MAX_IMAGE_SIZE_BYTES if self.kind == "image" else MAX_VIDEO_SIZE_BYTES,
            )
            if not data:
                raise ValueError("Material file is empty")
            key = f"content-generator/{organization_id}/{self.project_id}/{uuid.uuid4().hex}_{PurePosixPath(material.object_key).name}"
            self.owned_keys.append(key)
            register_media(key)
            put_media_bytes(key, data, content_type=material.mime_type)
            self.media[handle] = (media_url(key, self.base_url), material.id)
        return {"media_id": handle, "name": material.name, "media_kind": self.kind}

    def list_materials(self, collection_id: str) -> list[dict]:
        return [
            {"id": item.id, "name": item.name, "node_type": item.node_type, "media_type": item.media_type}
            for item in list_project_materials(self.user_id, self.project_id, collection_id)
            if item.node_type == "collection" or item.media_type in {self.kind, "document"}
        ]

    def discard(self) -> None:
        for key in self.owned_keys:
            delete_media(key)
        self.owned_keys.clear()

    def discard_unused(self) -> None:
        used = {
            media_key_from_url(url)
            for work in self.revisions
            for url in [work.image_url, *work.additional_image_urls, work.video_url] if url
        }
        for key in list(self.owned_keys):
            if key not in used:
                delete_media(key)
                self.owned_keys.remove(key)

    def compose(self, arguments: dict) -> CreativeDeliverable:
        draft = ComposeWork.model_validate(arguments)
        if self.current:
            preserved = self.current.model_dump(include={
                "title", "publication_copy", "tags", "visual_prompt", "video_script", "storyboard",
            })
            changes = draft.model_dump(exclude_unset=True)
            changes.setdefault("media_ids", self.current_media_handles)
            draft = ComposeWork.model_validate({**preserved, **changes})
        if len(set(draft.media_ids)) != len(draft.media_ids):
            raise ValueError("Media handles must be unique")
        if any(handle not in self.media for handle in draft.media_ids):
            raise ValueError("Work contains an unknown media handle")
        if self.kind == "video" and len(draft.media_ids) > 1:
            raise ValueError("Video creation accepts only one video")
        if self.kind == "image" and (draft.video_script or draft.storyboard):
            raise ValueError("Image creation cannot contain a video script or storyboard")
        if self.selected_index is not None:
            if len(draft.media_ids) != len(self.initial_media) or any(
                handle != draft.media_ids[index]
                for index, handle in enumerate(self.initial_media)
                if index != self.selected_index
            ):
                raise ValueError("Only the referenced image may be replaced")
        pairs = [self.media[handle] for handle in draft.media_ids]
        work = CreativeDeliverable(
            id=uuid.uuid4().hex[:12], media_kind=self.kind,
            title=draft.title, publication_copy=draft.publication_copy, tags=draft.tags,
            image_url=pairs[0][0] if pairs and self.kind == "image" else "",
            image_material_id=pairs[0][1] if pairs and self.kind == "image" else "",
            additional_image_urls=[url for url, _ in pairs[1:]] if self.kind == "image" else [],
            additional_image_material_ids=[mid for _, mid in pairs[1:]] if self.kind == "image" else [],
            video_url=pairs[0][0] if pairs and self.kind == "video" else "",
            video_material_id=pairs[0][1] if pairs and self.kind == "video" else "",
            visual_prompt=draft.visual_prompt or (self.current.visual_prompt if self.current else ""),
            video_script=draft.video_script, storyboard=draft.storyboard,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.composed = True
        excluded = {"id", "created_at", "source_version_id"}
        if self.current:
            previous = self.current.model_dump(exclude=excluded)
            previous["additional_image_material_ids"] = [
                self.current.additional_image_material_ids[index]
                if index < len(self.current.additional_image_material_ids) else ""
                for index in range(len(self.current.additional_image_urls))
            ]
            if work.model_dump(exclude=excluded) == previous:
                return self.current
        self.current = work
        self.current_media_handles = list(draft.media_ids)
        self.revisions.append(work)
        return work
