from __future__ import annotations

import os
import uuid
from typing import Annotated

import aiofiles
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

from app.auth.dependencies import get_current_user
from app.config import ALLOWED_DOCUMENT_TYPES, ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES
from app.engines.market_insight.ai_analyzer import analyze_async
from app.engines.market_insight.models import (
    AnalysisLocale,
    HistoryUpdateRequest,
    InsightRenameRequest,
    ManualInsightRequest,
    ParsedDocument,
    ParseRequest,
)
from app.engines.market_insight.parser_factory import parse_document
from app.engines.market_insight.storage import (
    InsightProjectAccessDenied,
    InsightRetryNotAllowed,
    add_insight_source,
    delete_insight,
    get_insight,
    get_insight_source_file,
    get_insight_source_preview,
    list_history,
    list_insight_sources,
    prepare_insight_retry,
    rename_insight,
    save_insight,
    save_manual_insight,
    update_insight,
)
from app.media_storage import (
    delete_media,
    delete_media_prefix,
    guess_content_type,
    media_response,
    put_media_bytes,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/market_insight", tags=["market_insight"])


@router.get("/health")
async def health_check():
    return success_response("Service is running", {"status": "healthy"})


@router.get("/history")
async def get_history(
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    project_id: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    records = list_history(
        owner_id=current_user["id"], limit=limit, offset=offset,
        search=search, project_id=project_id,
    )
    return success_response("History retrieved", [r.model_dump() for r in records])


@router.get("/history/{record_id}")
async def get_history_item(record_id: str, current_user=Depends(get_current_user)):
    record = get_insight(record_id, current_user["id"])
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Record retrieved", record.model_dump())


@router.get("/history/{record_id}/sources")
async def get_history_sources(record_id: str, current_user=Depends(get_current_user)):
    sources = list_insight_sources(record_id, current_user["id"])
    if sources is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Sources retrieved", [source.model_dump() for source in sources])


@router.get("/history/{record_id}/sources/{source_id}/preview")
async def get_history_source_preview(
    record_id: str,
    source_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20_000, ge=1, le=50_000),
    current_user=Depends(get_current_user),
):
    preview = get_insight_source_preview(
        record_id, source_id, current_user["id"], offset=offset, limit=limit,
    )
    if preview is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return success_response("Source preview retrieved", preview)


@router.get("/history/{record_id}/sources/{source_id}/file")
async def get_history_source_file(
    record_id: str, source_id: str, current_user=Depends(get_current_user),
):
    source_file = get_insight_source_file(record_id, source_id, current_user["id"])
    if source_file is None:
        raise HTTPException(status_code=404, detail="Source file not found")
    filename, relative_path = source_file
    return media_response(relative_path, filename=filename)


@router.put("/history/{record_id}")
async def update_history_item(record_id: str, body: HistoryUpdateRequest, current_user=Depends(get_current_user)):
    existing = get_insight(record_id, current_user["id"])
    if existing is None:
        raise HTTPException(status_code=404, detail="Record not found")
    if existing.source_type != "manual" and existing.status in {"analyzing", "failed"}:
        raise HTTPException(
            status_code=409,
            detail="Document insights cannot be edited while analyzing or failed",
        )
    try:
        record = update_insight(record_id, body.ai_analysis, current_user["id"])
    except InsightProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Record updated", record.model_dump())


@router.patch("/history/{record_id}/name")
async def rename_history_item(
    record_id: str,
    body: InsightRenameRequest,
    current_user=Depends(get_current_user),
):
    try:
        record = rename_insight(record_id, body.name, current_user["id"])
    except InsightProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except InsightRetryNotAllowed as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Record renamed", record.model_dump())


@router.post("/history/{record_id}/retry")
async def retry_history_item(
    record_id: str, locale: Annotated[AnalysisLocale, Query()] = "zh-CN",
    current_user=Depends(get_current_user),
):
    try:
        prepared = prepare_insight_retry(record_id, current_user["id"])
    except InsightProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except InsightRetryNotAllowed as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if prepared is None:
        raise HTTPException(status_code=404, detail="Record not found")
    document, owner_id = prepared
    analyze_async(document, record_id=record_id, owner_id=owner_id, locale=locale)
    record = get_insight(record_id, current_user["id"])
    return success_response("Analysis restarted", record.model_dump())


@router.delete("/history/{record_id}")
async def delete_history_item(record_id: str, current_user=Depends(get_current_user)):
    existing = get_insight(record_id, current_user["id"])
    if existing is None:
        raise HTTPException(status_code=404, detail="Record not found")
    sources = list_insight_sources(record_id, current_user["id"]) or []
    source_files = [
        source_file
        for source in sources
        if (source_file := get_insight_source_file(
            record_id, source.id, current_user["id"],
        )) is not None
    ]
    try:
        deleted = delete_insight(record_id, current_user["id"])
    except InsightProjectAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")

    delete_media_prefix(f"market_insight_sources/{record_id}")
    for _, relative_path in source_files:
        delete_media(relative_path)

    return success_response("Record deleted")


@router.post("/manual")
async def create_manual_insight(body: ManualInsightRequest, current_user=Depends(get_current_user)):
    try:
        record = save_manual_insight(
            body.ai_analysis, owner_id=current_user["id"], project_id=body.project_id,
        )
    except InsightProjectAccessDenied as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    add_insight_source(
        record.id, record.filename, 0, "manual", "", position=0,
    )
    return success_response("Manual insight created", record.model_dump())


@router.post("/parse")
async def parse_file(
    files: list[UploadFile] = File(...),
    project_id: str = Form(...),
    locale: Annotated[AnalysisLocale, Form()] = "zh-CN",
    with_ai: bool = Query(default=True),
    current_user=Depends(get_current_user),
    request: Request = None,
):
    if not files or any(not file.filename for file in files):
        raise HTTPException(status_code=400, detail="No file selected")
    if len(files) > 5:
        raise HTTPException(status_code=400, detail="Files cannot exceed 5")

    # Pre-check Content-Length before reading body into memory
    content_length = request.headers.get("content-length") if request else None
    if content_length and int(content_length) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB",
        )

    record = None
    temp_paths: list[str] = []
    persisted_dir = ""
    try:
        parsed_sources: list[tuple[UploadFile, bytes, ParsedDocument]] = []
        total_size = 0
        for file in files:
            ext = os.path.splitext(file.filename or "")[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
                )
            source_type = _resolve_source_type(file.content_type, ext)
            if source_type is None:
                raise HTTPException(status_code=400, detail=f"Unsupported content type: {file.content_type}")
            content_bytes = await file.read()
            total_size += len(content_bytes)
            if len(content_bytes) > MAX_UPLOAD_SIZE_BYTES or total_size > MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Upload too large. Max total size: {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB",
                )
            temp_path = f"/tmp/{uuid.uuid4().hex}{ext}"
            temp_paths.append(temp_path)
            async with aiofiles.open(temp_path, "wb") as temp:
                await temp.write(content_bytes)
            if source_type == "markdown":
                parsed = parse_document(
                    source_type, content=content_bytes.decode("utf-8"), with_ai=False,
                )
            else:
                parsed = parse_document(source_type, file_path=temp_path, with_ai=False)
            parsed_sources.append((file, content_bytes, parsed))

        combined_text = "\n\n".join(
            f"===== {file.filename} =====\n\n{parsed.raw_text}"
            for file, _, parsed in parsed_sources
        )
        first_title = parsed_sources[0][2].title
        combined_title = (
            first_title if len(parsed_sources) == 1
            else f"{first_title} ({len(parsed_sources)} sources)"
        )
        result = ParsedDocument(
            title=combined_title,
            source_type=parsed_sources[0][2].source_type if len(parsed_sources) == 1 else "documents",
            raw_text=combined_text,
        )

        # Save with analyzing status, AI will update later
        status = "analyzing" if with_ai else "completed"
        record = save_insight(
            result,
            parsed_sources[0][0].filename if len(parsed_sources) == 1 else f"{len(parsed_sources)} sources",
            sum(len(content) for _, content, _ in parsed_sources),
            owner_id=current_user["id"], project_id=project_id, status=status,
        )
        persisted_dir = f"market_insight_sources/{record.id}"
        for position, (file, content_bytes, parsed) in enumerate(parsed_sources):
            safe_filename = os.path.basename(file.filename or f"source-{position + 1}")
            stored_filename = f"{position + 1}-{safe_filename}"
            relative_path = (
                f"market_insight_sources/{record.id}/{stored_filename}"
            )
            put_media_bytes(
                relative_path,
                content_bytes,
                content_type=file.content_type or guess_content_type(stored_filename),
            )
            add_insight_source(
                record.id,
                file.filename or safe_filename,
                len(content_bytes),
                parsed.source_type,
                parsed.raw_text,
                relative_path,
                position,
            )
        response_data = result.model_dump()
        response_data["record_id"] = record.id
        response_data["status"] = status

        # Start async AI analysis in background
        if with_ai:
            analyze_async(result, record_id=record.id, owner_id=current_user["id"], locale=locale)

        return success_response("Document uploaded, AI analysis in progress", response_data)
    except ValueError as e:
        if record is not None:
            delete_insight(record.id, current_user["id"])
        if persisted_dir:
            delete_media_prefix(persisted_dir)
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as exc:
        if record is not None:
            delete_insight(record.id, current_user["id"])
        if persisted_dir:
            delete_media_prefix(persisted_dir)
        raise HTTPException(status_code=500, detail="Could not persist source file") from exc
    finally:
        for temp_path in temp_paths:
            if os.path.exists(temp_path):
                os.remove(temp_path)


