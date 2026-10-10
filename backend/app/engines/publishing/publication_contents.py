from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import closing

from app.config import MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES
from app.engines.publishing import publication_plans as plans
from app.engines.publishing.models import PublicationContent, PublicationCopy
from app.engines.publishing.project_memberships import ProjectPermissionDenied
from app.media_storage import delete_media, put_media_bytes, read_media_bytes
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


def get_publication_copy(user_id: str, plan_id: str) -> PublicationCopy:
    plans._schema_initializer()
    with closing(plans._connection_factory()) as conn:
        plan = _access(conn, user_id, plan_id)
        return PublicationCopy(
            title=plan["copy_title"], content=plan["copy_text"], tags=json.loads(plan["copy_tags"]),
        )


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
    conn, plan_id: str, *, name: str, media_type: str, mime_type: str, object_key: str,
) -> PublicationContent:
    content_id, now = uuid.uuid4().hex, plans._clock()
    position = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_position "
        "FROM publication_contents WHERE plan_id = ?", (plan_id,),
    ).fetchone()["next_position"]
    conn.execute(
        "INSERT INTO publication_contents "
        "(id, plan_id, name, media_type, mime_type, object_key, "
        "created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (content_id, plan_id, name, media_type, mime_type, object_key, now, now, position),
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


def import_portfolio_work(conn, user_id: str, plan_id: str, portfolio) -> None:
    from app.engines.portfolio.models import PortfolioMedia

    plan = _access(conn, user_id, plan_id, edit=True)
    expected_kind = "video" if plan["media_mode"] == "video" else "image"
    if portfolio["media_kind"] != expected_kind:
        raise ValueError("Portfolio media type does not match publication mode")
    media = [PortfolioMedia.model_validate(item) for item in json.loads(portfolio["media"])]
    plans.validate_publication_media(conn, plan_id, plan["media_mode"], added_types=[item.media_type for item in media])
    copy = PublicationCopy(
        title=portfolio["title"], content=portfolio["content"], tags=json.loads(portfolio["tags"]),
    )
    owned = []
    try:
        for item in media:
            data = read_media_bytes(
                item.object_key, max_bytes=MAX_VIDEO_SIZE_BYTES if item.media_type == "video" else MAX_IMAGE_SIZE_BYTES,
            )
            key = _owned_key(conn, user_id, plan, item.object_key)
            owned.append(key)
            put_media_bytes(key, data, content_type=item.mime_type)
            _insert_content(conn, plan_id, name=item.name, media_type=item.media_type,
                            mime_type=item.mime_type, object_key=key)
        conn.execute(
            "UPDATE project_publications SET copy_title = ?, copy_text = ?, copy_tags = ? WHERE id = ?",
            (copy.title, copy.content, json.dumps(copy.tags, ensure_ascii=False), plan_id),
        )
    except Exception:
        _cleanup(owned)
        raise
