from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
    InvalidChannelCredential,
    decrypt_channel_credentials,
)
from app.engines.publishing.publication_executor import (
    PublicationExecutionError,
    PublicationJob,
    PublicationResult,
)
from app.media_storage import read_media_bytes

DOUYIN_API_BASE = "https://open.douyin.com/api/douyin/v1/video"
DOUYIN_UPLOAD_VIDEO = f"{DOUYIN_API_BASE}/upload_video/"
DOUYIN_CREATE_VIDEO = f"{DOUYIN_API_BASE}/create_video/"
DOUYIN_UPLOAD_IMAGE = f"{DOUYIN_API_BASE}/upload_image/"
DOUYIN_CREATE_IMAGE_TEXT = f"{DOUYIN_API_BASE}/create_image_text/"


class PlatformPublisher:
    def __init__(self, *, client: httpx.AsyncClient | None = None) -> None:
        self.client = client

    def credentials(self, job: PublicationJob) -> dict[str, object]:
        if job.authorization_status != "active":
            raise PublicationExecutionError("The channel account is unavailable; reconnect the account")
        if not job.credential_blob or job.platform_user_id.startswith("local-test-"):
            raise PublicationExecutionError("This account has no real platform authorization; connect a real account")
        if job.token_expires_at:
            try:
                expires = datetime.fromisoformat(job.token_expires_at.replace("Z", "+00:00"))
            except ValueError as exc:
                raise PublicationExecutionError("The account token expiry is invalid; reconnect the account") from exc
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= datetime.now(timezone.utc):
                raise PublicationExecutionError("The account authorization has expired; reconnect the account")
        try:
            credentials = decrypt_channel_credentials(job.credential_blob)
        except (ChannelCredentialEncryptionUnavailable, InvalidChannelCredential) as exc:
            raise PublicationExecutionError("The account credentials cannot be read; check encryption configuration and reconnect") from exc
        if not isinstance(credentials.get("access_token"), str) or not credentials["access_token"]:
            raise PublicationExecutionError("The account access token is missing; reconnect the account")
        if not job.platform_user_id:
            raise PublicationExecutionError("The platform account identifier is missing; reconnect the account")
        if job.media_mode == "video":
            if len(job.assets) != 1 or job.assets[0].media_type != "video":
                raise PublicationExecutionError("Video publication requires exactly one video")
        elif not job.assets or any(asset.media_type != "image" for asset in job.assets):
            raise PublicationExecutionError("Image publication requires images and does not accept videos")
        return credentials

    async def publish(
        self, job: PublicationJob, before_submit: Callable[[], None],
    ) -> PublicationResult:
        if job.platform == "xiaohongshu":
            raise PublicationExecutionError(
                "Xiaohongshu has not opened a verified official creator publishing API; "
                "write_notes is listed as planned. This plan was not submitted"
            )
        if job.platform != "douyin":
            raise PublicationExecutionError("This publication platform is not supported")
        credentials = self.credentials(job)
        if "video.create.bind" not in job.scopes:
            raise PublicationExecutionError("The Douyin account lacks video.create.bind publishing permission; reauthorize")
        token = str(credentials["access_token"])
        if credentials.get("open_id") not in (None, "", job.platform_user_id):
            raise PublicationExecutionError("The account token belongs to a different platform identity; reconnect the account")
        text = "\n".join(part for part in (
            job.title, job.content, " ".join(f"#{tag}" for tag in job.tags),
        ) if part)
        if len(text) > 1000:
            raise PublicationExecutionError("Douyin publication title, body and tags together must be at most 1000 characters")
        if job.media_mode == "image_text" and len(job.assets) > 30:
            raise PublicationExecutionError("Douyin image posts support at most 30 images; reduce the images before scheduling again")
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))
        params = {"open_id": job.platform_user_id}
        headers = {"access-token": token}
        try:
            ids = []
            for asset in job.assets:
                is_video = asset.media_type == "video"
                try:
                    data = read_media_bytes(
                        asset.object_key,
                        max_bytes=min(MAX_VIDEO_SIZE_BYTES, 300 * 1024 * 1024) if is_video
                        else min(MAX_IMAGE_SIZE_BYTES, 20 * 1024 * 1024),
                    )
                except (OSError, ValueError, RuntimeError) as exc:
                    raise PublicationExecutionError("Publication media could not be read or exceeds the platform size limit") from exc
                if not data:
                    raise PublicationExecutionError("Publication media is empty; replace the file before scheduling again")
                field = "video" if is_video else "image"
                payload = await self._post(
                    client, DOUYIN_UPLOAD_VIDEO if is_video else DOUYIN_UPLOAD_IMAGE,
                    params=params, headers=headers,
                    files={field: (asset.name, data, asset.mime_type)},
                )
                media = payload.get(field)
                media_id = media.get(f"{field}_id") if isinstance(media, dict) else None
                if not isinstance(media_id, str) or not media_id:
                    raise PublicationExecutionError("Douyin upload did not return a media ID")
                ids.append(media_id)
            body: dict[str, object] = {"text": text}
            if job.media_mode == "video":
                body["video_id"] = ids[0]
                url = DOUYIN_CREATE_VIDEO
            else:
                body["image_list"] = ids
                url = DOUYIN_CREATE_IMAGE_TEXT
            before_submit()
            payload = await self._post(
                client, url, params=params, headers=headers, json=body, submitting=True,
            )
            item_id = payload.get("item_id")
            video_id = payload.get("video_id")
            if not isinstance(item_id, str) or not item_id:
                raise PublicationExecutionError(
                    "Douyin creation did not return a post ID; verify the platform before retrying",
                    outcome_unknown=True,
                )
            return PublicationResult(item_id, video_id if isinstance(video_id, str) else "")
        finally:
            if owns_client:
                await client.aclose()

    async def _post(
        self, client: httpx.AsyncClient, url: str, *,
        params: dict[str, str], headers: dict[str, str],
        files: dict[str, tuple[str, bytes, str]] | None = None,
        json: dict[str, object] | None = None, submitting: bool = False,
    ) -> dict[str, Any]:
        try:
            response = await client.post(url, params=params, headers=headers, files=files, json=json)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise PublicationExecutionError(
                "Douyin publishing request failed. "
                + ("The post may already have been accepted; verify the account before scheduling again"
                   if submitting else "Upload did not complete; set the publication plan again"),
                outcome_unknown=submitting,
            ) from exc
        data = payload.get("data") if isinstance(payload, dict) else None
        extra = payload.get("extra") if isinstance(payload, dict) else None
        if not isinstance(data, dict) or not isinstance(extra, dict):
            raise PublicationExecutionError("Douyin returned an invalid publishing response", outcome_unknown=submitting)
        codes = [data.get("error_code"), extra.get("error_code")]
        if any(type(code) is not int for code in codes):
            raise PublicationExecutionError("Douyin publishing response omitted a valid result code", outcome_unknown=submitting)
        error_code = next((code for code in codes if code != 0), 0)
        if error_code:
            ambiguous = submitting and error_code in {2100004, 28001005, 28001006}
            raise PublicationExecutionError(
                f"Douyin rejected the publishing request (code {error_code})"
                + (". Verify the platform before scheduling again; the result may be uncertain" if ambiguous else ""),
                outcome_unknown=ambiguous,
            )
        return data
