from __future__ import annotations

import base64
import binascii
import hashlib
import mimetypes
import os
import re
import tempfile
from functools import lru_cache
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse

from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

from app.config import (
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_VIDEO_EXTENSIONS,
    MEDIA_ROOT,
    MEDIA_S3_ACCESS_KEY_ID,
    MEDIA_S3_ADDRESSING_STYLE,
    MEDIA_S3_BUCKET,
    MEDIA_S3_ENDPOINT_URL,
    MEDIA_S3_PREFIX,
    MEDIA_S3_PRESIGNED_TTL_SECONDS,
    MEDIA_S3_PUBLIC_BASE_URL,
    MEDIA_S3_REGION,
    MEDIA_S3_SECRET_ACCESS_KEY,
    MEDIA_STORAGE_BACKEND,
)

_IMAGE_DATA_URL = re.compile(
    r"^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\\s]+)$"
)
_IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}
_PUBLIC_MEDIA_PREFIXES = (
    "avatars/",
    "organization-avatars/",
    "project-materials/",
    "content-generator/",
    "portfolio/",
    "users/",
)


class MediaStorageConfigurationError(RuntimeError):
    pass


def _normalize_key(value: str) -> str:
    normalized = str(PurePosixPath(value.replace("\\", "/").lstrip("/")))
    if (
        not normalized
        or normalized == "."
        or normalized.startswith("../")
        or "/../" in f"/{normalized}/"
    ):
        raise ValueError("Invalid media object key")
    return normalized


def _local_path(key: str) -> str:
    normalized = _normalize_key(key)
    media_root = os.path.realpath(MEDIA_ROOT)
    path = os.path.realpath(os.path.join(MEDIA_ROOT, *normalized.split("/")))
    if os.path.commonpath([path, media_root]) != media_root:
        raise ValueError("Invalid media object key")
    return path


def _is_s3() -> bool:
    return MEDIA_STORAGE_BACKEND == "s3"


def _s3_key(key: str) -> str:
    normalized = _normalize_key(key)
    prefix = MEDIA_S3_PREFIX.strip("/")
    return f"{prefix}/{normalized}" if prefix else normalized


def _logical_s3_key(key: str) -> str:
    prefix = MEDIA_S3_PREFIX.strip("/")
    if not prefix:
        return key
    marker = f"{prefix}/"
    return key[len(marker):] if key.startswith(marker) else key


@lru_cache(maxsize=1)
def _s3_client():
    if not MEDIA_S3_BUCKET:
        raise MediaStorageConfigurationError(
            "MEDIA_S3_BUCKET is required for S3 media storage",
        )
    import boto3
    from botocore.config import Config

    credentials = {}
    if MEDIA_S3_ACCESS_KEY_ID or MEDIA_S3_SECRET_ACCESS_KEY:
        if not MEDIA_S3_ACCESS_KEY_ID or not MEDIA_S3_SECRET_ACCESS_KEY:
            raise MediaStorageConfigurationError(
                "Both S3 access key ID and secret access key are required",
            )
        credentials = {
            "aws_access_key_id": MEDIA_S3_ACCESS_KEY_ID,
            "aws_secret_access_key": MEDIA_S3_SECRET_ACCESS_KEY,
        }
    return boto3.client(
        "s3",
        endpoint_url=MEDIA_S3_ENDPOINT_URL or None,
        region_name=MEDIA_S3_REGION or None,
        config=Config(s3={"addressing_style": MEDIA_S3_ADDRESSING_STYLE}),
        **credentials,
    )


def validate_media_storage() -> None:
    if MEDIA_STORAGE_BACKEND not in {"local", "s3"}:
        raise MediaStorageConfigurationError(
            "MEDIA_STORAGE_BACKEND must be 'local' or 's3'",
        )
    if _is_s3():
        _s3_client()
    else:
        os.makedirs(MEDIA_ROOT, mode=0o700, exist_ok=True)


def put_media_bytes(
    key: str,
    data: bytes,
    *,
    content_type: str = "application/octet-stream",
) -> str:
    normalized = _normalize_key(key)
    if _is_s3():
        _s3_client().put_object(
            Bucket=MEDIA_S3_BUCKET,
            Key=_s3_key(normalized),
            Body=data,
            ContentType=content_type,
        )
        return normalized

    destination = _local_path(normalized)
    directory = os.path.dirname(destination)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".media-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, destination)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    return normalized


def read_media_bytes(key: str, *, max_bytes: int | None = None) -> bytes:
    normalized = _normalize_key(key)
    if _is_s3():
        response = _s3_client().get_object(
            Bucket=MEDIA_S3_BUCKET,
            Key=_s3_key(normalized),
        )
        body = response["Body"]
        try:
            data = body.read() if max_bytes is None else body.read(max_bytes + 1)
        finally:
            body.close()
    else:
        with open(_local_path(normalized), "rb") as handle:
            data = handle.read() if max_bytes is None else handle.read(max_bytes + 1)
    if max_bytes is not None and len(data) > max_bytes:
        raise ValueError("Media object exceeds the document size limit")
    return data


