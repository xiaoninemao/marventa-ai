from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Callable
from contextlib import closing
from datetime import datetime

from app.config import DB_PATH
from app.database import connect_database
from app.engines.publishing.models import PublicationPlan
from app.engines.publishing.project_memberships import (
    ProjectNotFound,
    ProjectPermissionDenied,
)
from app.media_storage import delete_media
from app.storage_schema import resolve_user_organization_id

_connection_factory: Callable[[], sqlite3.Connection] = lambda: connect_database(DB_PATH)
_schema_initializer: Callable[[], None] = lambda: None
_clock: Callable[[], str] = lambda: ""


def configure(
    connection_factory: Callable[[], sqlite3.Connection],
    schema_initializer: Callable[[], None],
    clock: Callable[[], str],
) -> None:
    global _connection_factory, _schema_initializer, _clock
    _connection_factory = connection_factory
    _schema_initializer = schema_initializer
    _clock = clock


def _project_access(
    conn: sqlite3.Connection,
    user_id: str,
    project_id: str,
) -> sqlite3.Row:
    organization_id = resolve_user_organization_id(conn, user_id)
    access = conn.execute("""
        SELECT project.id, membership.role
        FROM content_projects project
        JOIN project_memberships membership
          ON membership.project_id = project.id
         AND membership.user_id = ?
        WHERE project.id = ? AND project.organization_id = ?
    """, (user_id, project_id, organization_id)).fetchone()
    if access is None:
        raise ProjectNotFound("Project not found")
    return access


def _required_scope(platform: str) -> str:
    return "write_notes" if platform == "xiaohongshu" else "video.create.bind"


def _ensure_plan_mutable(conn, plan) -> None:
    if plan["status"] == "published":
        raise ValueError("Published plans cannot be edited")
    execution = conn.execute(
        "SELECT state FROM publication_executions WHERE plan_id = ?", (plan["id"],),
    ).fetchone()
    if execution is not None and execution["state"] == "running":
        raise ValueError("Publishing plans cannot be edited")


def ensure_publications_deletable(conn, project_id: str, account_id: str | None = None) -> None:
    condition = "project_id = ?"
    params = [project_id]
    if account_id is not None:
        condition += " AND channel_account_id = ?"
        params.append(account_id)
    if getattr(conn, "dialect", "") == "postgresql":
        conn.execute(
            f"SELECT id FROM project_publications WHERE {condition} ORDER BY id FOR UPDATE",
            params,
        ).fetchall()
    for plan in conn.execute(
        f"SELECT id, status FROM project_publications WHERE {condition}", params,
    ).fetchall():
        _ensure_plan_mutable(conn, plan)


