from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import BinaryIO, Literal

from app.config import DB_PATH
from app.database import connect_database, is_postgresql
from app.engines.content_generator.models import CreativeDeliverable
from app.engines.portfolio.models import (
    PortfolioMedia,
    ScriptDocument,
    ScriptEdit,
)
from app.media_storage import (
    delete_media,
    guess_content_type,
    media_key_from_url,
    put_media_bytes,
    read_media_bytes,
    validate_work_media,
)
from app.storage_schema import (
    ensure_json_columns,
    ensure_organization_scope,
    ensure_project_scope,
    resolve_user_organization_id,
)

logger = logging.getLogger(__name__)


def _document(row: sqlite3.Row) -> ScriptDocument:
    data = dict(row)
    data["media_kind"] = data.get("media_kind") or None
    data["media"] = json.loads(data.get("media") or "[]")
    # Legacy completion means the record was saved, not that it contains media.
    if data.get("status") == "completed" and not data["media"]:
        data["status"] = "draft"
    data["tags"] = json.loads(data.get("tags") or "[]")
    return ScriptDocument.model_validate(data)

def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            source_session_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)
    ensure_organization_scope(conn, "portfolio", "user_id")
    cols = [row[1] for row in conn.execute("PRAGMA table_info(portfolio)").fetchall()]
    if "name" not in cols:
        conn.execute("ALTER TABLE portfolio ADD COLUMN name TEXT NOT NULL DEFAULT ''")
        conn.execute("UPDATE portfolio SET name = title")
    if "project_id" not in cols:
        conn.execute("ALTER TABLE portfolio ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
    if "status" not in cols:
        conn.execute("ALTER TABLE portfolio ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'")
    for column, default in (("media", "'[]'"), ("tags", "'[]'"), ("media_kind", "''"), ("source_version_id", "''")):
        if column not in cols:
            conn.execute(f"ALTER TABLE portfolio ADD COLUMN {column} TEXT NOT NULL DEFAULT {default}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_source_version "
        "ON portfolio(source_session_id, source_version_id) WHERE source_version_id != ''"
    )
    conn.execute("UPDATE portfolio SET status = 'completed' WHERE status = ''")
    if all(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
    ).fetchone() for table in ("creation_sessions", "content_projects", "project_memberships")):
        conn.execute("""
            UPDATE portfolio
            SET project_id = COALESCE(
                (SELECT session.project_id FROM creation_sessions session
                 WHERE session.id = portfolio.source_session_id AND session.project_id != ''),
                (SELECT pm.project_id
                 FROM project_memberships pm
                 JOIN content_projects p ON p.id = pm.project_id
                 WHERE pm.user_id = portfolio.user_id
                   AND p.organization_id = portfolio.organization_id
                 ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                          pm.created_at, pm.project_id
                 LIMIT 1),
                ''
            )
            WHERE project_id = ''
        """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_portfolio_project_updated "
        "ON portfolio(project_id, updated_at DESC)"
    )
    ensure_project_scope(conn, "portfolio")
    ensure_json_columns(conn, "portfolio", ("media", "tags"))
    conn.commit()
    conn.close()


def create_script(
    user_id: str, title: str, content: str,
    source_session_id: str = "", project_id: str = "", status: str = "completed",
    media_kind: Literal["image", "video"] | None = None,
    name: str | None = None,
) -> ScriptDocument:
    init_db()
    conn = _get_conn()
    sid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    content = content or ""
    work_name = title if name is None else name
    organization_id = ""
    if not project_id and source_session_id:
        session = conn.execute(
            "SELECT project_id FROM creation_sessions WHERE id = ? AND user_id = ?",
            (source_session_id, user_id),
        ).fetchone()
        project_id = session["project_id"] if session else ""
    if project_id:
        organization_id = resolve_user_organization_id(conn, user_id)
        access = conn.execute("""
            SELECT p.title, pm.role FROM content_projects p
            JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
            WHERE p.id = ? AND p.organization_id = ?
        """, (user_id, project_id, organization_id)).fetchone()
        if access is None:
            conn.close()
            raise ValueError("Project not found or access denied")
    elif conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_projects'",
    ).fetchone():
        conn.close()
        raise ValueError("Project is required")
    conn.execute(
        "INSERT INTO portfolio (id, user_id, project_id, name, title, content, source_session_id, status, created_at, updated_at, organization_id, media_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, project_id, work_name, title, content, source_session_id, status, now, now, organization_id, media_kind or ""),
    )
    conn.commit()
    conn.close()
    return ScriptDocument(
        id=sid, name=work_name, user_id=user_id, project_id=project_id, title=title, content=content,
        source_session_id=source_session_id, project_title=access["title"] if project_id else "",
        project_role=access["role"] if project_id else "owner",
        status="draft" if status == "completed" else status, created_at=now, updated_at=now, media_kind=media_kind,
    )


