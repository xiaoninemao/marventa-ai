from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Annotated, Literal
from urllib.parse import urlencode

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
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import get_current_user
from app.config import (
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_VIDEO_EXTENSIONS,
    FRONTEND_BASE_URL,
    MAX_IMAGE_SIZE_BYTES,
    MAX_UPLOAD_SIZE_BYTES,
    MAX_VIDEO_SIZE_BYTES,
)
from app.engines.publishing.account_content import (
    AccountContentProviderError,
    get_account_content,
    get_account_content_player,
    list_account_content_accounts,
)
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
)
from app.engines.publishing.channel_oauth import (
    ChannelOAuthConfigurationError,
    ChannelOAuthProviderError,
    exchange_douyin_code,
    poll_xiaohongshu_authorization,
    start_channel_authorization,
)
from app.engines.publishing.document_copy import parse_document_copy
from app.engines.publishing.material_copy import (
    DOCUMENT_CONTENT_TYPES,
    copy_html_to_text,
    validate_copy_title,
)
from app.engines.publishing.models import (
    CreateProjectRequest,
    ManualProjectRequest,
    ProjectChannelAuthorizationPollRequest,
    ProjectChannelAuthorizationRequest,
    ProjectMaterialContentUpdate,
    ProjectMaterialCopyCreate,
    ProjectMaterialSetCreate,
    ProjectMaterialSetUpdate,
    ProjectMaterialUpdate,
    ProjectMember,
    ProjectMemberInvite,
    ProjectMemberRole,
    PublicationContentOrder,
    PublicationContentsFromMaterials,
    PublicationCopy,
    PublicationPlanCreate,
    PublicationPlanUpdate,
    UpdateProjectRequest,
)
from app.engines.publishing.project_channel_accounts import (
    InvalidChannelAuthorizationState,
    consume_channel_authorization_state,
    delete_project_channel_account,
    get_channel_authorization_state,
    list_project_channel_accounts,
    save_authorized_channel_account,
)
from app.engines.publishing.project_materials import (
    create_project_material,
    create_project_material_set,
    delete_project_material,
    ensure_project_material_access,
    get_project_material,
    list_project_materials,
    update_project_material,
    update_project_material_set,
)
from app.engines.publishing.project_memberships import (
    ProjectMemberNotFound,
    ProjectMembershipExists,
    ProjectNotFound,
    ProjectOrganizationMembershipRequired,
    ProjectPermissionDenied,
    invite_project_member,
    list_project_members,
    remove_project_member,
    update_project_member_role,
)
from app.engines.publishing.projects import (
    ProjectNameExists,
    create_manual_project,
    create_project_from_session,
    delete_project,
    get_project,
    list_projects,
    update_project,
)
from app.engines.publishing.publication_contents import (
    delete_publication_content,
    ensure_content_edit_access,
    get_publication_copy,
    get_publication_document,
    import_publication_materials,
    list_publication_contents,
    reorder_publication_images,
    update_publication_copy,
    upload_publication_content,
)
from app.engines.publishing.publication_plans import (
    create_publication_plan,
    delete_publication_plan,
    get_publication_plan,
    list_publication_plans,
    update_publication_plan,
)
from app.media_storage import (
    delete_media,
    delete_media_prefix,
    guess_content_type,
    media_key_from_url,
    media_url,
    put_media_bytes,
)
from app.shared.response import success_response

