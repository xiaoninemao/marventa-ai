import { apiError } from "@/i18n/errors";
import type { Locale } from "@/i18n/locale";
import type { CaseListResponse, CaseItemResponse, CaseImportTaskResponse } from "@/types/case_library";
import { API_BASE, auth_headers, normalize_network_error } from "@/services/api_core";

// ── Case Library API ──

export async function fetch_my_cases(limit = 100, offset = 0, search = "", project_id = ""): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (search) params.set("search", search);
  if (project_id) params.set("project_id", project_id);

  const res = await fetch(`${API_BASE}/api/v1/case_library/my/cases?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Failed to fetch cases");
  return res.json();
}

export async function fetch_my_favorites(limit = 100, offset = 0, search = ""): Promise<CaseListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (search) params.set("search", search);

  const res = await fetch(`${API_BASE}/api/v1/case_library/my/favorites?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Failed to fetch favorites");
  return res.json();
}

export async function fetch_case(id: string): Promise<CaseItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Case not found");
  return res.json();
}

export async function create_case_import_task(
  input: string, project_id: string,
  manual_text = "",
  save_case = true,
): Promise<CaseImportTaskResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/import_tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ input, manual_text, save_case, project_id }),
    signal: AbortSignal.timeout(45000),
  }).catch(normalize_network_error);
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Import task failed");
  }
  return res.json();
}

export async function create_video_case(
  title: string, description: string, tags: string[], video_file: File,
  project_id: string, source = "",
): Promise<CaseItemResponse> {
  const form = new FormData();
  form.append("title", title);
  form.append("content_type", "video");
  form.append("description", description);
  form.append("tags", JSON.stringify(tags));
  if (source) form.append("source", source);
  form.append("project_id", project_id);
  form.append("video", video_file);

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create case failed");
  }
  return res.json();
}

export async function create_image_text_case(
  title: string, description: string, tags: string[], image_files: File[],
  project_id: string, source = "",
): Promise<CaseItemResponse> {
  const form = new FormData();
  form.append("title", title);
  form.append("content_type", "image_text");
  form.append("description", description);
  form.append("tags", JSON.stringify(tags));
  if (source) form.append("source", source);
  form.append("project_id", project_id);
  image_files.forEach((f) => form.append("images", f));

  const res = await fetch(`${API_BASE}/api/v1/case_library/cases`, {
    method: "POST",
    headers: auth_headers(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create case failed");
  }
  return res.json();
}

export async function update_case(
  id: string, payload: { title?: string; description?: string; tags?: string[]; source?: string },
): Promise<CaseItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Update case failed");
  }
  return res.json();
}

export async function delete_case(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Delete case failed");
  }
}

export async function favorite_case(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/favorite`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Favorite failed");
  }
  return res.json();
}

export async function unfavorite_case(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/favorite`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Unfavorite failed");
  }
  return res.json();
}

export async function analyze_case(id: string, locale: Locale): Promise<{ success: boolean; message: string; data: { status: string } }> {
  const query = new URLSearchParams({ locale });
  const res = await fetch(`${API_BASE}/api/v1/case_library/cases/${id}/analyze?${query}`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Analyze failed");
  }
  return res.json();
}
