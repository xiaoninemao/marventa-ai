from __future__ import annotations

import asyncio
import ipaddress
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
    InvalidChannelCredential,
    decrypt_channel_credentials,
)
from app.engines.publishing.models import (
    AccountContentAccount,
    AccountContentPage,
    AccountContentPlayer,
    AccountContentPost,
    AccountContentStatistics,
)
from app.engines.publishing.project_channel_accounts import account_content_connection
from app.engines.publishing.project_memberships import ProjectNotFound
from app.media_storage import media_url

# Verified older official contract. Eligibility does not establish current app API availability.
# https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/account-video-list/
DOUYIN_CONTENT_URL = "https://open.douyin.com/video/list/"
DOUYIN_PLAYER_URL = "https://open.douyin.com/api/douyin/v1/video/get_iframe_by_video"
MAX_PLAYER_RESPONSE_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_CURSOR = 2**63 - 1
MAX_PAGES = 4
PROVIDER_ERROR = "The account content provider is unavailable or returned an invalid response"
PLAYER_ERROR = "The account video player is unavailable or returned an invalid response"


class AccountContentProviderError(RuntimeError):
    pass


def public_https_url(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 8192:
        return ""
    if re.search(r"[\x00-\x20\x7f\\]", value):
        return ""
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower()
        if (
            parsed.scheme != "https" or not host or parsed.username is not None
            or parsed.password is not None or parsed.port not in (None, 443)
            or "%" in host
        ):
            return ""
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            if (
                "." not in host or host.split(".")[-1].isdigit()
                or host.endswith((
                    ".localhost", ".local", ".internal", ".home", ".lan",
                    ".test", ".invalid", ".example", ".home.arpa",
                ))
                or not re.fullmatch(r"[a-z0-9.-]+", host)
                or any(
                    not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
                    for label in host.split(".")
                )
            ):
                return ""
    except ValueError:
        return ""
    return value


def validate_pagination(source: str, cursor: str, count: int, page: int) -> int:
    if source not in ("platform", "marventa"):
        raise ValueError("Invalid account content source")
    if (
        not isinstance(cursor, str) or not re.fullmatch(r"[0-9]{1,19}", cursor)
        or int(cursor) > MAX_CURSOR
    ):
        raise ValueError("Cursor must be a nonnegative signed 64-bit integer")
    if type(count) is not int or not 1 <= count <= 24:
        raise ValueError("Page size must be between 1 and 24")
    if type(page) is not int or page < 1:
        raise ValueError("Page must be at least 1")
    if source == "platform" and page > MAX_PAGES:
        raise ValueError("Platform page must be between 1 and 4")
    if page == 1 and int(cursor) != 0:
        raise ValueError("The first page must start at cursor 0")
    return int(cursor)


_ACCOUNT_SELECT = """
    SELECT account.*, project.title AS project_title,
           COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name,
           COALESCE(creator.avatar_url, '') AS creator_avatar_url
    FROM project_channel_accounts account
    JOIN content_projects project ON project.id = account.project_id
    JOIN project_memberships membership ON membership.project_id = project.id
    LEFT JOIN users creator ON creator.id = account.created_by_user_id
    WHERE membership.user_id = ? AND project.organization_id = ?
"""


def _account_rows(user_id: str, project_id: str | None = None) -> list[dict]:
    with account_content_connection(user_id, project_id) as (conn, organization_id):
        params = [user_id, organization_id]
        condition = ""
        if project_id is not None:
            condition = " AND project.id = ?"
            params.append(project_id)
        rows = conn.execute(
            _ACCOUNT_SELECT + condition + " ORDER BY project.title, account.created_at, account.id",
            params,
        ).fetchall()
        return [dict(row) for row in rows]


def _scoped_account(user_id: str, project_id: str, account_id: str) -> dict:
    with account_content_connection(user_id, project_id) as (conn, organization_id):
        row = conn.execute(
            _ACCOUNT_SELECT + " AND project.id = ? AND account.id = ?",
            (user_id, organization_id, project_id, account_id),
        ).fetchone()
        if row is None:
            raise ProjectNotFound("Channel account not found")
        return dict(row)


def _eligibility(row: dict) -> tuple[AccountContentAccount, str]:
    token = ""
    status = "ready"
    message = (
        "Read authorization is eligible; provider availability is not guaranteed. "
        "Platform reads are limited to four pages and may not include all posts."
    )
    if row["platform"] != "douyin":
        status, message = "unsupported_platform", "Official creator content reading is not verified for this platform"
    elif (
        row["authorization_status"] != "active" or not row["credential_blob"]
        or not row["platform_user_id"] or row["platform_user_id"].startswith("local-test-")
    ):
        status, message = "authorization_required", "Reconnect a real platform account to read content"
    else:
        try:
            expires = datetime.fromisoformat(row["token_expires_at"].replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= datetime.now(timezone.utc):
                raise ValueError("expired")
        except (ValueError, TypeError):
            status, message = "authorization_required", "Account authorization is expired or unverifiable; reconnect the account"
        if status == "ready":
            try:
                credentials = decrypt_channel_credentials(row["credential_blob"])
                candidate = credentials.get("access_token")
                if (
                    not isinstance(candidate, str) or not candidate
                    or re.search(r"[\x00-\x20\x7f]", candidate)
                    or credentials.get("open_id") not in (None, "", row["platform_user_id"])
                ):
                    raise InvalidChannelCredential("Invalid credential")
                token = candidate
            except ChannelCredentialEncryptionUnavailable:
                status, message = "configuration_required", "Credential encryption must be configured before reading content"
            except (InvalidChannelCredential, ValueError, TypeError, UnicodeError):
                status, message = "authorization_required", "Stored authorization cannot be read; reconnect the account"
        if status == "ready":
            try:
                scopes = json.loads(row["scopes"])
            except (ValueError, TypeError):
                scopes = []
            if not isinstance(scopes, list) or "video.list" not in scopes:
                status, message = "scope_required", "Approve video.list for the app, then reauthorize this account with the read scope"
    account = AccountContentAccount(
        **{key: value for key, value in row.items() if key in AccountContentAccount.model_fields
           and key not in ("content_status", "required_scope", "content_message")},
        content_status=status,
        required_scope="video.list" if row["platform"] == "douyin" else "",
        content_message=message,
    )
    account.profile_url = public_https_url(account.profile_url)
    account.creator_avatar_url = public_https_url(account.creator_avatar_url)
    return account, token if status == "ready" else ""


def list_account_content_accounts(
    user_id: str, project_id: str | None = None,
) -> list[AccountContentAccount]:
    return [_eligibility(row)[0] for row in _account_rows(user_id, project_id)]


def _utc(value: object, *, timestamp: bool = False) -> str:
    try:
        if timestamp:
            if type(value) not in (int, float):
                return ""
            date = datetime.fromtimestamp(value, timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
        return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError, OSError):
        return ""


def _parse_post(item: object) -> AccountContentPost:
    if not isinstance(item, dict) or not isinstance(item.get("item_id"), str) or not item["item_id"]:
        raise AccountContentProviderError(PROVIDER_ERROR)
    for key in ("title", "cover", "share_url"):
        if key in item and not isinstance(item[key], str):
            raise AccountContentProviderError(PROVIDER_ERROR)
    stats = item.get("statistics")
    if stats is not None and not isinstance(stats, dict):
        raise AccountContentProviderError(PROVIDER_ERROR)
    values = {}
    for field, key in (("likes", "digg_count"), ("comments", "comment_count"), ("views", "play_count"), ("shares", "share_count")):
        value = (stats or {}).get(key)
        if value is not None and (type(value) is not int or value < 0):
            raise AccountContentProviderError(PROVIDER_ERROR)
        values[field] = value
    visibility = item.get("video_status")
    media_type = item.get("media_type")
    video_id = item.get("video_id")
    return AccountContentPost(
        id=item["item_id"], title=item.get("title", ""),
        cover_url=public_https_url(item.get("cover")),
        share_url=public_https_url(item.get("share_url")),
        published_at=_utc(item.get("create_time"), timestamp=True),
        visibility={1: "published", 2: "not_public", 4: "reviewing"}.get(visibility, "unknown")
        if type(visibility) is int else "unknown",
        media_type={2: "image_text", 4: "video"}.get(media_type, "unknown")
        if type(media_type) is int else "unknown",
        statistics=AccountContentStatistics(**values),
        platform_video_id=str(video_id)
        if (
            type(video_id) is int and 0 < video_id <= MAX_CURSOR
            and type(media_type) is int and media_type == 4
            and type(visibility) is int and visibility == 1
        ) else "",
    )


async def _get_provider_json(
    url: str, params: dict, headers: dict[str, str], client: httpx.AsyncClient | None,
    *, max_bytes: int = MAX_RESPONSE_BYTES,
) -> dict:
    owns_client = client is None
    active_client = client or httpx.AsyncClient(timeout=15.0, follow_redirects=False)
    try:
        async with asyncio.timeout(15.0), active_client.stream(
            "GET", url, params=params, headers=headers,
            timeout=15.0, follow_redirects=False,
        ) as response:
            if response.status_code != 200:
                raise AccountContentProviderError(PROVIDER_ERROR)
            content_length = response.headers.get("content-length")
            if content_length is not None and (
                not content_length.isascii() or not content_length.isdigit()
                or len(content_length) > 10 or int(content_length) > max_bytes
            ):
                raise AccountContentProviderError(PROVIDER_ERROR)
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > max_bytes:
                    raise AccountContentProviderError(PROVIDER_ERROR)
                body.extend(chunk)
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise AccountContentProviderError(PROVIDER_ERROR)
        return payload
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError, UnicodeError) as exc:
        raise AccountContentProviderError(PROVIDER_ERROR) from exc
    finally:
        if owns_client:
            await active_client.aclose()


async def _platform_page(
    token: str, open_id: str, cursor: int, count: int,
    client: httpx.AsyncClient | None,
) -> tuple[list[AccountContentPost], str, bool]:
    payload = await _get_provider_json(
        DOUYIN_CONTENT_URL, {"open_id": open_id, "count": count, "cursor": cursor},
        {"access-token": token, "Content-Type": "application/json"}, client,
    )
    data = payload.get("data")
    extra = payload.get("extra")
    if (
        not isinstance(data, dict) or data.get("error_code", 0) != 0
        or payload.get("error_code", 0) != 0
        or (extra is not None and (
            not isinstance(extra, dict) or extra.get("error_code", 0) != 0
        ))
        or not isinstance(data.get("list"), list) or len(data["list"]) > count
        or type(data.get("has_more")) is not bool
        or type(data.get("cursor")) is not int or not 0 <= data["cursor"] <= MAX_CURSOR
        or (data["has_more"] and data["cursor"] == cursor)
    ):
        raise AccountContentProviderError(PROVIDER_ERROR)
    return [_parse_post(item) for item in data["list"]], str(data["cursor"]), data["has_more"]


class _PlayerIframeParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "iframe":
            self.sources.append(dict(attrs).get("src") or "")


async def get_account_content_player(
    user_id: str, project_id: str, account_id: str, video_id: str,
    *, client: httpx.AsyncClient | None = None,
) -> AccountContentPlayer:
    row = _scoped_account(user_id, project_id, account_id)
    if row["platform"] != "douyin":
        raise ValueError("Official video embedding is only available for Douyin")
    if not re.fullmatch(r"[1-9][0-9]{0,18}", video_id) or int(video_id) > MAX_CURSOR:
        raise ValueError("Invalid platform video ID")
    try:
        payload = await _get_provider_json(
            DOUYIN_PLAYER_URL, {"video_id": video_id}, {"Content-Type": "application/json"}, client,
            max_bytes=MAX_PLAYER_RESPONSE_BYTES,
        )
        data = payload.get("data")
        if type(payload.get("err_no")) is not int or payload["err_no"] != 0 or not isinstance(data, dict):
            raise AccountContentProviderError(PLAYER_ERROR)
        code = data.get("iframe_code")
        if not isinstance(code, str) or not code:
            raise AccountContentProviderError(PLAYER_ERROR)
        parser = _PlayerIframeParser()
        parser.feed(code)
        if len(parser.sources) != 1:
            raise AccountContentProviderError(PLAYER_ERROR)
        source = public_https_url(parser.sources[0])
        parts = urlsplit(source)
        if (
            parts.netloc != "open.douyin.com" or parts.path != "/player/video"
            or parts.fragment or parse_qs(parts.query).get("vid") != [video_id]
        ):
            raise AccountContentProviderError(PLAYER_ERROR)
        player_url = "https://open.douyin.com/player/video?" + urlencode({"vid": video_id, "autoplay": 0})
        return AccountContentPlayer(video_id=video_id, player_url=player_url)
    except (AccountContentProviderError, ValueError, AssertionError) as exc:
        raise AccountContentProviderError(PLAYER_ERROR) from exc


def _local_posts(
    user_id: str, project_id: str, account_id: str, offset: int, count: int,
    base_url: str,
) -> tuple[list[AccountContentPost], str, bool]:
    with account_content_connection(user_id, project_id) as (conn, _):
        rows = conn.execute("""
            SELECT publication.id, publication.copy_title, publication.copy_text, publication.name,
                   publication.media_mode, execution.published_at
            FROM project_publications publication
            LEFT JOIN publication_executions execution ON execution.plan_id = publication.id
            WHERE publication.project_id = ? AND publication.channel_account_id = ?
              AND publication.status = 'published'
            ORDER BY COALESCE(NULLIF(execution.published_at, ''), publication.updated_at) DESC,
                     publication.id DESC
            LIMIT ? OFFSET ?
        """, (project_id, account_id, count + 1, offset)).fetchall()
        plan_ids = [row["id"] for row in rows[:count]]
        images_by_plan: dict[str, list[str]] = {}
        videos_by_plan: dict[str, str] = {}
        if plan_ids:
            placeholders = ", ".join("?" for _ in plan_ids)
            media_rows = conn.execute(f"""
                SELECT plan_id, object_key, media_type FROM publication_contents
                WHERE plan_id IN ({placeholders}) AND media_type IN ('image', 'video')
                ORDER BY plan_id, position, id
            """, plan_ids).fetchall()
            for media in media_rows:
                url = media_url(media["object_key"], base_url)
                if media["media_type"] == "image":
                    images_by_plan.setdefault(media["plan_id"], []).append(url)
                else:
                    videos_by_plan.setdefault(media["plan_id"], url)
    items = []
    for row in rows[:count]:
        images = images_by_plan.get(row["id"], [])
        items.append(AccountContentPost(
            id=row["id"], plan_id=row["id"], title=row["copy_title"] or row["name"],
            content=row["copy_text"],
            cover_url=images[0] if images else "", image_urls=images, published_at=_utc(row["published_at"]),
            video_url=videos_by_plan.get(row["id"], "") if row["media_mode"] == "video" else "",
            media_type=row["media_mode"], visibility="accepted",
        ))
    return items, str(offset + len(items)), len(rows) > count


async def get_account_content(
    user_id: str, project_id: str, account_id: str, *, source: str = "platform",
    cursor: str = "0", count: int = 12, page: int = 1, base_url: str = "",
    client: httpx.AsyncClient | None = None,
) -> AccountContentPage:
    offset = validate_pagination(source, cursor, count, page)
    row = _scoped_account(user_id, project_id, account_id)
    account, token = _eligibility(row)
    result = AccountContentPage(
        account=account, source=source, status=account.content_status,
        page=page, page_size=count, message=account.content_message,
    )
    if source == "marventa":
        result.status = "ready"
        result.message = "Through-Marventa accepted publication records; public visibility and share URLs are not verified"
        items, next_cursor, has_more = _local_posts(user_id, project_id, account_id, offset, count, base_url)
    elif result.status != "ready":
        return result
    else:
        items, next_cursor, has_more = await _platform_page(
            token, row["platform_user_id"], offset, count, client,
        )
    result.items = items
    result.has_more = has_more
    result.limited = source == "platform" and has_more and page == MAX_PAGES
    result.next_cursor = next_cursor if has_more and not result.limited else None
    if result.limited:
        result.message += "; four-page limit reached, additional records are not included"
    return result