def media_exists(key: str) -> bool:
    normalized = _normalize_key(key)
    if _is_s3():
        from botocore.exceptions import ClientError

        try:
            _s3_client().head_object(
                Bucket=MEDIA_S3_BUCKET,
                Key=_s3_key(normalized),
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return False
            raise
        return True
    return os.path.isfile(_local_path(normalized))


def delete_media(key: str) -> None:
    normalized = _normalize_key(key)
    if _is_s3():
        _s3_client().delete_object(
            Bucket=MEDIA_S3_BUCKET,
            Key=_s3_key(normalized),
        )
        return
    path = _local_path(normalized)
    if os.path.isfile(path):
        os.remove(path)


def list_media_keys(prefix: str) -> list[str]:
    normalized_prefix = _normalize_key(prefix).rstrip("/") + "/"
    if _is_s3():
        keys: list[str] = []
        paginator = _s3_client().get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=MEDIA_S3_BUCKET,
            Prefix=_s3_key(normalized_prefix.rstrip("/")) + "/",
        ):
            keys.extend(
                _logical_s3_key(item["Key"]) for item in page.get("Contents", [])
                if item.get("Key")
            )
        return keys
    directory = _local_path(normalized_prefix)
    if not os.path.isdir(directory):
        return []
    media_root = os.path.realpath(MEDIA_ROOT)
    return [
        os.path.relpath(
            os.path.join(root, filename),
            media_root,
        ).replace(os.sep, "/")
        for root, _, filenames in os.walk(directory)
        for filename in filenames
    ]


def delete_media_prefix(prefix: str) -> None:
    keys = list_media_keys(prefix)
    if _is_s3():
        for offset in range(0, len(keys), 1000):
            batch = keys[offset:offset + 1000]
            if batch:
                _s3_client().delete_objects(
                    Bucket=MEDIA_S3_BUCKET,
                    Delete={"Objects": [{"Key": _s3_key(key)} for key in batch]},
                )
        return
    for key in keys:
        delete_media(key)
    directory = _local_path(prefix)
    if os.path.isdir(directory):
        import shutil
        shutil.rmtree(directory)


def media_url(key: str, base_url: str) -> str:
    normalized = _normalize_key(key)
    return f"{base_url.rstrip('/')}/media/{quote(normalized, safe='/')}"


def media_key_from_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    path = parsed.path if parsed.scheme else value
    if "/media/" in path:
        path = path.split("/media/", 1)[1]
    elif parsed.scheme:
        return ""
    try:
        return _normalize_key(path)
    except ValueError:
        return ""


def materialize_media(key: str) -> tuple[str, bool]:
    normalized = _normalize_key(key)
    if not _is_s3():
        return _local_path(normalized), False
    suffix = os.path.splitext(normalized)[1]
    fd, path = tempfile.mkstemp(prefix="marventa-media-", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(read_media_bytes(normalized))
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        raise
    return path, True


def media_response(
    key: str,
    *,
    filename: str = "",
    public: bool = False,
) -> Response:
    normalized = _normalize_key(key)
    parts = normalized.split("/")
    publication_media = (
        len(parts) == 6
        and parts[0] == "publishing"
        and parts[3] == "publications"
        and PurePosixPath(normalized).suffix.lower()
        in ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS
    )
    if public and not (normalized.startswith(_PUBLIC_MEDIA_PREFIXES) or publication_media):
        raise HTTPException(status_code=404, detail="Media not found")
    if not media_exists(normalized):
        raise HTTPException(status_code=404, detail="Media not found")
    if not _is_s3():
        return FileResponse(_local_path(normalized), filename=filename or None)
    if MEDIA_S3_PUBLIC_BASE_URL and not filename:
        return RedirectResponse(
            f"{MEDIA_S3_PUBLIC_BASE_URL.rstrip('/')}/"
            f"{quote(_s3_key(normalized), safe='/')}",
            status_code=307,
        )
    params = {"Bucket": MEDIA_S3_BUCKET, "Key": _s3_key(normalized)}
    if filename:
        params["ResponseContentDisposition"] = (
            f"attachment; filename*=UTF-8''{quote(filename)}"
        )
    url = _s3_client().generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=MEDIA_S3_PRESIGNED_TTL_SECONDS,
    )
    return RedirectResponse(url, status_code=307)


def _valid_image_signature(mime_type: str, data: bytes) -> bool:
    if mime_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def validate_work_media(filename: str, data: bytes, kind: str) -> str:
    extension = PurePosixPath(filename).suffix.lower()
    allowed = ALLOWED_VIDEO_EXTENSIONS if kind == "video" else ALLOWED_IMAGE_EXTENSIONS
    if extension not in allowed:
        raise ValueError("Unsupported work media type")
    mime_type = guess_content_type(filename)
    if not data:
        raise ValueError("Work media file is empty")
    if kind == "image" and not _valid_image_signature(mime_type, data):
        raise ValueError("Invalid work image file")
    if kind == "video" and not (
        (extension == ".webm" and data.startswith(b"\x1a\x45\xdf\xa3"))
        or (extension != ".webm" and len(data) >= 12 and data[4:8] == b"ftyp")
        or (extension == ".mov" and len(data) >= 12 and data[4:8] in {b"moov", b"mdat", b"wide", b"free"})
    ):
        raise ValueError("Invalid work video file")
    return mime_type


def store_image_data_url(
    value: str,
    category: str,
    owner_id: str,
    base_url: str,
    invalid_detail: str,
) -> str:
    match = _IMAGE_DATA_URL.fullmatch(value)
    if not match:
        return value
    mime_type, encoded = match.groups()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=invalid_detail) from exc
    if not data or len(data) > 2 * 1024 * 1024 or not _valid_image_signature(mime_type, data):
        raise HTTPException(status_code=400, detail=invalid_detail)

    filename = f"{hashlib.sha256(data).hexdigest()[:24]}.{_IMAGE_EXTENSIONS[mime_type]}"
    key = f"{category}/{owner_id}/{filename}"
    if not media_exists(key):
        put_media_bytes(key, data, content_type=mime_type)
    return media_url(key, base_url)


def guess_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"
