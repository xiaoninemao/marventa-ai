"""Publishing schema migrations and compatibility exports for active project storage."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import DB_PATH
from app.database import connect_database
from app.engines.publishing import (
    project_channel_accounts,
    project_materials,
    project_memberships,
    projects,
    publication_plans,
)
from app.engines.publishing.material_copy import copy_html_to_text
from app.engines.publishing.models import ContentProject as ContentProject

# Keep the original storage-module imports available to existing project clients.
from app.engines.publishing.project_memberships import (
    ProjectNotFound as ProjectNotFound,
)
from app.engines.publishing.project_memberships import (
    ProjectPermissionDenied as ProjectPermissionDenied,
)
from app.engines.publishing.projects import (
    PROJECT_AVATAR_COLORS as PROJECT_AVATAR_COLORS,
)
from app.engines.publishing.projects import (
    PROJECT_AVATAR_ICONS,
)
from app.engines.publishing.projects import (
    ProjectNameExists as ProjectNameExists,
)
from app.engines.publishing.projects import (
    create_manual_project as create_manual_project,
)
from app.engines.publishing.projects import (
    create_project_from_session as create_project_from_session,
)
from app.engines.publishing.projects import (
    delete_project as delete_project,
)
from app.engines.publishing.projects import (
    get_project as get_project,
)
from app.engines.publishing.projects import (
    list_projects as list_projects,
)
from app.engines.publishing.projects import (
    update_project as update_project,
)
from app.storage_schema import ensure_json_columns, ensure_organization_scope


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def backfill_publication_positions(conn: sqlite3.Connection) -> None:
    conn.execute("""
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY plan_id ORDER BY created_at, id
            ) - 1 AS position
            FROM publication_contents
        )
        UPDATE publication_contents SET position = (
            SELECT ranked.position FROM ranked WHERE ranked.id = publication_contents.id
        )
    """)


def backfill_publication_copy_text(conn: sqlite3.Connection) -> None:
    for row in conn.execute(
        "SELECT id, copy_content_html FROM project_publications WHERE copy_text IS NULL",
    ).fetchall():
        conn.execute(
            "UPDATE project_publications SET copy_text = ? WHERE id = ? AND copy_text IS NULL",
            (copy_html_to_text(row["copy_content_html"]), row["id"]),
        )


def backfill_publication_media_modes(conn: sqlite3.Connection) -> None:
    conn.execute("""
        UPDATE project_publications SET media_mode = 'video'
        WHERE EXISTS (
            SELECT 1 FROM publication_contents c
            WHERE c.plan_id = project_publications.id AND c.media_type = 'video'
        ) AND NOT EXISTS (
            SELECT 1 FROM publication_contents c
            WHERE c.plan_id = project_publications.id AND c.media_type = 'image'
        )
    """)


def _create_project_materials_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_materials (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            parent_id TEXT NOT NULL DEFAULT '',
            node_type TEXT NOT NULL DEFAULT 'file' CHECK (
                node_type IN ('collection', 'file')
            ),
            name TEXT NOT NULL,
            media_type TEXT NOT NULL CHECK (
                media_type IN ('image', 'video', 'document')
            ),
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            object_key TEXT NOT NULL,
            created_by_user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)


def _migrate_project_material_collections(conn: sqlite3.Connection) -> None:
    if getattr(conn, "dialect", "") == "postgresql":
        _create_project_materials_table(conn)
        return
    definition = conn.execute(
        "SELECT sql FROM sqlite_master "
        "WHERE type = 'table' AND name = 'project_materials'",
    ).fetchone()
    if definition is None or "'folder'" not in (definition["sql"] or ""):
        _create_project_materials_table(conn)
        return

    legacy_rows = [
        dict(row)
        for row in conn.execute("SELECT * FROM project_materials").fetchall()
    ]
    conn.execute("DROP TABLE project_materials")
    _create_project_materials_table(conn)

    rows_by_id = {row["id"]: row for row in legacy_rows}
    material_sets = [
        row for row in legacy_rows
        if row.get("node_type") == "folder" and not row.get("parent_id")
    ]
    used_names = {
        (row["project_id"], row["name"].lower())
        for row in material_sets
    }
    fallback_sets: dict[str, dict[str, Any]] = {}

    def root_set_id(row: dict[str, Any]) -> str:
        parent_id = row.get("parent_id", "")
        seen: set[str] = set()
        while parent_id and parent_id not in seen:
            seen.add(parent_id)
            parent = rows_by_id.get(parent_id)
            if parent is None:
                break
            if parent.get("node_type") == "folder" and not parent.get("parent_id"):
                return str(parent["id"])
            parent_id = str(parent.get("parent_id", ""))
        project_id = str(row["project_id"])
        if project_id not in fallback_sets:
            name = "Migrated materials"
            suffix = 2
            while (project_id, name.lower()) in used_names:
                name = f"Migrated materials {suffix}"
                suffix += 1
            used_names.add((project_id, name.lower()))
            fallback_sets[project_id] = {
                **row,
                "id": uuid.uuid4().hex[:12],
                "parent_id": "",
                "node_type": "collection",
                "name": name,
                "media_type": "document",
                "mime_type": "",
                "file_size": 0,
                "object_key": "",
            }
        return str(fallback_sets[project_id]["id"])

    migrated_rows = [
        {**row, "node_type": "collection"}
        for row in material_sets
    ]
    files = [row for row in legacy_rows if row.get("node_type") == "file"]
    migrated_files = [
        {**row, "parent_id": root_set_id(row)}
        for row in files
    ]
    migrated_rows.extend(fallback_sets.values())
    migrated_rows.extend(migrated_files)
    for row in migrated_rows:
        conn.execute(
            """
            INSERT INTO project_materials (
                id, project_id, parent_id, node_type, name, media_type,
                mime_type, file_size, object_key, created_by_user_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"], row["project_id"], row["parent_id"], row["node_type"],
                row["name"], row["media_type"], row["mime_type"],
                row["file_size"], row["object_key"], row["created_by_user_id"],
                row["created_at"], row["updated_at"],
            ),
        )


