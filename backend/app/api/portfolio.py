import asyncio
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError

from app.auth.dependencies import get_current_user
from app.engines.portfolio.models import (
    ScriptCreate,
    ScriptDocument,
    ScriptEdit,
    ScriptUpdate,
)
from app.engines.portfolio.storage import (
    create_script,
    delete_script,
    edit_script,
    get_script,
    list_scripts,
    reorder_media,
    update_script,
)
from app.media_storage import media_url
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])


def _work_data(work: ScriptDocument, request: Request) -> dict[str, Any]:
    data = work.model_dump()
    for item in data["media"]:
        item["file_url"] = media_url(item["object_key"], str(request.base_url))
    return data


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/scripts")
async def list_my_scripts(request: Request, project_id: str = "", current_user=Depends(get_current_user)):
    scripts = list_scripts(current_user["id"], project_id)
    return success_response("ok", [_work_data(s, request) for s in scripts])


@router.get("/scripts/{script_id}")
async def get_my_script(script_id: str, request: Request, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    return success_response("ok", _work_data(s, request))


@router.post("/scripts")
async def create_my_script(req: ScriptCreate, request: Request, current_user=Depends(get_current_user)):
    try:
        s = create_script(
            current_user["id"], "", "", project_id=req.project_id, media_kind=req.media_kind, name=req.name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("created", _work_data(s, request))


@router.put("/scripts/{script_id}")
async def update_my_script(script_id: str, req: ScriptUpdate, request: Request, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    if s.user_id != current_user["id"] and s.project_role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Access denied")
    if req.media_order is not None:
        if not req.expected_updated_at or req.name is not None:
            raise HTTPException(status_code=422, detail="Media order requires a version and cannot include text edits")
        try:
            updated = reorder_media(current_user["id"], script_id, req.media_order, req.expected_updated_at)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    else:
        if req.name is None:
            raise HTTPException(status_code=422, detail="Work name is required")
        updated = update_script(script_id, name=req.name)
    return success_response("updated", _work_data(updated, request))


@router.delete("/scripts/{script_id}")
async def delete_my_script(script_id: str, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    if s.user_id != current_user["id"] and s.project_role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Access denied")
    delete_script(script_id)
    return success_response("deleted")


@router.put("/scripts/{script_id}/edit")
async def edit_my_script(
    script_id: str, request: Request, metadata: str = Form(...),
    files: list[UploadFile] | None = File(default=None), current_user=Depends(get_current_user),
):
    try:
        changes = ScriptEdit.model_validate_json(metadata)
        updated = await asyncio.to_thread(
            edit_script, current_user["id"], script_id, changes,
            [(file.filename or "", file.file) for file in files or []],
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid work edit") from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409 if "Work changed" in str(exc) else 422, detail=str(exc)) from exc
    finally:
        for file in files or []:
            await file.close()
    return success_response("updated", _work_data(updated, request))
