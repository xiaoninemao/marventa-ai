"""Bounded, official-provider daily comment snapshots for lead tracking."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from app.config import (
    LEAD_TRACKING_REQUIRED_SCOPE,
    LEAD_TRACKING_SYNC_ENABLED,
    LEAD_TRACKING_TIMEZONE,
)
from app.engines.publishing import storage
from app.engines.publishing.account_content import (
    MAX_CURSOR,
    AccountContentProviderError,
    _get_provider_json,
    _scoped_account,
)
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
    InvalidChannelCredential,
    decrypt_channel_credentials,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.models import (
    LeadTrackingComment,
    LeadTrackingCommentInsight,
)

DOUYIN_COMMENT_URL = "https://open.douyin.com/item/comment/list/"
COMMENT_PAGE_SIZE = 20
TOP_LIMIT = 50
MAX_PAGES_PER_ACCOUNT = 100
MAX_COMMENTS_PER_ACCOUNT = 2_000
PROVIDER_ERROR = "The official comment provider is unavailable or returned an invalid response"
logger = logging.getLogger(__name__)


class CommentProviderError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def register_comment_targets(
    project_id: str,
    account_id: str,
    item_ids: list[str],
) -> None:
    """Persist only IDs returned by a successful authenticated video.list read."""
    valid = list(dict.fromkeys(
        item_id for item_id in item_ids
        if isinstance(item_id, str) and 0 < len(item_id) <= 512
    ))
    if not valid:
        return
    account = _internal_account(project_id, account_id)
    if account is None:
        raise LookupError("Channel account not found")
    account_key = lead_account_key_from_row(account)
    stamp = _now()
    with storage._get_conn() as conn:
        for item_id in valid:
            conn.execute(
                """
                INSERT INTO lead_tracking_account_targets (
                    account_key, platform, platform_user_id, item_id,
                    discovered_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, item_id) DO UPDATE
                SET last_seen_at = excluded.last_seen_at
                """,
                (
                    account_key, account["platform"], account["platform_user_id"],
                    item_id, stamp, stamp,
                ),
            )


def _internal_account(project_id: str, account_id: str) -> dict | None:
    with storage._get_conn() as conn:
        row = conn.execute(
            """
            SELECT account.*, project.organization_id
            FROM project_channel_accounts account
            JOIN content_projects project ON project.id = account.project_id
            WHERE account.project_id = ? AND account.id = ?
            """,
            (project_id, account_id),
        ).fetchone()
    return dict(row) if row is not None else None


def _account_for_key(account_key: str) -> dict | None:
    with storage._get_conn() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT account.*, project.organization_id
                FROM project_channel_accounts account
                JOIN content_projects project ON project.id = account.project_id
                ORDER BY account.created_at, account.id
                """,
            ).fetchall()
        ]
    candidates = [
        row for row in rows
        if lead_account_key_from_row(row) == account_key
    ]
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda row: (
            row["authorization_status"] == "active",
            bool(row["credential_blob"]),
            str(row["token_expires_at"]),
        ),
    )


def _credential(row: dict) -> tuple[str, str]:
    if (
        row["platform"] != "douyin"
        or row["authorization_status"] != "active"
        or not row["credential_blob"]
        or not row["platform_user_id"]
        or row["platform_user_id"].startswith("local-test-")
    ):
        return "", "Reconnect a real Douyin account to read comments"
    try:
        scopes = json.loads(row["scopes"])
    except (TypeError, ValueError):
        scopes = []
    if not isinstance(scopes, list) or LEAD_TRACKING_REQUIRED_SCOPE not in scopes:
        return "", (
            f"Approve and authorize the configured official comment permission "
            f"({LEAD_TRACKING_REQUIRED_SCOPE})"
        )
    try:
        expires = datetime.fromisoformat(str(row["token_expires_at"]).replace("Z", "+00:00"))
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            return "", "Account authorization is expired; reconnect the account"
        credentials = decrypt_channel_credentials(row["credential_blob"])
        token = credentials.get("access_token")
        if (
            not isinstance(token, str)
            or not token
            or re.search(r"[\x00-\x20\x7f]", token)
            or credentials.get("open_id") not in (None, "", row["platform_user_id"])
        ):
            raise InvalidChannelCredential("Invalid credential")
        return token, ""
    except ChannelCredentialEncryptionUnavailable:
        return "", "Credential encryption must be configured before reading comments"
    except (InvalidChannelCredential, TypeError, ValueError, UnicodeError):
        return "", "Stored authorization cannot be read; reconnect the account"