def _strip_project_material_extensions(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS publishing_migrations (key TEXT PRIMARY KEY)",
    )
    migration_key = "stable-material-names-v1"
    if conn.execute(
        "SELECT 1 FROM publishing_migrations WHERE key = ?", (migration_key,),
    ).fetchone():
        return
    rows = conn.execute(
        "SELECT id, project_id, parent_id, name, object_key FROM project_materials "
        "WHERE node_type = 'file' AND mime_type != 'text/html'",
    ).fetchall()
    for row in rows:
        name = str(row["name"])
        if Path(name).suffix.lower() != Path(row["object_key"]).suffix.lower():
            continue
        normalized_name = Path(name).stem.strip()
        if not normalized_name or normalized_name == name:
            continue
        duplicate = conn.execute(
            "SELECT 1 FROM project_materials "
            "WHERE project_id = ? AND parent_id = ? AND lower(name) = lower(?) "
            "AND id != ?",
            (
                row["project_id"], row["parent_id"], normalized_name, row["id"],
            ),
        ).fetchone()
        if duplicate is None:
            conn.execute(
                "UPDATE project_materials SET name = ? WHERE id = ?",
                (normalized_name, row["id"]),
            )
    conn.execute(
        "INSERT INTO publishing_migrations (key) VALUES (?) ON CONFLICT DO NOTHING",
        (migration_key,),
    )


_schema_guard = threading.RLock()
_initialized_postgres_databases: set[str] = set()


def init_db() -> None:
    from app.config import DATABASE_URL

    with _schema_guard:
        with closing(_get_conn()) as conn, conn:
            postgres = getattr(conn, "dialect", "") == "postgresql"
            if postgres:
                conn.execute("SELECT pg_advisory_xact_lock(hashtext('marventa.publishing.schema'))")
            _initialize_schema(conn)
        if postgres:
            _initialized_postgres_databases.add(DATABASE_URL)


def _ensure_db_initialized() -> None:
    from app.config import DATABASE_URL

    if DATABASE_URL:
        with _schema_guard:
            if DATABASE_URL not in _initialized_postgres_databases:
                init_db()
    else:
        init_db()


