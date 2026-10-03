from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database, is_postgresql
from app.engines.content_generator.models import (
    ChatMessage, ChatReference, ContentCard, CreationActivity, SessionResponse, ContentVersion,
)
from app.storage_schema import (
    ensure_organization_scope,
    ensure_parent_organization_scope,
    ensure_json_columns,
    ensure_project_scope,
    resolve_user_organization_id,
)

def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creation_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT DEFAULT '',
            messages TEXT DEFAULT '[]',
            cards TEXT DEFAULT '[]',
            status TEXT DEFAULT 'drafting',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(creation_sessions)").fetchall()]
    if "insight_ids" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN insight_ids TEXT DEFAULT '[]'")
    if "case_ids" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN case_ids TEXT DEFAULT '[]'")
    if "material_ids" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN material_ids TEXT NOT NULL DEFAULT '[]'")
    if is_postgresql(conn):
        conn.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'creation_sessions'::regclass
                      AND conname = 'creation_sessions_material_ids_json'
                ) THEN
                    ALTER TABLE creation_sessions ADD CONSTRAINT creation_sessions_material_ids_json
                    CHECK (jsonb_typeof(material_ids::jsonb) = 'array') NOT VALID;
                END IF;
            END $$
        """)
    if "preference_keys" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN preference_keys TEXT DEFAULT '[]'")
    if "activities" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN activities TEXT DEFAULT '[]'")
    if "project_id" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS content_versions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            version_label TEXT NOT NULL,
            major INTEGER NOT NULL,
            minor INTEGER NOT NULL,
            version_type TEXT NOT NULL DEFAULT '',
            source_version_label TEXT NOT NULL DEFAULT '',
            changed_card_ids TEXT NOT NULL DEFAULT '[]',
            cards TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    version_cols = [r[1] for r in conn.execute("PRAGMA table_info(content_versions)").fetchall()]
    if "version_type" not in version_cols:
        conn.execute("ALTER TABLE content_versions ADD COLUMN version_type TEXT NOT NULL DEFAULT ''")
    if "source_version_label" not in version_cols:
        conn.execute("ALTER TABLE content_versions ADD COLUMN source_version_label TEXT NOT NULL DEFAULT ''")
    if "changed_card_ids" not in version_cols:
        conn.execute("ALTER TABLE content_versions ADD COLUMN changed_card_ids TEXT NOT NULL DEFAULT '[]'")
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_content_versions_session
        ON content_versions(session_id, major, minor)
    """)
    ensure_organization_scope(conn, "creation_sessions", "user_id")
    if all(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
    ).fetchone() for table in ("content_projects", "project_memberships")):
        conn.execute("""
            UPDATE creation_sessions
            SET project_id = COALESCE((
                SELECT pm.project_id
                FROM project_memberships pm
                JOIN content_projects p ON p.id = pm.project_id
                WHERE pm.user_id = creation_sessions.user_id
                  AND p.organization_id = creation_sessions.organization_id
                ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                         pm.created_at, pm.project_id
                LIMIT 1
            ), '')
            WHERE project_id = ''
        """)
    ensure_parent_organization_scope(
        conn, "content_versions", "creation_sessions", "session_id",
    )
    ensure_json_columns(
        conn, "creation_sessions", ("messages", "cards", "insight_ids", "case_ids", "material_ids", "preference_keys", "activities"),
    )
    ensure_json_columns(conn, "content_versions", ("cards", "changed_card_ids"))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_org_user_updated "
        "ON creation_sessions(organization_id, user_id, updated_at DESC)"
    )
    ensure_project_scope(conn, "creation_sessions")
    from app.engines.content_generator.presence import ensure_presence_schema
    ensure_presence_schema(conn)
    conn.commit()
    conn.close()


