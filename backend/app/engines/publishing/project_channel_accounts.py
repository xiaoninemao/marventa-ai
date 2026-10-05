from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import (
    DB_PATH,
    JWT_ALGORITHM,
    JWT_SECRET,
)
from app.database import connect_database
from app.engines.publishing.channel_credentials import (
    encrypt_channel_credentials,
)
from app.engines.publishing.models import ProjectChannelAccount
from app.engines.publishing.project_memberships import (
    ProjectNotFound,
    project_manager_access,
)
from app.engines.publishing.publication_plans import ensure_publications_deletable
from app.storage_schema import resolve_user_organization_id

_connection_factory: Callable[[], sqlite3.Connection] = lambda: connect_database(DB_PATH)
_schema_initializer: Callable[[], None] = lambda: None
_clock: Callable[[], str] = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
class InvalidChannelAuthorizationState(RuntimeError):
    pass


def configure(
    connection_factory: Callable[[], sqlite3.Connection],
    schema_initializer: Callable[[], None],
    clock: Callable[[], str],
) -> None:
    global _connection_factory, _schema_initializer, _clock
    _connection_factory = connection_factory
    _schema_initializer = schema_initializer
    _clock = clock


def _project_access(conn: sqlite3.Connection, user_id: str, project_id: str) -> None:
    organization_id = resolve_user_organization_id(conn, user_id)
    access = conn.execute("""
        SELECT 1 FROM content_projects p
        JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ? AND p.organization_id = ?
    """, (user_id, project_id, organization_id)).fetchone()
    if access is None:
        raise ProjectNotFound("Project not found")


def _row_to_account(row: sqlite3.Row) -> ProjectChannelAccount:
    return ProjectChannelAccount(**dict(row))


def ensure_project_channel_access(user_id: str, project_id: str) -> None:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        _project_access(conn, user_id, project_id)


@contextmanager
def account_content_connection(
    user_id: str, project_id: str | None = None,
) -> Iterator[tuple[sqlite3.Connection, str]]:
    """Server-only connection; callers must scope queries to the returned organization."""
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        organization_id = resolve_user_organization_id(conn, user_id)
        if project_id is not None:
            _project_access(conn, user_id, project_id)
        yield conn, organization_id


def list_project_channel_accounts(
    user_id: str, project_id: str,
) -> list[ProjectChannelAccount]:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        _project_access(conn, user_id, project_id)
        rows = conn.execute("""
            SELECT account.id, account.project_id, account.platform,
                   account.account_name, account.platform_user_id,
                   account.profile_url, account.notes, account.created_by_user_id,
                   account.authorization_status, account.token_expires_at,
                   account.refresh_token_expires_at,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url,
                   account.created_at, account.updated_at
            FROM project_channel_accounts account
            LEFT JOIN users creator ON creator.id = account.created_by_user_id
            WHERE account.project_id = ?
            ORDER BY CASE account.platform WHEN 'xiaohongshu' THEN 0 ELSE 1 END,
                     account.created_at, account.id
        """, (project_id,)).fetchall()
        return [_row_to_account(row) for row in rows]