def get_script(script_id: str, user_id: str | None = None) -> ScriptDocument | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
        ).fetchone():
            row = conn.execute("""
                SELECT script.*, p.title AS project_title, pm.role AS project_role,
                       COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name
                FROM portfolio script
                LEFT JOIN users creator ON creator.id = script.user_id
                JOIN project_memberships pm ON pm.project_id = script.project_id AND pm.user_id = ?
                JOIN content_projects p ON p.id = script.project_id
                WHERE script.id = ? AND script.organization_id = ?
            """, (user_id, script_id, organization_id)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM portfolio WHERE id = ? AND organization_id = ?",
                (script_id, organization_id),
            ).fetchone()
    conn.close()
    if not row:
        return None
    return _document(row)


def list_scripts(user_id: str, project_id: str = "") -> list[ScriptDocument]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
    ).fetchone():
        rows = conn.execute(
            "SELECT * FROM portfolio WHERE organization_id = ? "
            "ORDER BY updated_at DESC, id DESC LIMIT 200",
            (organization_id,),
        ).fetchall()
        conn.close()
        return [_document(row) for row in rows]
    project_clause = " AND script.project_id = ?" if project_id else ""
    params = [user_id, organization_id]
    if project_id:
        params.append(project_id)
    rows = conn.execute(
        "SELECT script.*, p.title AS project_title, pm.role AS project_role, "
        "COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name "
        "FROM portfolio script "
        "LEFT JOIN users creator ON creator.id = script.user_id "
        "JOIN project_memberships pm ON pm.project_id = script.project_id AND pm.user_id = ? "
        "JOIN content_projects p ON p.id = script.project_id "
        "WHERE script.organization_id = ? "
        f"{project_clause} ORDER BY script.updated_at DESC, script.id DESC LIMIT 200",
        params,
    ).fetchall()
    conn.close()
    return [_document(r) for r in rows]


def update_script(
    script_id: str,
    name: str,
) -> ScriptDocument | None:
    init_db()
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("UPDATE portfolio SET name = ?, updated_at = ? WHERE id = ?", (name, now, script_id))
    conn.commit()
    row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return _document(row)


