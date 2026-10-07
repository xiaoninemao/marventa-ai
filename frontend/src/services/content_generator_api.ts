import { apiError } from "@/i18n/errors";
import type { SessionListResponse, SessionDetailResponse, ChatResponse, GenerateResponse, VersionListResponse, VersionRestoreResponse, CreationPresenceResponse, QualityReport } from "@/types/content_generator";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";

// ── Content Generator API ──

export async function create_session(project_id: string, title = ""): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ project_id, title }),
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

export async function fetch_session(id: string): Promise<SessionDetailResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}`, {
    headers: auth_headers(),
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
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ message, insight_ids, case_ids, preference_keys, client_message_id, material_ids }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Send message failed");
  }
  return res.json();
}

export async function regenerate_latest_reply(session_id: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/chat/regenerate`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Regenerate reply failed");
  }
  return res.json();
}

export async function rewrite_latest_reply(
  session_id: string,
  message: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/chat/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Rewrite reply failed");
  }
  return res.json();
}

export async function generate_cards(id: string): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${id}/generate`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Generate failed");
  }
  return res.json();
}

export async function modify_card(
  session_id: string, card_id: string, instruction: string, signal?: AbortSignal,
): Promise<{
  success: boolean;
  message: string;
  data: {
    card: import("@/types/content_generator").ContentCard;
    session: import("@/types/content_generator").SessionRecord;
  };
}> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/cards/${card_id}/modify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ instruction }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Modify card failed");
  }

  return res.json();
}

export async function check_content_quality(session_id: string): Promise<{
  success: boolean;
  message: string;
  data: QualityReport;
}> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/quality-check`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Content quality check failed");
  }
  return res.json();
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

// ── Generate document from session cards ──

export async function generate_document(session_id: string): Promise<{
  success: boolean; message: string; data: {
    id?: string; title?: string; content?: string;
    source_session_id: string; created_at?: string;
    status?: string;
    work_id?: string;
  };
}> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/generate_document`, {
    method: "POST",
    headers: auth_headers(),
    keepalive: true,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Generate document failed");
  }
  return res.json();
}

export async function fetch_versions(session_id: string): Promise<VersionListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/versions`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch versions failed");
  }
  return res.json();
}

export async function restore_version(session_id: string, version_id: string): Promise<VersionRestoreResponse> {
  const res = await fetch(`${API_BASE}/api/v1/content_generator/sessions/${session_id}/versions/${version_id}/restore`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Restore version failed");
  }
  return res.json();
}
