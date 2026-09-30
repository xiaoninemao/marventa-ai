from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from app.config import DB_PATH
from app.database import connect_database
from app.engines.portfolio.models import ScriptDocument
from app.storage_schema import ensure_organization_scope, ensure_project_scope, resolve_user_organization_id

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
    if "project_id" not in cols:
        conn.execute("ALTER TABLE portfolio ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
    if "status" not in cols:
        conn.execute("ALTER TABLE portfolio ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'")
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
    conn.commit()
    conn.close()


def create_script(
    user_id: str, title: str, content: str,
    source_session_id: str = "", project_id: str = "", status: str = "completed",
) -> ScriptDocument:
    init_db()
    conn = _get_conn()
    sid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    content = content or ""
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
            SELECT 1 FROM content_projects p
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
        "INSERT INTO portfolio (id, user_id, project_id, title, content, source_session_id, status, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, project_id, title, content, source_session_id, status, now, now, organization_id),
    )
    conn.commit()
    conn.close()
    return ScriptDocument(
        id=sid, user_id=user_id, project_id=project_id, title=title, content=content,
        source_session_id=source_session_id, project_title="", project_role="owner",
        status=status, created_at=now, updated_at=now,
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
    return ScriptDocument(**dict(row))


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
        return [ScriptDocument(**dict(row)) for row in rows]
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
    return [ScriptDocument(**dict(r)) for r in rows]


def update_script(
    script_id: str,
    title: str | None = None,
    content: str | None = None,
    status: str | None = None,
) -> ScriptDocument | None:
    init_db()
    conn = _get_conn()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if title is not None:
        conn.execute("UPDATE portfolio SET title = ?, updated_at = ? WHERE id = ?", (title, now, script_id))
    if content is not None:
        conn.execute("UPDATE portfolio SET content = ?, updated_at = ? WHERE id = ?", (content, now, script_id))
    if status is not None:
        conn.execute("UPDATE portfolio SET status = ?, updated_at = ? WHERE id = ?", (status, now, script_id))
    conn.commit()
    row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return ScriptDocument(**dict(row))


def delete_script(script_id: str) -> bool:
    init_db()
    conn = _get_conn()
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
    return True
