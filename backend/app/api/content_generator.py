import asyncio
import logging
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from openai import APIConnectionError, APIStatusError, AuthenticationError
from app.ai_provider import AIProviderConfigurationError
from app.engines.content_generator.models import (
    SessionCreate, SessionRename, SessionResponse, ChatRequest, ChatMessage, ChatReference,
    ModifyCardRequest, PresenceHeartbeat, RewriteUserMessageRequest,
)
from app.engines.content_generator.storage import (
    create_session, get_session, list_sessions, update_session, delete_session,
    accept_user_message, append_assistant_message,
    append_activity, create_activity, replace_latest_user_exchange,
    save_next_version, get_versions, get_version,
)
from app.engines.content_generator.ai_analyzer import (
    build_reference_context,
    chat,
    evaluate_content_quality,
    find_prohibited_term_issues,
    generate_async,
    generate_document,
    modify_card,
)
from app.engines.content_generator.presence import get_presence, release_presence
from app.engines.content_generator.material_references import (
    build_material_audio_context,
    build_material_visual_inputs,
    latest_material_reference_ids,
)
from app.engines.portfolio.storage import create_script, delete_script, update_script
from app.shared.response import success_response
from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/v1/content_generator", tags=["content_generator"])
logger = logging.getLogger(__name__)
_document_jobs: dict[tuple[str, str], str] = {}
_ALLOWED_PREFERENCE_KEYS = {
    "short_video", "image_text",
    "douyin", "xiaohongshu", "kuaishou", "weibo", "bilibili", "wechat_mp", "shipinhao",
}
_PREFERENCE_LABELS = {
    "short_video": "Short video", "image_text": "Image-text",
    "douyin": "Douyin", "xiaohongshu": "Xiaohongshu", "kuaishou": "Kuaishou", "weibo": "Weibo",
    "bilibili": "Bilibili", "wechat_mp": "WeChat Official Accounts", "shipinhao": "WeChat Channels",
}


def _ai_http_exception(exc: Exception) -> HTTPException:
    if isinstance(exc, AIProviderConfigurationError):
        return HTTPException(status_code=500, detail=str(exc))
    if isinstance(exc, AuthenticationError):
        return HTTPException(status_code=502, detail="AI 鉴权失败，请检查所选统一或替代 AI API Key 是否有效。")
    if isinstance(exc, APIConnectionError):
        return HTTPException(status_code=502, detail="无法连接 AI 服务，请检查所选统一或替代 AI Base URL 和网络。")
    if isinstance(exc, APIStatusError):
        return HTTPException(status_code=502, detail=f"AI 服务返回错误 {exc.status_code}，请检查模型名、额度或服务状态。")
    return HTTPException(status_code=500, detail="AI 生成失败，请检查后端日志。")


def _validate_sent_context(
    session: SessionResponse,
    req: ChatRequest,
    user_id: str,
) -> list[ChatReference]:
    invalid_preferences = [key for key in req.preference_keys if key not in _ALLOWED_PREFERENCE_KEYS]
    if invalid_preferences:
        raise HTTPException(status_code=422, detail="Invalid content preference")
    for group in (
        {"short_video", "image_text"},
        {"douyin", "xiaohongshu", "kuaishou", "weibo", "bilibili", "wechat_mp", "shipinhao"},
    ):
        if len(group.intersection(req.preference_keys)) > 1:
            raise HTTPException(status_code=422, detail="Conflicting content preferences")
    from app.engines.market_insight.storage import get_insight
    from app.engines.case_library.storage import get_case
    references: list[ChatReference] = []
    for insight_id in dict.fromkeys(req.insight_ids):
        insight = get_insight(insight_id, user_id)
        if insight is None or insight.project_id != session.project_id:
            raise HTTPException(status_code=404, detail="Referenced insight not found")
        if insight.status != "completed" or insight.ai_analysis is None:
            raise HTTPException(
                status_code=422,
                detail="Referenced insight must complete AI analysis before use",
            )
        references.append(ChatReference(
            id=insight.id,
            kind="insight",
            title=insight.title or insight.filename,
        ))
    for case_id in dict.fromkeys(req.case_ids):
        case = get_case(case_id, user_id)
        if case is None or case.project_id != session.project_id:
            raise HTTPException(status_code=404, detail="Referenced case not found")
        if case.ai_status != "completed" or case.ai_analysis is None:
            raise HTTPException(
                status_code=422,
                detail="Referenced case must complete AI analysis before use",
            )
        references.append(ChatReference(
            id=case.id,
            kind="case",
            title=case.title,
        ))
    from app.engines.publishing.project_materials import get_project_material
    from app.engines.publishing.project_memberships import ProjectNotFound
    from app.engines.content_generator.material_references import ensure_material_content_available
    for material_id in req.material_ids:
        try:
            material = get_project_material(user_id, session.project_id, material_id)
            ensure_material_content_available(material)
        except (ProjectNotFound, LookupError, FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=404, detail="Referenced material not found") from exc
        references.append(ChatReference(id=material.id, kind="material", title=material.name))
    return references


