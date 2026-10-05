from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import (
    DOUYIN_CHANNEL_CLIENT_KEY,
    DOUYIN_CHANNEL_CLIENT_SECRET,
    DOUYIN_CHANNEL_REDIRECT_URI,
    DOUYIN_CHANNEL_SCOPES,
    XIAOHONGSHU_CHANNEL_APP_ID,
    XIAOHONGSHU_CHANNEL_APP_SECRET,
    XIAOHONGSHU_CHANNEL_CLIENT_NAME,
)
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
    ensure_channel_credential_encryption,
)
from app.engines.publishing.project_channel_accounts import (
    attach_device_authorization,
    create_channel_authorization_state,
    ensure_project_channel_access,
)

DOUYIN_AUTHORIZE_URL = "https://open.douyin.com/platform/oauth/connect"
DOUYIN_TOKEN_URL = "https://open.douyin.com/oauth/access_token/"
DOUYIN_USERINFO_URL = "https://open.douyin.com/oauth/userinfo/"
XIAOHONGSHU_DEVICE_CODE_URL = (
    "https://openaccount.xiaohongshu.com/api/sns/v1/oauth2/device/code"
)
XIAOHONGSHU_DEVICE_TOKEN_URL = (
    "https://openaccount.xiaohongshu.com/api/sns/v1/oauth2/device/token"
)
XIAOHONGSHU_USERINFO_URL = (
    "https://openaccount.xiaohongshu.com/api/sns/v1/oauth2/"
    "batch_get_min_user_info"
)


class ChannelOAuthConfigurationError(RuntimeError):
    pass


class ChannelOAuthProviderError(RuntimeError):
    def __init__(self, message: str, *, provider_code: str = "") -> None:
        super().__init__(message)
        self.provider_code = provider_code


@dataclass(frozen=True)
class ChannelAuthorizationStart:
    platform: str
    mode: str
    state: str
    authorization_url: str
    expires_in: int
    interval: int = 0
    user_code: str = ""


@dataclass(frozen=True)
class ChannelOAuthGrant:
    platform_user_id: str
    account_name: str
    avatar_url: str
    profile_url: str
    scopes: list[str]
    credentials: dict[str, object]
    token_expires_at: str
    refresh_token_expires_at: str


@dataclass(frozen=True)
class DeviceAuthorizationPoll:
    status: str
    interval: int
    grant: ChannelOAuthGrant | None = None


def _require_configuration(platform: str, values: dict[str, str]) -> None:
    if any(not value for value in values.values()):
        raise ChannelOAuthConfigurationError(
            f"{platform} authorization is not configured",
        )
    try:
        ensure_channel_credential_encryption()
    except ChannelCredentialEncryptionUnavailable as exc:
        raise ChannelOAuthConfigurationError(str(exc)) from exc


def configured_douyin_scopes() -> str:
    scopes = DOUYIN_CHANNEL_SCOPES.split(",")
    if (
        not scopes or "user_info" not in scopes
        or len(scopes) != len(set(scopes))
        or any(not re.fullmatch(r"[a-z][a-z0-9_.]{0,63}", scope) for scope in scopes)
    ):
        raise ChannelOAuthConfigurationError("Douyin authorization scopes are invalid")
    return ",".join(scopes)


def _utc_from_seconds(seconds: object) -> str:
    try:
        value = max(0, int(seconds))
    except (TypeError, ValueError):
        return ""
    return (
        datetime.now(timezone.utc) + timedelta(seconds=value)
    ).strftime("%Y-%m-%d %H:%M:%S")


