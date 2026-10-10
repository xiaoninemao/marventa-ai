import asyncio
import json
import logging
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from openai import APIConnectionError, APIStatusError, AuthenticationError

from app.ai_provider import AIProviderConfigurationError
from app.auth.dependencies import get_current_user
from app.engines.content_generator import agent_jobs
from app.engines.content_generator.ai_analyzer import (
    build_reference_context,
    find_prohibited_term_issues,
)
from app.engines.content_generator.creation_agent import run_creation_agent
from app.engines.content_generator.material_references import (
    build_material_audio_context,
    build_material_visual_inputs,
)
from app.engines.content_generator.models import (
    AgentConversationEvent,
    AgentTurnResult,
    ChatMessage,
    ChatReference,
    ChatRequest,
    PresenceHeartbeat,
    RegenerateReplyRequest,
    RestoreDeliverableRequest,
    RewriteUserMessageRequest,
    SessionCreate,
    SessionRename,
    SessionResponse,
)
from app.engines.content_generator.presence import get_presence, release_presence
from app.engines.content_generator.storage import (
    accept_user_message,
    append_activity,
    commit_agent_result,
    create_activity,
    create_session,
    delete_session,
    get_session,
    list_sessions,
    restore_deliverable,
    update_session,
)
from app.engines.portfolio.storage import save_agent_work
from app.media_storage import delete_media
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/content_generator", tags=["content_generator"])
logger = logging.getLogger(__name__)
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
    if isinstance(exc, agent_jobs.JobStopped):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, AIProviderConfigurationError):
        return HTTPException(status_code=500, detail=str(exc))
    if isinstance(exc, AuthenticationError):
        return HTTPException(status_code=502, detail="AI 鉴权失败，请检查所选统一或替代 AI API Key 是否有效。")
    if isinstance(exc, APIConnectionError):
        return HTTPException(status_code=502, detail="无法连接 AI 服务，请检查所选统一或替代 AI Base URL 和网络。")
    if isinstance(exc, APIStatusError):
        return HTTPException(status_code=502, detail=f"AI 服务返回错误 {exc.status_code}，请检查模型名、额度或服务状态。")
    return HTTPException(status_code=500, detail="AI 生成失败，请检查后端日志。")


def _start_agent_progress(user_id: str, session_id: str) -> None:
    agent_jobs.update_progress(user_id, session_id, start=True)


def _advance_agent_progress(
    user_id: str,
    session_id: str,
    stage: str,
    message: str = "",
    event: AgentConversationEvent | None = None,
) -> None:
    agent_jobs.update_progress(user_id, session_id, stage=stage, message=message, event=event)


def _finish_agent_progress(user_id: str, session_id: str, *, failed: bool = False) -> None:
    agent_jobs.update_progress(user_id, session_id, failed=failed)


