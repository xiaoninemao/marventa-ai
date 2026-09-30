from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import closing

from app.config import MAX_IMAGE_SIZE_BYTES, MAX_UPLOAD_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES
from app.engines.publishing import publication_plans as plans
from app.engines.publishing.document_copy import parse_document_copy
from app.engines.publishing.material_copy import (
    DOCUMENT_CONTENT_TYPES,
    sanitize_copy_html,
    validate_copy_text,
)
from app.engines.publishing.models import PublicationContent, PublicationCopy
from app.engines.publishing.project_memberships import ProjectPermissionDenied
from app.media_storage import (
    delete_media,
    guess_content_type,
    media_exists,
    put_media_bytes,
    read_media_bytes,
)
from app.storage_schema import resolve_user_organization_id

logger = logging.getLogger(__name__)
_CONTENT_SELECT = (
    "SELECT id, plan_id, position, name, media_type, mime_type, object_key, source_material_id, "
    "created_at, updated_at FROM publication_contents"
)


def _access(conn, user_id: str, plan_id: str, *, edit: bool = False):
    if edit and getattr(conn, "dialect", "") == "postgresql":
        conn.execute("SELECT id FROM project_publications WHERE id = ? FOR UPDATE", (plan_id,))
    plan = conn.execute("SELECT * FROM project_publications WHERE id = ?", (plan_id,)).fetchone()
    if plan is None:
        raise LookupError("Publication plan not found")
    access = plans._project_access(conn, user_id, plan["project_id"])
    if edit:
        if plan["created_by_user_id"] != user_id and access["role"] not in {"owner", "admin"}:
            raise ProjectPermissionDenied(
                "Only the plan creator and project managers can update publication plans",
            )
        plans._ensure_plan_mutable(conn, plan)
    return plan


def ensure_content_edit_access(user_id: str, plan_id: str) -> None:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _access(conn, user_id, plan_id, edit=True)


def get_publication_copy(user_id: str, plan_id: str) -> PublicationCopy:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn:
        plan = _access(conn, user_id, plan_id)
        return PublicationCopy(
            title=plan["copy_title"], content=plan["copy_text"], tags=json.loads(plan["copy_tags"]),
        )


def _demote_empty_scheduled_plan(conn, plan_id: str) -> None:
    conn.execute(
        "UPDATE project_publications SET status = 'draft', scheduled_for = '' "
        "WHERE id = ? AND status = 'scheduled' AND ("
        "(media_mode = 'image_text' AND copy_text = '' "
        "AND NOT EXISTS (SELECT 1 FROM publication_contents WHERE plan_id = ?)) OR "
        "(media_mode = 'video' AND NOT EXISTS (SELECT 1 FROM publication_contents "
        "WHERE plan_id = ? AND media_type = 'video')))",
        (plan_id, plan_id, plan_id),
    )


def update_publication_copy(
    user_id: str, plan_id: str, *, title: str, content: str, tags: list[str] | None = None,
) -> PublicationCopy:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        plan = _access(conn, user_id, plan_id, edit=True)
        copy = PublicationCopy(
            title=title.strip(), content=validate_copy_text(content),
            tags=json.loads(plan["copy_tags"]) if tags is None else tags,
        )
        conn.execute(
            "UPDATE project_publications SET copy_title = ?, copy_text = ?, copy_tags = ?, updated_at = ? "
            "WHERE id = ?",
            (copy.title, copy.content, json.dumps(copy.tags, ensure_ascii=False), plans._clock(), plan_id),
        )
        _demote_empty_scheduled_plan(conn, plan_id)
    return copy


def list_publication_contents(user_id: str, plan_id: str) -> list[PublicationContent]:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn:
        _access(conn, user_id, plan_id)
        return [
            PublicationContent(**dict(row)) for row in conn.execute(
                _CONTENT_SELECT + " WHERE plan_id = ? ORDER BY position, id", (plan_id,),
            ).fetchall()
        ]