def _cursor(value: object) -> str:
    if type(value) is int:
        value = str(value)
    if (
        not isinstance(value, str)
        or not re.fullmatch(r"[0-9]{1,19}", value)
        or int(value) > MAX_CURSOR
    ):
        raise CommentProviderError(PROVIDER_ERROR)
    return value


def _comment(item: object, item_id: str) -> dict:
    if not isinstance(item, dict):
        raise CommentProviderError(PROVIDER_ERROR)
    text_fields = ("comment_id", "comment_user_id", "content")
    if any(not isinstance(item.get(field), str) for field in text_fields):
        raise CommentProviderError(PROVIDER_ERROR)
    if not item["comment_id"] or len(item["comment_id"]) > 512:
        raise CommentProviderError(PROVIDER_ERROR)
    if len(item["comment_user_id"]) > 512 or len(item["content"]) > 100_000:
        raise CommentProviderError(PROVIDER_ERROR)
    for field in ("create_time", "digg_count", "reply_comment_total"):
        if (
            type(item.get(field)) is not int
            or item[field] < 0
            or item[field] > MAX_CURSOR
        ):
            raise CommentProviderError(PROVIDER_ERROR)
    if type(item.get("top")) is not bool:
        raise CommentProviderError(PROVIDER_ERROR)
    return {
        "item_id": item_id,
        "comment_id": item["comment_id"],
        "comment_user_id": item["comment_user_id"],
        "content": item["content"],
        "create_time": item["create_time"],
        "digg_count": item["digg_count"],
        "reply_comment_total": item["reply_comment_total"],
        "top": item["top"],
        "raw_data": json.dumps(item, ensure_ascii=False, separators=(",", ":")),
    }


async def _comment_page(
    token: str,
    open_id: str,
    item_id: str,
    cursor: str,
    client: httpx.AsyncClient | None,
) -> tuple[list[dict], str, bool]:
    try:
        payload = await _get_provider_json(
            DOUYIN_COMMENT_URL,
            {
                "open_id": open_id,
                "cursor": cursor,
                "count": COMMENT_PAGE_SIZE,
                "item_id": item_id,
                "sort_type": "time_asc",
            },
            {"access-token": token, "Content-Type": "application/json"},
            client,
        )
        data = payload.get("data")
        extra = payload.get("extra")
        if (
            not isinstance(data, dict)
            or data.get("error_code", 0) != 0
            or payload.get("error_code", 0) != 0
            or (
                extra is not None
                and (not isinstance(extra, dict) or extra.get("error_code", 0) != 0)
            )
            or not isinstance(data.get("list"), list)
            or len(data["list"]) > COMMENT_PAGE_SIZE
            or type(data.get("has_more")) is not bool
        ):
            raise CommentProviderError(PROVIDER_ERROR)
        next_cursor = _cursor(data.get("cursor"))
        if data["has_more"] and next_cursor == cursor:
            raise CommentProviderError(PROVIDER_ERROR)
        return (
            [_comment(item, item_id) for item in data["list"]],
            next_cursor,
            data["has_more"],
        )
    except AccountContentProviderError as exc:
        raise CommentProviderError(PROVIDER_ERROR) from exc


def _targets(account_key: str) -> list[str]:
    with storage._get_conn() as conn:
        return [
            row["item_id"]
            for row in conn.execute(
                """
                SELECT item_id FROM lead_tracking_account_targets
                WHERE account_key = ?
                ORDER BY discovered_at, item_id
                """,
                (account_key,),
            ).fetchall()
        ]


