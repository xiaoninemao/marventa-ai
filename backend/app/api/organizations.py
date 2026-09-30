from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth.dependencies import get_current_user
from app.auth.models import (
    OrganizationDetail,
    OrganizationDetails,
    OrganizationMember,
    OrganizationMemberInvite,
    OrganizationMemberRole,
    OrganizationName,
    OrganizationUpdate,
    OrganizationResponse,
)
from app.auth.storage import (
    OrganizationMemberNotFound,
    OrganizationMembershipExists,
    OrganizationNotFound,
    OrganizationPermissionDenied,
    create_organization,
    delete_organization,
    get_organization,
    invite_organization_member,
    list_organization_members,
    list_organizations,
    rename_organization,
    remove_organization_member,
    switch_organization,
    update_organization_avatar,
    update_organization_member_role,
)
from app.media_storage import (
    delete_media,
    delete_media_prefix,
    media_key_from_url,
    store_image_data_url,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/organizations", tags=["organizations"])


@router.get("")
async def get_organizations(user=Depends(get_current_user)):
    return success_response("Organizations retrieved", [
        OrganizationDetails(**dict(row)).model_dump() for row in list_organizations(user["id"])
    ])


@router.get("/{organization_id}")
async def get_organization_detail(organization_id: str, user=Depends(get_current_user)):
    try:
        organization = dict(get_organization(user["id"], organization_id))
        organization["members"] = [
            OrganizationMember(**dict(row)).model_dump()
            for row in list_organization_members(user["id"], organization_id)
        ]
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response(
        "Organization retrieved", OrganizationDetail(**organization).model_dump(),
    )


@router.post("")
async def create_new_organization(body: OrganizationName, user=Depends(get_current_user)):
    try:
        organization = create_organization(user["id"], body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization created", OrganizationDetails(**dict(organization)).model_dump())


@router.patch("/{organization_id}")
async def update_organization(
    organization_id: str,
    body: OrganizationUpdate,
    request: Request,
    user=Depends(get_current_user),
):
    try:
        if body.name is None and body.avatar_url is None:
            raise ValueError("At least one organization field is required")
        organization = (
            rename_organization(user["id"], organization_id, body.name)
            if body.name is not None
            else get_organization(user["id"], organization_id)
        )
        if body.avatar_url is not None:
            if organization["role"] != "owner":
                raise OrganizationPermissionDenied(
                    "Only organization owners can update the organization avatar",
                )
            avatar_url = store_image_data_url(
                body.avatar_url.strip(), "organization-avatars", organization_id,
                str(request.base_url), "Invalid organization image",
            )
            organization = update_organization_avatar(
                user["id"], organization_id, avatar_url,
            )
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization updated", OrganizationDetails(**dict(organization)).model_dump())


@router.delete("/{organization_id}")
async def remove_organization(organization_id: str, user=Depends(get_current_user)):
    try:
        media_paths = delete_organization(user["id"], organization_id)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    for prefix in (
        f"organization-avatars/{organization_id}",
        f"publishing/{organization_id}",
        f"project-materials/{organization_id}",
        f"market_insight_sources/{organization_id}",
    ):
        delete_media_prefix(prefix)
    for path in media_paths:
        if key := media_key_from_url(path):
            delete_media(key)
    return success_response("Organization deleted")


@router.post("/{organization_id}/members")
async def invite_member(
    organization_id: str, body: OrganizationMemberInvite, user=Depends(get_current_user),
):
    try:
        member = invite_organization_member(user["id"], organization_id, body.email, body.role)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationMemberNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except OrganizationMembershipExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization member added", OrganizationMember(**dict(member)).model_dump())


@router.patch("/{organization_id}/members/{member_user_id}")
async def update_member_role(
    organization_id: str,
    member_user_id: str,
    body: OrganizationMemberRole,
    user=Depends(get_current_user),
):
    try:
        member = update_organization_member_role(
            user["id"], organization_id, member_user_id, body.role,
        )
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationMemberNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization member updated", OrganizationMember(**dict(member)).model_dump())


@router.delete("/{organization_id}/members/{member_user_id}")
async def delete_member(
    organization_id: str,
    member_user_id: str,
    user=Depends(get_current_user),
):
    try:
        remove_organization_member(user["id"], organization_id, member_user_id)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationMemberNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return success_response("Organization member removed")


@router.post("/{organization_id}/switch")
async def select_organization(organization_id: str, user=Depends(get_current_user)):
    try:
        organization = switch_organization(user["id"], organization_id)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Organization switched", OrganizationResponse(**dict(organization)).model_dump())