def save_agent_work(user_id: str, session_id: str, project_id: str, work: CreativeDeliverable) -> ScriptDocument:
    from app.config import MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES

    init_db()
    conn = _get_conn()
    owned: list[str] = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        session = conn.execute(
            "SELECT user_id, organization_id, title, deliverables FROM creation_sessions WHERE id = ? AND project_id = ?"
            + (" FOR UPDATE" if is_postgresql(conn) else ""), (session_id, project_id),
        ).fetchone()
        organization_id = resolve_user_organization_id(conn, user_id)
        access = conn.execute(
            "SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?", (project_id, user_id),
        ).fetchone()
        if session is None or session["organization_id"] != organization_id or not access:
            raise LookupError("Creation not found")
        if session["user_id"] != user_id and access["role"] not in {"owner", "admin"}:
            raise PermissionError("Access denied")
        from app.engines.content_generator.agent_jobs import require_idle
        require_idle(session_id, conn)
        latest = json.loads(session["deliverables"] or "[]")
        if not latest or latest[-1]["id"] != work.id:
            raise ValueError("Creation changed; reload and try again")
        existing = conn.execute(
            "SELECT * FROM portfolio WHERE source_session_id = ? AND source_version_id = ?", (session_id, work.id),
        ).fetchone()
        if existing:
            return _document(existing)
        script_id = uuid.uuid4().hex[:12]
        urls = ([work.video_url] if work.media_kind == "video"
                else [work.image_url, *work.additional_image_urls])
        media: list[PortfolioMedia] = []
        for index, url in enumerate(filter(None, urls)):
            source_key = media_key_from_url(url)
            if not source_key:
                raise ValueError("Work media is not stored locally")
            name = PurePosixPath(source_key).name
            key = f"portfolio/{organization_id}/{project_id}/{script_id}/{uuid.uuid4().hex}{PurePosixPath(name).suffix}"
            data = read_media_bytes(source_key, max_bytes=MAX_VIDEO_SIZE_BYTES if work.media_kind == "video" else MAX_IMAGE_SIZE_BYTES)
            if not data:
                raise ValueError("Work media file is empty")
            owned.append(key)
            mime_type = guess_content_type(name)
            put_media_bytes(key, data, content_type=mime_type)
            media.append(PortfolioMedia(
                id=uuid.uuid4().hex[:12], name=f"{work.title or session['title'] or 'Media'} {index + 1}",
                media_type=work.media_kind, object_key=key, mime_type=mime_type,
            ))
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO portfolio (id, user_id, organization_id, project_id, name, title, content, source_session_id, "
            "source_version_id, media_kind, media, tags, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)",
            (script_id, user_id, organization_id, project_id, session["title"] or work.title or "Untitled work", work.title, work.publication_copy, session_id,
             work.id, work.media_kind, json.dumps([item.model_dump(exclude={"file_url"}) for item in media]),
             json.dumps(work.tags, ensure_ascii=False), now, now),
        )
        row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
        conn.commit()
        return _document(row)
    except Exception:
        conn.rollback()
        for key in owned:
            try:
                delete_media(key)
            except Exception:
                logger.exception("Failed to clean portfolio media %s", key)
        raise
    finally:
        conn.close()