# Project routes retain their existing namespace alongside publication-plan APIs.
router = APIRouter(prefix="/api/v1/publishing", tags=["projects"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    return success_response("Project service is running", {"status": "healthy"})


@router.get("/publications")
async def get_publication_plans(
    project_id: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    try:
        plans = list_publication_plans(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response(
        "Publication plans retrieved",
        [plan.model_dump() for plan in plans],
    )


@router.get("/publications/{plan_id}")
async def get_publication_plan_detail(
    plan_id: str,
    current_user=Depends(get_current_user),
):
    try:
        plan = get_publication_plan(current_user["id"], plan_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Publication plan retrieved", plan.model_dump())


@router.post("/publications")
async def create_new_publication_plan(
    body: PublicationPlanCreate,
    current_user=Depends(get_current_user),
):
    try:
        plan = create_publication_plan(
            current_user["id"],
            **body.model_dump(),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication plan created", plan.model_dump())


@router.patch("/publications/{plan_id}")
async def edit_publication_plan(
    plan_id: str,
    body: PublicationPlanUpdate,
    current_user=Depends(get_current_user),
):
    try:
        plan = update_publication_plan(
            current_user["id"],
            plan_id,
            **body.model_dump(),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication plan updated", plan.model_dump())


@router.delete("/publications/{plan_id}")
async def remove_publication_plan(
    plan_id: str,
    current_user=Depends(get_current_user),
):
    try:
        delete_publication_plan(current_user["id"], plan_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication plan deleted")


def _publication_content_response(item, request: Request) -> dict:
    return {
        **item.model_dump(),
        "file_url": media_url(item.object_key, str(request.base_url)) if item.object_key else "",
    }


@router.get("/publications/{plan_id}/copy")
async def get_saved_publication_copy(plan_id: str, current_user=Depends(get_current_user)):
    try:
        copy = get_publication_copy(current_user["id"], plan_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Publication copy retrieved", copy.model_dump())


@router.patch("/publications/{plan_id}/copy")
async def save_publication_copy(
    plan_id: str, body: PublicationCopy, current_user=Depends(get_current_user),
):
    try:
        copy = update_publication_copy(
            current_user["id"], plan_id, **body.model_dump(exclude_unset=True),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication copy updated", copy.model_dump())


@router.get("/publications/{plan_id}/contents")
async def get_publication_contents(plan_id: str, request: Request, current_user=Depends(get_current_user)):
    try:
        items = list_publication_contents(current_user["id"], plan_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Publication contents retrieved", [
        _publication_content_response(item, request) for item in items
    ])


@router.post("/publications/{plan_id}/contents")
async def add_publication_content(
    plan_id: str, request: Request, file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    try:
        ensure_content_edit_access(current_user["id"], plan_id)
        filename = os.path.basename(file.filename or "").strip()
        if not filename:
            raise ValueError("Material filename is required")
        media_type, limit = _material_kind(filename)
        data = await file.read(limit + 1)
        if not data:
            raise ValueError("Material file is empty")
        if len(data) > limit:
            raise HTTPException(status_code=413, detail="Material file is too large")
        item = await run_in_threadpool(
            upload_publication_content, current_user["id"], plan_id,
            filename=filename, media_type=media_type, data=data,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication content added", _publication_content_response(item, request))


@router.post("/publications/{plan_id}/contents/from-materials")
async def add_publication_materials(
    plan_id: str, body: PublicationContentsFromMaterials, request: Request,
    current_user=Depends(get_current_user),
):
    try:
        items = await run_in_threadpool(
            import_publication_materials, current_user["id"], plan_id, body.material_ids,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Material content not found") from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication contents added", [
        _publication_content_response(item, request) for item in items
    ])


@router.patch("/publications/{plan_id}/contents/order")
async def order_publication_images(
    plan_id: str, body: PublicationContentOrder, request: Request,
    current_user=Depends(get_current_user),
):
    try:
        items = reorder_publication_images(current_user["id"], plan_id, body.content_ids)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication image order updated", [
        _publication_content_response(item, request) for item in items
    ])


@router.get("/publications/{plan_id}/contents/{content_id}/content")
async def get_publication_content_document(
    plan_id: str, content_id: str, format: Literal["html", "text"] = Query(default="html"),
    current_user=Depends(get_current_user),
):
    try:
        content = get_publication_document(current_user["id"], plan_id, content_id)
        if format == "text":
            content = copy_html_to_text(content)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication content retrieved", {"content": content, "format": format})


@router.delete("/publications/{plan_id}/contents/{content_id}")
async def remove_publication_content(
    plan_id: str, content_id: str, current_user=Depends(get_current_user),
):
    try:
        delete_publication_content(current_user["id"], plan_id, content_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Publication content deleted")


@router.post("/projects/from_session")
async def create_project(req: CreateProjectRequest, current_user=Depends(get_current_user)):
    try:
        project = create_project_from_session(
            current_user["id"],
            req.source_session_id,
            title=req.title,
            xhs_account=req.xhs_account,
            source_card_id=req.source_card_id,
            content_type=req.content_type,
            platform_hint=req.platform_hint,
            notes=req.notes,
        )
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Project saved", project.model_dump())


def _material_kind(filename: str) -> tuple[str, int]:
    extension = os.path.splitext(filename)[1].lower()
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        return "image", MAX_IMAGE_SIZE_BYTES
    if extension in ALLOWED_VIDEO_EXTENSIONS:
        return "video", MAX_VIDEO_SIZE_BYTES
    if extension in DOCUMENT_CONTENT_TYPES:
        return "document", MAX_UPLOAD_SIZE_BYTES
    raise ValueError("Unsupported project material type")


@router.get("/projects/{project_id}/materials")
async def get_project_materials(
    project_id: str,
    request: Request,
    material_set_id: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    try:
        materials = list_project_materials(
            current_user["id"], project_id, material_set_id,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Project materials retrieved", [
        {
            **material.model_dump(),
            "covers": [
                {**cover.model_dump(), "file_url": media_url(cover.object_key, str(request.base_url))}
                for cover in material.covers
            ],
            "file_url": (
                media_url(material.object_key, str(request.base_url))
                if material.object_key and material.content_html is None
                else ""
            ),
        }
        for material in materials
    ])


@router.post("/projects/{project_id}/material-sets")
async def create_project_material_set_route(
    project_id: str,
    body: ProjectMaterialSetCreate,
    current_user=Depends(get_current_user),
):
    try:
        material_set = create_project_material_set(
            current_user["id"],
            project_id,
            **body.model_dump(),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project material set created", material_set.model_dump())


@router.put("/projects/{project_id}/material-sets/{material_set_id}")
async def update_project_material_set_route(
    project_id: str,
    material_set_id: str,
    body: ProjectMaterialSetUpdate,
    current_user=Depends(get_current_user),
):
    try:
        material_set = update_project_material_set(
            current_user["id"],
            project_id,
            material_set_id,
            **body.model_dump(),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project material set updated", material_set.model_dump())


@router.post("/projects/{project_id}/materials")
async def upload_project_material(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    material_set_id: str = Form(...),
    current_user=Depends(get_current_user),
):
    """Upload media, or parse TXT/MD/markdown/PDF/DOCX directly to database HTML.

    Document originals are never stored. Parsing errors reject the entire upload.
    PDF/DOCX parsing is bounded; scanned PDFs require OCR and are rejected.
    """
    filename = os.path.basename(file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Material filename is required")
    try:
        organization_id = ensure_project_material_access(
            current_user["id"], project_id, material_set_id,
        )
        media_type, max_size = _material_kind(filename)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    content = await file.read(max_size + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Material file is empty")
    if len(content) > max_size:
        raise HTTPException(status_code=413, detail="Material file is too large")
    if media_type == "document":
        try:
            html = await run_in_threadpool(
                parse_document_copy, content, os.path.splitext(filename)[1],
            )
            material = create_project_material(
                current_user["id"], project_id, name=filename,
                media_type="document", mime_type="text/html",
                file_size=len(html.encode("utf-8")), object_key="",
                material_set_id=material_set_id, content_html=html,
            )
        except (ProjectNotFound, LookupError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return success_response("Project document imported", material.model_dump())
    safe_name = re.sub(r"[^\w.\-]", "_", filename)
    object_key = (
        f"project-materials/{organization_id}/{project_id}/"
        f"{uuid.uuid4().hex[:12]}_{safe_name}"
    )
    mime_type = (
        DOCUMENT_CONTENT_TYPES.get(os.path.splitext(filename)[1].lower())
        or guess_content_type(filename)
    )
    put_media_bytes(
        object_key,
        content,
        content_type=mime_type,
    )
    try:
        material = create_project_material(
            current_user["id"],
            project_id,
            name=filename,
            media_type=media_type,
            mime_type=mime_type,
            file_size=len(content),
            object_key=object_key,
            material_set_id=material_set_id,
        )
    except (ProjectNotFound, LookupError) as exc:
        delete_media(object_key)
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        delete_media(object_key)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        delete_media(object_key)
        raise
    return success_response("Project material uploaded", {
        **material.model_dump(),
        "file_url": media_url(object_key, str(request.base_url)),
    })


@router.post("/projects/{project_id}/materials/copy")
async def create_project_material_copy(
    project_id: str,
    body: ProjectMaterialCopyCreate,
    request: Request,
    current_user=Depends(get_current_user),
):
    """Create a document in a material set, automatically numbering duplicate titles.

    Nonblank titles are limited to 255 characters; dots are preserved. Content is
    limited to 1 MiB UTF-8 before and after sanitizing. Allowed tags: p, h2, h3,
    strong, em, s, u, ul, ol, li, blockquote, br, a. Only HTTP(S)/mailto href
    attributes survive. Content persists in the database, not as a media object.
    Returns the material record with empty object_key/file_url.
    """
    try:
        ensure_project_material_access(
            current_user["id"], project_id, body.material_set_id,
        )
        title = validate_copy_title(body.title)
        material = create_project_material(
            current_user["id"], project_id, name=title,
            media_type="document", mime_type="text/html", file_size=0,
            object_key="", material_set_id=body.material_set_id,
            strip_extension=False, content_html=body.content,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project copy created", material.model_dump())


@router.get("/projects/{project_id}/materials/{material_id}/content")
async def get_project_material_content(
    project_id: str,
    material_id: str,
    format: Literal["html", "text"] = Query(default="html"),
    current_user=Depends(get_current_user),
):
    """Return sanitized HTML or plain text to project members.

    Legacy media-backed documents are converted on read without changing storage.
    Invalid, oversized, encrypted or scanned documents return explicit 400 errors.
    Missing projects, materials, and media objects return 404.
    """
    try:
        material = get_project_material(current_user["id"], project_id, material_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if material.media_type != "document":
        raise HTTPException(status_code=400, detail="Material does not support text preview")
    try:
        from app.engines.publishing.publication_contents import read_material_document
        content = await run_in_threadpool(read_material_document, {
            "content_html": material.content_html,
            "object_key": material.object_key,
            "mime_type": material.mime_type,
        }, max_bytes=MAX_UPLOAD_SIZE_BYTES)
    except (LookupError, FileNotFoundError) as exc:
        raise HTTPException(status_code=404, detail="Material content not found") from exc
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Material content is not UTF-8 text") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if format == "text":
        content = copy_html_to_text(content)
    return success_response("Project material content retrieved", {
        "content": content,
        "format": format,
    })


@router.patch("/projects/{project_id}/materials/{material_id}/content")
async def update_project_material_content(
    project_id: str,
    material_id: str,
    body: ProjectMaterialContentUpdate,
    current_user=Depends(get_current_user),
):
    """Edit sanitized HTML as creator or project manager, preserving the title.

    Renaming remains a separate operation. Legacy objects remain untouched for
    recovery; database content becomes authoritative on save.
    """
    try:
        material = update_project_material(
            current_user["id"], project_id, material_id,
            content_html=body.content,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project material content updated", material.model_dump())


@router.put("/projects/{project_id}/materials/{material_id}")
async def update_project_material_route(
    project_id: str,
    material_id: str,
    body: ProjectMaterialUpdate,
    request: Request,
    current_user=Depends(get_current_user),
):
    try:
        material = update_project_material(
            current_user["id"],
            project_id,
            material_id,
            **body.model_dump(),
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project material updated", {
        **material.model_dump(),
        "file_url": (
            media_url(material.object_key, str(request.base_url))
            if material.object_key and material.content_html is None else ""
        ),
    })


@router.delete("/projects/{project_id}/materials/{material_id}")
async def remove_project_material(
    project_id: str,
    material_id: str,
    current_user=Depends(get_current_user),
):
    try:
        object_keys = delete_project_material(
            current_user["id"], project_id, material_id,
        )
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    for object_key in object_keys:
        delete_media(object_key)
    return success_response("Project material deleted")


@router.post("/projects/manual")
async def create_manual_content_project(req: ManualProjectRequest, current_user=Depends(get_current_user)):
    try:
        project = create_manual_project(
            current_user["id"],
            title=req.title,
            xhs_account=req.xhs_account,
            content_type=req.content_type,
            platform_hint=req.platform_hint,
            final_snapshot=req.final_snapshot,
            notes=req.notes,
        )
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return success_response("Manual project saved", project.model_dump())


@router.get("/projects")
async def get_projects(
    xhs_account: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    projects = list_projects(current_user["id"], xhs_account=xhs_account)
    return success_response("Projects retrieved", [item.model_dump() for item in projects])


@router.get("/projects/{project_id}")
async def get_project_detail(project_id: str, current_user=Depends(get_current_user)):
    project = get_project(project_id, current_user["id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return success_response("Project retrieved", project.model_dump())


@router.patch("/projects/{project_id}")
async def edit_project(
    project_id: str,
    body: UpdateProjectRequest,
    current_user=Depends(get_current_user),
):
    try:
        project = update_project(
            current_user["id"], project_id,
            title=body.title,
            notes=body.notes,
            avatar_color=body.avatar_color,
            avatar_icon=body.avatar_icon,
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project updated", project.model_dump())


@router.get("/account-content/accounts")
async def get_account_content_accounts(
    current_user: Annotated[dict, Depends(get_current_user)],
    project_id: Annotated[str | None, Query(min_length=1)] = None,
):
    try:
        accounts = await run_in_threadpool(
            list_account_content_accounts, current_user["id"], project_id,
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    return success_response("Account content accounts retrieved", [
        account.model_dump() for account in accounts
    ])


@router.get("/projects/{project_id}/channel-accounts/{account_id}/content")
async def get_channel_account_content(
    project_id: str, account_id: str, request: Request,
    current_user: Annotated[dict, Depends(get_current_user)],
    source: Annotated[Literal["platform", "marventa"], Query()] = "platform",
    cursor: Annotated[str, Query(pattern=r"^[0-9]{1,19}$", max_length=19)] = "0",
    count: Annotated[int, Query(ge=1, le=24)] = 12,
    page: Annotated[int, Query(ge=1)] = 1,
):
    try:
        result = await get_account_content(
            current_user["id"], project_id, account_id, source=source,
            cursor=cursor, count=count, page=page, base_url=str(request.base_url),
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Channel account not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AccountContentProviderError as exc:
        raise HTTPException(
            status_code=502, detail="The account content provider is unavailable or returned an invalid response",
        ) from exc
    return success_response("Account content retrieved", result.model_dump())


@router.get("/projects/{project_id}/channel-accounts/{account_id}/content/player")
async def get_channel_account_player(
    project_id: str, account_id: str,
    video_id: Annotated[str, Query(pattern=r"^[1-9][0-9]{0,18}$", max_length=19)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    try:
        result = await get_account_content_player(current_user["id"], project_id, account_id, video_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Channel account not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AccountContentProviderError as exc:
        raise HTTPException(
            status_code=502, detail="The account video player is unavailable or returned an invalid response",
        ) from exc
    return success_response("Account video player retrieved", result.model_dump())


@router.get("/projects/{project_id}/channel-accounts")
async def get_project_channel_accounts(
    project_id: str, current_user=Depends(get_current_user),
):
    try:
        accounts = list_project_channel_accounts(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Channel accounts retrieved", [account.model_dump() for account in accounts])


@router.post("/projects/{project_id}/channel-accounts/authorization")
async def authorize_project_channel_account(
    project_id: str,
    body: ProjectChannelAuthorizationRequest,
    current_user=Depends(get_current_user),
):
    try:
        authorization = await start_channel_authorization(
            current_user["id"], project_id, body.platform,
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (
        ChannelOAuthConfigurationError,
        ChannelCredentialEncryptionUnavailable,
    ) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ChannelOAuthProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return success_response(
        "Channel authorization started",
        {
            "platform": authorization.platform,
            "mode": authorization.mode,
            "state": authorization.state,
            "authorization_url": authorization.authorization_url,
            "expires_in": authorization.expires_in,
            "interval": authorization.interval,
            "user_code": authorization.user_code,
        },
    )


def _channel_authorization_redirect(
    project_id: str,
    *,
    status: str,
) -> RedirectResponse:
    query = urlencode({
        "tab": "channels",
        "channel_authorization": status,
    })
    return RedirectResponse(
        f"{FRONTEND_BASE_URL.rstrip('/')}/projects/{project_id}?{query}",
        status_code=303,
    )


@router.get("/channel-accounts/oauth/douyin/callback")
async def complete_douyin_channel_authorization(
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    try:
        authorization = get_channel_authorization_state(state, "douyin")
    except InvalidChannelAuthorizationState:
        raise HTTPException(
            status_code=400,
            detail="Channel authorization state is invalid or expired",
        ) from None
    project_id = str(authorization["project_id"])
    if error or not code:
        consume_channel_authorization_state(state, "douyin")
        return _channel_authorization_redirect(project_id, status="cancelled")
    try:
        grant = await exchange_douyin_code(code)
        user_id, consumed_project_id = consume_channel_authorization_state(
            state, "douyin",
        )
        save_authorized_channel_account(
            user_id,
            consumed_project_id,
            platform="douyin",
            platform_user_id=grant.platform_user_id,
            account_name=grant.account_name,
            profile_url=grant.profile_url,
            scopes=grant.scopes,
            credentials=grant.credentials,
            token_expires_at=grant.token_expires_at,
            refresh_token_expires_at=grant.refresh_token_expires_at,
        )
    except (
        ChannelOAuthConfigurationError,
        ChannelOAuthProviderError,
        ChannelCredentialEncryptionUnavailable,
        InvalidChannelAuthorizationState,
        ValueError,
    ) as exc:
        logger.warning(
            "Douyin channel authorization callback failed for project %s: %s",
            project_id,
            type(exc).__name__,
        )
        return _channel_authorization_redirect(project_id, status="failed")
    return _channel_authorization_redirect(project_id, status="success")


@router.post(
    "/projects/{project_id}/channel-accounts/authorization/xiaohongshu/poll",
)
async def poll_xiaohongshu_channel_authorization(
    project_id: str,
    body: ProjectChannelAuthorizationPollRequest,
    current_user=Depends(get_current_user),
):
    try:
        authorization = get_channel_authorization_state(
            body.state, "xiaohongshu",
        )
        if (
            authorization["user_id"] != current_user["id"]
            or authorization["project_id"] != project_id
        ):
            raise InvalidChannelAuthorizationState(
                "Channel authorization state is invalid or expired",
            )
        poll = await poll_xiaohongshu_authorization(
            str(authorization["provider_code"]),
            int(authorization["poll_interval_seconds"]),
        )
        if poll.status != "authorized" or poll.grant is None:
            return success_response(
                "Channel authorization pending",
                {"status": poll.status, "interval": poll.interval},
            )
        user_id, consumed_project_id = consume_channel_authorization_state(
            body.state, "xiaohongshu",
        )
        account = save_authorized_channel_account(
            user_id,
            consumed_project_id,
            platform="xiaohongshu",
            platform_user_id=poll.grant.platform_user_id,
            account_name=poll.grant.account_name,
            profile_url=poll.grant.profile_url,
            scopes=poll.grant.scopes,
            credentials=poll.grant.credentials,
            token_expires_at=poll.grant.token_expires_at,
            refresh_token_expires_at=poll.grant.refresh_token_expires_at,
        )
    except (ProjectNotFound, InvalidChannelAuthorizationState) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (
        ChannelOAuthConfigurationError,
        ChannelCredentialEncryptionUnavailable,
    ) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ChannelOAuthProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return success_response(
        "Channel account authorized",
        {"status": "authorized", "account": account.model_dump()},
    )


@router.delete("/projects/{project_id}/channel-accounts/{account_id}")
async def unbind_project_channel_account(
    project_id: str,
    account_id: str,
    current_user=Depends(get_current_user),
):
    try:
        delete_project_channel_account(current_user["id"], project_id, account_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Channel account authorization removed")


@router.delete("/projects/{project_id}")
async def remove_project(project_id: str, current_user=Depends(get_current_user)):
    try:
        case_media = delete_project(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    delete_media_prefix(
        f"publishing/{current_user['organization_id']}/{project_id}",
    )
    delete_media_prefix(
        f"project-materials/{current_user['organization_id']}/{project_id}",
    )
    for relative_path in case_media:
        if key := media_key_from_url(relative_path):
            delete_media(key)
    return success_response("Project deleted")


@router.get("/projects/{project_id}/members")
async def get_project_members(project_id: str, current_user=Depends(get_current_user)):
    try:
        members = list_project_members(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response(
        "Project members retrieved",
        [ProjectMember(**dict(member)).model_dump() for member in members],
    )


@router.post("/projects/{project_id}/members")
async def add_project_member(
    project_id: str,
    body: ProjectMemberInvite,
    current_user=Depends(get_current_user),
):
    try:
        member = invite_project_member(
            current_user["id"], project_id, body.email, body.role,
        )
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (ProjectMembershipExists, ProjectOrganizationMembershipRequired) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project member added", ProjectMember(**dict(member)).model_dump())


@router.patch("/projects/{project_id}/members/{member_user_id}")
async def change_project_member_role(
    project_id: str,
    member_user_id: str,
    body: ProjectMemberRole,
    current_user=Depends(get_current_user),
):
    try:
        member = update_project_member_role(
            current_user["id"], project_id, member_user_id, body.role,
        )
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project member updated", ProjectMember(**dict(member)).model_dump())


@router.delete("/projects/{project_id}/members/{member_user_id}")
async def delete_project_member(
    project_id: str,
    member_user_id: str,
    current_user=Depends(get_current_user),
):
    try:
        remove_project_member(current_user["id"], project_id, member_user_id)
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return success_response("Project member removed")
