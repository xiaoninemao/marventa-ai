"""Stable platform-account identity for project-independent lead tracking."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping


def lead_account_key(
    organization_id: str,
    platform: str,
    platform_user_id: str,
    binding_id: str,
) -> str:
    identity = platform_user_id.strip() or f"binding:{binding_id}"
    return hashlib.sha256(
        f"{organization_id}\0{platform.strip().lower()}\0{identity}".encode("utf-8"),
    ).hexdigest()


def legacy_lead_account_key(
    platform: str,
    platform_user_id: str,
    binding_id: str,
) -> str:
    identity = platform_user_id.strip() or f"binding:{binding_id}"
    return hashlib.sha256(
        f"{platform.strip().lower()}\0{identity}".encode("utf-8"),
    ).hexdigest()


def lead_account_key_from_row(account: Mapping[str, object]) -> str:
    return lead_account_key(
        str(account["organization_id"]),
        str(account["platform"]),
        str(account.get("platform_user_id") or ""),
        str(account["id"]),
    )
