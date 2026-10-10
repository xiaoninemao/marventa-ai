from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from app.config import DB_PATH
from app.database import connect_database, is_postgresql
from app.engines.content_generator.models import (
    AgentTurnResult,
    ChatMessage,
    ChatReference,
    CreationActivity,
    CreationPlan,
    CreativeDeliverable,
    SessionResponse,
)
from app.storage_schema import (
    ensure_json_columns,
    ensure_organization_scope,
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
            deliverables TEXT DEFAULT '[]',
            status TEXT DEFAULT 'drafting',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(creation_sessions)").fetchall()]
    if "creation_kind" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN creation_kind TEXT NOT NULL DEFAULT 'image'")
        deliverable_column = "deliverables" if "deliverables" in cols else "'[]' AS deliverables"
        preference_column = "preference_keys" if "preference_keys" in cols else "'[]' AS preference_keys"
        for row in conn.execute(f"SELECT id, {deliverable_column}, {preference_column} FROM creation_sessions").fetchall():
            items = json.loads(row["deliverables"] or "[]")
            preferences = json.loads(row["preference_keys"] or "[]")
            if (items and items[-1].get("media_kind") == "video") or (not items and "short_video" in preferences):
                conn.execute("UPDATE creation_sessions SET creation_kind = 'video' WHERE id = ?", (row["id"],))
    if "plans" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN plans TEXT NOT NULL DEFAULT '[]'")
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
    if "deliverables" not in cols:
        conn.execute(
            "ALTER TABLE creation_sessions ADD COLUMN deliverables TEXT NOT NULL DEFAULT '[]'",
        )
    if "project_id" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
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
    ensure_json_columns(
        conn, "creation_sessions", (
            "messages", "deliverables", "insight_ids", "case_ids",
            "material_ids", "preference_keys", "activities", "plans",
        ),
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_org_user_updated "
        "ON creation_sessions(organization_id, user_id, updated_at DESC)"
    )
    ensure_project_scope(conn, "creation_sessions")
    from app.engines.content_generator.presence import ensure_presence_schema
    ensure_presence_schema(conn)
    from app.engines.content_generator.agent_jobs import (
        ensure_schema as ensure_agent_jobs_schema,
    )
    ensure_agent_jobs_schema(conn)
    conn.commit()
    conn.close()

def create_session(user_id: str, project_id: str = "", title: str = "", creation_kind: str = "image") -> SessionResponse:
    if creation_kind not in {"image", "video"}:
        raise ValueError("Unsupported creation kind")
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
        "INSERT INTO creation_sessions (id, user_id, project_id, title, messages, status, insight_ids, case_ids, preference_keys, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, project_id, title, "[]", "drafting", "[]", "[]", "[]", now, now, organization_id),
    )
    conn.execute("UPDATE creation_sessions SET creation_kind = ? WHERE id = ?", (creation_kind, sid))
    conn.commit()
    conn.close()
    return SessionResponse(
        id=sid, user_id=user_id, project_id=project_id, title=title, messages=[],
        organization_id=organization_id, project_role=project_role,
        status="drafting", insight_ids=[], case_ids=[], preference_keys=[],
        deliverables=[], creation_kind=creation_kind,
        created_at=now, updated_at=now,
    )

def get_session(session_id: str, user_id: str | None = None, *, initialize: bool = True) -> SessionResponse | None:
    if initialize:
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
            if key in ("messages", "deliverables", "activities", "plans") and isinstance(val, list):
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

