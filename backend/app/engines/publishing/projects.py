from __future__ import annotations

import json
import secrets
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from typing import Any, Callable

from app.config import DB_PATH
from app.database import connect_database
from app.engines.content_generator.models import ContentCard
from app.engines.content_generator.storage import get_session
from app.engines.publishing.models import ContentProject
from app.engines.publishing.project_memberships import (
    ProjectNotFound,
    attach_project_members,
    project_manager_access,
)
from app.engines.publishing.publication_plans import ensure_publications_deletable
from app.storage_schema import resolve_user_organization_id


PROJECT_AVATAR_COLORS = {
    "#bfdbfe", "#93c5fd", "#a5b4fc", "#c7d2fe", "#ddd6fe", "#e9d5ff",
    "#f5d0fe", "#fbcfe8", "#fecdd3", "#bbf7d0", "#a7f3d0", "#fde68a",
    "#fcd34d", "#fed7aa", "#fdba74", "#fecaca", "#e5e7eb", "#d1d5db",
}
PROJECT_AVATAR_ICONS = {
    "🎯", "🚀", "💡", "📣", "📈", "📊", "🧠", "✨", "📝",
    "🎨", "📷", "🎬", "🎙️", "🛍️", "🏷️", "📅", "💬", "🤝",
    "🌐", "🧪", "🧭", "💎", "🏆", "🚩", "🔥", "💰", "⭐",
}


class ProjectNameExists(ValueError):
    pass


_connection_factory: Callable[[], sqlite3.Connection] = lambda: connect_database(DB_PATH)
_schema_initializer: Callable[[], None] = lambda: None
_clock: Callable[[], str] = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def configure(
    connection_factory: Callable[[], sqlite3.Connection],
    schema_initializer: Callable[[], None],
    clock: Callable[[], str],
) -> None:
    global _connection_factory, _schema_initializer, _clock
    _connection_factory = connection_factory
    _schema_initializer = schema_initializer
    _clock = clock


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load_json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return default


def _cards_json(cards: list[ContentCard]) -> str:
    return _json([card.model_dump() for card in cards])


def _snapshot_from_cards(
    cards: list[ContentCard], source_title: str = "",
) -> dict[str, Any]:
    def pick(card_type: str) -> ContentCard | None:
        return next((card for card in cards if card.card_type == card_type), None)

    title = pick("title")
    body = pick("copy")
    cover = pick("visual")
    tags = pick("hashtags")
    script = pick("script")
    return {
        "source_title": source_title,
        "title": title.title if title else (cards[0].title if cards else ""),
        "body": body.content if body else "",
        "cover_text": cover.preview if cover else "",
        "tags": tags.content if tags else "",
        "layout": cover.content if cover else "",
        "script": script.content if script else "",
        "selected_card_ids": {},
    }


def _random_project_avatar() -> tuple[str, str]:
    return (
        secrets.choice(sorted(PROJECT_AVATAR_COLORS)),
        secrets.choice(sorted(PROJECT_AVATAR_ICONS)),
    )


def _ensure_project_name_available(
    conn: sqlite3.Connection,
    user_id: str,
    title: str,
    exclude_project_id: str = "",
    creator_user_id: str | None = None,
) -> None:
    organization_id = resolve_user_organization_id(conn, user_id)
    scoped_creator_id = creator_user_id or user_id
    existing = conn.execute(
        "SELECT 1 FROM content_projects "
        "WHERE organization_id = ? AND user_id = ? AND lower(trim(title)) = lower(?) "
        "AND id != ? LIMIT 1",
        (organization_id, scoped_creator_id, title, exclude_project_id),
    ).fetchone()
    if existing:
        raise ProjectNameExists("Project name already exists")


