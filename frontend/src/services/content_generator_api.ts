import { apiError } from "@/i18n/errors";
import type { AgentJob, SessionListResponse, SessionDetailResponse, ChatResponse, CreationPresenceResponse } from "@/types/content_generator";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";
import { agentStateObserver } from "./agent_state_observer";

// ── Content Generator API ──

export class AgentTaskCancelledError extends Error {
  constructor() { super("Agent task cancelled"); this.name = "AgentTaskCancelledError"; }
}

export class AgentTaskFailedError extends Error {
  constructor(message: string) { super(apiError(message).message); this.name = "AgentTaskFailedError"; }
}

export async function fetch_active_agent_job(sessionId: string, signal?: AbortSignal): Promise<AgentJob | null> {
  const response = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(sessionId)}/agent-jobs/active`,
    { headers: auth_headers(), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw await response_error(response, "Could not load Agent task");
  const body: { data: AgentJob | null } = await response.json();
  return body.data;
}

export async function cancel_agent_job(sessionId: string, jobId: string): Promise<AgentJob> {
  const response = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(sessionId)}/agent-jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST", headers: auth_headers(), signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw await response_error(response, "Could not cancel Agent task");
  const body: { data: AgentJob } = await response.json();
  return body.data;
}

export async function wait_for_agent_job(sessionId: string, jobId: string, signal?: AbortSignal): Promise<ChatResponse> {
  signal?.throwIfAborted();
  return new Promise<ChatResponse>((resolve, reject) => {
    const finish = (result?: ChatResponse, error?: unknown) => {
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, signal?.reason || new DOMException("Aborted", "AbortError"));
    const unsubscribe = agentStateObserver.subscribe(sessionId, {
      jobId,
      onState: ({ job }) => {
        if (!job || job.id !== jobId) return;
        if (job.status === "succeeded") {
          if (!job.result?.success || !job.result.data?.session) {
            finish(undefined, apiError("Agent task returned an invalid result"));
          } else finish(job.result);
        } else if (job.status === "cancelled") finish(undefined, new AgentTaskCancelledError());
        else if (["failed", "interrupted", "timed_out"].includes(job.status)) {
          finish(undefined, new AgentTaskFailedError(job.error || "Agent task failed; check backend logs"));
        }
      },
      onError: (error, fatal) => { if (fatal) finish(undefined, error); },
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function agent_chat_response(response: Response, sessionId: string, signal?: AbortSignal): Promise<ChatResponse> {
  if (response.status !== 202) return response.json();
  const body: { data: { job: AgentJob } } = await response.json();
  return wait_for_agent_job(sessionId, body.data.job.id, signal);
}

export async function create_session(project_id: string, title = "", creation_kind: "image" | "video" = "image"): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ project_id, title, creation_kind }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create session failed");
  }
  return res.json();
}

export async function fetch_sessions(project_id = ""): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  if (project_id) params.set("project_id", project_id);
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch sessions failed");
  }
  return res.json();
}

export async function fetch_session(id: string, signal?: AbortSignal): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}`, {
    headers: auth_headers(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : undefined,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch session failed");
  }
  return res.json();
}

export async function update_creation_presence(
  session_id: string, client_id: string, signal: AbortSignal, headers = auth_headers(),
): Promise<CreationPresenceResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(session_id)}/presence`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ client_id }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!res.ok) throw await response_error(res, "Could not update creation presence");
  return res.json();
}

export async function leave_creation_presence(session_id: string, client_id: string, headers = auth_headers()): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(session_id)}/presence/${encodeURIComponent(client_id)}`,
    { method: "DELETE", headers, keepalive: true },
  );
  if (!res.ok) throw await response_error(res, "Could not leave creation presence");
}

export async function send_chat_message(
  id: string, message: string,
  insight_ids: string[] = [], case_ids: string[] = [],
  preference_keys: string[] = [], client_message_id = crypto.randomUUID(),
  material_ids: string[] = [],
  agent_mode: "auto" | "explore" | "create" = "auto",
  image_reference?: import("@/types/content_generator").ImageReference,
  reference_positions?: import("@/types/content_generator").MessageReferencePosition[],
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/chat?background=true`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({
      message,
      insight_ids,
      case_ids,
      preference_keys,
      client_message_id,
      material_ids,
      agent_mode,
      image_reference,
      reference_positions,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Send message failed");
  }

  return agent_chat_response(res, id, signal);
}

export async function restore_work_version(
  sessionId: string, versionId: string, expectedVersionId: string,
): Promise<SessionDetailResponse> {
  const res = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(versionId)}/restore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ expected_version_id: expectedVersionId }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not restore work version");
  return res.json();
}

export async function regenerate_latest_reply(
  session_id: string,
  agent_mode: "auto" | "explore" | "create" = "auto",
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/chat/regenerate?background=true`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...auth_headers(), "X-Agent-Request-Id": crypto.randomUUID() },
    body: JSON.stringify({ agent_mode }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Regenerate reply failed");
  }
  return agent_chat_response(res, session_id, signal);
}

export async function fetch_agent_progress(session_id: string): Promise<{
  success: boolean;
  message: string;
  data: import("@/types/content_generator").AgentProgress;
}> {
  const res = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(session_id)}/agent-progress`,
    { headers: auth_headers() },
  );
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Could not load Agent progress");
  }
  return res.json();
}

export async function rewrite_latest_reply(
  session_id: string,
  message: string,
  agent_mode: "auto" | "explore" | "create" = "auto",
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/chat/rewrite?background=true`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...auth_headers(), "X-Agent-Request-Id": crypto.randomUUID() },
    body: JSON.stringify({ message, agent_mode }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Rewrite reply failed");
  }
  return agent_chat_response(res, session_id, signal);
}

export async function rename_session(id: string, title: string): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Rename creation failed");
  }
  return res.json();
}

export async function delete_session(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Delete session failed");
  }
}

// ── Save the current Agent work to Portfolio ──

export async function save_creation_work(session_id: string): Promise<{
  success: boolean; message: string; data: {
    source_session_id: string;
    status: "draft" | "completed";
    work_id: string;
  };
}> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(session_id)}/save-work`, {
    method: "POST",
    headers: auth_headers(),
    keepalive: true,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Could not save portfolio work");
  }
  return res.json();
}