def _save_run(
    account_key: str,
    local_date: date,
    status: str,
    limited: bool,
    message: str,
    comments: list[dict],
    *,
    is_simulated: bool = False,
) -> None:
    stamp = _now()
    with storage._get_conn() as conn:
        conn.execute(
            """
            INSERT INTO lead_tracking_account_comment_runs (
                account_key, local_date, timezone, status,
                is_simulated, limited, message, comments_seen, last_synced_at
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
                account_key, local_date.isoformat(),
                LEAD_TRACKING_TIMEZONE, status, int(is_simulated),
                int(limited), message, len(comments), stamp,
            ),
        )
        conn.execute(
            """
            DELETE FROM lead_tracking_account_analysis_runs
            WHERE account_key = ? AND local_date = ?
            """,
            (account_key, local_date.isoformat()),
        )
        conn.execute(
            """
            DELETE FROM lead_tracking_account_comments
            WHERE account_key = ? AND local_date = ?
            """,
            (account_key, local_date.isoformat()),
        )
        for item in comments:
            conn.execute(
                """
                INSERT INTO lead_tracking_account_comments (
                    account_key, local_date, item_id, comment_id,
                    comment_user_id, content, create_time, digg_count,
                    reply_comment_total, top, raw_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, local_date, comment_id)
                DO UPDATE SET
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
                    account_key, local_date.isoformat(),
                    item["item_id"], item["comment_id"], item["comment_user_id"],
                    item["content"], item["create_time"], item["digg_count"],
                    item["reply_comment_total"], int(item["top"]), item["raw_data"],
                ),
            )