def create_project_from_session(
    user_id: str,
    source_session_id: str,
    title: str = "",
    xhs_account: str = "",
    source_card_id: str = "",
    content_type: str = "mixed",
    platform_hint: str = "",
    notes: str = "",
) -> ContentProject:
    _schema_initializer()
    session = get_session(source_session_id, user_id)
    if not session or session.user_id != user_id:
        raise ValueError("Session not found")
    now = _clock()
    project_id = uuid.uuid4().hex[:12]
    snapshot = _snapshot_from_cards(session.cards, source_title=session.title)
    project_title = title.strip() or session.title.strip() or "Untitled content project"
    avatar_color, avatar_icon = _random_project_avatar()
    conn = _connection_factory()
    try:
        conn.execute("BEGIN IMMEDIATE")
        _ensure_project_name_available(conn, user_id, project_title)
        conn.execute(
            """
            INSERT INTO content_projects (
                id, user_id, title, xhs_account, source_session_id, source_card_id,
                content_type, platform_hint, cards_snapshot, final_snapshot, notes,
                status, created_at, updated_at, avatar_color, avatar_icon
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id, user_id, project_title, xhs_account,
                source_session_id, source_card_id, content_type, platform_hint,
                _cards_json(session.cards), _json(snapshot), notes, "active", now, now,
                avatar_color, avatar_icon,
            ),
        )
        conn.execute(
            "INSERT INTO project_memberships VALUES (?, ?, 'owner', ?)",
            (project_id, user_id, now),
        )
        conn.commit()
    finally:
        conn.close()
    return get_project(project_id)  # type: ignore[return-value]


def create_manual_project(
    user_id: str,
    title: str,
    final_snapshot: dict[str, Any] | None = None,
    xhs_account: str = "",
    content_type: str = "mixed",
    platform_hint: str = "",
    notes: str = "",
) -> ContentProject:
    _schema_initializer()
    now = _clock()
    project_id = uuid.uuid4().hex[:12]
    snapshot = final_snapshot or {}
    project_title = title.strip() or str(snapshot.get("title") or "").strip() or "Manual content project"
    avatar_color, avatar_icon = _random_project_avatar()
    conn = _connection_factory()
    try:
        conn.execute("BEGIN IMMEDIATE")
        _ensure_project_name_available(conn, user_id, project_title)
        conn.execute(
            """
            INSERT INTO content_projects (
                id, user_id, title, xhs_account, source_session_id, source_card_id,
                content_type, platform_hint, cards_snapshot, final_snapshot, notes,
                status, created_at, updated_at, avatar_color, avatar_icon
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id, user_id, project_title,
                xhs_account, "", "", content_type, platform_hint, "[]", _json(snapshot),
                notes, "active", now, now, avatar_color, avatar_icon,
            ),
        )
        conn.execute(
            "INSERT INTO project_memberships VALUES (?, ?, 'owner', ?)",
            (project_id, user_id, now),
        )
        conn.commit()
    finally:
        conn.close()
    return get_project(project_id)  # type: ignore[return-value]


def list_projects(user_id: str, xhs_account: str = "") -> list[ContentProject]:
    _schema_initializer()
    conn = _connection_factory()
    organization_id = resolve_user_organization_id(conn, user_id)
    if xhs_account:
        rows = conn.execute(
            "SELECT p.*, pm.role FROM content_projects p "
            "JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ? "
            "WHERE p.organization_id = ? AND p.xhs_account = ? "
            "ORDER BY p.updated_at DESC, p.id DESC LIMIT 200",
            (user_id, organization_id, xhs_account),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT p.*, pm.role FROM content_projects p "
            "JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ? "
            "WHERE p.organization_id = ? "
            "ORDER BY p.updated_at DESC, p.id DESC LIMIT 200",
            (user_id, organization_id),
        ).fetchall()
    projects = [_row_to_project(row) for row in rows]
    attach_project_members(conn, projects)
    conn.close()
    return projects


def get_project(project_id: str, user_id: str | None = None) -> ContentProject | None:
    _schema_initializer()
    conn = _connection_factory()
    if user_id is None:
        row = conn.execute(
            "SELECT p.*, 'owner' AS role FROM content_projects p WHERE p.id = ?", (project_id,),
        ).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT p.*, pm.role FROM content_projects p "
            "JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ? "
            "WHERE p.id = ? AND p.organization_id = ?",
            (user_id, project_id, organization_id),
        ).fetchone()
    project = _row_to_project(row) if row else None
    if project:
        attach_project_members(conn, [project])
    conn.close()
    return project