def _row_to_plan(row: sqlite3.Row) -> PublicationPlan:
    scopes = json.loads(row["scopes"] or "[]")
    required_scope = _required_scope(row["platform"]) if row["platform"] else ""
    return PublicationPlan(
        id=row["id"],
        name=row["name"] or row["portfolio_title"] or "",
        media_mode=row["media_mode"],
        project_id=row["project_id"],
        project_title=row["project_title"] or "",
        portfolio_id=row["portfolio_id"],
        portfolio_title=row["portfolio_title"] or "",
        channel_account_id=row["channel_account_id"],
        platform=row["platform"] or "",
        account_name=row["account_name"] or "",
        created_by_user_id=row["created_by_user_id"],
        creator_name=row["creator_name"] or "",
        creator_avatar_url=row["creator_avatar_url"] or "",
        status="publishing" if row["execution_state"] == "running" else row["status"],
        scheduled_for=row["scheduled_for"] or "",
        published_at=row["published_at"] or "",
        platform_post_id=row["platform_post_id"] or "",
        platform_video_id=row["platform_video_id"] or "",
        last_error=row["error_message"] or "",
        outcome_unknown=bool(row["outcome_unknown"]),
        note=row["note"] or "",
        publishing_ready=row["platform"] == "douyin" and required_scope in scopes,
        missing_scope="" if required_scope in scopes else required_scope,
        has_copy=bool(row["has_copy"]),
        content_count=row["content_count"] + row["has_copy"],
        image_count=row["image_count"],
        video_count=row["video_count"],
        document_count=row["document_count"] + row["has_copy"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


_PLAN_SELECT = """
    SELECT publication.id, publication.name, publication.media_mode, publication.project_id, project.title AS project_title,
           publication.portfolio_id, portfolio.title AS portfolio_title,
           publication.channel_account_id, account.platform, account.account_name,
           account.scopes, publication.created_by_user_id,
           COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
               AS creator_name,
           COALESCE(creator.avatar_url, '') AS creator_avatar_url,
           publication.status, publication.scheduled_for, publication.note,
           execution.state AS execution_state, execution.published_at,
           execution.platform_post_id, execution.platform_video_id,
           execution.error_message, execution.outcome_unknown,
           publication.created_at, publication.updated_at,
           CASE WHEN publication.copy_text != '' THEN 1 ELSE 0 END AS has_copy,
           (SELECT COUNT(*) FROM publication_contents c WHERE c.plan_id = publication.id) AS content_count,
           (SELECT COUNT(*) FROM publication_contents c WHERE c.plan_id = publication.id AND c.media_type = 'image') AS image_count,
           (SELECT COUNT(*) FROM publication_contents c WHERE c.plan_id = publication.id AND c.media_type = 'video') AS video_count,
           (SELECT COUNT(*) FROM publication_contents c WHERE c.plan_id = publication.id AND c.media_type = 'document') AS document_count
    FROM project_publications publication
    JOIN content_projects project ON project.id = publication.project_id
    LEFT JOIN portfolio ON portfolio.id = publication.portfolio_id
    LEFT JOIN project_channel_accounts account
      ON account.id = publication.channel_account_id
     AND account.project_id = publication.project_id
    LEFT JOIN users creator ON creator.id = publication.created_by_user_id
    LEFT JOIN publication_executions execution ON execution.plan_id = publication.id
"""


def list_publication_plans(
    user_id: str,
    project_id: str = "",
) -> list[PublicationPlan]:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        organization_id = resolve_user_organization_id(conn, user_id)
        params: list[str] = [user_id, organization_id]
        condition = ""
        if project_id:
            _project_access(conn, user_id, project_id)
            condition = " AND publication.project_id = ?"
            params.append(project_id)
        rows = conn.execute(
            _PLAN_SELECT + """
            JOIN project_memberships viewer
              ON viewer.project_id = publication.project_id
             AND viewer.user_id = ?
            WHERE project.organization_id = ?
            """ + condition + """
            ORDER BY publication.created_at DESC, publication.id DESC
            """,
            params,
        ).fetchall()
        return [_row_to_plan(row) for row in rows]


def get_publication_plan(user_id: str, plan_id: str) -> PublicationPlan:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        row = conn.execute(_PLAN_SELECT + " WHERE publication.id = ?", (plan_id,)).fetchone()
        if row is None:
            raise LookupError("Publication plan not found")
        _project_access(conn, user_id, row["project_id"])
        return _row_to_plan(row)


def create_publication_plan(
    user_id: str,
    *,
    project_id: str,
    name: str = "",
    media_mode: str = "image_text",
    portfolio_id: str = "",
    channel_account_id: str = "",
    scheduled_for: str = "",
    note: str = "",
) -> PublicationPlan:
    _schema_initializer()
    if media_mode not in {"image_text", "video"}:
        raise ValueError("Publication media mode is invalid")
    normalized_schedule = scheduled_for.strip()
    if normalized_schedule:
        try:
            datetime.fromisoformat(normalized_schedule.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Scheduled time is invalid") from exc
    now = _clock()
    plan_id = uuid.uuid4().hex[:12]
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _project_access(conn, user_id, project_id)
        portfolio = conn.execute(
            """
            SELECT id, title FROM portfolio
            WHERE id = ? AND project_id = ? AND status = 'completed'
            """,
            (portfolio_id, project_id),
        ).fetchone() if portfolio_id else None
        if portfolio_id and portfolio is None:
            raise LookupError("Completed portfolio work not found")
        account = conn.execute(
            """
            SELECT id FROM project_channel_accounts
            WHERE id = ? AND project_id = ? AND authorization_status = 'active'
            """,
            (channel_account_id, project_id),
        ).fetchone() if channel_account_id else None
        if channel_account_id and account is None:
            raise LookupError("Connected channel account not found")
        normalized_name = name.strip() or (portfolio["title"] if portfolio else "")
        if not normalized_name:
            raise ValueError("Publication plan name is required")
        if normalized_schedule:
            raise ValueError("Content, account and time are required to schedule")
        conn.execute(
            """
            INSERT INTO project_publications (
                id, project_id, portfolio_id, channel_account_id,
                created_by_user_id, status, scheduled_for, note,
                created_at, updated_at, name, media_mode, copy_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
            """,
            (
                plan_id, project_id, portfolio_id, channel_account_id,
                user_id, "scheduled" if normalized_schedule else "draft",
                normalized_schedule, note.strip(), now, now, normalized_name, media_mode,
            ),
        )
        row = conn.execute(
            _PLAN_SELECT + " WHERE publication.id = ?",
            (plan_id,),
        ).fetchone()
        return _row_to_plan(row)


def validate_publication_media(
    conn, plan_id: str, media_mode: str, *,
    added_types: list[str] | None = None, scheduling: bool = False,
) -> None:
    counts = {
        row["media_type"]: row["count"] for row in conn.execute(
            "SELECT media_type, COUNT(*) AS count FROM publication_contents "
            "WHERE plan_id = ? GROUP BY media_type", (plan_id,),
        ).fetchall()
    }
    for media_type in added_types or []:
        counts[media_type] = counts.get(media_type, 0) + 1
    images, videos = counts.get("image", 0), counts.get("video", 0)
    if media_mode == "image_text":
        if videos:
            raise ValueError("Image-text mode does not support videos")
    elif media_mode == "video":
        if images:
            raise ValueError("Video mode does not support images")
        if videos > 1:
            raise ValueError("Video mode supports only one video")
        if scheduling and videos != 1:
            raise ValueError("Video mode requires one video to schedule")
    else:
        raise ValueError("Publication media mode is invalid")


def update_publication_plan(
    user_id: str,
    plan_id: str,
    *,
    name: str | None = None,
    media_mode: str | None = None,
    portfolio_id: str | None = None,
    channel_account_id: str | None = None,
    scheduled_for: str | None = None,
    note: str | None = None,
    status: str | None = None,
) -> PublicationPlan:
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        if getattr(conn, "dialect", "") == "postgresql":
            conn.execute("SELECT id FROM project_publications WHERE id = ? FOR UPDATE", (plan_id,))
        existing = conn.execute(
            "SELECT * FROM project_publications WHERE id = ?",
            (plan_id,),
        ).fetchone()
        if existing is None:
            raise LookupError("Publication plan not found")
        access = _project_access(conn, user_id, existing["project_id"])
        if existing["created_by_user_id"] != user_id and access["role"] not in {
            "owner", "admin",
        }:
            raise ProjectPermissionDenied(
                "Only the plan creator and project managers can update publication plans",
            )
        _ensure_plan_mutable(conn, existing)
        changes = {
            key: value.strip()
            for key, value in {
                "name": name, "portfolio_id": portfolio_id, "media_mode": media_mode,
                "channel_account_id": channel_account_id,
                "scheduled_for": scheduled_for, "note": note, "status": status,
            }.items() if value is not None
        }
        if not changes:
            raise ValueError("At least one publication field is required")
        if "name" in changes and not changes["name"]:
            raise ValueError("Publication plan name is required")
        if "name" in changes and len(changes["name"]) > 120:
            raise ValueError("Publication plan name must be at most 120 characters")
        if "note" in changes and len(changes["note"]) > 500:
            raise ValueError("Publication note must be at most 500 characters")
        if status is not None and status not in {"draft", "scheduled", "cancelled"}:
            raise ValueError("Publication status is invalid")
        schedule = changes.get("scheduled_for", existing["scheduled_for"])
        if schedule:
            try:
                datetime.fromisoformat(schedule.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError("Scheduled time is invalid") from exc
        if status is None and scheduled_for is not None and existing["status"] in {"draft", "scheduled", "cancelled", "failed"}:
            changes["status"] = "scheduled" if schedule else "draft"
        effective_status = changes.get("status", existing["status"])
        if media_mode is not None or effective_status == "scheduled":
            validate_publication_media(
                conn, plan_id, changes.get("media_mode", existing["media_mode"]),
                scheduling=effective_status == "scheduled",
            )
        work_id = changes.get("portfolio_id", existing["portfolio_id"])
        account_id = changes.get("channel_account_id", existing["channel_account_id"])
        if work_id and portfolio_id is not None:
            work = conn.execute(
                "SELECT id FROM portfolio WHERE id = ? AND project_id = ? AND status = 'completed'",
                (work_id, existing["project_id"]),
            ).fetchone()
            if work is None:
                raise LookupError("Completed portfolio work not found")
        if account_id and (channel_account_id is not None or effective_status == "scheduled"):
            account = conn.execute(
                "SELECT id FROM project_channel_accounts "
                "WHERE id = ? AND project_id = ? AND authorization_status = 'active'",
                (account_id, existing["project_id"]),
            ).fetchone()
            if account is None:
                raise LookupError("Connected channel account not found")
        has_content = conn.execute(
            "SELECT 1 FROM publication_contents WHERE plan_id = ? LIMIT 1", (plan_id,),
        ).fetchone()
        if effective_status == "scheduled" and not (
            (has_content or existing["copy_text"]) and account_id and schedule
        ):
            raise ValueError("Content, account and time are required to schedule")
        updates = [f"{key} = ?" for key in changes]
        values = list(changes.values())
        updates.append("updated_at = ?")
        values.extend((_clock(), plan_id))
        conn.execute(
            f"UPDATE project_publications SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        row = conn.execute(
            _PLAN_SELECT + " WHERE publication.id = ?",
            (plan_id,),
        ).fetchone()
        return _row_to_plan(row)


def delete_publication_plan(user_id: str, plan_id: str) -> None:
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        if getattr(conn, "dialect", "") == "postgresql":
            conn.execute("SELECT id FROM project_publications WHERE id = ? FOR UPDATE", (plan_id,))
        existing = conn.execute(
            "SELECT id, project_id, created_by_user_id, status FROM project_publications WHERE id = ?",
            (plan_id,),
        ).fetchone()
        if existing is None:
            raise LookupError("Publication plan not found")
        access = _project_access(conn, user_id, existing["project_id"])
        if existing["created_by_user_id"] != user_id and access["role"] not in {
            "owner", "admin",
        }:
            raise ProjectPermissionDenied(
                "Only the plan creator and project managers can delete publication plans",
            )
        _ensure_plan_mutable(conn, existing)
        keys = [
            row["object_key"] for row in conn.execute(
                "SELECT object_key FROM publication_contents WHERE plan_id = ? AND object_key != ''",
                (plan_id,),
            ).fetchall()
        ]
        conn.execute("DELETE FROM project_publications WHERE id = ?", (plan_id,))
    for key in keys:
        delete_media(key)