def commit_agent_result(
    expected: SessionResponse,
    result: AgentTurnResult,
    replacement_user: ChatMessage | None = None,
    *,
    append_reply: bool = True,
) -> SessionResponse:
    """Commit the turn and all work snapshots together, without overwriting concurrent edits."""
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        query = "SELECT * FROM creation_sessions WHERE id = ?"
        if is_postgresql(conn):
            query += " FOR UPDATE"
        row = conn.execute(query, (expected.id,)).fetchone()
        if row is None:
            raise LookupError("Session not found")
        current = _row_to_session(row)
        from app.engines.content_generator.agent_jobs import require_idle
        require_idle(expected.id, conn)
        if (current.messages != expected.messages
                or current.deliverables != expected.deliverables
                or current.plans != expected.plans):
            raise ValueError("Creation changed; reload and try again")
        revisions = result.revisions or ([result.deliverable] if result.deliverable else [])
        revisions = [item for item in revisions if item.id not in {old.id for old in current.deliverables}]
        for revision in revisions:
            if revision.media_kind != current.creation_kind:
                raise ValueError("Work type does not match creation type")
            if current.creation_kind == "image" and revision.video_url:
                raise ValueError("Image creation cannot contain video")
            if current.creation_kind == "video" and (revision.image_url or revision.additional_image_urls):
                raise ValueError("Video creation cannot contain images")
        messages = list(current.messages)
        if replacement_user:
            index = next(i for i in range(len(messages) - 1, -1, -1) if messages[i].role == "user")
            messages = [*messages[:index], replacement_user]
        if append_reply:
            messages.append(ChatMessage(role="assistant", content=result.reply, agent_events=result.agent_events))
        deliverables = [*current.deliverables, *revisions]
        plans = [*current.plans, *result.plans]
        status = "completed" if revisions else current.status
        now = datetime.now(timezone.utc).isoformat()
        values = [
            json.dumps([item.model_dump(mode="json") for item in items], ensure_ascii=False)
            for items in (messages, deliverables, plans)
        ]
        conn.execute(
            "UPDATE creation_sessions SET messages = ?, deliverables = ?, plans = ?, "
            "status = ?, updated_at = ? WHERE id = ?",
            (*values, status, now, expected.id),
        )
        updated = current.model_copy(update={
            "messages": messages, "deliverables": deliverables, "plans": plans,
            "status": status, "updated_at": now, "project_role": expected.project_role,
            "creator_name": expected.creator_name,
        })
        from app.engines.content_generator.agent_jobs import (
            commit_checkpoint,
            current_job,
        )
        if current_job.get():
            commit_checkpoint(conn, {
                "success": True, "message": "Agent task completed", "data": {
                    "reply": messages[-1].model_dump(mode="json"),
                    "session": updated.model_dump(mode="json"),
                    "intent": result.intent,
                    "deliverable": result.deliverable.model_dump(mode="json") if result.deliverable else None,
                },
            })
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return updated

def restore_deliverable(session: SessionResponse, version_id: str, expected_version_id: str) -> SessionResponse:
    if not session.deliverables or session.deliverables[-1].id != expected_version_id:
        raise ValueError("Work version changed; reload and try again")
    source = next((item for item in session.deliverables if item.id == version_id), None)
    if source is None:
        raise LookupError("Work version not found")
    restored = source.model_copy(update={
        "id": uuid.uuid4().hex[:12],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_version_id": source.id,
    })
    return commit_agent_result(
        session, AgentTurnResult(intent="create", reply="Version restored", revisions=[restored]),
        append_reply=False,
    )

def delete_session(session_id: str) -> bool:
    init_db()
    conn = _get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "SELECT id FROM creation_sessions WHERE id = ?"
            + (" FOR UPDATE" if is_postgresql(conn) else ""), (session_id,),
        ).fetchone()
        from app.engines.content_generator.agent_jobs import require_idle
        from app.media_storage import delete_media
        require_idle(session_id, conn)
        for row in conn.execute(
            "SELECT owned_keys FROM creation_agent_jobs WHERE session_id = ? AND owned_keys != '[]'",
            (session_id,),
        ).fetchall():
            for key in json.loads(row["owned_keys"]):
                delete_media(key)
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_versions'",
        ).fetchone():
            conn.execute("DELETE FROM content_versions WHERE session_id = ?", (session_id,))
        cursor = conn.execute("DELETE FROM creation_sessions WHERE id = ?", (session_id,))
        conn.commit()
        return cursor.rowcount > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

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
        activities = [
            CreationActivity(**{
                **item,
                "work_id": item.get("work_id", item.get("card_id", "")),
                "work_title": item.get("work_title", item.get("card_title", "")),
            })
            for item in raw
            if item["activity_type"] in {"agent_explored", "deliverable_created", "work_generation_started"}
        ]
    except (json.JSONDecodeError, TypeError):
        pass

    deliverables = []
    try:
        raw = json.loads(row["deliverables"] or "[]")
        deliverables = [CreativeDeliverable(**item) for item in raw]
    except (json.JSONDecodeError, TypeError, KeyError, IndexError):
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
        deliverables=deliverables,
        creation_kind=row["creation_kind"],
        plans=[CreationPlan(**item) for item in json.loads(row["plans"] or "[]")],
        status=row["status"] or "drafting",
        insight_ids=insight_ids,
        case_ids=case_ids,
        material_ids=material_ids,
        preference_keys=preference_keys,
        activities=activities,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )

def create_activity(
    activity_type: str,
    *,
    work_id: str = "",
    work_title: str = "",
) -> CreationActivity:
    return CreationActivity(
        id=uuid.uuid4().hex[:12],
        activity_type=activity_type,
        work_id=work_id,
        work_title=work_title,
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