def create_session(user_id: str, project_id: str = "", title: str = "") -> SessionResponse:
    init_db()
    sid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    title = title.strip()
    if len(title) > 80:
        raise ValueError("Canvas name must be at most 80 characters")
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    project_role = ""
    if project_id:
        access = conn.execute("""
            SELECT pm.role FROM content_projects p
            JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
            WHERE p.id = ? AND p.organization_id = ?
        """, (user_id, project_id, organization_id)).fetchone()
        if access is None:
            conn.close()
            raise ValueError("Project not found or access denied")
        project_role = access["role"]
    conn.execute(
        "INSERT INTO creation_sessions (id, user_id, project_id, title, messages, cards, status, insight_ids, case_ids, preference_keys, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, project_id, title, "[]", "[]", "drafting", "[]", "[]", "[]", now, now, organization_id),
    )
    conn.commit()
    conn.close()
    return SessionResponse(
        id=sid, user_id=user_id, project_id=project_id, title=title, messages=[], cards=[],
        organization_id=organization_id, project_role=project_role,
        status="drafting", insight_ids=[], case_ids=[], preference_keys=[],
        created_at=now, updated_at=now,
    )


def get_session(session_id: str, user_id: str | None = None) -> SessionResponse | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute(
            "SELECT * FROM creation_sessions WHERE id = ?", (session_id,),
        ).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
        ).fetchone():
            row = conn.execute("""
                SELECT session.*, pm.role AS project_role,
                       COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name
                FROM creation_sessions session
                LEFT JOIN users creator ON creator.id = session.user_id
                LEFT JOIN project_memberships pm
                  ON pm.project_id = session.project_id AND pm.user_id = ?
                WHERE session.id = ? AND session.organization_id = ?
                  AND (pm.user_id IS NOT NULL OR (
                    session.project_id = '' AND session.user_id = ?
                  ))
            """, (user_id, session_id, organization_id, user_id)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM creation_sessions "
                "WHERE id = ? AND user_id = ? AND organization_id = ?",
                (session_id, user_id, organization_id),
            ).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_session(row)


def list_sessions(user_id: str, project_id: str = "") -> list[SessionResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
    ).fetchone():
        rows = conn.execute(
            "SELECT * FROM creation_sessions WHERE user_id = ? AND organization_id = ? "
            "ORDER BY updated_at DESC, id DESC LIMIT 200",
            (user_id, organization_id),
        ).fetchall()
        conn.close()
        return [_row_to_session(row) for row in rows]
    project_clause = " AND session.project_id = ?" if project_id else ""
    params = [user_id, organization_id]
    if project_id:
        params.append(project_id)
    rows = conn.execute(
        "SELECT session.*, pm.role AS project_role, "
        "COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name "
        "FROM creation_sessions session "
        "LEFT JOIN users creator ON creator.id = session.user_id "
        "LEFT JOIN project_memberships pm ON pm.project_id = session.project_id AND pm.user_id = ? "
        "WHERE session.organization_id = ? "
        "AND (pm.user_id IS NOT NULL OR (session.project_id = '' AND session.user_id = ?)) "
        f"{project_clause} "
        "ORDER BY session.updated_at DESC, session.id DESC LIMIT 200",
        [params[0], params[1], user_id, *params[2:]],
    ).fetchall()
    conn.close()
    return [_row_to_session(r) for r in rows]