def _preference_prefix(keys: list[str]) -> str:
    labels = [_PREFERENCE_LABELS[key] for key in dict.fromkeys(keys)]
    return f"Selected preferences: {', '.join(labels)}\n\n" if labels else ""


def _project_has_brand_guidelines(project_id: str, user_id: str) -> bool:
    if not project_id:
        return False
    from app.engines.publishing.projects import get_project
    project = get_project(project_id, user_id)
    if not project:
        return False
    profile = project.brand_profile
    return any((
        profile.tone,
        profile.audience,
        profile.value_proposition,
        profile.visual_style,
        profile.prohibited_terms,
    ))


def _generate_document_job(session_id: str, user_id: str, work_id: str) -> None:
    job_key = (user_id, session_id)
    try:
        session = get_session(session_id, user_id)
        if not session or not session.cards:
            raise ValueError("Creation session has no cards")
        ref_ctx = build_reference_context(
            session.insight_ids, session.case_ids, user_id,
            material_ids=session.material_ids, project_id=session.project_id,
            material_priority_ids=latest_material_reference_ids(session.messages),
        ) if (
            session.insight_ids
            or session.case_ids
            or session.material_ids
            or _project_has_brand_guidelines(session.project_id, user_id)
        ) else ""
        content = generate_document(session.cards, reference_context=ref_ctx)
        update_script(work_id, content=content, status="completed")
    except Exception:
        update_script(work_id, status="failed")
        logger.exception("Failed to generate portfolio document for session %s", session_id)
    finally:
        _document_jobs.pop(job_key, None)


@router.get("/health")
async def health_check():
    return success_response("Content generator service is running", {"status": "healthy"})


@router.post("/sessions")
async def create_new_session(body: SessionCreate, current_user=Depends(get_current_user)):
    try:
        if not body.title.strip():
            raise ValueError("Canvas name is required")
        session = create_session(current_user["id"], body.project_id, body.title)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Session created", session.model_dump())


@router.get("/sessions")
async def list_my_sessions(project_id: str = "", current_user=Depends(get_current_user)):
    sessions = list_sessions(current_user["id"], project_id)
    return success_response("Sessions retrieved", [s.model_dump() for s in sessions])


@router.get("/sessions/{session_id}")
async def get_session_detail(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Session retrieved", session.model_dump())


def _session_presence(session_id: str, user_id: str, client_id: str | None = None):
    if not get_session(session_id, user_id):
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        return get_presence(session_id, user_id, client_id)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


@router.get("/sessions/{session_id}/presence")
def list_session_presence(session_id: str, current_user=Depends(get_current_user)):
    """List active viewers of this creation without joining or renewing presence."""
    return success_response(
        "Presence retrieved", _session_presence(session_id, current_user["id"]),
    )


@router.put("/sessions/{session_id}/presence")
def heartbeat_session_presence(
    session_id: str, body: PresenceHeartbeat, current_user=Depends(get_current_user),
):
    """Renew a 30-second visit lease; clients should heartbeat every 10 seconds.

    Use a fresh UUID for each browser visit. Members are deduplicated by user
    and contain only id, username, nickname, and avatar_url.
    """
    return success_response(
        "Presence updated",
        _session_presence(session_id, current_user["id"], str(body.client_id)),
    )


@router.delete("/sessions/{session_id}/presence/{client_id}")
def leave_session_presence(
    session_id: str, client_id: UUID, current_user=Depends(get_current_user),
):
    """Release this user's visit on leaving/hiding, even after losing access.

    Idempotent; does not return presence or disclose whether the creation exists.
    """
    release_presence(session_id, current_user["id"], str(client_id))
    return success_response("Presence released")


def _get_manageable_session(session_id: str, current_user) -> SessionResponse:
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"] and session.project_role not in {"owner", "admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only the creation owner and project administrators can rename or delete creations",
        )
    return session


