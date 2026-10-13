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
    LEAD_DAILY_REPORT_ENABLED,
    LEAD_DAILY_RETRY_MINUTES,
    LEAD_TRACKING_REQUIRED_SCOPE,
    LEAD_TRACKING_SYNC_ENABLED,
    LEAD_TRACKING_TIMEZONE,
)
from app.engines.publishing import storage
from app.engines.publishing.account_content import (
    MAX_CURSOR,
    AccountContentProviderError,
    _get_provider_json,
    _platform_page,
    _scoped_account,
    public_https_url,
)
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
    InvalidChannelCredential,
    decrypt_channel_credentials,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.models import (
    AccountContentPost,
    LeadTrackingComment,
    LeadTrackingCommentInsight,
)

DOUYIN_COMMENT_URL = "https://open.douyin.com/item/comment/list/"
COMMENT_PAGE_SIZE = 20
TOP_LIMIT = 50
MAX_PAGES_PER_ACCOUNT = 100
MAX_COMMENTS_PER_ACCOUNT = 2_000
MAX_DISCOVERY_PAGES = 20
PROVIDER_ERROR = "The official comment provider is unavailable or returned an invalid response"
logger = logging.getLogger(__name__)


class CommentProviderError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def register_comment_targets(
    project_id: str,
    account_id: str,
    item_ids: list[str | AccountContentPost],
) -> None:
    """Persist only IDs returned by a successful authenticated video.list read."""
    valid: dict[str, tuple[str, str, str, int | None, int | None, int | None, int | None]] = {}
    for item in item_ids:
        item_id = item.id if isinstance(item, AccountContentPost) else item
        if isinstance(item_id, str) and 0 < len(item_id) <= 512:
            valid[item_id] = (
                item.title[:1000] if isinstance(item, AccountContentPost) else "",
                public_https_url(item.share_url) if isinstance(item, AccountContentPost) else "",
                item.published_at if isinstance(item, AccountContentPost) else "",
                item.statistics.views if isinstance(item, AccountContentPost) else None,
                item.statistics.likes if isinstance(item, AccountContentPost) else None,
                item.statistics.comments if isinstance(item, AccountContentPost) else None,
                item.statistics.shares if isinstance(item, AccountContentPost) else None,
            )
    if not valid:
        return
    account = _internal_account(project_id, account_id)
    if account is None:
        raise LookupError("Channel account not found")
    account_key = lead_account_key_from_row(account)
    stamp = _now()
    local_day = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(
        ZoneInfo(LEAD_TRACKING_TIMEZONE)
    ).date().isoformat()
    with storage._get_conn() as conn:
        for item_id, (title, share_url, published_at, views, likes, comments, shares) in valid.items():
            conn.execute(
                """
                INSERT INTO lead_tracking_account_targets (
                    account_key, platform, platform_user_id, item_id,
                    discovered_at, last_seen_at, title, share_url,
                    published_at, views, likes, comments, shares
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, item_id) DO UPDATE
                SET last_seen_at = excluded.last_seen_at,
                    title = CASE WHEN excluded.title != '' THEN excluded.title ELSE lead_tracking_account_targets.title END,
                    share_url = CASE WHEN excluded.share_url != '' THEN excluded.share_url ELSE lead_tracking_account_targets.share_url END,
                    published_at = CASE WHEN excluded.published_at != '' THEN excluded.published_at ELSE lead_tracking_account_targets.published_at END,
                    views = COALESCE(excluded.views, lead_tracking_account_targets.views),
                    likes = COALESCE(excluded.likes, lead_tracking_account_targets.likes),
                    comments = COALESCE(excluded.comments, lead_tracking_account_targets.comments),
                    shares = COALESCE(excluded.shares, lead_tracking_account_targets.shares)
                """,
                (
                    account_key, account["platform"], account["platform_user_id"],
                    item_id, stamp, stamp, title, share_url, published_at,
                    views, likes, comments, shares,
                ),
            )
            if any(value is not None for value in (views, likes, comments, shares)):
                conn.execute(
                    """INSERT INTO lead_tracking_post_metric_snapshots
                       (account_key, local_date, item_id, views, likes, comments, shares, observed_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(account_key, local_date, item_id) DO UPDATE SET
                         views = COALESCE(excluded.views, lead_tracking_post_metric_snapshots.views),
                         likes = COALESCE(excluded.likes, lead_tracking_post_metric_snapshots.likes),
                         comments = COALESCE(excluded.comments, lead_tracking_post_metric_snapshots.comments),
                         shares = COALESCE(excluded.shares, lead_tracking_post_metric_snapshots.shares),
                         observed_at = excluded.observed_at""",
                    (account_key, local_day, item_id, views, likes, comments, shares, stamp),
                )


