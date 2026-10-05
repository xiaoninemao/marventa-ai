from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone

from app.config import DB_PATH, MEDIA_ROOT, MEDIA_S3_BUCKET, MEDIA_STORAGE_BACKEND
from app.database import connect_database
from app.engines.market_insight.models import (
    AIAnalysis,
    HistoryRecord,
    InsightSource,
    ParsedDocument,
)
from app.media_storage import delete_media, list_media_keys, media_exists
from app.storage_schema import (
    ensure_json_columns,
    ensure_organization_scope,
    ensure_project_scope,
    resolve_user_organization_id,
)

_reconciled_storage_roots: set[tuple[str, str]] = set()


class InsightProjectAccessDenied(PermissionError):
    pass


class InsightRetryNotAllowed(ValueError):
    pass


logger = logging.getLogger(__name__)
ANALYSIS_LEASE_SECONDS = 75
ANALYSIS_TIMEOUT_SECONDS = 600


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS insights (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            upload_time TEXT NOT NULL,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            ai_model TEXT DEFAULT '',
            ai_analysis TEXT DEFAULT NULL,
            is_edited INTEGER DEFAULT 0,
            status TEXT DEFAULT 'completed'
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(insights)").fetchall()]
    if "status" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN status TEXT DEFAULT 'completed'")
    for column, sql_type in (
        ("analysis_attempt_id", "TEXT"),
        ("analysis_lease_until", "BIGINT"),
        ("analysis_deadline", "BIGINT"),
    ):
        if column not in cols:
            conn.execute(f"ALTER TABLE insights ADD COLUMN {column} {sql_type}")
    if "owner_id" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN owner_id TEXT DEFAULT ''")
    if "project_id" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
    if "source_file_path" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN source_file_path TEXT DEFAULT ''")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS insight_sources (
            id TEXT PRIMARY KEY,
            insight_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            source_type TEXT NOT NULL,
            raw_text TEXT NOT NULL DEFAULT '',
            source_file_path TEXT NOT NULL DEFAULT '',
            upload_time TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (insight_id) REFERENCES insights(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_insight_migrations (
            key TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)
    if conn.execute(
        "SELECT 1 FROM market_insight_migrations WHERE key = 'insight-sources-v1'",
    ).fetchone() is None:
        conn.execute("""
            INSERT OR IGNORE INTO insight_sources (
                id, insight_id, filename, file_size, source_type, raw_text,
                source_file_path, upload_time, position
            )
            SELECT id || '-source', id, filename, file_size, source_type, raw_text,
                   source_file_path, upload_time, 0
            FROM insights
        """)
        conn.execute(
            "INSERT INTO market_insight_migrations VALUES (?, ?)",
            (
                "insight-sources-v1",
                datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
    if conn.execute(
        "SELECT 1 FROM market_insight_migrations WHERE key = 'source-payloads-v2'",
    ).fetchone() is None:
        conn.execute(
            "UPDATE insights SET raw_text = '', source_file_path = ''",
        )
        conn.execute(
            "INSERT INTO market_insight_migrations VALUES (?, ?)",
            (
                "source-payloads-v2",
                datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_insight_sources_insight_position "
        "ON insight_sources(insight_id, position, upload_time)"
    )
    ensure_organization_scope(conn, "insights", "owner_id")
    if all(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
    ).fetchone() for table in ("content_projects", "project_memberships")):
        conn.execute("""
            UPDATE insights
            SET project_id = COALESCE((
                SELECT pm.project_id
                FROM project_memberships pm
                JOIN content_projects p ON p.id = pm.project_id
                WHERE pm.user_id = insights.owner_id
                  AND p.organization_id = insights.organization_id
                ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                         pm.created_at, pm.project_id
                LIMIT 1
            ), '')
            WHERE project_id = ''
        """)
    ensure_json_columns(conn, "insights", ("ai_analysis",))
    if conn.execute(
        "SELECT 1 FROM market_insight_migrations WHERE key = 'stable-insight-title-v3'",
    ).fetchone() is None:
        conn.execute("""
            UPDATE insights
            SET title = COALESCE(
                NULLIF(json_extract(ai_analysis, '$.product_name'), ''), title, filename
            )
            WHERE json_valid(ai_analysis)
        """)
        conn.execute(
            "INSERT INTO market_insight_migrations VALUES (?, ?)",
            ("stable-insight-title-v3", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_insights_org_owner_uploaded "
        "ON insights(organization_id, owner_id, upload_time DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_insights_project_uploaded "
        "ON insights(project_id, upload_time DESC)"
    )
    ensure_project_scope(conn, "insights")
    reconciliation_key = (
        os.path.realpath(DB_PATH),
        MEDIA_STORAGE_BACKEND,
        MEDIA_S3_BUCKET or os.path.realpath(MEDIA_ROOT),
    )
    if reconciliation_key not in _reconciled_storage_roots:
        _reconcile_source_files(conn)
        _reconciled_storage_roots.add(reconciliation_key)
    _recover_interrupted_analyses(conn, int(time.time()))
    conn.commit()
    conn.close()


def _recover_interrupted_analyses(conn: sqlite3.Connection, now: int) -> None:
    updated = conn.execute(
        """UPDATE insights
           SET status = 'failed', analysis_attempt_id = NULL,
               analysis_lease_until = NULL, analysis_deadline = NULL
           WHERE status = 'analyzing' AND (
               analysis_attempt_id IS NULL OR analysis_attempt_id = ''
               OR analysis_lease_until IS NULL OR analysis_lease_until <= ?
               OR analysis_deadline IS NULL OR analysis_deadline <= ?
           )""",
        (now, now),
    )
    if updated.rowcount:
        logger.warning("Recovered %s interrupted insight analyses", updated.rowcount)


def renew_analysis_lease(record_id: str, attempt_id: str) -> bool:
    conn = _get_conn()
    try:
        now = int(time.time())
        _recover_interrupted_analyses(conn, now)
        updated = conn.execute(
            """UPDATE insights SET analysis_lease_until = ?
               WHERE id = ? AND status = 'analyzing' AND analysis_attempt_id = ?
               AND analysis_lease_until > ? AND analysis_deadline > ?""",
            (now + ANALYSIS_LEASE_SECONDS, record_id, attempt_id, now, now),
        )
        conn.commit()
        return updated.rowcount == 1
    finally:
        conn.close()


def finish_analysis(
    record_id: str, attempt_id: str, analysis: AIAnalysis | None = None,
) -> bool:
    """Only the still-live owner may publish a result, including a failure."""
    conn = _get_conn()
    try:
        now = int(time.time())
        _recover_interrupted_analyses(conn, now)
        updated = conn.execute(
            """UPDATE insights
               SET status = ?, ai_analysis = COALESCE(?, ai_analysis),
                   analysis_attempt_id = NULL, analysis_lease_until = NULL,
                   analysis_deadline = NULL
               WHERE id = ? AND status = 'analyzing' AND analysis_attempt_id = ?
               AND analysis_lease_until > ? AND analysis_deadline > ?""",
            (
                "completed" if analysis is not None else "failed",
                analysis.model_dump_json() if analysis is not None else None,
                record_id, attempt_id, now, now,
            ),
        )
        conn.commit()
        return updated.rowcount == 1
    finally:
        conn.close()


def analysis_time_remaining(record_id: str, attempt_id: str) -> float:
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT analysis_deadline FROM insights WHERE id = ? AND analysis_attempt_id = ? "
            "AND status = 'analyzing'", (record_id, attempt_id),
        ).fetchone()
        return max(0, (row["analysis_deadline"] or 0) - time.time()) if row else 0
    finally:
        conn.close()


def _reconcile_source_files(conn: sqlite3.Connection) -> None:
    expected_files: set[str] = set()
    rows = conn.execute(
        "SELECT id, source_file_path FROM insight_sources WHERE source_file_path != ''",
    ).fetchall()
    for row in rows:
        key = str(row["source_file_path"]).replace("\\", "/")
        if not media_exists(key):
            conn.execute(
                "UPDATE insight_sources SET source_file_path = '' WHERE id = ?",
                (row["id"],),
            )
            continue
        expected_files.add(key)

    for key in list_media_keys("market_insight_sources"):
        if key not in expected_files:
            delete_media(key)


def _project_access(
    conn: sqlite3.Connection, user_id: str, project_id: str,
) -> sqlite3.Row:
    if not project_id:
        raise ValueError("Project is required")
    organization_id = resolve_user_organization_id(conn, user_id)
    access = conn.execute("""
        SELECT p.id, p.title, p.organization_id, pm.role
        FROM content_projects p
        JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ? AND p.organization_id = ?
    """, (user_id, project_id, organization_id)).fetchone()
    if access is None:
        raise InsightProjectAccessDenied("Project not found or access denied")
    return access


def save_insight(
    doc: ParsedDocument,
    filename: str,
    file_size: int,
    owner_id: str,
    project_id: str,
    status: str = "completed",
) -> HistoryRecord:
    init_db()
    record_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    analysis_json = doc.ai_analysis.model_dump_json() if doc.ai_analysis else None
    title = (doc.ai_analysis.product_name if doc.ai_analysis else "") or doc.title or filename

    conn = _get_conn()
    project = _project_access(conn, owner_id, project_id)
    attempt_id = uuid.uuid4().hex if status == "analyzing" else None
    started_at = int(time.time())
    conn.execute(
        """INSERT INTO insights (id, filename, file_size, upload_time, source_type,
           title, raw_text, ai_model, ai_analysis, is_edited, status, owner_id,
           project_id, organization_id, analysis_attempt_id, analysis_lease_until,
           analysis_deadline)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)""",
        (record_id, filename, file_size, now, doc.source_type, title,
         "", doc.ai_model, analysis_json, status, owner_id, project_id,
         project["organization_id"], attempt_id,
         started_at + ANALYSIS_LEASE_SECONDS if attempt_id else None,
         started_at + ANALYSIS_TIMEOUT_SECONDS if attempt_id else None),
    )
    conn.commit()
    conn.close()
    doc._analysis_attempt_id = attempt_id or ""

    return HistoryRecord(
        id=record_id,
        filename=filename,
        file_size=file_size,
        upload_time=now,
        source_type=doc.source_type,
        title=title,
        ai_model=doc.ai_model,
        ai_analysis=doc.ai_analysis,
        is_edited=False,
        status=status,
        owner_id=owner_id,
        organization_id=project["organization_id"],
        project_id=project_id,
        project_title=project["title"],
        project_role=project["role"],
    )


def list_history(
    owner_id: str,
    limit: int = 50,
    offset: int = 0,
    search: str = "",
    project_id: str = "",
) -> list[HistoryRecord]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, owner_id)
    params: list = [owner_id, organization_id]
    search_clause = ""
    if search:
        search_clause = """ AND (
            i.title LIKE ? OR i.filename LIKE ? OR EXISTS (
                SELECT 1 FROM insight_sources source
                WHERE source.insight_id = i.id AND source.filename LIKE ?
            )
        )"""
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    project_clause = ""
    if project_id:
        project_clause = " AND i.project_id = ?"
        params.append(project_id)
    params.extend([limit, offset])
    rows = conn.execute(
        "SELECT i.*, p.title AS project_title, pm.role AS project_role, "
        "COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name "
        "FROM insights i "
        "JOIN content_projects p ON p.id = i.project_id "
        "JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ? "
        "LEFT JOIN users creator ON creator.id = i.owner_id "
        "WHERE p.organization_id = ? "
        f"{search_clause}{project_clause} "
        "ORDER BY i.upload_time DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    conn.close()

    return [_row_to_record(r) for r in rows]


def get_insight(record_id: str, owner_id: str | None = None) -> HistoryRecord | None:
    init_db()
    conn = _get_conn()
    if owner_id is None:
        row = conn.execute("""
            SELECT i.*, p.title AS project_title, '' AS project_role,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name
            FROM insights i
            JOIN content_projects p ON p.id = i.project_id
            LEFT JOIN users creator ON creator.id = i.owner_id
            WHERE i.id = ?
        """, (record_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, owner_id)
        row = conn.execute("""
            SELECT i.*, p.title AS project_title, pm.role AS project_role,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name
            FROM insights i
            JOIN content_projects p ON p.id = i.project_id
            JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
            LEFT JOIN users creator ON creator.id = i.owner_id
            WHERE i.id = ? AND p.organization_id = ?
        """, (owner_id, record_id, organization_id)).fetchone()
    if row is None:
        conn.close()
        return None
    conn.close()
    return _row_to_record(row)


def get_insight_source_preview(
    record_id: str, source_id: str, user_id: str,
    offset: int = 0, limit: int = 20_000,
) -> dict[str, str | int | bool] | None:
    source = get_insight_source(record_id, source_id, user_id)
    if source is None:
        return None
    conn = _get_conn()
    row = conn.execute(
        "SELECT filename, source_type, length(raw_text) AS total_length, "
        "substr(raw_text, ?, ?) AS content FROM insight_sources "
        "WHERE id = ? AND insight_id = ?",
        (offset + 1, limit, source_id, record_id),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    content = row["content"] or ""
    total_length = int(row["total_length"] or 0)
    return {
        "filename": row["filename"],
        "source_type": row["source_type"],
        "content": content,
        "offset": offset,
        "next_offset": offset + len(content),
        "total_length": total_length,
        "has_more": offset + len(content) < total_length,
    }


def get_insight_source_file(
    record_id: str, source_id: str, user_id: str,
) -> tuple[str, str] | None:
    source = get_insight_source(record_id, source_id, user_id)
    if source is None:
        return None
    conn = _get_conn()
    row = conn.execute(
        "SELECT filename, source_file_path FROM insight_sources "
        "WHERE id = ? AND insight_id = ?",
        (source_id, record_id),
    ).fetchone()
    conn.close()
    if row is None or not row["source_file_path"]:
        return None
    return row["filename"], row["source_file_path"]


def add_insight_source(
    record_id: str,
    filename: str,
    file_size: int,
    source_type: str,
    raw_text: str,
    source_file_path: str = "",
    position: int = 0,
) -> InsightSource:
    init_db()
    source_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = _get_conn()
    conn.execute(
        """INSERT INTO insight_sources (
            id, insight_id, filename, file_size, source_type, raw_text,
            source_file_path, upload_time, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            source_id, record_id, filename, file_size, source_type, raw_text,
            source_file_path, now, position,
        ),
    )
    conn.commit()
    conn.close()
    return InsightSource(
        id=source_id,
        insight_id=record_id,
        filename=filename,
        file_size=file_size,
        source_type=source_type,
        upload_time=now,
        has_source_file=bool(source_file_path),
    )


def list_insight_sources(
    record_id: str, user_id: str,
) -> list[InsightSource] | None:
    if get_insight(record_id, user_id) is None:
        return None
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM insight_sources WHERE insight_id = ? "
        "ORDER BY position, upload_time, id",
        (record_id,),
    ).fetchall()
    conn.close()
    return [
        InsightSource(
            id=row["id"],
            insight_id=row["insight_id"],
            filename=row["filename"],
            file_size=row["file_size"],
            source_type=row["source_type"],
            upload_time=row["upload_time"],
            has_source_file=bool(row["source_file_path"]),
        )
        for row in rows
    ]


def get_insight_source(
    record_id: str, source_id: str, user_id: str,
) -> InsightSource | None:
    if get_insight(record_id, user_id) is None:
        return None
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM insight_sources WHERE id = ? AND insight_id = ?",
        (source_id, record_id),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return InsightSource(
        id=row["id"],
        insight_id=row["insight_id"],
        filename=row["filename"],
        file_size=row["file_size"],
        source_type=row["source_type"],
        upload_time=row["upload_time"],
        has_source_file=bool(row["source_file_path"]),
    )


def update_insight(
    record_id: str, analysis: AIAnalysis, user_id: str | None = None,
) -> HistoryRecord | None:
    init_db()
    conn = _get_conn()
    existing = get_insight(record_id, user_id)
    if existing is None:
        conn.close()
        return None
    if user_id is not None and existing.project_role not in {"owner", "admin"} and existing.owner_id != user_id:
        conn.close()
        raise InsightProjectAccessDenied(
            "Only the insight creator and project administrators can edit insights"
        )
    if existing.status == "analyzing":
        conn.close()
        raise InsightRetryNotAllowed("Analyzing insights cannot be edited")
    analysis = (
        analysis.model_copy(deep=True, update={"research": None})
        if existing.source_type == "manual" else _human_analysis(analysis, existing.ai_analysis)
    )
    analysis_json = analysis.model_dump_json()
    updated = conn.execute(
        "UPDATE insights SET ai_analysis = ?, is_edited = 1 WHERE id = ? AND status != 'analyzing'",
        (analysis_json, record_id),
    )
    if updated.rowcount != 1:
        conn.rollback()
        conn.close()
        raise InsightRetryNotAllowed("Insight analysis started before the edit could be saved")
    conn.commit()
    conn.close()
    return get_insight(record_id, user_id)


def rename_insight(
    record_id: str, name: str, user_id: str,
) -> HistoryRecord | None:
    init_db()
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("Insight name is required")
    conn = _get_conn()
    existing = get_insight(record_id, user_id)
    if existing is None:
        conn.close()
        return None
    if existing.project_role not in {"owner", "admin"} and existing.owner_id != user_id:
        conn.close()
        raise InsightProjectAccessDenied("Only the insight creator and project administrators can rename insights")
    if existing.status == "analyzing":
        conn.close()
        raise InsightRetryNotAllowed("Analyzing insights cannot be renamed")
    edited_analysis = None
    if existing.ai_analysis:
        edited_analysis = (
            existing.ai_analysis.model_copy(deep=True, update={"research": None})
            if existing.source_type == "manual"
            else _human_analysis(existing.ai_analysis, existing.ai_analysis)
        )
    updated = conn.execute(
        "UPDATE insights SET title = ?, is_edited = 1, ai_analysis = ? WHERE id = ? AND status != 'analyzing'",
        (normalized_name, edited_analysis.model_dump_json() if edited_analysis else None, record_id),
    )
    if updated.rowcount != 1:
        conn.rollback()
        conn.close()
        raise InsightRetryNotAllowed("Insight analysis started before the rename could be saved")
    conn.commit()
    conn.close()
    return get_insight(record_id, user_id)


def update_insight_status(record_id: str, status: str, analysis: AIAnalysis | None = None) -> HistoryRecord | None:
    init_db()
    conn = _get_conn()
    if analysis is not None:
        analysis_json = analysis.model_dump_json()
        conn.execute(
            "UPDATE insights SET status = ?, ai_analysis = ?, analysis_attempt_id = NULL, "
            "analysis_lease_until = NULL, analysis_deadline = NULL WHERE id = ?",
            (status, analysis_json, record_id),
        )
    else:
        conn.execute(
            "UPDATE insights SET status = ?, analysis_attempt_id = NULL, "
            "analysis_lease_until = NULL, analysis_deadline = NULL WHERE id = ?",
            (status, record_id),
        )
    conn.commit()
    conn.close()
    return get_insight(record_id)


def prepare_insight_retry(
    record_id: str, user_id: str,
) -> tuple[ParsedDocument, str] | None:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    row = conn.execute("""
        SELECT i.*, pm.role AS project_role
        FROM insights i
        JOIN content_projects p ON p.id = i.project_id
        JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE i.id = ? AND p.organization_id = ?
    """, (user_id, record_id, organization_id)).fetchone()
    if row is None:
        conn.close()
        return None
    if row["owner_id"] != user_id and row["project_role"] not in {"owner", "admin"}:
        conn.close()
        raise InsightProjectAccessDenied(
            "Only the insight creator and project administrators can reanalyze insights"
        )
    if row["source_type"] == "manual" or row["status"] not in {"failed", "completed"}:
        conn.close()
        raise InsightRetryNotAllowed("Only completed or failed document insights can be reanalyzed")
    attempt_id = uuid.uuid4().hex
    started_at = int(time.time())
    updated = conn.execute(
        """UPDATE insights SET status = 'analyzing', analysis_attempt_id = ?,
           analysis_lease_until = ?, analysis_deadline = ?
           WHERE id = ? AND status IN ('failed', 'completed')""",
        (attempt_id, started_at + ANALYSIS_LEASE_SECONDS,
         started_at + ANALYSIS_TIMEOUT_SECONDS, record_id),
    )
    if updated.rowcount != 1:
        conn.close()
        raise InsightRetryNotAllowed("Only completed or failed document insights can be reanalyzed")
    source_rows = conn.execute(
        "SELECT filename, source_type, raw_text FROM insight_sources "
        "WHERE insight_id = ? ORDER BY position, upload_time, id",
        (record_id,),
    ).fetchall()
    if not source_rows:
        conn.rollback()
        conn.close()
        raise InsightRetryNotAllowed("Insight has no source material")
    combined_text = "\n\n".join(
        f"===== {source['filename']} =====\n\n{source['raw_text']}"
        for source in source_rows
    )
    combined_source_type = (
        source_rows[0]["source_type"] if len(source_rows) == 1 else "documents"
    )
    conn.commit()
    conn.close()
    document = ParsedDocument(
        title=row["title"],
        source_type=combined_source_type,
        raw_text=combined_text,
        ai_model=row["ai_model"] or "",
    )
    document._analysis_attempt_id = attempt_id
    return document, row["owner_id"]


def save_manual_insight(
    analysis: AIAnalysis, owner_id: str, project_id: str,
) -> HistoryRecord:
    init_db()
    analysis = analysis.model_copy(deep=True, update={"research": None})
    record_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    analysis_json = analysis.model_dump_json()
    product_name = analysis.product_name or "Untitled product"

    conn = _get_conn()
    project = _project_access(conn, owner_id, project_id)
    conn.execute(
        """INSERT INTO insights (id, filename, file_size, upload_time, source_type,
           title, raw_text, ai_model, ai_analysis, is_edited, status, owner_id,
           project_id, organization_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'completed', ?, ?, ?)""",
        (record_id, product_name, 0, now, "manual", product_name,
         "", "", analysis_json, owner_id, project_id, project["organization_id"]),
    )
    conn.commit()
    conn.close()

    return HistoryRecord(
        id=record_id,
        filename=product_name,
        file_size=0,
        upload_time=now,
        source_type="manual",
        title=product_name,
        ai_model="",
        ai_analysis=analysis,
        is_edited=True,
        status="completed",
        owner_id=owner_id,
        organization_id=project["organization_id"],
        project_id=project_id,
        project_title=project["title"],
        project_role=project["role"],
    )


def _human_analysis(analysis: AIAnalysis, previous: AIAnalysis | None = None) -> AIAnalysis:
    from app.engines.market_insight.models import InsightResearch

    result = analysis.model_copy(deep=True)
    # Request-supplied evidence is not a trusted source registry. Preserve only stored evidence.
    research = previous.research.model_copy(deep=True) if previous and previous.research else InsightResearch(status="edited")
    research.status = "edited"
    notice = "Human-edited summary; prior evidence may no longer support it. Not verified."
    if notice not in research.limitations:
        research.limitations.append(notice)
    result.research = research
    return result

def delete_insight(record_id: str, user_id: str | None = None) -> bool:
    init_db()
    if user_id is not None:
        existing = get_insight(record_id, user_id)
        if existing is None:
            return False
        if existing.project_role not in {"owner", "admin"} and existing.owner_id != user_id:
            raise InsightProjectAccessDenied("Access denied")
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM insights WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def _row_to_record(row: sqlite3.Row) -> HistoryRecord:
    analysis = None
    if row["ai_analysis"]:
        try:
            analysis_data = json.loads(row["ai_analysis"])
            if row["source_type"] == "manual" and isinstance(analysis_data, dict):
                analysis_data["research"] = None
            analysis = AIAnalysis(**analysis_data)
        except (json.JSONDecodeError, TypeError):
            pass

    return HistoryRecord(
        id=row["id"],
        filename=row["filename"],
        file_size=row["file_size"],
        upload_time=row["upload_time"],
        source_type=row["source_type"],
        title=row["title"],
        ai_model=row["ai_model"] or "",
        ai_analysis=analysis,
        is_edited=bool(row["is_edited"]),
        status=row["status"] if "status" in row.keys() else "completed",
        owner_id=row["owner_id"] if "owner_id" in row.keys() else "",
        creator_name=row["creator_name"] if "creator_name" in row.keys() else "",
        organization_id=row["organization_id"] if "organization_id" in row.keys() else "",
        project_id=row["project_id"],
        project_title=row["project_title"] if "project_title" in row.keys() else "",
        project_role=row["project_role"] if "project_role" in row.keys() else "member",
    )