@router.patch("/sessions/{session_id}/name")
async def rename_session(
    session_id: str, body: SessionRename, current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Creation name is required")
    updated = update_session(session_id, title=title)
    if not updated:
        raise HTTPException(status_code=404, detail="Session not found")
    updated.project_role = session.project_role
    return success_response("Creation renamed", updated.model_dump())


@router.post("/sessions/{session_id}/chat")
async def send_chat_message(
    session_id: str,
    req: ChatRequest,
    current_user=Depends(get_current_user),
):
    """Accept up to 20 project material IDs, alongside existing case/insight inputs.

    IDs are deduplicated and checked against the user's current organization and
    session project. Server-derived captions are preserved with each message;
    cumulative IDs are reauthorized when used. Copy is plaintext source data;
    image/video references provide metadata by default. When multimodal input is
    enabled, current-turn JPEG/PNG/WebP image references are also sent as bounded
    image inputs; video content is never sent or inferred.
    Replaying a client_message_id returns the original accepted turn unchanged.
    """
    session = _get_manageable_session(session_id, current_user)
    message_text = req.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message is required")
    client_message_id = str(req.client_message_id or "")
    if client_message_id:
        for index, existing in enumerate(session.messages):
            if str(existing.client_message_id or "") != client_message_id:
                continue
            reply = next(
                (
                    message for message in session.messages[index + 1:]
                    if message.role == "assistant"
                ),
                ChatMessage(role="assistant", content=""),
            )
            return success_response("Message already accepted", {
                "reply": reply.model_dump(mode="json"),
                "session": session.model_dump(mode="json"),
            })

    references = _validate_sent_context(session, req, current_user["id"])
    try:
        image_inputs = build_material_visual_inputs(
            req.material_ids,
            session.project_id,
            current_user["id"],
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        audio_context = await asyncio.to_thread(
            build_material_audio_context,
            req.material_ids,
            session.project_id,
            current_user["id"],
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise _ai_http_exception(exc) from exc
    sent_message = ChatMessage(
        role="user",
        content=_preference_prefix(req.preference_keys) + message_text,
        client_message_id=req.client_message_id,
        references=references,
    )
    try:
        accepted = accept_user_message(
            session_id, current_user["id"], sent_message,
            list(dict.fromkeys(req.insight_ids)),
            list(dict.fromkeys(req.case_ids)),
            list(dict.fromkeys(req.preference_keys)),
            material_ids=req.material_ids,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Referenced material not found") from exc
    if not accepted:
        raise HTTPException(status_code=404, detail="Session not found")
    if not accepted._user_message_accepted:
        index = next(
            index for index, message in enumerate(accepted.messages)
            if str(message.client_message_id or "") == client_message_id
        )
        reply = next(
            (message for message in accepted.messages[index + 1:] if message.role == "assistant"),
            ChatMessage(role="assistant", content=""),
        )
        return success_response("Message already accepted", {
            "reply": reply.model_dump(mode="json"),
            "session": accepted.model_dump(mode="json"),
        })
    ref_ctx = build_reference_context(
        accepted.insight_ids, accepted.case_ids, current_user["id"],
        material_ids=accepted.material_ids, project_id=accepted.project_id,
        material_priority_ids=req.material_ids,
    )
    if audio_context:
        ref_ctx = f"{ref_ctx}\n\n{audio_context}" if ref_ctx else audio_context
    msg_dicts = [
        {"role": message.role, "content": message.content}
        for message in accepted.messages
    ]

    # Get AI reply
    try:
        chat_kwargs = {"reference_context": ref_ctx}
        if image_inputs:
            chat_kwargs["image_inputs"] = image_inputs
        reply_content = await asyncio.to_thread(chat, msg_dicts, **chat_kwargs)
    except Exception as exc:
        raise _ai_http_exception(exc) from exc
    assistant_msg = ChatMessage(role="assistant", content=reply_content)
    updated = append_assistant_message(session_id, assistant_msg)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")

    return success_response("Message sent", {
        "reply": assistant_msg.model_dump(),
        "session": updated.model_dump(),
    })


async def _replace_latest_reply(
    session_id: str,
    user_id: str,
    rewritten_message: str = "",
):
    session = _get_manageable_session(session_id, {"id": user_id})
    user_index = next(
        (
            index for index in range(len(session.messages) - 1, -1, -1)
            if session.messages[index].role == "user"
        ),
        -1,
    )
    if user_index < 0:
        raise HTTPException(status_code=400, detail="No user message to regenerate")

    latest_user = session.messages[user_index]
    replacement_user = latest_user.model_copy(
        update={"content": rewritten_message.strip()},
    ) if rewritten_message else latest_user
    source_messages = [*session.messages[:user_index], replacement_user]
    msg_dicts = [
        {"role": message.role, "content": message.content}
        for message in source_messages
    ]
    ref_ctx = build_reference_context(
        session.insight_ids, session.case_ids, user_id,
        material_ids=session.material_ids, project_id=session.project_id,
        material_priority_ids=[
            reference.id for reference in latest_user.references if reference.kind == "material"
        ],
    )
    material_reference_ids = [
        reference.id
        for reference in latest_user.references
        if reference.kind == "material"
    ]
    try:
        audio_context = await asyncio.to_thread(
            build_material_audio_context,
            material_reference_ids,
            session.project_id,
            user_id,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise _ai_http_exception(exc) from exc
    if audio_context:
        ref_ctx = f"{ref_ctx}\n\n{audio_context}" if ref_ctx else audio_context
    try:
        image_inputs = build_material_visual_inputs(
            material_reference_ids,
            session.project_id,
            user_id,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        chat_kwargs = {"reference_context": ref_ctx}
        if image_inputs:
            chat_kwargs["image_inputs"] = image_inputs
        reply_content = await asyncio.to_thread(chat, msg_dicts, **chat_kwargs)
    except Exception as exc:
        raise _ai_http_exception(exc) from exc

    replacement_assistant = ChatMessage(role="assistant", content=reply_content)
    updated = replace_latest_user_exchange(
        session_id,
        session.messages,
        replacement_user,
        replacement_assistant,
    )
    if not updated:
        raise HTTPException(status_code=409, detail="Conversation changed; try again")
    return success_response("Reply replaced", {
        "reply": replacement_assistant.model_dump(),
        "session": updated.model_dump(),
    })


@router.post("/sessions/{session_id}/chat/regenerate")
async def regenerate_latest_reply(
    session_id: str,
    current_user=Depends(get_current_user),
):
    return await _replace_latest_reply(session_id, current_user["id"])


@router.post("/sessions/{session_id}/chat/rewrite")
async def rewrite_latest_reply(
    session_id: str,
    req: RewriteUserMessageRequest,
    current_user=Depends(get_current_user),
):
    return await _replace_latest_reply(
        session_id,
        current_user["id"],
        req.message,
    )


@router.post("/sessions/{session_id}/generate")
async def trigger_generation(session_id: str, current_user=Depends(get_current_user)):
    session = _get_manageable_session(session_id, current_user)
    if not session.messages:
        raise HTTPException(status_code=400, detail="No messages in session")

    update_session(session_id, status="generating")
    generate_async(session_id, user_id=current_user["id"])
    return success_response("Generation started", {"status": "generating"})


@router.post("/sessions/{session_id}/cards/{card_id}/modify")
async def modify_session_card(
    session_id: str,
    card_id: str,
    req: ModifyCardRequest,
    current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)

    card = next((c for c in session.cards if c.id == card_id), None)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    msg_dicts = [m.model_dump() for m in session.messages]
    ref_ctx = build_reference_context(
        session.insight_ids, session.case_ids, current_user["id"],
        material_ids=session.material_ids, project_id=session.project_id,
        material_priority_ids=latest_material_reference_ids(session.messages),
    ) if (
        session.insight_ids
        or session.case_ids
        or session.material_ids
        or _project_has_brand_guidelines(session.project_id, current_user["id"])
    ) else ""
    try:
        modified = await asyncio.to_thread(
            modify_card, card, req.instruction, msg_dicts, reference_context=ref_ctx,
        )
    except Exception as exc:
        raise _ai_http_exception(exc) from exc

    new_cards = [modified if c.id == card_id else c for c in session.cards]
    updated = update_session(session_id, cards=new_cards)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")

    saved_version = save_next_version(
        session_id,
        new_cards,
        is_major_bump=False,
        activity=create_activity(
            "card_modified",
            card_id=modified.id,
            card_title=modified.title,
            card_count=1,
        ),
        changed_card_ids=[modified.id],
    )

    refreshed = get_session(session_id, current_user["id"])
    if not refreshed:
        raise HTTPException(status_code=500, detail="Failed to refresh session")
    return success_response("Card modified", {
        "card": modified.model_dump(),
        "version": saved_version.model_dump(),
        "session": refreshed.model_dump(),
    })


@router.post("/sessions/{session_id}/quality-check")
async def check_session_quality(
    session_id: str,
    current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)
    if not session.cards:
        raise HTTPException(status_code=400, detail="Creation session has no cards")
    from app.engines.publishing.projects import get_project
    project = get_project(session.project_id, current_user["id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    reference_context = build_reference_context(
        session.insight_ids,
        session.case_ids,
        current_user["id"],
        material_ids=session.material_ids,
        project_id=session.project_id,
        material_priority_ids=latest_material_reference_ids(session.messages),
    )
    try:
        report = await asyncio.to_thread(
            evaluate_content_quality,
            session.cards,
            project.brand_profile.model_dump(),
            reference_context,
            session.preference_keys,
        )
    except Exception as exc:
        raise _ai_http_exception(exc) from exc
    return success_response("Content quality checked", report.model_dump())


@router.get("/sessions/{session_id}/versions")
async def list_session_versions(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    versions = get_versions(session_id)
    return success_response("Versions retrieved", [v.model_dump() for v in versions])


@router.post("/sessions/{session_id}/versions/{version_id}/restore")
async def restore_session_version(session_id: str, version_id: str, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user)
    version = get_version(version_id)
    if not version or version.session_id != session_id:
        raise HTTPException(status_code=404, detail="Version not found")
    updated = update_session(session_id, cards=version.cards)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to restore version")
    saved_version = save_next_version(
        session_id,
        version.cards,
        is_major_bump=True,
        version_type="rollback",
        source_version_label=version.version_label,
    )
    return success_response("Version restored", {
        "version": saved_version.model_dump(),
        "session": updated.model_dump(),
    })


@router.post("/sessions/{session_id}/generate_document")
async def generate_session_document(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)
    if not session.cards:
        raise HTTPException(status_code=400, detail="No cards to generate document from")
    from app.engines.publishing.projects import get_project
    project = get_project(session.project_id, current_user["id"])
    if project and find_prohibited_term_issues(
        session.cards,
        project.brand_profile.model_dump(),
    ):
        raise HTTPException(
            status_code=422,
            detail="Content contains a configured prohibited term. Run quality check and revise it before generating the work.",
        )

    job_key = (current_user["id"], session_id)
    work_id = _document_jobs.get(job_key)
    if work_id is None:
        work = create_script(
            current_user["id"],
            title=session.title or "Marketing strategy report",
            content="Your report is being generated. Please wait.",
            source_session_id=session_id,
            project_id=session.project_id,
            status="generating",
        )
        try:
            append_activity(session_id, create_activity("work_generation_started"))
        except Exception as exc:
            delete_script(work.id)
            raise HTTPException(status_code=500, detail="Failed to record activity") from exc
        work_id = work.id
        _document_jobs[job_key] = work_id
        background_tasks.add_task(
            _generate_document_job, session_id, current_user["id"], work_id,
        )

    return success_response("Document generation queued", {
        "status": "queued",
        "source_session_id": session_id,
        "work_id": work_id,
    })


@router.delete("/sessions/{session_id}")
async def delete_my_session(session_id: str, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user)
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Session deleted")