def list_tracking_works(user_id: str, project_id: str, account_id: str) -> list[dict]:
    account = _scoped_account(user_id, project_id, account_id)
    account_key = lead_account_key_from_row(account)
    with storage._get_conn() as conn:
        rows = conn.execute(
            """SELECT item_id, title, share_url FROM lead_tracking_account_targets
               WHERE account_key = ? ORDER BY last_seen_at DESC, item_id""",
            (account_key,),
        ).fetchall()
    return [dict(row) for row in rows]


async def discover_comment_targets(account: dict, client: httpx.AsyncClient | None = None) -> bool:
    """Read verified creator works; return False if provider pagination was capped."""
    token, unavailable = _credential(account)
    if unavailable:
        raise CommentProviderError(unavailable)
    try:
        scopes = json.loads(account["scopes"])
    except (TypeError, ValueError):
        scopes = []
    if "video.list" not in scopes:
        raise CommentProviderError("Approve and authorize video.list to discover works")
    cursor = 0
    for _ in range(MAX_DISCOVERY_PAGES):
        try:
            posts, next_cursor, has_more = await _platform_page(
                token, account["platform_user_id"], cursor, 20, client,
            )
        except AccountContentProviderError as exc:
            raise CommentProviderError(PROVIDER_ERROR) from exc
        register_comment_targets(account["project_id"], account["id"], posts)
        if not has_more:
            return True
        cursor = int(next_cursor)
    return False


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
                "sort_type": "time" if LEAD_DAILY_REPORT_ENABLED else "time_asc",
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
        previous_comment_reviews = (
            [dict(row) for row in conn.execute(
                """SELECT comment_id, stance, reviewed_by_user_id, reviewed_at
                   FROM lead_daily_comment_reviews WHERE account_key = ? AND local_date = ?""",
                (account_key, local_date.isoformat()),
            ).fetchall()] if LEAD_DAILY_REPORT_ENABLED else []
        )
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
        retained_ids = {item["comment_id"] for item in comments}
        for review in previous_comment_reviews:
            if review["comment_id"] not in retained_ids:
                continue
            conn.execute(
                """INSERT INTO lead_daily_comment_reviews
                   (account_key, local_date, comment_id, stance, reviewed_by_user_id, reviewed_at)
                   VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                (account_key, local_date.isoformat(), review["comment_id"], review["stance"],
                 review["reviewed_by_user_id"], review["reviewed_at"]),
            )


async def sync_account_comment_insight(
    project_id: str,
    account_id: str,
    local_date: date,
    *,
    client: httpx.AsyncClient | None = None,
    discovery_complete: bool = True,
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
                    if LEAD_DAILY_REPORT_ENABLED and item["create_time"] < start_epoch:
                        beyond_day = True
                    elif not LEAD_DAILY_REPORT_ENABLED and item["create_time"] >= end_epoch:
                        beyond_day = True
                    elif start_epoch <= item["create_time"] < end_epoch:
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

    status = "partial" if limited or not discovery_complete else "completed"
    message = (
        "A provider safety ceiling was reached; the snapshot is incomplete"
        if limited else "Work discovery was capped; the snapshot is incomplete"
        if not discovery_complete else "Daily comments synchronized from the official Douyin API"
    )
    _save_run(
        account_key, local_date, status, limited or not discovery_complete, message,
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
    item_id: str = "",
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
        where_work = " AND item_id = ?" if item_id else ""
        rows = conn.execute(
            f"""SELECT item_id, comment_id, comment_user_id, content, create_time,
                       digg_count, reply_comment_total, top,
                       digg_count + reply_comment_total * 2 AS interaction_score
                FROM lead_tracking_account_comments
                WHERE account_key = ? AND local_date = ?{where_work}
                ORDER BY interaction_score DESC, create_time DESC, comment_id ASC
                LIMIT ?""",
            (account_key, selected.isoformat(), *((item_id,) if item_id else ()), TOP_LIMIT),
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
    item_id: str = "",
) -> LeadTrackingCommentInsight:
    account = _scoped_account(user_id, project_id, account_id)
    return get_comment_insight_internal(
        lead_account_key_from_row(account),
        local_date,
        item_id,
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
    @staticmethod
    def _claim(account_key: str, local_date: date) -> bool:
        now = datetime.now(timezone.utc)
        stamp = now.isoformat()
        lease = (now + timedelta(hours=2)).isoformat()
        with storage._get_conn() as conn:
            conn.execute(
                """INSERT INTO lead_daily_jobs
                   (account_key, local_date, status, attempts, updated_at)
                   VALUES (?, ?, 'failed', 0, ?) ON CONFLICT DO NOTHING""",
                (account_key, local_date.isoformat(), stamp),
            )
            changed = conn.execute(
                """UPDATE lead_daily_jobs SET status = 'running', attempts = attempts + 1,
                     lease_until = ?, updated_at = ?
                   WHERE account_key = ? AND local_date = ? AND attempts < 5
                     AND ((status = 'failed' AND next_retry_at <= ?)
                       OR (status = 'running' AND lease_until <= ?))""",
                (lease, stamp, account_key, local_date.isoformat(), stamp, stamp),
            )
            return changed.rowcount == 1

    @staticmethod
    def _finish(account_key: str, local_date: date, success: bool, message: str = "") -> None:
        now = datetime.now(timezone.utc)
        with storage._get_conn() as conn:
            job = conn.execute(
                "SELECT attempts FROM lead_daily_jobs WHERE account_key = ? AND local_date = ?",
                (account_key, local_date.isoformat()),
            ).fetchone()
            attempts = int(job["attempts"]) if job else 1
            retry = (now + timedelta(minutes=min(120, LEAD_DAILY_RETRY_MINUTES * 2 ** (attempts - 1)))).isoformat()
            conn.execute(
                """UPDATE lead_daily_jobs SET status = ?, lease_until = '', next_retry_at = ?,
                     message = ?, updated_at = ? WHERE account_key = ? AND local_date = ?""",
                ("completed" if success else "failed", "" if success else retry,
                 message[:500], now.isoformat(), account_key, local_date.isoformat()),
            )

    async def run_once(self, local_date: date) -> None:
        with storage._get_conn() as conn:
            if LEAD_DAILY_REPORT_ENABLED:
                bindings = [dict(row) for row in conn.execute(
                    """SELECT account.*, project.organization_id
                       FROM project_channel_accounts account
                       JOIN content_projects project ON project.id = account.project_id
                       ORDER BY account.id""",
                ).fetchall()]
                keys = sorted({lead_account_key_from_row(row) for row in bindings})
            else:
                keys = [row["account_key"] for row in conn.execute(
                    "SELECT DISTINCT account_key FROM lead_tracking_account_targets ORDER BY account_key",
                ).fetchall()]
        for account_key in keys:
            account = _account_for_key(account_key)
            if account is None:
                logger.error(
                    "Lead tracking comment sync skipped without a binding for account %s",
                    account_key,
                )
                continue
            if LEAD_DAILY_REPORT_ENABLED and not self._claim(account_key, local_date):
                continue
            try:
                discovery_complete = True
                if LEAD_DAILY_REPORT_ENABLED:
                    discovery_complete = await discover_comment_targets(account)
                snapshot = await sync_account_comment_insight(
                    account["project_id"], account["id"], local_date,
                    discovery_complete=discovery_complete,
                )
                if LEAD_DAILY_REPORT_ENABLED:
                    from app.engines.publishing.daily_comment_report import generate_daily_report

                    await asyncio.to_thread(
                        generate_daily_report, account, local_date,
                        notify=local_date == _previous_local_date(),
                    )
                    self._finish(account_key, local_date, snapshot.status in ("completed", "partial"), snapshot.message)
            except CommentProviderError as exc:
                if LEAD_DAILY_REPORT_ENABLED:
                    self._finish(account_key, local_date, False, str(exc))
                logger.warning("Daily comment discovery unavailable for account=%s date=%s: %s", account_key, local_date, exc)
            except Exception:
                if LEAD_DAILY_REPORT_ENABLED:
                    self._finish(account_key, local_date, False, "Daily report generation failed")
                logger.exception(
                    "Lead tracking comment sync failed for account %s",
                    account_key,
                )

    async def serve(self, stop: asyncio.Event) -> None:
        zone = ZoneInfo(LEAD_TRACKING_TIMEZONE)
        if LEAD_DAILY_REPORT_ENABLED:
            while not stop.is_set():
                yesterday = datetime.now(zone).date() - timedelta(days=1)
                for days_back in reversed(range(3)):
                    await self.run_once(yesterday - timedelta(days=days_back))
                try:
                    await asyncio.wait_for(stop.wait(), timeout=LEAD_DAILY_RETRY_MINUTES * 60)
                    return
                except TimeoutError:
                    continue
        while not stop.is_set():
            delay = seconds_until_next_midnight(datetime.now(timezone.utc))
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return
            except TimeoutError:
                await self.run_once(datetime.now(zone).date() - timedelta(days=1))
