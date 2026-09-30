from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TABLE_ORDER = (
    "users",
    "organizations",
    "organization_memberships",
    "user_organization_preferences",
    "content_projects",
    "project_memberships",
    "insights",
    "insight_sources",
    "cases",
    "case_favorites",
    "case_import_tasks",
    "creation_sessions",
    "content_versions",
    "creation_presence_leases",
    "portfolio",
    "project_channel_accounts",
    "project_publications",
    "publication_executions",
    "publication_contents",
    "project_materials",
    "project_channel_authorization_states",
    "notifications",
    "account_memories",
    "social_accounts",
    "publish_tasks",
    "publish_metrics",
    "publish_reviews",
    "data_audit_log",
)
_SCHEMA_METADATA_TABLES = {
    "auth_schema_migrations",
    "storage_schema_migrations",
    "market_insight_migrations",
    "publishing_migrations",
}


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid database identifier: {value}")
    return value


def _initialize_postgres(database_url: str) -> None:
    from app import config

    config.DATABASE_URL = database_url
    from app.auth.storage import init_users_db
    from app.engines.case_library.import_tasks import init_import_tasks_db
    from app.engines.case_library.storage import init_db as init_case_library_db
    from app.engines.content_generator.storage import (
        init_db as init_content_generator_db,
    )
    from app.engines.market_insight.storage import init_db as init_market_insight_db
    from app.engines.portfolio.storage import init_db as init_portfolio_db
    from app.engines.publishing.storage import init_db as init_publishing_db
    from app.notifications.storage import init_notifications_db

    init_users_db()
    init_notifications_db()
    init_publishing_db()
    init_case_library_db()
    init_import_tasks_db()
    init_content_generator_db()
    init_portfolio_db()
    init_market_insight_db()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Copy a Marventa SQLite database into an empty PostgreSQL database "
            "and verify row counts."
        ),
    )
    parser.add_argument(
        "--sqlite-path",
        default=str(
            Path(__file__).resolve().parents[1] / "data" / "market_insight.db"
        ),
    )
    parser.add_argument("--database-url", required=True)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect source tables and counts without connecting to PostgreSQL.",
    )
    args = parser.parse_args()

    source_path = Path(args.sqlite_path).resolve()
    if not source_path.is_file():
        parser.error(f"SQLite database does not exist: {source_path}")
    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    source_tables = {
        row["name"]
        for row in source.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        ).fetchall()
    }
    ordered_tables = [
        table for table in _TABLE_ORDER if table in source_tables
    ]
    ordered_tables.extend(sorted(
        source_tables - set(ordered_tables) - _SCHEMA_METADATA_TABLES,
    ))
    source_counts = {
        table: source.execute(
            f"SELECT COUNT(*) FROM {_identifier(table)}",
        ).fetchone()[0]
        for table in ordered_tables
    }
    if args.dry_run:
        for table in ordered_tables:
            print(f"{table}: {source_counts[table]}")
        print(f"{sum(source_counts.values())} total row(s)")
        return 0

    if not args.database_url.startswith(("postgresql://", "postgres://")):
        parser.error("--database-url must use postgresql://")
    _initialize_postgres(args.database_url)

    from app import config
    from app.database import connect_database

    config.DATABASE_URL = args.database_url
    target = connect_database("")
    target_tables = {
        row["name"]
        for row in target.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'",
        ).fetchall()
    }
    unexpected = sorted(source_tables - target_tables)
    if unexpected:
        print(
            "Destination schema is missing table(s): " + ", ".join(unexpected),
            file=sys.stderr,
        )
        return 1
    nonempty = {
        table: target.execute(
            f"SELECT COUNT(*) AS count FROM {_identifier(table)}",
        ).fetchone()["count"]
        for table in ordered_tables
        if target.execute(
            f"SELECT COUNT(*) AS count FROM {_identifier(table)}",
        ).fetchone()["count"]
    }
    if nonempty:
        print(
            "Destination must be empty; non-empty table(s): "
            + ", ".join(f"{name}={count}" for name, count in nonempty.items()),
            file=sys.stderr,
        )
        return 1

    for table in ordered_tables:
        table = _identifier(table)
        source_columns = [
            row["name"]
            for row in source.execute(f"PRAGMA table_info({table})").fetchall()
        ]
        target_columns = {
            row["name"]
            for row in target.execute(f"PRAGMA table_info({table})").fetchall()
        }
        columns = [column for column in source_columns if column in target_columns]
        if not columns or source_counts[table] == 0:
            continue
        placeholders = ", ".join("?" for _ in columns)
        column_sql = ", ".join(_identifier(column) for column in columns)
        insert_sql = (
            f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})"
        )
        with target:
            for row in source.execute(
                f"SELECT {column_sql} FROM {table}",
            ):
                target.execute(insert_sql, tuple(row[column] for column in columns))
        print(f"copied {table}: {source_counts[table]}")

    from app.engines.publishing.storage import (
        backfill_publication_copy_text,
        backfill_publication_media_modes,
        backfill_publication_positions,
    )

    with target:
        backfill_publication_copy_text(target)
        for table, column, backfill in (
            ("project_publications", "media_mode", backfill_publication_media_modes),
            ("publication_contents", "position", backfill_publication_positions),
        ):
            if table in source_tables and column not in {
                row["name"] for row in source.execute(f"PRAGMA table_info({table})").fetchall()
            }:
                backfill(target)

    identity_columns = target.execute(
        """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND is_identity = 'YES'
        """,
    ).fetchall()
    for identity in identity_columns:
        table = _identifier(identity["table_name"])
        column = _identifier(identity["column_name"])
        maximum = target.execute(
            f"SELECT COALESCE(MAX({column}), 0) AS maximum FROM {table}",
        ).fetchone()["maximum"]
        sequence = target.execute(
            "SELECT pg_get_serial_sequence(?, ?) AS sequence_name",
            (table, column),
        ).fetchone()["sequence_name"]
        if sequence:
            target.execute(
                "SELECT setval(?::regclass, ?, ?)",
                (sequence, max(int(maximum), 1), bool(maximum)),
            )
    target.commit()

    failures: list[str] = []
    for table, expected in source_counts.items():
        actual = target.execute(
            f"SELECT COUNT(*) AS count FROM {_identifier(table)}",
        ).fetchone()["count"]
        if actual != expected:
            failures.append(f"{table}: expected {expected}, found {actual}")
    target.close()
    source.close()
    if failures:
        print("Row-count verification failed:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    print(
        f"Migration complete: {len(ordered_tables)} table(s), "
        f"{sum(source_counts.values())} row(s) verified.",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