def update_session(session_id: str, **kwargs) -> SessionResponse | None:
    init_db()
    existing = get_session(session_id)
    if existing is None:
        return None

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    fields = []
    values = []

    for key, val in kwargs.items():
        if val is not None and hasattr(existing, key):
            if key in ("messages", "cards", "activities") and isinstance(val, list):
                fields.append(f"{key} = ?")
                values.append(json.dumps(
                    [v.model_dump() if hasattr(v, "model_dump") else v for v in val],
                    ensure_ascii=False,
                ))
            elif key in ("insight_ids", "case_ids", "material_ids", "preference_keys") and isinstance(val, list):
                fields.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False))
            else:
                fields.append(f"{key} = ?")
                values.append(val)

    if not fields:
        return existing

    fields.append("updated_at = ?")
    values.append(now)
    values.append(session_id)

    conn = _get_conn()
    conn.execute(f"UPDATE creation_sessions SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return get_session(session_id)


_EXCLUSIVE_PREFERENCE_GROUPS = (
    frozenset({"short_video", "image_text"}),
    frozenset({"douyin", "xiaohongshu", "kuaishou", "weibo", "bilibili", "wechat_mp", "shipinhao"}),
)


def _merge_unique(existing: list[str], submitted: list[str]) -> list[str]:
    return list(dict.fromkeys([*existing, *submitted]))


def _merge_preferences(existing: list[str], submitted: list[str]) -> list[str]:
    merged = list(dict.fromkeys(existing))
    for group in _EXCLUSIVE_PREFERENCE_GROUPS:
        selected = next((key for key in submitted if key in group), None)
        if selected:
            merged = [key for key in merged if key not in group]
            merged.append(selected)
    for key in submitted:
        if not any(key in group for group in _EXCLUSIVE_PREFERENCE_GROUPS) and key not in merged:
            merged.append(key)
    return merged


def accept_user_message(
    session_id: str,
    user_id: str,
    message: ChatMessage,
    insight_ids: list[str],
    case_ids: list[str],
    preference_keys: list[str],
    material_ids: list[str] | None = None,
) -> SessionResponse | None:
    """Atomically append one idempotent user message and merge sent context."""
    init_db()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        organization_id = resolve_user_organization_id(conn, user_id)
        query = """
            SELECT session.messages, session.insight_ids, session.case_ids, session.material_ids, session.preference_keys
            FROM creation_sessions session
            JOIN project_memberships membership
              ON membership.project_id = session.project_id AND membership.user_id = ?
            JOIN content_projects project ON project.id = session.project_id
            WHERE session.id = ? AND session.organization_id = ?
              AND project.organization_id = session.organization_id
        """
        if is_postgresql(conn):
            query += " FOR UPDATE OF session"
        row = conn.execute(query, (user_id, session_id, organization_id)).fetchone()
        if row is None:
            conn.rollback()
            return None
        messages = [ChatMessage(**item) for item in json.loads(row["messages"] or "[]")]
        message_id = str(message.client_message_id) if message.client_message_id else ""
        duplicate = bool(message_id) and any(
            str(existing.client_message_id or "") == message_id for existing in messages
        )
        if not duplicate:
            messages.append(message)
        else:
            conn.rollback()
            existing_session = get_session(session_id, user_id)
            if existing_session:
                existing_session._user_message_accepted = False
            return existing_session
        submitted_materials = list(dict.fromkeys(material_ids or []))
        if len(submitted_materials) > 20:
            raise ValueError("At most 20 material references are allowed")
        # Recheck within the write transaction, closing the API validation race.
        material_titles = {}
        for material_id in submitted_materials:
            material = conn.execute("""
                SELECT material.id, material.name FROM project_materials material
                JOIN creation_sessions session ON session.project_id = material.project_id
                WHERE session.id = ? AND material.id = ? AND material.node_type = 'file'
            """, (session_id, material_id)).fetchone()
            if material is None:
                raise LookupError("Referenced material not found")
            material_titles[material_id] = material["name"]
        message.references = [
            reference for reference in message.references if reference.kind != "material"
        ] + [
            ChatReference(id=material_id, kind="material", title=title)
            for material_id, title in material_titles.items()
        ]
        merged_insights = _merge_unique(json.loads(row["insight_ids"] or "[]"), insight_ids)
        merged_cases = _merge_unique(json.loads(row["case_ids"] or "[]"), case_ids)
        merged_materials = _merge_unique(json.loads(row["material_ids"] or "[]"), material_ids or [])
        merged_preferences = _merge_preferences(
            json.loads(row["preference_keys"] or "[]"), preference_keys,
        )
        conn.execute("""
            UPDATE creation_sessions
            SET messages = ?, insight_ids = ?, case_ids = ?, material_ids = ?, preference_keys = ?, updated_at = ?
            WHERE id = ?
        """, (
            json.dumps([item.model_dump(mode="json") for item in messages], ensure_ascii=False),
            json.dumps(merged_insights, ensure_ascii=False),
            json.dumps(merged_cases, ensure_ascii=False),
            json.dumps(merged_materials, ensure_ascii=False),
            json.dumps(merged_preferences, ensure_ascii=False),
            now,
            session_id,
        ))
        conn.commit()
    finally:
        conn.close()
    return get_session(session_id)


def append_assistant_message(session_id: str, message: ChatMessage) -> SessionResponse | None:
    """Append an assistant reply without overwriting concurrent messages or context."""
    init_db()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        query = "SELECT messages FROM creation_sessions WHERE id = ?"
        if is_postgresql(conn):
            query += " FOR UPDATE"
        row = conn.execute(query, (session_id,)).fetchone()
        if row is None:
            conn.rollback()
            return None
        messages = [ChatMessage(**item) for item in json.loads(row["messages"] or "[]")]
        messages.append(message)
        conn.execute(
            "UPDATE creation_sessions SET messages = ?, updated_at = ? WHERE id = ?",
            (
                json.dumps([item.model_dump(mode="json") for item in messages], ensure_ascii=False),
                now,
                session_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return get_session(session_id)


def replace_latest_user_exchange(
    session_id: str,
    expected_messages: list[ChatMessage],
    user_message: ChatMessage,
    assistant_message: ChatMessage,
) -> SessionResponse | None:
    """Replace the latest user message and its reply without overwriting concurrent messages."""
    init_db()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT messages FROM creation_sessions WHERE id = ?", (session_id,),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        messages = [ChatMessage(**item) for item in json.loads(row["messages"] or "[]")]
        if [item.model_dump(mode="json") for item in messages] != [
            item.model_dump(mode="json") for item in expected_messages
        ]:
            conn.rollback()
            return None
        user_index = next(
            (index for index in range(len(messages) - 1, -1, -1) if messages[index].role == "user"),
            -1,
        )
        if user_index < 0:
            conn.rollback()
            return None
        messages = [*messages[:user_index], user_message, assistant_message]
        conn.execute(
            "UPDATE creation_sessions SET messages = ?, updated_at = ? WHERE id = ?",
            (
                json.dumps([item.model_dump(mode="json") for item in messages], ensure_ascii=False),
                now,
                session_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return get_session(session_id)


def delete_session(session_id: str) -> bool:
    init_db()
    conn = _get_conn()
    conn.execute("DELETE FROM content_versions WHERE session_id = ?", (session_id,))
    cursor = conn.execute("DELETE FROM creation_sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def _row_to_session(row: sqlite3.Row) -> SessionResponse:
    messages = []
    try:
        raw = json.loads(row["messages"] or "[]")
        messages = [ChatMessage(**m) for m in raw]
    except (json.JSONDecodeError, TypeError):
        pass

    activities = []
    try:
        raw = json.loads(row["activities"] or "[]")
        activities = [CreationActivity(**item) for item in raw]
    except (json.JSONDecodeError, TypeError):
        pass

    cards = []
    try:
        raw = json.loads(row["cards"] or "[]")
        cards = [ContentCard(**c) for c in raw]
    except (json.JSONDecodeError, TypeError):
        pass

    insight_ids = []
    try:
        insight_ids = json.loads(row["insight_ids"] or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    case_ids = []
    try:
        case_ids = json.loads(row["case_ids"] or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    preference_keys = []
    try:
        preference_keys = json.loads(row["preference_keys"] or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    material_ids = []
    try:
        parsed = json.loads(row["material_ids"] or "[]")
        if isinstance(parsed, list):
            material_ids = [item for item in parsed if isinstance(item, str)]
    except (json.JSONDecodeError, TypeError, KeyError, IndexError):
        pass

    return SessionResponse(
        id=row["id"],
        user_id=row["user_id"],
        creator_name=row["creator_name"] if "creator_name" in row.keys() else "",
        project_id=row["project_id"] if "project_id" in row.keys() else "",
        organization_id=row["organization_id"],
        project_role=(row["project_role"] or "") if "project_role" in row.keys() else "",
        title=row["title"] or "",
        messages=messages,
        cards=cards,
        status=row["status"] or "drafting",
        insight_ids=insight_ids,
        case_ids=case_ids,
        material_ids=material_ids,
        preference_keys=preference_keys,
        activities=activities,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Version History ──


def _row_to_version(row: sqlite3.Row) -> ContentVersion:
    cards = []
    try:
        raw = json.loads(row["cards"] or "[]")
        cards = [ContentCard(**c) for c in raw]
    except (json.JSONDecodeError, TypeError):
        pass
    try:
        changed_card_ids = json.loads(row["changed_card_ids"] or "[]")
    except (json.JSONDecodeError, TypeError):
        changed_card_ids = []
    return ContentVersion(
        id=row["id"],
        session_id=row["session_id"],
        version_label=row["version_label"],
        major=row["major"],
        minor=row["minor"],
        version_type=(row["version_type"] or ("generation" if row["minor"] == 0 else "edit")),
        source_version_label=row["source_version_label"] or "",
        changed_card_ids=changed_card_ids,
        cards=cards,
        created_at=row["created_at"],
    )


def create_activity(
    activity_type: str,
    *,
    card_id: str = "",
    card_title: str = "",
    card_count: int = 0,
) -> CreationActivity:
    return CreationActivity(
        id=uuid.uuid4().hex[:12],
        activity_type=activity_type,
        card_id=card_id,
        card_title=card_title,
        card_count=card_count,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    )


def _append_activity_in_connection(
    conn: sqlite3.Connection,
    session_id: str,
    activity: CreationActivity,
) -> None:
    row = conn.execute(
        "SELECT activities FROM creation_sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if row is None:
        raise ValueError("Session not found")
    try:
        activities = json.loads(row["activities"] or "[]")
    except (json.JSONDecodeError, TypeError):
        activities = []
    activities.append(activity.model_dump())
    conn.execute(
        "UPDATE creation_sessions SET activities = ?, updated_at = ? WHERE id = ?",
        (
            json.dumps(activities, ensure_ascii=False),
            activity.created_at,
            session_id,
        ),
    )


def append_activity(session_id: str, activity: CreationActivity) -> None:
    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        _append_activity_in_connection(conn, session_id, activity)
        conn.commit()
    finally:
        conn.close()


def save_next_version(
    session_id: str,
    cards: list[ContentCard],
    is_major_bump: bool,
    activity: CreationActivity | None = None,
    version_type: str = "",
    source_version_label: str = "",
    changed_card_ids: list[str] | None = None,
) -> ContentVersion:
    """Atomically compute next version number and save the version record."""
    init_db()
    conn = _get_conn()
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT major, minor FROM content_versions WHERE session_id = ? ORDER BY major DESC, minor DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if row is None:
        major, minor = 1, 0
    else:
        major, minor = row["major"], row["minor"]
        if is_major_bump:
            major, minor = major + 1, 0
        else:
            minor = minor + 1

    vid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    label = f"v{major}.{minor}"
    resolved_version_type = version_type or ("generation" if minor == 0 else "edit")
    cards_json = json.dumps(
        [v.model_dump() if hasattr(v, "model_dump") else v for v in cards],
        ensure_ascii=False,
    )
    conn.execute(
        "INSERT INTO content_versions "
        "(id, session_id, version_label, major, minor, version_type, source_version_label, changed_card_ids, cards, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            vid, session_id, label, major, minor, resolved_version_type,
            source_version_label,
            json.dumps(changed_card_ids or [], ensure_ascii=False),
            cards_json,
            now,
        ),
    )
    if activity is not None:
        _append_activity_in_connection(conn, session_id, activity)
    conn.commit()
    conn.close()
    return ContentVersion(
        id=vid, session_id=session_id, version_label=label,
        major=major, minor=minor, version_type=resolved_version_type,
        source_version_label=source_version_label,
        changed_card_ids=changed_card_ids or [],
        cards=cards,
        created_at=now,
    )


def get_versions(session_id: str) -> list[ContentVersion]:
    init_db()
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM content_versions WHERE session_id = ? ORDER BY major ASC, minor ASC",
        (session_id,),
    ).fetchall()
    conn.close()
    return [_row_to_version(r) for r in rows]


def get_version(version_id: str) -> ContentVersion | None:
    init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM content_versions WHERE id = ?", (version_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_version(row)