def _queue_agent_job(session_id: str, current_user, operation: str, payload: dict, request: Request, request_key=""):
    session = _get_manageable_session(session_id, current_user)
    if request_key:
        try:
            existing = agent_jobs.find_submission(session_id, current_user["id"], operation, request_key, payload)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if existing:
            return JSONResponse(success_response("Agent task already accepted", {
                "job": agent_jobs.get_job(existing, current_user["id"], session_id),
            }).model_dump(mode="json"), status_code=202)
    _require_available_agent_worker(request)
    submitted_message = None
    if operation == "chat":
        req = ChatRequest.model_validate(payload)
        if req.client_message_id is None:
            req = req.model_copy(update={"client_message_id": uuid4()})
            payload = req.model_dump(mode="json")
        references = _validate_chat_references(session, req, current_user["id"])
        submitted_message = ChatMessage(
            role="user", content=req.message, client_message_id=req.client_message_id,
            references=references, image_reference=req.image_reference,
            reference_positions=req.reference_positions,
        ).model_dump(mode="json")
    try:
        job_id = agent_jobs.enqueue(
            session_id, current_user["id"], operation, payload, str(request.base_url),
            request_key or uuid4().hex,
            submitted_message,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JSONResponse(success_response("Agent task queued", {
        "job": agent_jobs.get_job(job_id, current_user["id"], session_id),
    }).model_dump(mode="json"), status_code=202)


def _require_available_agent_worker(request: Request) -> None:
    worker = getattr(request.app.state, "agent_worker_task", None)
    if worker is not None and worker.done():
        raise HTTPException(status_code=503, detail="Agent worker unavailable; check backend logs")


def _require_idle_agent_session(session_id: str) -> None:
    try:
        agent_jobs.require_idle(session_id)
    except (ValueError, agent_jobs.JobStopped) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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
    from app.engines.case_library.storage import get_case
    from app.engines.market_insight.storage import get_insight
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
    from app.engines.content_generator.material_references import (
        ensure_material_content_available,
    )
    from app.engines.publishing.project_materials import get_project_material
    from app.engines.publishing.project_memberships import ProjectNotFound
    for material_id in req.material_ids:
        try:
            material = get_project_material(user_id, session.project_id, material_id)
            ensure_material_content_available(material)
        except (ProjectNotFound, LookupError, FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=404, detail="Referenced material not found") from exc
        references.append(ChatReference(id=material.id, kind="material", title=material.name))
    return references


def _validate_chat_references(session: SessionResponse, req: ChatRequest, user_id: str) -> list[ChatReference]:
    references = _validate_sent_context(session, req, user_id)
    allowed_positions = {(item.kind, item.id) for item in references}
    if req.image_reference:
        allowed_positions.add(("image", f"{req.image_reference.deliverable_id}:{req.image_reference.index}"))
    if any(position.offset > len(req.message.encode("utf-16-le")) // 2 or (position.kind, position.id) not in allowed_positions
           for position in req.reference_positions):
        raise HTTPException(status_code=422, detail="Invalid inline reference")
    if req.image_reference:
        current_work = session.deliverables[-1] if session.deliverables else None
        count = (int(bool(current_work.image_url)) + len(current_work.additional_image_urls)) if current_work else 0
        if (session.creation_kind != "image" or not current_work
                or req.image_reference.deliverable_id != current_work.id
                or req.image_reference.index >= count):
            raise HTTPException(status_code=409, detail="Selected image is no longer in the current work")
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




@router.get("/health")
async def health_check():
    return success_response("Content generator service is running", {"status": "healthy"})


@router.post("/sessions")
async def create_new_session(body: SessionCreate, current_user=Depends(get_current_user)):
    try:
        if not body.title.strip():
            raise ValueError("Canvas name is required")
        session = create_session(current_user["id"], body.project_id, body.title, body.creation_kind)
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
    data = session.model_dump(mode="json")
    data["agent_job"] = agent_jobs.latest_active_job(current_user["id"], session_id)
    return success_response("Session retrieved", data)


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


def _get_manageable_session(session_id: str, current_user, *, initialize: bool = True) -> SessionResponse:
    session = get_session(session_id, current_user["id"], initialize=initialize)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"] and session.project_role not in {"owner", "admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only the creation owner and project administrators can rename or delete creations",
        )
    return session


def _save_agent_result(
    session: SessionResponse, user_id: str, result: AgentTurnResult,
    replacement_user: ChatMessage | None = None,
) -> SessionResponse:
    try:
        _get_manageable_session(session.id, {"id": user_id})
        return commit_agent_result(session, result, replacement_user)
    except Exception as exc:
        for key in result.owned_media_keys:
            delete_media(key)
        _finish_agent_progress(user_id, session.id, failed=True)
        if isinstance(exc, HTTPException):
            raise
        if isinstance(exc, ValueError):
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if isinstance(exc, LookupError):
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        logger.exception("Could not commit Agent work")
        raise HTTPException(status_code=500, detail="Could not save Agent work") from exc