def _initialize_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS content_projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            xhs_account TEXT DEFAULT '',
            source_session_id TEXT NOT NULL,
            source_card_id TEXT DEFAULT '',
            content_type TEXT DEFAULT 'mixed',
            platform_hint TEXT DEFAULT '',
            cards_snapshot TEXT DEFAULT '[]',
            final_snapshot TEXT DEFAULT '{}',
            notes TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(content_projects)").fetchall()]
    if "avatar_color" not in cols:
        conn.execute(
            "ALTER TABLE content_projects ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#bfdbfe'"
        )
    if "avatar_icon" not in cols:
        conn.execute(
            "ALTER TABLE content_projects ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT '💡'"
        )
    allowed_avatar_icons = ",".join("?" for _ in PROJECT_AVATAR_ICONS)
    conn.execute(
        f"UPDATE content_projects SET avatar_icon = '💡' "
        f"WHERE avatar_icon NOT IN ({allowed_avatar_icons})",
        tuple(PROJECT_AVATAR_ICONS),
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_memberships (
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, user_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_channel_accounts (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            platform TEXT NOT NULL CHECK (platform IN ('xiaohongshu', 'douyin')),
            account_name TEXT NOT NULL,
            platform_user_id TEXT NOT NULL DEFAULT '',
            profile_url TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            created_by_user_id TEXT NOT NULL DEFAULT '',
            authorization_status TEXT NOT NULL DEFAULT 'active',
            scopes TEXT NOT NULL DEFAULT '[]',
            credential_blob TEXT NOT NULL DEFAULT '',
            token_expires_at TEXT NOT NULL DEFAULT '',
            refresh_token_expires_at TEXT NOT NULL DEFAULT '',
            last_refreshed_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (project_id, platform, account_name)
        )
    """)
    channel_account_cols = [
        row[1] for row in conn.execute(
            "PRAGMA table_info(project_channel_accounts)",
        ).fetchall()
    ]
    if "created_by_user_id" not in channel_account_cols:
        conn.execute(
            "ALTER TABLE project_channel_accounts "
            "ADD COLUMN created_by_user_id TEXT NOT NULL DEFAULT ''",
        )
    for column, ddl in {
        "authorization_status": "TEXT NOT NULL DEFAULT 'active'",
        "scopes": "TEXT NOT NULL DEFAULT '[]'",
        "credential_blob": "TEXT NOT NULL DEFAULT ''",
        "token_expires_at": "TEXT NOT NULL DEFAULT ''",
        "refresh_token_expires_at": "TEXT NOT NULL DEFAULT ''",
        "last_refreshed_at": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if column not in channel_account_cols:
            conn.execute(
                f"ALTER TABLE project_channel_accounts ADD COLUMN {column} {ddl}",
            )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_channel_authorization_states (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            platform TEXT NOT NULL CHECK (platform IN ('xiaohongshu', 'douyin')),
            user_id TEXT NOT NULL,
            provider_code TEXT NOT NULL DEFAULT '',
            poll_interval_seconds INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT NOT NULL DEFAULT ''
        )
    """)
    authorization_state_cols = [
        row[1] for row in conn.execute(
            "PRAGMA table_info(project_channel_authorization_states)",
        ).fetchall()
    ]
    for column, ddl in {
        "provider_code": "TEXT NOT NULL DEFAULT ''",
        "poll_interval_seconds": "INTEGER NOT NULL DEFAULT 1",
    }.items():
        if column not in authorization_state_cols:
            conn.execute(
                "ALTER TABLE project_channel_authorization_states "
                f"ADD COLUMN {column} {ddl}",
            )
    conn.execute("""
        UPDATE project_channel_accounts
        SET created_by_user_id = COALESCE((
            SELECT membership.user_id
            FROM project_memberships membership
            WHERE membership.project_id = project_channel_accounts.project_id
              AND membership.role = 'owner'
            ORDER BY membership.created_at, membership.user_id
            LIMIT 1
        ), '')
        WHERE created_by_user_id = ''
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_channel_accounts_project "
        "ON project_channel_accounts(project_id, platform, created_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_channel_authorization_states_expiry "
        "ON project_channel_authorization_states(expires_at, consumed_at)"
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_publications (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            portfolio_id TEXT NOT NULL,
            channel_account_id TEXT NOT NULL,
            created_by_user_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
                status IN ('draft', 'scheduled', 'cancelled', 'published', 'failed')
            ),
            scheduled_for TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_publications_project_status "
        "ON project_publications(project_id, status, created_at DESC)"
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publication_executions (
            plan_id TEXT PRIMARY KEY REFERENCES project_publications(id) ON DELETE CASCADE,
            attempt_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
            started_at TEXT NOT NULL,
            heartbeat_at TEXT NOT NULL,
            submission_started INTEGER NOT NULL DEFAULT 0,
            published_at TEXT NOT NULL DEFAULT '',
            platform_post_id TEXT NOT NULL DEFAULT '',
            platform_video_id TEXT NOT NULL DEFAULT '',
            error_message TEXT NOT NULL DEFAULT '',
            outcome_unknown INTEGER NOT NULL DEFAULT 0
        )
    """)
    execution_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(publication_executions)").fetchall()
    }
    if "platform_video_id" not in execution_columns:
        conn.execute(
            "ALTER TABLE publication_executions ADD COLUMN platform_video_id TEXT NOT NULL DEFAULT ''",
        )
    publication_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(project_publications)").fetchall()
    }
    if "name" not in publication_columns:
        conn.execute("ALTER TABLE project_publications ADD COLUMN name TEXT NOT NULL DEFAULT ''")
    for column in ("copy_title", "copy_content_html"):
        if column not in publication_columns:
            conn.execute(
                f"ALTER TABLE project_publications ADD COLUMN {column} TEXT NOT NULL DEFAULT ''",
            )
    if "copy_text" not in publication_columns:
        conn.execute("ALTER TABLE project_publications ADD COLUMN copy_text TEXT")
    if "copy_tags" not in publication_columns:
        conn.execute("ALTER TABLE project_publications ADD COLUMN copy_tags TEXT NOT NULL DEFAULT '[]'")
    backfill_publication_copy_text(conn)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publication_contents (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL REFERENCES project_publications(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'document')),
            mime_type TEXT NOT NULL,
            object_key TEXT NOT NULL DEFAULT '',
            content_html TEXT,
            source_material_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    content_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(publication_contents)").fetchall()
    }
    if "position" not in content_columns:
        conn.execute(
            "ALTER TABLE publication_contents ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
        )
        backfill_publication_positions(conn)
    if "media_mode" not in publication_columns:
        conn.execute(
            "ALTER TABLE project_publications ADD COLUMN media_mode TEXT NOT NULL "
            "DEFAULT 'image_text' CHECK (media_mode IN ('image_text', 'video'))",
        )
        backfill_publication_media_modes(conn)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_publication_contents_position "
        "ON publication_contents(plan_id, position, id)",
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_publication_contents_plan "
        "ON publication_contents(plan_id, created_at, id)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_publication_contents_source "
        "ON publication_contents(plan_id, source_material_id) WHERE source_material_id != ''"
    )
    _migrate_project_material_collections(conn)
    _strip_project_material_extensions(conn)
    material_cols = [
        row[1] for row in conn.execute(
            "PRAGMA table_info(project_materials)",
        ).fetchall()
    ]
    for column, ddl in {
        "parent_id": "TEXT NOT NULL DEFAULT ''",
        "node_type": "TEXT NOT NULL DEFAULT 'file'",
        "content_html": "TEXT",
    }.items():
        if column not in material_cols:
            conn.execute(
                f"ALTER TABLE project_materials ADD COLUMN {column} {ddl}",
            )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_materials_project_created "
        "ON project_materials(project_id, created_at DESC)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_materials_unique_name "
        "ON project_materials(project_id, parent_id, name)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_memberships_user "
        "ON project_memberships(user_id, project_id)"
    )
    conn.execute("""
        INSERT OR IGNORE INTO project_memberships (project_id, user_id, role, created_at)
        SELECT id, user_id, 'owner', created_at
        FROM content_projects
    """)
    conn.execute("""
        UPDATE project_memberships
        SET role = 'owner'
        WHERE (project_id, user_id) IN (
            SELECT project.id, (
                SELECT candidate.user_id
                FROM project_memberships candidate
                WHERE candidate.project_id = project.id
                ORDER BY candidate.created_at, candidate.user_id
                LIMIT 1
            )
            FROM content_projects project
            WHERE NOT EXISTS (
                SELECT 1
                FROM project_memberships owner
                WHERE owner.project_id = project.id AND owner.role = 'owner'
            )
        )
    """)
    conn.execute("""
        WITH ranked_owners AS (
            SELECT project_id, user_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY project_id
                       ORDER BY created_at, user_id
                   ) AS owner_number
            FROM project_memberships
            WHERE role = 'owner'
        )
        UPDATE project_memberships
        SET role = 'admin'
        WHERE (project_id, user_id) IN (
            SELECT project_id, user_id
            FROM ranked_owners
            WHERE owner_number > 1
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_memberships_single_owner
        ON project_memberships(project_id)
        WHERE role = 'owner'
    """)
    # Retain retired publishing tables and migrations for historical data and exports.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            project_id TEXT DEFAULT '',
            source_session_id TEXT NOT NULL,
            source_card_id TEXT DEFAULT '',
            platform TEXT DEFAULT 'xiaohongshu',
            account_name TEXT DEFAULT '',
            content_type TEXT DEFAULT 'mixed',
            status TEXT DEFAULT 'pending_publish',
            selected_version_ids TEXT DEFAULT '{}',
            original_cards TEXT DEFAULT '[]',
            final_snapshot TEXT DEFAULT '{}',
            planned_publish_at TEXT DEFAULT '',
            published_at TEXT DEFAULT '',
            publish_link TEXT DEFAULT '',
            platform_work_id TEXT DEFAULT '',
            metrics TEXT DEFAULT '{}',
            review TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_metrics (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            views INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            collects INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            followers INTEGER DEFAULT 0,
            leads INTEGER DEFAULT 0,
            completion_rate REAL DEFAULT 0,
            interaction_rate REAL DEFAULT 0,
            collect_rate REAL DEFAULT 0,
            raw_data TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_reviews (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            summary TEXT DEFAULT '',
            success_reasons TEXT DEFAULT '[]',
            problem_reasons TEXT DEFAULT '[]',
            reusable_structures TEXT DEFAULT '[]',
            next_directions TEXT DEFAULT '[]',
            series_potential TEXT DEFAULT '',
            memory_update_suggestion TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS account_memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            platform TEXT DEFAULT 'xiaohongshu',
            account_name TEXT NOT NULL,
            brand_positioning TEXT DEFAULT '',
            target_users TEXT DEFAULT '',
            product_selling_points TEXT DEFAULT '',
            content_style TEXT DEFAULT '',
            banned_expressions TEXT DEFAULT '[]',
            common_tags TEXT DEFAULT '[]',
            high_performing_content TEXT DEFAULT '[]',
            low_performing_directions TEXT DEFAULT '[]',
            ai_operation_lessons TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS social_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            account_name TEXT NOT NULL,
            platform_user_id TEXT DEFAULT '',
            nickname TEXT DEFAULT '',
            avatar_url TEXT DEFAULT '',
            profile_url TEXT DEFAULT '',
            account_type TEXT DEFAULT 'ordinary',
            remark TEXT DEFAULT '',
            session_dir TEXT NOT NULL,
            status TEXT DEFAULT 'authorized',
            cookie_status TEXT DEFAULT 'unknown',
            profile TEXT DEFAULT '{}',
            credential_blob TEXT DEFAULT '',
            last_checked_at TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    social_cols = [r[1] for r in conn.execute("PRAGMA table_info(social_accounts)").fetchall()]
    for col, ddl in {
        "platform_user_id": "TEXT DEFAULT ''",
        "nickname": "TEXT DEFAULT ''",
        "avatar_url": "TEXT DEFAULT ''",
        "profile_url": "TEXT DEFAULT ''",
        "account_type": "TEXT DEFAULT 'ordinary'",
        "remark": "TEXT DEFAULT ''",
        "cookie_status": "TEXT DEFAULT 'unknown'",
        "credential_blob": "TEXT DEFAULT ''",
    }.items():
        if col not in social_cols:
            conn.execute(f"ALTER TABLE social_accounts ADD COLUMN {col} {ddl}")
    for table in (
        "content_projects",
        "publish_tasks",
        "publish_metrics",
        "publish_reviews",
        "account_memories",
        "social_accounts",
    ):
        ensure_organization_scope(conn, table, "user_id")
    ensure_json_columns(
        conn, "content_projects",
        ("cards_snapshot", "final_snapshot"),
    )
    ensure_json_columns(
        conn, "publish_tasks",
        ("selected_version_ids", "original_cards", "final_snapshot", "metrics", "review"),
    )
    ensure_json_columns(conn, "publish_metrics", ("raw_data",))
    ensure_json_columns(
        conn, "publish_reviews",
        ("success_reasons", "problem_reasons", "reusable_structures", "next_directions"),
    )
    ensure_json_columns(
        conn, "account_memories",
        (
            "banned_expressions", "common_tags", "high_performing_content",
            "low_performing_directions", "ai_operation_lessons",
        ),
    )
    ensure_json_columns(conn, "social_accounts", ("profile",))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_projects_org_user_updated "
        "ON content_projects(organization_id, user_id, updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_org_user_status_updated "
        "ON publish_tasks(organization_id, user_id, status, updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_org_platform_name "
        "ON social_accounts(organization_id, platform, account_name)"
    )


project_memberships.configure(_get_conn, _ensure_db_initialized, _now)
projects.configure(_get_conn, _ensure_db_initialized, _now)
project_channel_accounts.configure(_get_conn, _ensure_db_initialized, _now)
publication_plans.configure(_get_conn, _ensure_db_initialized, _now)
project_materials.configure(_get_conn, _ensure_db_initialized, _now)