async def sync_account_comment_insight(
    project_id: str,
    account_id: str,
    local_date: date,
    *,
    client: httpx.AsyncClient | None = None,
) -> LeadTrackingCommentInsight:
    """Synchronize one verified account/date. This is intentionally not an HTTP mutation."""
    if not LEAD_TRACKING_SYNC_ENABLED:
        return LeadTrackingCommentInsight(
            status="unavailable", date=local_date.isoformat(),
            timezone=LEAD_TRACKING_TIMEZONE,
            message="Daily comment synchronization is disabled",
        )
    row = _internal_account(project_id, account_id)
    if row is None:
        raise LookupError("Channel account not found")
    account_key = lead_account_key_from_row(row)
    token, unavailable = _credential(row)
    targets = _targets(account_key)
    if unavailable or not targets:
        message = unavailable or "No verified platform works have been discovered for this account"
        _save_run(account_key, local_date, "unavailable", False, message, [])
        return get_comment_insight_internal(account_key, local_date)

    zone = ZoneInfo(LEAD_TRACKING_TIMEZONE)
    start = datetime.combine(local_date, time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(local_date + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    start_epoch, end_epoch = int(start.timestamp()), int(end.timestamp())
    comments: dict[str, dict] = {}
    pages = seen = 0
    limited = False
    try:
        for item_id in targets:
            cursor = "0"
            while True:
                if pages >= MAX_PAGES_PER_ACCOUNT or seen >= MAX_COMMENTS_PER_ACCOUNT:
                    limited = True
                    break
                page, next_cursor, has_more = await _comment_page(
                    token, row["platform_user_id"], item_id, cursor, client,
                )
                pages += 1
                seen += len(page)
                beyond_day = False
                for item in page:
                    if item["create_time"] >= end_epoch:
                        beyond_day = True
                    elif item["create_time"] >= start_epoch:
                        comments[item["comment_id"]] = item
                if beyond_day or not has_more:
                    break
                cursor = next_cursor
            if limited:
                break
    except CommentProviderError:
        _save_run(
            account_key, local_date, "failed", False,
            PROVIDER_ERROR, [],
        )
        return get_comment_insight_internal(account_key, local_date)

    status = "partial" if limited else "completed"
    message = (
        "A provider safety ceiling was reached; the snapshot is incomplete"
        if limited else "Daily comments synchronized from the official Douyin API"
    )
    _save_run(
        account_key, local_date, status, limited, message,
        list(comments.values()),
    )
    from app.engines.publishing.lead_analysis import (
        analyze_comment_snapshot_after_sync,
    )
    await asyncio.to_thread(
        analyze_comment_snapshot_after_sync,
        account_key,
        local_date,
        str(row["created_by_user_id"]),
    )
    return get_comment_insight_internal(account_key, local_date)


def _previous_local_date() -> date:
    return datetime.now(ZoneInfo(LEAD_TRACKING_TIMEZONE)).date() - timedelta(days=1)


def get_comment_insight_internal(
    account_key: str,
    local_date: date | None = None,
) -> LeadTrackingCommentInsight:
    selected = local_date or _previous_local_date()
    with storage._get_conn() as conn:
        run = conn.execute(
            """
            SELECT * FROM lead_tracking_account_comment_runs
            WHERE account_key = ? AND local_date = ?
            """,
            (account_key, selected.isoformat()),
        ).fetchone()
        if run is None:
            return LeadTrackingCommentInsight(
                status="unavailable", date=selected.isoformat(),
                timezone=LEAD_TRACKING_TIMEZONE,
                message="No daily comment snapshot is available",
            )
        rows = conn.execute(
            """
            SELECT item_id, comment_id, comment_user_id, content, create_time,
                   digg_count, reply_comment_total, top,
                   digg_count + reply_comment_total * 2 AS interaction_score
            FROM lead_tracking_account_comments
            WHERE account_key = ? AND local_date = ?
            ORDER BY interaction_score DESC, create_time DESC, comment_id ASC
            LIMIT ?
            """,
            (account_key, selected.isoformat(), TOP_LIMIT),
        ).fetchall()
    return LeadTrackingCommentInsight(
        status=run["status"], date=selected.isoformat(), timezone=run["timezone"],
        items=[
            LeadTrackingComment(**{**dict(row), "top": bool(row["top"])})
            for row in rows
        ],
        is_simulated=bool(run["is_simulated"]),
        limited=bool(run["limited"]), message=run["message"],
        last_synced_at=run["last_synced_at"],
    )


def get_comment_insight(
    user_id: str,
    project_id: str,
    account_id: str,
    local_date: date | None = None,
) -> LeadTrackingCommentInsight:
    account = _scoped_account(user_id, project_id, account_id)
    return get_comment_insight_internal(
        lead_account_key_from_row(account),
        local_date,
    )


def seconds_until_next_midnight(
    now: datetime,
    timezone_name: str = LEAD_TRACKING_TIMEZONE,
) -> float:
    zone = ZoneInfo(timezone_name)
    local_now = now.astimezone(zone)
    next_date = local_now.date() + timedelta(days=1)
    next_midnight = datetime.combine(next_date, time.min, zone)
    return max(0.0, (next_midnight.astimezone(timezone.utc) - now.astimezone(timezone.utc)).total_seconds())


class LeadTrackingCommentScheduler:
    async def run_once(self, local_date: date) -> None:
        with storage._get_conn() as conn:
            account_keys = conn.execute(
                """
                SELECT DISTINCT account_key
                FROM lead_tracking_account_targets
                ORDER BY account_key
                """,
            ).fetchall()
        for item in account_keys:
            account = _account_for_key(item["account_key"])
            if account is None:
                logger.error(
                    "Lead tracking comment sync skipped without a binding for account %s",
                    item["account_key"],
                )
                continue
            try:
                await sync_account_comment_insight(
                    account["project_id"], account["id"], local_date,
                )
            except Exception:
                logger.exception(
                    "Lead tracking comment sync failed for account %s",
                    item["account_key"],
                )

    async def serve(self, stop: asyncio.Event) -> None:
        zone = ZoneInfo(LEAD_TRACKING_TIMEZONE)
        while not stop.is_set():
            delay = seconds_until_next_midnight(datetime.now(timezone.utc))
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return
            except TimeoutError:
                await self.run_once(datetime.now(zone).date() - timedelta(days=1))