def _insert_content(
    conn, plan_id: str, *, name: str, media_type: str, mime_type: str,
    object_key: str = "", content_html: str | None = None, source_material_id: str = "",
) -> PublicationContent:
    content_id, now = uuid.uuid4().hex, plans._clock()
    position = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_position "
        "FROM publication_contents WHERE plan_id = ?", (plan_id,),
    ).fetchone()["next_position"]
    conn.execute(
        "INSERT INTO publication_contents "
        "(id, plan_id, name, media_type, mime_type, object_key, content_html, "
        "source_material_id, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (content_id, plan_id, name, media_type, mime_type, object_key, content_html,
         source_material_id, now, now, position),
    )
    conn.execute("UPDATE project_publications SET updated_at = ? WHERE id = ?", (now, plan_id))
    row = conn.execute(_CONTENT_SELECT + " WHERE id = ?", (content_id,)).fetchone()
    return PublicationContent(**dict(row))


def _owned_key(conn, user_id: str, plan, filename: str) -> str:
    organization_id = resolve_user_organization_id(conn, user_id)
    extension = os.path.splitext(filename)[1].lower()
    return (
        f"publishing/{organization_id}/{plan['project_id']}/publications/"
        f"{plan['id']}/{uuid.uuid4().hex}{extension}"
    )


def _cleanup(keys: list[str]) -> None:
    for key in keys:
        try:
            delete_media(key)
        except Exception:
            logger.exception("Failed to clean publication content media %s", key)