def reorder_media(user_id: str, script_id: str, order: list[str], expected_updated_at: str) -> ScriptDocument:
    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM portfolio WHERE id = ?" + (" FOR UPDATE" if is_postgresql(conn) else ""), (script_id,),
        ).fetchone()
        if row is None or row["organization_id"] != resolve_user_organization_id(conn, user_id):
            raise LookupError("Work not found")
        access = conn.execute(
            "SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?", (row["project_id"], user_id),
        ).fetchone()
        if not access:
            raise LookupError("Work not found")
        if row["user_id"] != user_id and access["role"] not in {"owner", "admin"}:
            raise PermissionError("Access denied")
        if row["updated_at"] != expected_updated_at:
            raise ValueError("Work changed; reload and try again")
        work = _document(row)
        ids = [item.id for item in work.media]
        if len(order) != len(ids) or len(set(order)) != len(order) or set(order) != set(ids):
            raise ValueError("Invalid media order")
        if work.media_kind != "image":
            raise ValueError("Only image works support media reordering")
        by_id = {item.id: item for item in work.media}
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE portfolio SET media = ?, updated_at = ? WHERE id = ?", (
            json.dumps([by_id[item].model_dump(exclude={"file_url"}) for item in order]), now, script_id,
        ))
        conn.commit()
        return _document(conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone())
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def edit_script(
    user_id: str, script_id: str, changes: ScriptEdit, uploads: list[tuple[str, BinaryIO]],
) -> ScriptDocument:
    from app.config import MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES

    init_db()
    conn = _get_conn()
    owned: list[str] = []
    removed: list[str] = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM portfolio WHERE id = ?" + (" FOR UPDATE" if is_postgresql(conn) else ""), (script_id,),
        ).fetchone()
        if row is None or row["organization_id"] != resolve_user_organization_id(conn, user_id):
            raise LookupError("Work not found")
        access = conn.execute(
            "SELECT pm.role, p.title FROM project_memberships pm "
            "JOIN content_projects p ON p.id = pm.project_id WHERE pm.project_id = ? AND pm.user_id = ?",
            (row["project_id"], user_id),
        ).fetchone()
        if not access:
            raise LookupError("Work not found")
        if row["user_id"] != user_id and access["role"] not in {"owner", "admin"}:
            raise PermissionError("Access denied")
        if row["updated_at"] != changes.expected_updated_at:
            raise ValueError("Work changed; reload and try again")
        if row["status"] != "completed":
            raise ValueError("Only completed works can be edited")
        current = _document(row)
        kind = current.media_kind or "image"
        media = {item.id: item for item in current.media}
        upload_ids = {f"upload:{index}" for index in range(len(uploads))}
        requested = set(changes.media_ids)
        material_ids = {item for item in requested if item.startswith("material:")}
        if not upload_ids <= requested or not requested <= media.keys() | upload_ids | material_ids:
            raise ValueError("Invalid media order")
        if kind == "video" and len(changes.media_ids) > 1:
            raise ValueError("Video works accept only one video")

        def copy_media(name: str, extension: str, data: bytes, mime_type: str) -> PortfolioMedia:
            key = f"portfolio/{row['organization_id']}/{row['project_id']}/{script_id}/{uuid.uuid4().hex}{extension}"
            owned.append(key)
            put_media_bytes(key, data, content_type=mime_type)
            return PortfolioMedia(
                id=uuid.uuid4().hex[:12], name=name, media_type=kind, object_key=key, mime_type=mime_type,
            )

        for index, (name, stream) in enumerate(uploads):
            limit = MAX_VIDEO_SIZE_BYTES if kind == "video" else MAX_IMAGE_SIZE_BYTES
            data = stream.read(limit + 1)
            if len(data) > limit:
                raise ValueError("Work media file exceeds the size limit")
            mime_type = validate_work_media(name, data, kind)
            media[f"upload:{index}"] = copy_media(
                PurePosixPath(name).name, PurePosixPath(name).suffix.lower(), data, mime_type,
            )
        for reference in material_ids:
            material = conn.execute(
                "SELECT name, media_type, object_key, mime_type FROM project_materials "
                "WHERE id = ? AND project_id = ? AND node_type = 'file'",
                (reference.removeprefix("material:"), row["project_id"]),
            ).fetchone()
            if material is None or not material["object_key"]:
                raise LookupError("Project material not found")
            if material["media_type"] != kind:
                raise ValueError("Material media type does not match work type")
            try:
                data = read_media_bytes(material["object_key"],
                    max_bytes=MAX_VIDEO_SIZE_BYTES if kind == "video" else MAX_IMAGE_SIZE_BYTES)
            except FileNotFoundError as exc:
                raise LookupError("Project material not found") from exc
            if not data:
                raise ValueError("Work media file is empty")
            media[reference] = copy_media(
                material["name"], PurePosixPath(material["object_key"]).suffix.lower(), data, material["mime_type"],
            )
        final_media = [media[item] for item in changes.media_ids]
        removed = [item.object_key for item in current.media if item.id not in requested]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE portfolio SET title = ?, content = ?, tags = ?, media = ?, media_kind = ?, updated_at = ? WHERE id = ?",
            (changes.title, changes.content, json.dumps(changes.tags, ensure_ascii=False),
             json.dumps([item.model_dump(exclude={"file_url"}) for item in final_media]), kind, now, script_id),
        )
        updated = _document(conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone())
        updated.project_title = access["title"]
        updated.project_role = access["role"]
        conn.commit()
    except Exception:
        conn.rollback()
        for key in owned:
            try:
                delete_media(key)
            except Exception:
                logger.exception("Failed to clean cancelled portfolio edit media %s", key)
        raise
    finally:
        conn.close()
    for key in removed:
        try:
            delete_media(key)
        except Exception:
            logger.exception("Failed to clean removed portfolio media %s", key)
    return updated


def delete_script(script_id: str) -> bool:
    init_db()
    conn = _get_conn()
    row = conn.execute("SELECT media FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    media = json.loads(row["media"]) if row else []
    if conn.execute(
        "SELECT 1 FROM sqlite_master "
        "WHERE type = 'table' AND name = 'project_publications'",
    ).fetchone():
        conn.execute(
            "DELETE FROM project_publications WHERE portfolio_id = ?",
            (script_id,),
        )
    conn.execute("DELETE FROM portfolio WHERE id = ?", (script_id,))
    conn.commit()
    conn.close()
    for item in media:
        try:
            delete_media(item["object_key"])
        except Exception:
            logger.exception("Failed to clean deleted portfolio media %s", item["object_key"])
    return True