def _utc_from_timestamp(timestamp: object) -> str:
    try:
        value = int(timestamp)
    except (TypeError, ValueError):
        return ""
    return datetime.fromtimestamp(value, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _scope_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if isinstance(value, str):
        return [item for item in value.split(",") if item]
    return []


async def _post(
    url: str,
    *,
    json: dict[str, object] | None = None,
    data: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    owns_client = client is None
    active_client = client or httpx.AsyncClient(timeout=15.0)
    try:
        response = await active_client.post(
            url,
            json=json,
            data=data,
            headers=headers,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ChannelOAuthProviderError(
            "The channel authorization provider is unavailable",
        ) from exc
    finally:
        if owns_client:
            await active_client.aclose()
    if not isinstance(payload, dict):
        raise ChannelOAuthProviderError(
            "The channel authorization provider returned an invalid response",
        )
    return payload


async def start_channel_authorization(
    user_id: str,
    project_id: str,
    platform: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> ChannelAuthorizationStart:
    ensure_project_channel_access(user_id, project_id)
    if platform == "douyin":
        _require_configuration("douyin", {
            "DOUYIN_CHANNEL_CLIENT_KEY": DOUYIN_CHANNEL_CLIENT_KEY,
            "DOUYIN_CHANNEL_CLIENT_SECRET": DOUYIN_CHANNEL_CLIENT_SECRET,
            "DOUYIN_CHANNEL_REDIRECT_URI": DOUYIN_CHANNEL_REDIRECT_URI,
        })
        scopes = configured_douyin_scopes()
        state = create_channel_authorization_state(user_id, project_id, platform)
        query = urlencode({
            "client_key": DOUYIN_CHANNEL_CLIENT_KEY,
            "response_type": "code",
            "scope": scopes,
            "redirect_uri": DOUYIN_CHANNEL_REDIRECT_URI,
            "state": state,
        })
        return ChannelAuthorizationStart(
            platform=platform,
            mode="redirect",
            state=state,
            authorization_url=f"{DOUYIN_AUTHORIZE_URL}?{query}",
            expires_in=600,
        )
    if platform != "xiaohongshu":
        raise ChannelOAuthConfigurationError("Unsupported channel platform")
    _require_configuration("xiaohongshu", {
        "XIAOHONGSHU_CHANNEL_APP_ID": XIAOHONGSHU_CHANNEL_APP_ID,
        "XIAOHONGSHU_CHANNEL_APP_SECRET": XIAOHONGSHU_CHANNEL_APP_SECRET,
    })
    payload = await _post(
        XIAOHONGSHU_DEVICE_CODE_URL,
        json={
            "app_id": XIAOHONGSHU_CHANNEL_APP_ID,
            "app_secret": XIAOHONGSHU_CHANNEL_APP_SECRET,
            "scopes": ["basic_info"],
            "client_name": XIAOHONGSHU_CHANNEL_CLIENT_NAME,
            "device_id": uuid.uuid4().hex,
            "scene": "web",
        },
        client=client,
    )
    data = payload.get("data")
    if payload.get("code") != 0 or not isinstance(data, dict):
        raise ChannelOAuthProviderError(
            str(payload.get("msg") or "Xiaohongshu authorization could not start"),
            provider_code=str(payload.get("code") or ""),
        )
    device_code = str(data.get("device_code") or "")
    authorization_url = str(data.get("verification_uri_complete") or "")
    if not device_code or not authorization_url:
        raise ChannelOAuthProviderError(
            "Xiaohongshu authorization returned incomplete device details",
        )
    expires_in = max(1, int(data.get("expires_in") or 600))
    interval = max(1, int(data.get("interval") or 1))
    state = create_channel_authorization_state(
        user_id,
        project_id,
        platform,
        expires_in_seconds=expires_in,
    )
    attach_device_authorization(
        state,
        platform,
        provider_code=device_code,
        poll_interval_seconds=interval,
    )
    return ChannelAuthorizationStart(
        platform=platform,
        mode="device",
        state=state,
        authorization_url=authorization_url,
        expires_in=expires_in,
        interval=interval,
        user_code=str(data.get("user_code") or ""),
    )


async def exchange_douyin_code(
    code: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> ChannelOAuthGrant:
    _require_configuration("douyin", {
        "DOUYIN_CHANNEL_CLIENT_KEY": DOUYIN_CHANNEL_CLIENT_KEY,
        "DOUYIN_CHANNEL_CLIENT_SECRET": DOUYIN_CHANNEL_CLIENT_SECRET,
        "DOUYIN_CHANNEL_REDIRECT_URI": DOUYIN_CHANNEL_REDIRECT_URI,
    })
    token_payload = await _post(
        DOUYIN_TOKEN_URL,
        data={
            "client_key": DOUYIN_CHANNEL_CLIENT_KEY,
            "client_secret": DOUYIN_CHANNEL_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        },
        client=client,
    )
    token_data = token_payload.get("data")
    if not isinstance(token_data, dict) or int(token_data.get("error_code") or 0) != 0:
        raise ChannelOAuthProviderError(
            str(
                token_data.get("description")
                if isinstance(token_data, dict)
                else token_payload.get("message")
                or "Douyin token exchange failed"
            ),
            provider_code=str(
                token_data.get("error_code") if isinstance(token_data, dict) else "",
            ),
        )
    access_token = str(token_data.get("access_token") or "")
    open_id = str(token_data.get("open_id") or "")
    if not access_token or not open_id:
        raise ChannelOAuthProviderError(
            "Douyin token exchange returned incomplete credentials",
        )
    profile_payload = await _post(
        DOUYIN_USERINFO_URL,
        json={"access_token": access_token, "open_id": open_id},
        client=client,
    )
    profile = profile_payload.get("data")
    if (
        not isinstance(profile, dict)
        or int(profile_payload.get("err_no") or 0) != 0
        or int(profile.get("error_code") or 0) != 0
    ):
        raise ChannelOAuthProviderError(
            str(
                profile.get("err_msg")
                if isinstance(profile, dict)
                else profile_payload.get("err_msg")
                or "Douyin account information could not be loaded"
            ),
        )
    nickname = str(profile.get("nickname") or "")
    return ChannelOAuthGrant(
        platform_user_id=open_id,
        account_name=nickname or open_id,
        avatar_url=str(profile.get("avatar") or ""),
        profile_url="",
        scopes=_scope_list(token_data.get("scope")),
        credentials={
            "access_token": access_token,
            "refresh_token": str(token_data.get("refresh_token") or ""),
            "open_id": open_id,
            "union_id": str(profile.get("union_id") or ""),
        },
        token_expires_at=_utc_from_seconds(token_data.get("expires_in")),
        refresh_token_expires_at=_utc_from_seconds(
            token_data.get("refresh_expires_in"),
        ),
    )


async def poll_xiaohongshu_authorization(
    device_code: str,
    interval: int,
    *,
    client: httpx.AsyncClient | None = None,
) -> DeviceAuthorizationPoll:
    _require_configuration("xiaohongshu", {
        "XIAOHONGSHU_CHANNEL_APP_ID": XIAOHONGSHU_CHANNEL_APP_ID,
        "XIAOHONGSHU_CHANNEL_APP_SECRET": XIAOHONGSHU_CHANNEL_APP_SECRET,
    })
    token_payload = await _post(
        XIAOHONGSHU_DEVICE_TOKEN_URL,
        json={
            "app_id": XIAOHONGSHU_CHANNEL_APP_ID,
            "app_secret": XIAOHONGSHU_CHANNEL_APP_SECRET,
            "device_code": device_code,
        },
        client=client,
    )
    code = int(token_payload.get("code") or 0)
    if code in {37002, 37009}:
        return DeviceAuthorizationPoll(
            status="scanned" if code == 37009 else "pending",
            interval=interval,
        )
    if code == 37003:
        return DeviceAuthorizationPoll(status="pending", interval=interval + 5)
    token_data = token_payload.get("data")
    if code != 0 or not isinstance(token_data, dict):
        raise ChannelOAuthProviderError(
            str(token_payload.get("msg") or "Xiaohongshu authorization failed"),
            provider_code=str(code),
        )
    access_token = str(token_data.get("access_token") or "")
    open_id = str(token_data.get("open_id") or "")
    if not access_token or not open_id:
        raise ChannelOAuthProviderError(
            "Xiaohongshu token exchange returned incomplete credentials",
        )
    profile_payload = await _post(
        XIAOHONGSHU_USERINFO_URL,
        headers={"Authorization": access_token},
        client=client,
    )
    profile = profile_payload.get("data")
    if profile_payload.get("code") != 0 or not isinstance(profile, dict):
        raise ChannelOAuthProviderError(
            str(
                profile_payload.get("msg")
                or "Xiaohongshu account information could not be loaded"
            ),
        )
    nickname = str(profile.get("nickname") or "")
    grant = ChannelOAuthGrant(
        platform_user_id=str(profile.get("open_id") or open_id),
        account_name=nickname or open_id,
        avatar_url=str(profile.get("avatar") or ""),
        profile_url="",
        scopes=_scope_list(token_data.get("scope")),
        credentials={
            "access_token": access_token,
            "refresh_token": str(token_data.get("refresh_token") or ""),
            "open_id": open_id,
        },
        token_expires_at=_utc_from_timestamp(token_data.get("expire_time")),
        refresh_token_expires_at=_utc_from_timestamp(
            token_data.get("refresh_expire_time"),
        ),
    )
    return DeviceAuthorizationPoll(
        status="authorized",
        interval=interval,
        grant=grant,
    )
