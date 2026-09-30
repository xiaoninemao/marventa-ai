from __future__ import annotations

import os
import re
import tempfile
import uuid
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from pydantic import BaseModel

from app.auth.dependencies import (
    get_current_user,
    get_optional_user,
)
from app.config import (
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_VIDEO_EXTENSIONS,
    MAX_IMAGE_SIZE_BYTES,
    MAX_VIDEO_SIZE_BYTES,
)
from app.engines.case_library.favorites import (
    add_favorite,
    get_favorite_ids,
    is_favorited,
    remove_favorite,
)
from app.engines.case_library.models import CaseUpdate
from app.engines.case_library.storage import (
    create_case,
    delete_case,
    get_case,
    list_favorited_cases,
    list_user_cases,
    update_case,
)
from app.media_storage import (
    delete_media,
    guess_content_type,
    materialize_media,
    media_key_from_url,
    put_media_bytes,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/case_library", tags=["case_library"])

class CaseImportTaskRequest(BaseModel):
    input: str
    manual_text: str = ""
    save_case: bool = True
    project_id: str


def _sanitize_filename(name: str) -> str:
    return re.sub(r"[^\w.\-]", "_", name)


def _media_prefix(owner_id: str, media_type: str) -> str:
    return f"users/{owner_id}/{media_type}"


@router.get("/health")
async def health_check():
    return success_response("Case library service is running", {"status": "healthy"})


@router.post("/import_tasks")
async def create_case_import_task(
    body: CaseImportTaskRequest,
    current_user=Depends(get_current_user),
):
    if not body.input.strip() and not body.manual_text.strip():
        raise HTTPException(status_code=400, detail="Input or manual_text is required")

    from app.engines.case_library.import_tasks import create_and_run_import_task

    owner_id = current_user["id"]
    task = create_and_run_import_task(
        owner_id=owner_id,
        raw_input=body.input.strip(),
        manual_text=body.manual_text.strip(),
        save_case=body.save_case,
        project_id=body.project_id,
    )
    if task.get("status") == "failed":
        raise HTTPException(status_code=422, detail=task.get("error") or "Import failed")
    return success_response("Import task started", task)


@router.get("/import_tasks/{task_id}")
async def get_case_import_task(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    from app.engines.case_library.import_tasks import get_import_task

    task = get_import_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Import task not found")
    owner_id = task.get("owner_id") or ""
    if owner_id and current_user and owner_id != current_user.get("id", ""):
        raise HTTPException(status_code=403, detail="You can only view your own import tasks")
    return success_response("Import task retrieved", task)

@router.get("/cases")
async def get_accessible_cases(
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    content_type: str = Query(default=""),
    project_id: str = Query(default=""),
    search: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    user_id = current_user.get("id", "")
    cases = list_user_cases(user_id, limit=limit, offset=offset, content_type=content_type, project_id=project_id, search=search)
    fav_ids = get_favorite_ids(user_id) if user_id else set()
    return success_response("Cases retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": list(fav_ids),
    })


@router.get("/cases/{case_id}")
async def get_case_item(case_id: str, current_user=Depends(get_current_user)):
    user_id = current_user.get("id", "")
    case = get_case(case_id, user_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    data = case.model_dump()
    data["is_favorited"] = is_favorited(user_id, case_id) if user_id else False
    return success_response("Case retrieved", data)


# ── User endpoints (auth required) ──

@router.get("/my/cases")
async def get_my_cases(
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    project_id: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    cases = list_user_cases(
        current_user["id"], limit=limit, offset=offset,
        search=search, project_id=project_id,
    )
    fav_ids = get_favorite_ids(current_user["id"])
    return success_response("My cases retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": list(fav_ids),
    })


@router.get("/my/favorites")
async def get_my_favorites(
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    cases = list_favorited_cases(current_user["id"], limit=limit, offset=offset, search=search)
    return success_response("My favorites retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": [c.id for c in cases],
    })


@router.post("/cases")
async def create_case_item(
    title: str = Form(...),
    content_type: str = Form(...),
    description: str = Form(""),
    tags: str = Form("[]"),
    source: str = Form(""),
    project_id: str = Form(...),
    video: UploadFile | None = File(None),
    images: list[UploadFile] | None = File(None),
    current_user=Depends(get_current_user),
    request: Request = None,
):
    # Pre-check Content-Length before reading files into memory
    content_length = request.headers.get("content-length") if request else None
    if content_length and content_type == "video" and int(content_length) > MAX_VIDEO_SIZE_BYTES + 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Video too large. Max: {MAX_VIDEO_SIZE_BYTES // 1024 // 1024}MB")
    if content_length and content_type == "image_text" and int(content_length) > MAX_IMAGE_SIZE_BYTES * 10 + 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Images too large. Max: {MAX_IMAGE_SIZE_BYTES // 1024 // 1024}MB per image")

    if content_type not in ("video", "image_text"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'image_text'")

    import json
    try:
        tags_list = json.loads(tags) if isinstance(tags, str) else tags
    except json.JSONDecodeError:
        tags_list = []

    owner_id = current_user["id"]

    video_url = ""
    image_urls: list[str] = []

    if content_type == "video":
        if video is None or not video.filename:
            raise HTTPException(status_code=400, detail="Video file is required for video cases")
        ext = os.path.splitext(video.filename)[1].lower()
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")
        content_bytes = await video.read()
        if len(content_bytes) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Video too large. Max: {MAX_VIDEO_SIZE_BYTES // 1024 // 1024}MB")
        prefix = _media_prefix(owner_id, "videos")
        safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(video.filename)}"
        video_url = put_media_bytes(
            f"{prefix}/{safe_name}",
            content_bytes,
            content_type=video.content_type or guess_content_type(safe_name),
        )

    elif content_type == "image_text":
        if images is None or len(images) == 0:
            raise HTTPException(status_code=400, detail="At least one image is required for image_text cases")
        prefix = _media_prefix(owner_id, "images")
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Unsupported image format: {ext}")
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(status_code=413, detail=f"Image too large. Max: {MAX_IMAGE_SIZE_BYTES // 1024 // 1024}MB")
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            image_urls.append(put_media_bytes(
                f"{prefix}/{safe_name}",
                content_bytes,
                content_type=img.content_type or guess_content_type(safe_name),
            ))

    try:
        case = create_case(
            title=title,
            content_type=content_type,
            description=description,
            tags=tags_list,
            video_url=video_url,
            image_urls=image_urls,
            owner_id=owner_id,
            source=source,
            project_id=project_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Case created", case.model_dump())


# ── Update / Delete (ownership or admin check) ──

def _check_ownership(case_id: str, current_user):
    case = get_case(case_id, current_user["id"])
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if (
        case.owner_id != current_user["id"]
        and case.project_role not in {"owner", "admin"}
    ):
        raise HTTPException(status_code=403, detail="You can only modify your own cases")
    return case


@router.put("/cases/{case_id}")
async def update_case_item(
    case_id: str,
    body: CaseUpdate,
    current_user=Depends(get_current_user),
):
    case = _check_ownership(case_id, current_user)
    updates = body.model_dump(exclude_none=True)
    updated = update_case(case_id, **updates)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update case")
    updated.project_role = case.project_role
    updated.project_title = case.project_title
    updated.is_project_member = case.is_project_member
    return success_response("Case updated", updated.model_dump())


@router.post("/cases/{case_id}/media")
async def replace_case_media(
    case_id: str,
    video: UploadFile | None = File(None),
    images: list[UploadFile] | None = File(None),
    current_user=Depends(get_current_user),
):
    case = _check_ownership(case_id, current_user)
    # Delete old media files
    if case.video_url and (key := media_key_from_url(case.video_url)):
        delete_media(key)
    for img_url in case.image_urls:
        if key := media_key_from_url(img_url):
            delete_media(key)

    video_url = ""
    image_urls: list[str] = []

    if video is not None and video.filename:
        ext = os.path.splitext(video.filename)[1].lower()
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")
        content_bytes = await video.read()
        if len(content_bytes) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="Video too large")
        prefix = _media_prefix(case.owner_id, "videos")
        safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(video.filename)}"
        video_url = put_media_bytes(
            f"{prefix}/{safe_name}",
            content_bytes,
            content_type=video.content_type or guess_content_type(safe_name),
        )

    if images is not None and len(images) > 0:
        prefix = _media_prefix(case.owner_id, "images")
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Unsupported image format: {ext}")
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="Image too large")
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            image_urls.append(put_media_bytes(
                f"{prefix}/{safe_name}",
                content_bytes,
                content_type=img.content_type or guess_content_type(safe_name),
            ))

    updates = {}
    if video_url:
        updates["video_url"] = video_url
    if image_urls:
        updates["image_urls"] = image_urls

    updated = update_case(case_id, **updates)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update case media")
    updated.project_role = case.project_role
    updated.project_title = case.project_title
    updated.is_project_member = case.is_project_member
    return success_response("Media updated", updated.model_dump())


@router.delete("/cases/{case_id}")
async def delete_case_item(
    case_id: str,
    current_user=Depends(get_current_user),
):
    case = _check_ownership(case_id, current_user)

    deleted = delete_case(case_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Case not found")

    if case.video_url and (key := media_key_from_url(case.video_url)):
        delete_media(key)
    for img_url in case.image_urls:
        if key := media_key_from_url(img_url):
            delete_media(key)

    return success_response("Case deleted")


@router.post("/cases/{case_id}/analyze")
async def analyze_case_item(
    case_id: str,
    locale: Annotated[Literal["zh-CN", "en"], Query()] = "zh-CN",
    current_user=Depends(get_current_user),
    images: list[UploadFile] | None = File(None),
):
    case = _check_ownership(case_id, current_user)

    if case.ai_status == "analyzing":
        raise HTTPException(status_code=409, detail="AI analysis is already in progress")

    from app.engines.case_library.ai_analyzer import analyze_async
    from app.engines.case_library.storage import update_case_ai

    # Build image paths from existing case media
    image_paths: list[str] = []
    cleanup_paths: list[str] = []
    for img_url in case.image_urls:
        key = media_key_from_url(img_url)
        if not key:
            continue
        try:
            path, should_cleanup = materialize_media(key)
        except (FileNotFoundError, ValueError):
            continue
        image_paths.append(path)
        if should_cleanup:
            cleanup_paths.append(path)

    # If new images were uploaded for analysis, save them temporarily and add to paths
    if images:
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                continue
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                continue
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            fd, file_path = tempfile.mkstemp(
                prefix="marventa-analysis-",
                suffix=os.path.splitext(safe_name)[1],
            )
            with os.fdopen(fd, "wb") as handle:
                handle.write(content_bytes)
            image_paths.append(file_path)
            cleanup_paths.append(file_path)

    video_path = ""
    if case.video_url:
        video_path = case.video_url

    update_case_ai(case_id, "analyzing")
    analyze_async(
        case_id=case.id,
        title=case.title,
        content_type=case.content_type,
        description=case.description,
        tags=case.tags,
        image_paths=image_paths if image_paths else None,
        video_url=video_path,
        cleanup_paths=cleanup_paths,
        locale=locale,
    )
    return success_response("AI analysis started", {"status": "analyzing"})


# ── Favorites ──

@router.post("/cases/{case_id}/favorite")
async def favorite_case(case_id: str, current_user=Depends(get_current_user)):
    case = get_case(case_id, current_user["id"])
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if not add_favorite(current_user["id"], case_id):
        raise HTTPException(status_code=500, detail="Failed to favorite case")
    return success_response("Favorited")


@router.delete("/cases/{case_id}/favorite")
async def unfavorite_case(case_id: str, current_user=Depends(get_current_user)):
    remove_favorite(current_user["id"], case_id)
    return success_response("Unfavorited")
