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
from app.engines.publishing.lead_identity import (
    lead_account_key,
    legacy_lead_account_key,
)
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
            ai_transcript TEXT NOT NULL DEFAULT '',
            ai_transcript_model TEXT NOT NULL DEFAULT '',
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


def _initialize_account_lead_tracking(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_tracking_account_targets (
            account_key TEXT NOT NULL,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            discovered_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            PRIMARY KEY (account_key, item_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_tracking_account_comment_runs (
            account_key TEXT NOT NULL,
            local_date TEXT NOT NULL,
            timezone TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
                status IN ('completed', 'partial', 'unavailable', 'failed')
            ),
            is_simulated INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1)),
            limited INTEGER NOT NULL DEFAULT 0 CHECK (limited IN (0, 1)),
            message TEXT NOT NULL DEFAULT '',
            comments_seen INTEGER NOT NULL DEFAULT 0,
            last_synced_at TEXT NOT NULL,
            PRIMARY KEY (account_key, local_date)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_tracking_account_comments (
            account_key TEXT NOT NULL,
            local_date TEXT NOT NULL,
            item_id TEXT NOT NULL,
            comment_id TEXT NOT NULL,
            comment_user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            create_time BIGINT NOT NULL,
            digg_count BIGINT NOT NULL,
            reply_comment_total BIGINT NOT NULL,
            top INTEGER NOT NULL CHECK (top IN (0, 1)),
            raw_data TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (account_key, local_date, comment_id),
            FOREIGN KEY (account_key, local_date)
                REFERENCES lead_tracking_account_comment_runs(account_key, local_date)
                ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_lead_tracking_account_comments_rank
        ON lead_tracking_account_comments(
            account_key, local_date,
            digg_count DESC, reply_comment_total DESC, create_time DESC, comment_id
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_tracking_account_analysis_runs (
            account_key TEXT NOT NULL,
            local_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'completed' CHECK (
                status IN ('completed', 'failed')
            ),
            analysis_method TEXT NOT NULL DEFAULT 'rules' CHECK (
                analysis_method IN ('rules', 'ai')
            ),
            model TEXT NOT NULL DEFAULT '',
            rule_version TEXT NOT NULL,
            is_simulated INTEGER NOT NULL DEFAULT 0 CHECK (is_simulated IN (0, 1)),
            message TEXT NOT NULL DEFAULT '',
            generated_at TEXT NOT NULL,
            generated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (account_key, local_date),
            FOREIGN KEY (account_key, local_date)
                REFERENCES lead_tracking_account_comment_runs(account_key, local_date)
                ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_tracking_account_leads (
            account_key TEXT NOT NULL,
            local_date TEXT NOT NULL,
            comment_id TEXT NOT NULL,
            score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
            intent TEXT NOT NULL CHECK (intent IN ('high', 'medium', 'low')),
            demand_labels TEXT NOT NULL DEFAULT '[]',
            evidence TEXT NOT NULL DEFAULT '[]',
            recommended_action TEXT NOT NULL,
            review_status TEXT NOT NULL DEFAULT 'pending' CHECK (
                review_status IN ('pending', 'confirmed', 'dismissed')
            ),
            reviewed_by_user_id TEXT NOT NULL DEFAULT '',
            reviewed_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (account_key, local_date, comment_id),
            FOREIGN KEY (account_key, local_date)
                REFERENCES lead_tracking_account_analysis_runs(account_key, local_date)
                ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_lead_tracking_account_leads_priority
        ON lead_tracking_account_leads(
            account_key, local_date, score DESC, review_status, comment_id
        )
    """)
    account_rows = conn.execute(
        """
        SELECT account.id, account.project_id, account.platform,
               account.platform_user_id, project.organization_id
        FROM project_channel_accounts account
        JOIN content_projects project ON project.id = account.project_id
        """,
    ).fetchall()
    new_keys_by_legacy: dict[str, set[str]] = {}
    for row in account_rows:
        old_key = legacy_lead_account_key(
            row["platform"], row["platform_user_id"], row["id"],
        )
        new_key = lead_account_key(
            row["organization_id"], row["platform"],
            row["platform_user_id"], row["id"],
        )
        new_keys_by_legacy.setdefault(old_key, set()).add(new_key)
    for old_key, candidates in new_keys_by_legacy.items():
        if len(candidates) != 1:
            continue
        new_key = next(iter(candidates))
        if old_key == new_key:
            continue
        targets = conn.execute(
            "SELECT * FROM lead_tracking_account_targets WHERE account_key = ?",
            (old_key,),
        ).fetchall()
        for target in targets:
            conn.execute(
                """
                INSERT INTO lead_tracking_account_targets (
                    account_key, platform, platform_user_id, item_id,
                    discovered_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, item_id) DO NOTHING
                """,
                (
                    new_key, target["platform"], target["platform_user_id"],
                    target["item_id"], target["discovered_at"],
                    target["last_seen_at"],
                ),
            )
        runs = conn.execute(
            """
            SELECT * FROM lead_tracking_account_comment_runs
            WHERE account_key = ?
            """,
            (old_key,),
        ).fetchall()
        for run in runs:
            local_date = run["local_date"]
            conn.execute(
                """
                INSERT INTO lead_tracking_account_comment_runs (
                    account_key, local_date, timezone, status, is_simulated,
                    limited, message, comments_seen, last_synced_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, local_date) DO NOTHING
                """,
                (
                    new_key, local_date, run["timezone"], run["status"],
                    run["is_simulated"], run["limited"], run["message"],
                    run["comments_seen"], run["last_synced_at"],
                ),
            )
            for comment in conn.execute(
                """
                SELECT * FROM lead_tracking_account_comments
                WHERE account_key = ? AND local_date = ?
                """,
                (old_key, local_date),
            ).fetchall():
                conn.execute(
                    """
                    INSERT INTO lead_tracking_account_comments (
                        account_key, local_date, item_id, comment_id,
                        comment_user_id, content, create_time, digg_count,
                        reply_comment_total, top, raw_data
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(account_key, local_date, comment_id) DO NOTHING
                    """,
                    (
                        new_key, local_date, comment["item_id"],
                        comment["comment_id"], comment["comment_user_id"],
                        comment["content"], comment["create_time"],
                        comment["digg_count"], comment["reply_comment_total"],
                        comment["top"], comment["raw_data"],
                    ),
                )
            analysis = conn.execute(
                """
                SELECT * FROM lead_tracking_account_analysis_runs
                WHERE account_key = ? AND local_date = ?
                """,
                (old_key, local_date),
            ).fetchone()
            if analysis is not None:
                conn.execute(
                    """
                    INSERT INTO lead_tracking_account_analysis_runs (
                        account_key, local_date, status, analysis_method, model,
                        rule_version, is_simulated, message, generated_at,
                        generated_by_user_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(account_key, local_date) DO NOTHING
                    """,
                    (
                        new_key, local_date, analysis["status"],
                        analysis["analysis_method"], analysis["model"],
                        analysis["rule_version"], analysis["is_simulated"],
                        analysis["message"], analysis["generated_at"],
                        analysis["generated_by_user_id"],
                    ),
                )
                for lead in conn.execute(
                    """
                    SELECT * FROM lead_tracking_account_leads
                    WHERE account_key = ? AND local_date = ?
                    """,
                    (old_key, local_date),
                ).fetchall():
                    conn.execute(
                        """
                        INSERT INTO lead_tracking_account_leads (
                            account_key, local_date, comment_id, score, intent,
                            demand_labels, evidence, recommended_action,
                            review_status, reviewed_by_user_id, reviewed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(account_key, local_date, comment_id) DO NOTHING
                        """,
                        (
                            new_key, local_date, lead["comment_id"], lead["score"],
                            lead["intent"], lead["demand_labels"], lead["evidence"],
                            lead["recommended_action"], lead["review_status"],
                            lead["reviewed_by_user_id"], lead["reviewed_at"],
                        ),
                    )
        conn.execute(
            "DELETE FROM lead_tracking_account_targets WHERE account_key = ?",
            (old_key,),
        )
        conn.execute(
            "DELETE FROM lead_tracking_account_comment_runs WHERE account_key = ?",
            (old_key,),
        )
    legacy_run_columns = {
        row[1]
        for row in conn.execute(
            "PRAGMA table_info(lead_tracking_comment_runs)",
        ).fetchall()
    }
    if not legacy_run_columns:
        return
    accounts = {
        (row["project_id"], row["id"]): (
            lead_account_key(
                row["organization_id"],
                row["platform"],
                row["platform_user_id"],
                row["id"],
            ),
            row["platform"],
            row["platform_user_id"],
        )
        for row in account_rows
    }
    legacy_targets = conn.execute(
        "SELECT * FROM lead_tracking_comment_targets",
    ).fetchall()
    for target in legacy_targets:
        identity = accounts.get((target["project_id"], target["account_id"]))
        if identity is None:
            continue
        conn.execute(
            """
            INSERT INTO lead_tracking_account_targets (
                account_key, platform, platform_user_id, item_id,
                discovered_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_key, item_id) DO UPDATE SET
                last_seen_at = excluded.last_seen_at
            """,
            (
                identity[0], identity[1], identity[2], target["item_id"],
                target["discovered_at"], target["last_seen_at"],
            ),
        )
    selected_runs: dict[tuple[str, str], sqlite3.Row] = {}
    for run in conn.execute(
        "SELECT * FROM lead_tracking_comment_runs ORDER BY last_synced_at",
    ).fetchall():
        identity = accounts.get((run["project_id"], run["account_id"]))
        if identity is not None:
            selected_runs[(identity[0], run["local_date"])] = run
    for (account_key, local_date), run in selected_runs.items():
        conn.execute(
            """
            INSERT INTO lead_tracking_account_comment_runs (
                account_key, local_date, timezone, status, is_simulated,
                limited, message, comments_seen, last_synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_key, local_date) DO UPDATE SET
                timezone = excluded.timezone,
                status = excluded.status,
                is_simulated = excluded.is_simulated,
                limited = excluded.limited,
                message = excluded.message,
                comments_seen = excluded.comments_seen,
                last_synced_at = excluded.last_synced_at
            """,
            (
                account_key, local_date, run["timezone"], run["status"],
                int(run["is_simulated"]) if "is_simulated" in legacy_run_columns else 0,
                run["limited"], run["message"], run["comments_seen"],
                run["last_synced_at"],
            ),
        )
        comments = conn.execute(
            """
            SELECT * FROM lead_tracking_comments
            WHERE project_id = ? AND account_id = ? AND local_date = ?
            """,
            (run["project_id"], run["account_id"], local_date),
        ).fetchall()
        for comment in comments:
            conn.execute(
                """
                INSERT INTO lead_tracking_account_comments (
                    account_key, local_date, item_id, comment_id,
                    comment_user_id, content, create_time, digg_count,
                    reply_comment_total, top, raw_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, local_date, comment_id) DO UPDATE SET
                    item_id = excluded.item_id,
                    comment_user_id = excluded.comment_user_id,
                    content = excluded.content,
                    create_time = excluded.create_time,
                    digg_count = excluded.digg_count,
                    reply_comment_total = excluded.reply_comment_total,
                    top = excluded.top,
                    raw_data = excluded.raw_data
                """,
                (
                    account_key, local_date, comment["item_id"],
                    comment["comment_id"], comment["comment_user_id"],
                    comment["content"], comment["create_time"],
                    comment["digg_count"], comment["reply_comment_total"],
                    comment["top"], comment["raw_data"],
                ),
            )
    analysis_columns = {
        row[1]
        for row in conn.execute(
            "PRAGMA table_info(lead_tracking_analysis_runs)",
        ).fetchall()
    }
    if analysis_columns:
        selected_analyses: dict[tuple[str, str], sqlite3.Row] = {}
        for run in conn.execute(
            "SELECT * FROM lead_tracking_analysis_runs ORDER BY generated_at",
        ).fetchall():
            identity = accounts.get((run["project_id"], run["account_id"]))
            if identity is not None:
                selected_analyses[(identity[0], run["local_date"])] = run
        for (account_key, local_date), run in selected_analyses.items():
            if (account_key, local_date) not in selected_runs:
                continue
            conn.execute(
                """
                INSERT INTO lead_tracking_account_analysis_runs (
                    account_key, local_date, status, analysis_method, model,
                    rule_version, is_simulated, message, generated_at,
                    generated_by_user_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, local_date) DO UPDATE SET
                    status = excluded.status,
                    analysis_method = excluded.analysis_method,
                    model = excluded.model,
                    rule_version = excluded.rule_version,
                    is_simulated = excluded.is_simulated,
                    message = excluded.message,
                    generated_at = excluded.generated_at,
                    generated_by_user_id = excluded.generated_by_user_id
                """,
                (
                    account_key, local_date,
                    run["status"] if "status" in analysis_columns else "completed",
                    run["analysis_method"] if "analysis_method" in analysis_columns else "rules",
                    run["model"] if "model" in analysis_columns else "",
                    run["rule_version"],
                    run["is_simulated"] if "is_simulated" in analysis_columns else 0,
                    run["message"] if "message" in analysis_columns else "",
                    run["generated_at"], run["generated_by_user_id"],
                ),
            )
            leads = conn.execute(
                """
                SELECT * FROM lead_tracking_leads
                WHERE project_id = ? AND account_id = ? AND local_date = ?
                """,
                (run["project_id"], run["account_id"], local_date),
            ).fetchall()
            for lead in leads:
                conn.execute(
                    """
                    INSERT INTO lead_tracking_account_leads (
                        account_key, local_date, comment_id, score, intent,
                        demand_labels, evidence, recommended_action,
                        review_status, reviewed_by_user_id, reviewed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(account_key, local_date, comment_id) DO UPDATE SET
                        score = excluded.score,
                        intent = excluded.intent,
                        demand_labels = excluded.demand_labels,
                        evidence = excluded.evidence,
                        recommended_action = excluded.recommended_action,
                        review_status = excluded.review_status,
                        reviewed_by_user_id = excluded.reviewed_by_user_id,
                        reviewed_at = excluded.reviewed_at
                    """,
                    (
                        account_key, local_date, lead["comment_id"], lead["score"],
                        lead["intent"], lead["demand_labels"], lead["evidence"],
                        lead["recommended_action"], lead["review_status"],
                        lead["reviewed_by_user_id"], lead["reviewed_at"],
                    ),
                )
    for table in (
        "lead_tracking_leads",
        "lead_tracking_analysis_runs",
        "lead_tracking_comments",
        "lead_tracking_comment_runs",
        "lead_tracking_comment_targets",
    ):
        conn.execute(f"DROP TABLE IF EXISTS {table}")


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
            brand_profile TEXT NOT NULL DEFAULT '{}',
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
    if "brand_profile" not in cols:
        conn.execute(
            "ALTER TABLE content_projects ADD COLUMN brand_profile TEXT NOT NULL DEFAULT '{}'"
        )
    allowed_avatar_icons = ",".join("?" for _ in PROJECT_AVATAR_ICONS)
    conn.execute(
        f"UPDATE content_projects SET avatar_icon = '💡' "
        f"WHERE avatar_icon NOT IN ({allowed_avatar_icons})",
        tuple(PROJECT_AVATAR_ICONS),
    )
    ensure_organization_scope(conn, "content_projects", "user_id")
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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS account_content_simulations (
            id TEXT NOT NULL,
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            account_id TEXT NOT NULL REFERENCES project_channel_accounts(id) ON DELETE CASCADE,
            created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, account_id, id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_account_content_simulations_account
        ON account_content_simulations(project_id, account_id, created_at DESC, id DESC)
    """)
    _initialize_account_lead_tracking(conn)
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
        "ai_transcript": "TEXT NOT NULL DEFAULT ''",
        "ai_transcript_model": "TEXT NOT NULL DEFAULT ''",
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