def upload_publication_content(
    user_id: str, plan_id: str, *, filename: str, media_type: str, data: bytes,
) -> PublicationContent:
    plans._schema_initializer()
    keys: list[str] = []
    try:
        with closing(plans._connection_factory()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            plan = _access(conn, user_id, plan_id, edit=True)
            plans.validate_publication_media(
                conn, plan_id, plan["media_mode"], added_types=[media_type],
            )
            html = None
            key = ""
            mime = guess_content_type(filename)
            if media_type == "document":
                html = parse_document_copy(data, os.path.splitext(filename)[1])
                mime = "text/html"
            else:
                key = _owned_key(conn, user_id, plan, filename)
                keys.append(key)
                put_media_bytes(key, data, content_type=mime)
            result = _insert_content(
                conn, plan_id, name=filename, media_type=media_type,
                mime_type=mime, object_key=key, content_html=html,
            )
        return result
    except Exception:
        _cleanup(keys)
        raise


def _document_snapshot(material) -> str:
    if material["content_html"] is not None:
        return sanitize_copy_html(material["content_html"])
    key = material["object_key"]
    if not key or not media_exists(key):
        raise LookupError("Material content not found")
    data = read_media_bytes(key, max_bytes=MAX_UPLOAD_SIZE_BYTES)
    if material["mime_type"] == "text/html":
        try:
            return sanitize_copy_html(data.decode("utf-8-sig"))
        except UnicodeDecodeError as exc:
            raise ValueError("Material content is not UTF-8 text") from exc
    extension = os.path.splitext(key)[1].lower()
    if extension not in DOCUMENT_CONTENT_TYPES:
        extension = {mime: suffix for suffix, mime in DOCUMENT_CONTENT_TYPES.items()}.get(
            material["mime_type"], "",
        )
        if material["mime_type"] == "text/x-markdown":
            extension = ".md"
    return parse_document_copy(data, extension)


def import_publication_materials(
    user_id: str, plan_id: str, material_ids: list[str],
) -> list[PublicationContent]:
    if not 1 <= len(material_ids) <= 10:
        raise ValueError("Select between 1 and 10 materials")
    if len(set(material_ids)) != len(material_ids):
        raise ValueError("Material already added to this plan")
    plans._schema_initializer()
    keys: list[str] = []
    result: list[PublicationContent] = []
    try:
        with closing(plans._connection_factory()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            plan = _access(conn, user_id, plan_id, edit=True)
            materials = []
            for material_id in material_ids:
                material = conn.execute(
                    "SELECT * FROM project_materials WHERE id = ? AND project_id = ?",
                    (material_id, plan["project_id"]),
                ).fetchone()
                if material is None:
                    raise LookupError("Project material not found")
                if material["node_type"] != "file":
                    raise ValueError("Select material files, not collections")
                if conn.execute(
                    "SELECT 1 FROM publication_contents WHERE plan_id = ? AND source_material_id = ?",
                    (plan_id, material_id),
                ).fetchone():
                    raise ValueError("Material already added to this plan")
                materials.append(material)
            plans.validate_publication_media(
                conn, plan_id, plan["media_mode"],
                added_types=[material["media_type"] for material in materials],
            )
            for material in materials:
                key, html, mime = "", None, material["mime_type"]
                if material["media_type"] == "document":
                    html, mime = _document_snapshot(material), "text/html"
                else:
                    source_key = material["object_key"]
                    if not source_key or not media_exists(source_key):
                        raise LookupError("Material content not found")
                    limit = MAX_IMAGE_SIZE_BYTES if material["media_type"] == "image" else MAX_VIDEO_SIZE_BYTES
                    data = read_media_bytes(source_key, max_bytes=limit)
                    if not data:
                        raise ValueError("Material file is empty")
                    key = _owned_key(conn, user_id, plan, source_key)
                    keys.append(key)
                    put_media_bytes(key, data, content_type=mime)
                result.append(_insert_content(
                    conn, plan_id, name=material["name"], media_type=material["media_type"],
                    mime_type=mime, object_key=key, content_html=html,
                    source_material_id=material["id"],
                ))
        return result
    except Exception:
        _cleanup(keys)
        raise


def reorder_publication_images(
    user_id: str, plan_id: str, content_ids: list[str],
) -> list[PublicationContent]:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        plan = _access(conn, user_id, plan_id, edit=True)
        if plan["media_mode"] != "image_text":
            raise ValueError("Image ordering is only available in image-text mode")
        images = conn.execute(
            "SELECT id, position FROM publication_contents "
            "WHERE plan_id = ? AND media_type = 'image' ORDER BY position, id", (plan_id,),
        ).fetchall()
        if (
            len(content_ids) != len(set(content_ids))
            or set(content_ids) != {image["id"] for image in images}
        ):
            raise ValueError("Image order must include every current image exactly once")
        for content_id, image in zip(content_ids, images, strict=True):
            conn.execute(
                "UPDATE publication_contents SET position = ? WHERE id = ? AND plan_id = ?",
                (image["position"], content_id, plan_id),
            )
        conn.execute(
            "UPDATE project_publications SET updated_at = ? WHERE id = ?", (plans._clock(), plan_id),
        )
        result = [
            PublicationContent(**dict(row)) for row in conn.execute(
                _CONTENT_SELECT + " WHERE plan_id = ? ORDER BY position, id", (plan_id,),
            ).fetchall()
        ]
    return result


def get_publication_document(user_id: str, plan_id: str, content_id: str) -> str:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn:
        _access(conn, user_id, plan_id)
        row = conn.execute(
            "SELECT media_type, content_html FROM publication_contents WHERE id = ? AND plan_id = ?",
            (content_id, plan_id),
        ).fetchone()
        if row is None:
            raise LookupError("Publication content not found")
        if row["media_type"] != "document":
            raise ValueError("Publication content does not support text preview")
        return sanitize_copy_html(row["content_html"])


def delete_publication_content(user_id: str, plan_id: str, content_id: str) -> None:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _access(conn, user_id, plan_id, edit=True)
        row = conn.execute(
            "SELECT object_key FROM publication_contents WHERE id = ? AND plan_id = ?",
            (content_id, plan_id),
        ).fetchone()
        if row is None:
            raise LookupError("Publication content not found")
        conn.execute("DELETE FROM publication_contents WHERE id = ? AND plan_id = ?", (content_id, plan_id))
        conn.execute("UPDATE project_publications SET updated_at = ? WHERE id = ?", (plans._clock(), plan_id))
        _demote_empty_scheduled_plan(conn, plan_id)
    if row["object_key"]:
        delete_media(row["object_key"])