def create_channel_authorization_state(
    user_id: str,
    project_id: str,
    platform: str,
    *,
    expires_in_seconds: int = 600,
) -> str:
    _schema_initializer()
    state_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=expires_in_seconds)
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _project_access(conn, user_id, project_id)
        conn.execute(
            "DELETE FROM project_channel_authorization_states "
            "WHERE expires_at <= ? OR consumed_at != ''",
            (now.strftime("%Y-%m-%d %H:%M:%S"),),
        )
        conn.execute(
            """
            INSERT INTO project_channel_authorization_states (
                id, project_id, platform, user_id, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                state_id, project_id, platform, user_id,
                now.strftime("%Y-%m-%d %H:%M:%S"),
                expires_at.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
    state = jwt.encode(
        {
            "type": "channel_authorization",
            "jti": state_id,
            "sub": user_id,
            "project_id": project_id,
            "platform": platform,
            "exp": expires_at,
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return state


def attach_device_authorization(
    state: str,
    platform: str,
    *,
    provider_code: str,
    poll_interval_seconds: int,
) -> None:
    claims = _decode_channel_authorization_state(state, platform)
    with closing(_connection_factory()) as conn, conn:
        updated = conn.execute(
            """
            UPDATE project_channel_authorization_states
            SET provider_code = ?, poll_interval_seconds = ?
            WHERE id = ? AND consumed_at = ''
            """,
            (
                provider_code,
                max(1, poll_interval_seconds),
                claims["jti"],
            ),
        ).rowcount
        if not updated:
            raise InvalidChannelAuthorizationState(
                "Channel authorization state is invalid or expired",
            )


def _decode_channel_authorization_state(
    state: str, platform: str,
) -> dict[str, object]:
    try:
        claims = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise InvalidChannelAuthorizationState(
            "Channel authorization state is invalid or expired",
        ) from exc
    if (
        claims.get("type") != "channel_authorization"
        or claims.get("platform") != platform
        or not claims.get("jti")
        or not claims.get("sub")
        or not claims.get("project_id")
    ):
        raise InvalidChannelAuthorizationState(
            "Channel authorization state is invalid or expired",
        )
    return claims


def get_channel_authorization_state(
    state: str, platform: str,
) -> dict[str, object]:
    claims = _decode_channel_authorization_state(state, platform)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with closing(_connection_factory()) as conn:
        stored = conn.execute(
            """
            SELECT user_id, project_id, provider_code, poll_interval_seconds
            FROM project_channel_authorization_states
            WHERE id = ? AND platform = ? AND consumed_at = '' AND expires_at > ?
            """,
            (claims["jti"], platform, now),
        ).fetchone()
    if (
        stored is None
        or stored["user_id"] != claims["sub"]
        or stored["project_id"] != claims["project_id"]
    ):
        raise InvalidChannelAuthorizationState(
            "Channel authorization state is invalid or expired",
        )
    return {
        "id": str(claims["jti"]),
        "user_id": str(claims["sub"]),
        "project_id": str(claims["project_id"]),
        "provider_code": stored["provider_code"],
        "poll_interval_seconds": stored["poll_interval_seconds"],
    }


def consume_channel_authorization_state(
    state: str, platform: str,
) -> tuple[str, str]:
    claims = _decode_channel_authorization_state(state, platform)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        stored = conn.execute(
            """
            SELECT user_id, project_id
            FROM project_channel_authorization_states
            WHERE id = ? AND platform = ? AND consumed_at = '' AND expires_at > ?
            """,
            (claims["jti"], platform, now),
        ).fetchone()
        if (
            stored is None
            or stored["user_id"] != claims["sub"]
            or stored["project_id"] != claims["project_id"]
        ):
            raise InvalidChannelAuthorizationState(
                "Channel authorization state is invalid or expired",
            )
        conn.execute(
            "UPDATE project_channel_authorization_states SET consumed_at = ? WHERE id = ?",
            (now, claims["jti"]),
        )
    return str(claims["sub"]), str(claims["project_id"])


def save_authorized_channel_account(
    user_id: str,
    project_id: str,
    *,
    platform: str,
    platform_user_id: str,
    account_name: str,
    profile_url: str,
    scopes: list[str],
    credentials: dict[str, object],
    token_expires_at: str = "",
    refresh_token_expires_at: str = "",
) -> ProjectChannelAccount:
    _schema_initializer()
    normalized_platform_user_id = platform_user_id.strip()
    normalized_name = account_name.strip()
    if not normalized_platform_user_id or not normalized_name:
        raise ValueError("Authorized account identity is incomplete")
    encrypted_credentials = encrypt_channel_credentials(credentials)
    now = _clock()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _project_access(conn, user_id, project_id)
        existing = conn.execute(
            """
            SELECT id FROM project_channel_accounts
            WHERE project_id = ? AND platform = ? AND platform_user_id = ?
            """,
            (project_id, platform, normalized_platform_user_id),
        ).fetchone()
        account_id = existing["id"] if existing else uuid.uuid4().hex[:12]
        if existing is None:
            duplicate_name = conn.execute(
                """
                SELECT 1 FROM project_channel_accounts
                WHERE project_id = ? AND platform = ? AND account_name = ?
                """,
                (project_id, platform, normalized_name),
            ).fetchone()
            if duplicate_name:
                normalized_name = (
                    f"{normalized_name} ({normalized_platform_user_id[-6:]})"
                )
            conn.execute(
                """
                INSERT INTO project_channel_accounts (
                    id, project_id, platform, account_name, platform_user_id,
                    profile_url, notes, created_by_user_id, authorization_status,
                    scopes, credential_blob, token_expires_at,
                    refresh_token_expires_at, last_refreshed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, '', ?, 'active', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id, project_id, platform, normalized_name,
                    normalized_platform_user_id, profile_url.strip(), user_id,
                    json.dumps(scopes, ensure_ascii=False), encrypted_credentials,
                    token_expires_at, refresh_token_expires_at, now, now, now,
                ),
            )
        else:
            conn.execute(
                """
                UPDATE project_channel_accounts
                SET account_name = ?, profile_url = ?, authorization_status = 'active',
                    scopes = ?, credential_blob = ?, token_expires_at = ?,
                    refresh_token_expires_at = ?, last_refreshed_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    normalized_name, profile_url.strip(),
                    json.dumps(scopes, ensure_ascii=False), encrypted_credentials,
                    token_expires_at, refresh_token_expires_at, now, now, account_id,
                ),
            )
        row = conn.execute(
            """
            SELECT account.id, account.project_id, account.platform,
                   account.account_name, account.platform_user_id,
                   account.profile_url, account.notes, account.created_by_user_id,
                   account.authorization_status, account.token_expires_at,
                   account.refresh_token_expires_at,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '')
                       AS creator_name,
                   COALESCE(creator.avatar_url, '') AS creator_avatar_url,
                   account.created_at, account.updated_at
            FROM project_channel_accounts account
            LEFT JOIN users creator ON creator.id = account.created_by_user_id
            WHERE account.id = ?
            """,
            (account_id,),
        ).fetchone()
        return _row_to_account(row)


def delete_project_channel_account(
    user_id: str, project_id: str, account_id: str,
) -> None:
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _project_access(conn, user_id, project_id)
        account = conn.execute(
            "SELECT created_by_user_id FROM project_channel_accounts "
            "WHERE id = ? AND project_id = ?",
            (account_id, project_id),
        ).fetchone()
        if account is None:
            raise LookupError("Channel account not found")
        if account["created_by_user_id"] != user_id:
            project_manager_access(conn, user_id, project_id)
        ensure_publications_deletable(conn, project_id, account_id)
        conn.execute(
            "DELETE FROM project_publications "
            "WHERE channel_account_id = ? AND project_id = ?",
            (account_id, project_id),
        )
        conn.execute(
            "DELETE FROM project_channel_accounts WHERE id = ? AND project_id = ?",
            (account_id, project_id),
        )