def update_project(
    user_id: str,
    project_id: str,
    title: str | None = None,
    notes: str | None = None,
    avatar_color: str | None = None,
    avatar_icon: str | None = None,
) -> ContentProject:
    if title is None and notes is None and avatar_color is None and avatar_icon is None:
        raise ValueError("At least one project field is required")
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project = project_manager_access(conn, user_id, project_id)
        updates: list[str] = []
        values: list[Any] = []
        if title is not None:
            normalized_title = title.strip()
            if not normalized_title:
                raise ValueError("Project name is required")
            _ensure_project_name_available(
                conn,
                user_id,
                normalized_title,
                exclude_project_id=project_id,
                creator_user_id=project["user_id"],
            )
            updates.append("title = ?")
            values.append(normalized_title)
        if notes is not None:
            updates.append("notes = ?")
            values.append(notes.strip())
        if avatar_color is not None:
            normalized_color = avatar_color.strip().lower()
            if normalized_color not in PROJECT_AVATAR_COLORS:
                raise ValueError("Unsupported project avatar color")
            updates.append("avatar_color = ?")
            values.append(normalized_color)
        if avatar_icon is not None:
            normalized_icon = avatar_icon.strip()
            if normalized_icon not in PROJECT_AVATAR_ICONS:
                raise ValueError("Unsupported project avatar icon")
            updates.append("avatar_icon = ?")
            values.append(normalized_icon)
        updates.append("updated_at = ?")
        values.append(_clock())
        values.append(project_id)
        conn.execute(
            f"UPDATE content_projects SET {', '.join(updates)} WHERE id = ?",
            values,
        )
    updated = get_project(project_id, user_id)
    if updated is None:
        raise ProjectNotFound("Project not found")
    return updated


def delete_project(user_id: str, project_id: str) -> list[str]:
    _schema_initializer()
    case_media: list[str] = []
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project_manager_access(conn, user_id, project_id)
        ensure_publications_deletable(conn, project_id)
        conn.execute(
            "UPDATE publish_tasks SET project_id = '' WHERE project_id = ?",
            (project_id,),
        )
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'insights'",
        ).fetchone():
            insight_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(insights)").fetchall()
            }
            if "source_file_path" in insight_columns:
                case_media.extend(
                    row["source_file_path"]
                    for row in conn.execute(
                        "SELECT source_file_path FROM insights WHERE project_id = ? "
                        "AND source_file_path != ''",
                        (project_id,),
                    ).fetchall()
                )
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'insight_sources'",
            ).fetchone():
                case_media.extend(
                    row["source_file_path"]
                    for row in conn.execute("""
                        SELECT s.source_file_path
                        FROM insight_sources s
                        JOIN insights i ON i.id = s.insight_id
                        WHERE i.project_id = ? AND s.source_file_path != ''
                    """, (project_id,)).fetchall()
                )
            conn.execute("DELETE FROM insights WHERE project_id = ?", (project_id,))
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cases'",
        ).fetchone():
            for row in conn.execute(
                "SELECT video_url, image_urls FROM cases WHERE project_id = ?",
                (project_id,),
            ).fetchall():
                if row["video_url"]:
                    case_media.append(row["video_url"])
                try:
                    case_media.extend(json.loads(row["image_urls"] or "[]"))
                except (json.JSONDecodeError, TypeError):
                    pass
        for table in ("cases", "content_versions", "creation_sessions", "portfolio"):
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
            ).fetchone():
                continue
            if table == "content_versions":
                conn.execute("""
                    DELETE FROM content_versions
                    WHERE session_id IN (
                        SELECT id FROM creation_sessions WHERE project_id = ?
                    )
                """, (project_id,))
            else:
                conn.execute(f"DELETE FROM {table} WHERE project_id = ?", (project_id,))
        conn.execute(
            "DELETE FROM project_memberships WHERE project_id = ?",
            (project_id,),
        )
        conn.execute("DELETE FROM content_projects WHERE id = ?", (project_id,))
    return case_media


def _row_to_project(row: sqlite3.Row) -> ContentProject:
    cards = [ContentCard(**card) for card in _load_json(row["cards_snapshot"], [])]
    return ContentProject(
        id=row["id"], user_id=row["user_id"], title=row["title"],
        xhs_account=row["xhs_account"] or "", source_session_id=row["source_session_id"],
        source_card_id=row["source_card_id"] or "", content_type=row["content_type"] or "mixed",
        platform_hint=row["platform_hint"] or "", cards_snapshot=cards,
        final_snapshot=_load_json(row["final_snapshot"], {}), notes=row["notes"] or "",
        status=row["status"] or "active",
        role=row["role"] if "role" in row.keys() else "owner",
        avatar_color=row["avatar_color"] or "#bfdbfe",
        avatar_icon=row["avatar_icon"] or "💡",
        created_at=row["created_at"], updated_at=row["updated_at"],
    )