@router.post("/parse_repo")
async def parse_repo(
    request: ParseRequest,
    with_ai: bool = Query(default=True),
    current_user=Depends(get_current_user),
):
    if not request.repo_url:
        raise HTTPException(status_code=400, detail="repo_url is required")

    try:
        result = parse_document("repo", content=request.repo_url, with_ai=False)
        status = "analyzing" if with_ai else "completed"
        record = save_insight(
            result, request.repo_url, 0, owner_id=current_user["id"],
            project_id=request.project_id, status=status,
        )
        add_insight_source(
            record.id, request.repo_url, 0, "repo", result.raw_text, position=0,
        )
        response_data = result.model_dump()
        response_data["record_id"] = record.id
        response_data["status"] = status

        if with_ai:
            analyze_async(result, record_id=record.id, owner_id=current_user["id"], locale=request.locale)

        return success_response("Repository uploaded, AI analysis in progress", response_data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _resolve_source_type(content_type: str | None, ext: str) -> str | None:
    if content_type and content_type in ALLOWED_DOCUMENT_TYPES:
        resolved = ALLOWED_DOCUMENT_TYPES[content_type]
        if resolved:
            return resolved

    ext_map = {
        ".md": "markdown",
        ".markdown": "markdown",
        ".pdf": "pdf",
        ".docx": "docx",
    }
    return ext_map.get(ext)