@router.get("/sessions/{session_id}/agent-state")
async def get_agent_state(
    session_id: str, request: Request, job_id: str = "", current_user=Depends(get_current_user),
):
    _get_manageable_session(session_id, current_user, initialize=False)
    try:
        state = agent_jobs.get_state(current_user["id"], session_id, job_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if state["progress"]["running"]:
        _require_available_agent_worker(request)
    return success_response("Agent state retrieved", state)


@router.get("/sessions/{session_id}/agent-progress")
async def get_agent_progress(
    session_id: str,
    request: Request,
    current_user=Depends(get_current_user),
):
    _get_manageable_session(session_id, current_user, initialize=False)
    state = agent_jobs.get_progress(current_user["id"], session_id)
    if state["running"]:
        _require_available_agent_worker(request)
    return success_response("Agent progress retrieved", state)


@router.get("/sessions/{session_id}/agent-jobs/active")
async def active_agent_job(session_id: str, request: Request, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user, initialize=False)
    active = agent_jobs.latest_active_job(current_user["id"], session_id)
    if active:
        _require_available_agent_worker(request)
    return success_response("Active Agent task", active)


@router.get("/sessions/{session_id}/agent-jobs/{job_id}")
async def get_agent_job(session_id: str, job_id: str, request: Request, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user, initialize=False)
    try:
        job = agent_jobs.get_job(job_id, current_user["id"], session_id)
        if job["status"] in agent_jobs.ACTIVE:
            _require_available_agent_worker(request)
        return success_response("Agent task", job)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/agent-jobs/{job_id}/cancel")
async def cancel_agent_job(session_id: str, job_id: str, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user, initialize=False)
    try:
        agent_jobs.cancel(job_id, current_user["id"], session_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Agent task cancellation requested", agent_jobs.get_job(job_id, current_user["id"], session_id))


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


@router.post("/sessions/{session_id}/deliverables/{version_id}/restore")
async def restore_work_version(
    session_id: str, version_id: str, body: RestoreDeliverableRequest,
    current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)
    _require_idle_agent_session(session_id)
    try:
        updated = restore_deliverable(session, version_id, body.expected_version_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return success_response("Work version restored", updated.model_dump())


@router.post("/sessions/{session_id}/chat")
async def send_chat_message(
    session_id: str,
    req: ChatRequest,
    request: Request,
    current_user=Depends(get_current_user),
    background: bool = False,
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
    if background:
        if not req.message.strip():
            raise HTTPException(status_code=400, detail="Message is required")
        return _queue_agent_job(
            session_id, current_user, "chat", req.model_dump(mode="json"), request,
            str(req.client_message_id or ""),
        )
    session = _get_manageable_session(session_id, current_user)
    _require_idle_agent_session(session_id)
    message_text = req.message
    if not message_text.strip():
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
            if agent_jobs.current_job.get() and not reply.content:
                if any(message.role == "user" for message in session.messages[index + 1:]):
                    raise HTTPException(status_code=409, detail="Creation changed; reload and try again")
                return await _replace_latest_reply(
                    session_id, current_user["id"], request, req.agent_mode,
                )
            return success_response("Message already accepted", {
                "reply": reply.model_dump(mode="json"),
                "session": session.model_dump(mode="json"),
                "intent": "explore",
                "deliverable": None,
            })

    _start_agent_progress(current_user["id"], session_id)
    _advance_agent_progress(current_user["id"], session_id, "validating_context")
    references = _validate_chat_references(session, req, current_user["id"])
    if req.material_ids:
        _advance_agent_progress(current_user["id"], session_id, "analyzing_materials")
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
        image_reference=req.image_reference,
        reference_positions=[
            position.model_copy(update={"offset": position.offset + len(_preference_prefix(req.preference_keys))})
            for position in req.reference_positions
        ],
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
        _finish_agent_progress(current_user["id"], session_id)
        return success_response("Message already accepted", {
            "reply": reply.model_dump(mode="json"),
            "session": accepted.model_dump(mode="json"),
            "intent": "explore",
            "deliverable": None,
        })
    ref_ctx = build_reference_context(
        accepted.insight_ids, accepted.case_ids, current_user["id"],
        material_ids=accepted.material_ids, project_id=accepted.project_id,
        material_priority_ids=req.material_ids,
    )
    if audio_context:
        ref_ctx = f"{ref_ctx}\n\n{audio_context}" if ref_ctx else audio_context
    context_sections = {
        "brand": build_reference_context(
            [], [], current_user["id"], project_id=accepted.project_id,
        ),
        "insights": build_reference_context(
            accepted.insight_ids, [], current_user["id"],
        ),
        "cases": build_reference_context(
            [], accepted.case_ids, current_user["id"],
        ),
        "materials": build_reference_context(
            [], [], current_user["id"],
            material_ids=accepted.material_ids,
            project_id=accepted.project_id,
            material_priority_ids=req.material_ids,
            include_brand=False,
        ),
    }
    context_sections["plans"] = "\n".join(item.model_dump_json() for item in accepted.plans)
    if audio_context:
        context_sections["materials"] = (
            f"{context_sections['materials']}\n\n{audio_context}"
            if context_sections["materials"] else audio_context
        )
    if accepted.deliverables:
        previous_deliverable = accepted.deliverables[-1]
        previous = previous_deliverable.model_dump(exclude={
            "image_url",
            "image_material_id",
            "additional_image_urls",
            "additional_image_material_ids",
            "video_url", "video_material_id",
        })
        previous["image_count"] = (
            int(bool(previous_deliverable.image_url))
            + len(previous_deliverable.additional_image_urls)
        )
        deliverable_context = (
            "Previous Agent deliverable. Use it as editable project context when "
            "the user requests a revision:\n"
            + json.dumps(previous, ensure_ascii=False)
        )
        ref_ctx = (
            f"{ref_ctx}\n\n{deliverable_context}"
            if ref_ctx else deliverable_context
        )
        context_sections["previous_deliverable"] = deliverable_context
    msg_dicts = [
        {"role": message.role, "content": message.content}
        for message in accepted.messages
    ]

    # Run the Agent turn. It decides whether to explore or create unless overridden.
    _advance_agent_progress(current_user["id"], session_id, "planning_response")
    try:
        agent_result = await asyncio.to_thread(
            run_creation_agent,
            msg_dicts,
            mode=req.agent_mode,
            reference_context=ref_ctx,
            preference_keys=accepted.preference_keys,
            image_inputs=image_inputs,
            user_id=current_user["id"],
            project_id=accepted.project_id,
            base_url=str(request.base_url),
            progress=lambda stage, message="", event=None: _advance_agent_progress(
                current_user["id"], session_id, stage, message, event,
            ),
            context_sections=context_sections,
            creation_kind=accepted.creation_kind,
            current_work=accepted.deliverables[-1] if accepted.deliverables else None,
            image_reference=req.image_reference,
        )
    except Exception as exc:
        _finish_agent_progress(current_user["id"], session_id, failed=True)
        raise _ai_http_exception(exc) from exc
    assistant_msg = ChatMessage(role="assistant", content=agent_result.reply, agent_events=agent_result.agent_events)
    _save_agent_result(accepted, current_user["id"], agent_result)
    if agent_result.revisions or agent_result.deliverable:
        append_activity(
            session_id,
            create_activity(
                "deliverable_created",
                work_id=agent_result.deliverable.id,
                work_title=agent_result.deliverable.title,
            ),
        )
    else:
        append_activity(session_id, create_activity("agent_explored"))
    refreshed = get_session(session_id, current_user["id"])
    if not refreshed:
        _finish_agent_progress(current_user["id"], session_id, failed=True)
        raise HTTPException(status_code=500, detail="Failed to refresh session")

    _finish_agent_progress(current_user["id"], session_id)
    return success_response("Message sent", {
        "reply": assistant_msg.model_dump(),
        "session": refreshed.model_dump(),
        "intent": agent_result.intent,
        "deliverable": (
            agent_result.deliverable.model_dump()
            if agent_result.deliverable else None
        ),
    })


async def _replace_latest_reply(
    session_id: str,
    user_id: str,
    request: Request,
    agent_mode: Literal["auto", "explore", "create"],
    rewritten_message: str = "",
):
    session = _get_manageable_session(session_id, {"id": user_id})
    _require_idle_agent_session(session_id)
    user_index = next(
        (
            index for index in range(len(session.messages) - 1, -1, -1)
            if session.messages[index].role == "user"
        ),
        -1,
    )
    if user_index < 0:
        raise HTTPException(status_code=400, detail="No user message to regenerate")
    _start_agent_progress(user_id, session_id)

    latest_user = session.messages[user_index]
    replacement_user = latest_user.model_copy(
        update={"content": rewritten_message.strip(), "reference_positions": []},
    ) if rewritten_message else latest_user
    source_messages = [*session.messages[:user_index], replacement_user]
    msg_dicts = [
        {"role": message.role, "content": message.content}
        for message in source_messages
    ]
    if session.material_ids:
        _advance_agent_progress(user_id, session_id, "analyzing_materials")
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
    context_sections = {
        "brand": build_reference_context(
            [], [], user_id, project_id=session.project_id,
        ),
        "insights": build_reference_context(
            session.insight_ids, [], user_id,
        ),
        "cases": build_reference_context(
            [], session.case_ids, user_id,
        ),
        "materials": build_reference_context(
            [], [], user_id,
            material_ids=session.material_ids,
            project_id=session.project_id,
            material_priority_ids=material_reference_ids,
            include_brand=False,
        ),
    }
    context_sections["plans"] = "\n".join(item.model_dump_json() for item in session.plans)
    if audio_context:
        context_sections["materials"] = (
            f"{context_sections['materials']}\n\n{audio_context}"
            if context_sections["materials"] else audio_context
        )
    if session.deliverables:
        previous_deliverable = session.deliverables[-1]
        previous = previous_deliverable.model_dump(exclude={
            "image_url",
            "image_material_id",
            "additional_image_urls",
            "additional_image_material_ids",
            "video_url", "video_material_id",
        })
        previous["image_count"] = (
            int(bool(previous_deliverable.image_url))
            + len(previous_deliverable.additional_image_urls)
        )
        context_sections["previous_deliverable"] = (
            "Previous Agent deliverable:\n"
            + json.dumps(previous, ensure_ascii=False)
        )
    try:
        image_inputs = build_material_visual_inputs(
            material_reference_ids,
            session.project_id,
            user_id,
        )
    except (LookupError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        _advance_agent_progress(user_id, session_id, "planning_response")
        agent_result = await asyncio.to_thread(
            run_creation_agent,
            msg_dicts,
            mode=agent_mode,
            reference_context=ref_ctx,
            preference_keys=session.preference_keys,
            image_inputs=image_inputs,
            user_id=user_id,
            project_id=session.project_id,
            base_url=str(request.base_url),
            progress=lambda stage, message="", event=None: _advance_agent_progress(
                user_id, session_id, stage, message, event,
            ),
            context_sections=context_sections,
            creation_kind=session.creation_kind,
            current_work=session.deliverables[-1] if session.deliverables else None,
            image_reference=replacement_user.image_reference,
        )
    except Exception as exc:
        _finish_agent_progress(user_id, session_id, failed=True)
        raise _ai_http_exception(exc) from exc

    replacement_assistant = ChatMessage(role="assistant", content=agent_result.reply, agent_events=agent_result.agent_events)
    updated = _save_agent_result(session, user_id, agent_result, replacement_user)
    _finish_agent_progress(user_id, session_id)
    return success_response("Reply replaced", {
        "reply": replacement_assistant.model_dump(),
        "session": updated.model_dump(),
        "intent": agent_result.intent,
        "deliverable": (
            agent_result.deliverable.model_dump()
            if agent_result.deliverable else None
        ),
    })


@router.post("/sessions/{session_id}/chat/regenerate")
async def regenerate_latest_reply(
    session_id: str,
    request: Request,
    req: RegenerateReplyRequest | None = None,
    current_user=Depends(get_current_user),
    background: bool = False,
    request_id: UUID | None = Header(None, alias="X-Agent-Request-Id"),
):
    if background:
        return _queue_agent_job(
            session_id, current_user, "regenerate",
            {"agent_mode": req.agent_mode if req else "auto"}, request, str(request_id or ""),
        )
    return await _replace_latest_reply(
        session_id,
        current_user["id"],
        request,
        req.agent_mode if req else "auto",
    )


@router.post("/sessions/{session_id}/chat/rewrite")
async def rewrite_latest_reply(
    session_id: str,
    req: RewriteUserMessageRequest,
    request: Request,
    current_user=Depends(get_current_user),
    background: bool = False,
    request_id: UUID | None = Header(None, alias="X-Agent-Request-Id"),
):
    if background:
        return _queue_agent_job(
            session_id, current_user, "rewrite", req.model_dump(mode="json"), request, str(request_id or ""),
        )
    return await _replace_latest_reply(
        session_id,
        current_user["id"],
        request,
        req.agent_mode,
        req.message,
    )












@router.post("/sessions/{session_id}/save-work")
async def save_session_work(
    session_id: str,
    current_user=Depends(get_current_user),
):
    session = _get_manageable_session(session_id, current_user)
    _require_idle_agent_session(session_id)
    if not session.deliverables:
        raise HTTPException(status_code=400, detail="No deliverable to save")
    from app.engines.publishing.projects import get_project
    project = get_project(session.project_id, current_user["id"])
    if project and find_prohibited_term_issues(
        session.deliverables[-1],
        project.brand_profile.model_dump(),
    ):
        raise HTTPException(
            status_code=422,
            detail="Content conflicts with the project's prohibited terms. Revise the deliverable before saving the work.",
        )

    try:
        work = await asyncio.to_thread(
            save_agent_work, current_user["id"], session_id, session.project_id, session.deliverables[-1],
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to save portfolio work")
        raise HTTPException(status_code=500, detail="Could not save portfolio work") from exc
    return success_response("Work saved to Portfolio", {
        "status": work.status,
        "source_session_id": session_id,
        "work_id": work.id,
    })


@router.delete("/sessions/{session_id}")
async def delete_my_session(session_id: str, current_user=Depends(get_current_user)):
    _get_manageable_session(session_id, current_user)
    _require_idle_agent_session(session_id)
    try:
        deleted = delete_session(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Session deleted")
