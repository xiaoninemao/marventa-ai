import { apiError } from "@/i18n/errors";
import type { Locale } from "@/i18n/locale";
import type { ParseResponse, HistoryListResponse, HistoryItemResponse, InsightSourcesResponse, SourcePreviewResponse, AIAnalysis } from "@/types/market_insight";
import { API_BASE, auth_headers } from "@/services/api_core";

// ── Market Insight API ──
export async function parse_files(files: File[], project_id: string, locale: Locale): Promise<ParseResponse> {
  const form_data = new FormData();
  files.forEach((file) => form_data.append("files", file));
  form_data.append("project_id", project_id);
  form_data.append("locale", locale);

  const url = `${API_BASE}/api/v1/market_insight/parse`;

  const res = await fetch(url, {
    method: "POST",
    body: form_data,
    headers: auth_headers(),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Parse failed");
  }
  return res.json();
}

export async function parse_repo(repo_url: string, project_id: string, locale: Locale): Promise<ParseResponse> {
  const url = `${API_BASE}/api/v1/market_insight/parse_repo`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ repo_url, project_id, locale }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Repository parse failed");
  }
  return res.json();
}

export async function fetch_history(search = "", project_id = ""): Promise<HistoryListResponse> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (project_id) params.set("project_id", project_id);

  const qs = params.toString();
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history${qs ? "?" + qs : ""}`, {
    headers: auth_headers(),
  });
  return res.json();
}

export async function fetch_history_item(id: string): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Record not found");
  return res.json();
}

export async function fetch_insight_sources(id: string): Promise<InsightSourcesResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}/sources`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Could not load insight sources");
  return res.json();
}

export async function fetch_source_preview(
  id: string, sourceId: string, offset = 0,
): Promise<SourcePreviewResponse> {
  const params = new URLSearchParams({ offset: String(offset) });
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}/sources/${sourceId}/preview?${params}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Could not load source preview");
  return res.json();
}

export async function download_source_file(id: string, sourceId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}/sources/${sourceId}/file`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Could not download source file");
  return res.blob();
}

export async function update_history_item(id: string, analysis: AIAnalysis): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ ai_analysis: analysis }),
  });
  if (!res.ok) throw apiError("Update failed");
  return res.json();
}

export async function rename_history_item(id: string, name: string): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}/name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Rename failed");
  }
  return res.json();
}

export async function retry_history_item(id: string, locale: Locale): Promise<HistoryItemResponse> {
  const query = new URLSearchParams({ locale });
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}/retry?${query}`, {
    method: "POST",
    headers: auth_headers(),
  });
  if (!res.ok) {
    const error = await res.json();
    throw apiError(error.detail || "Retry failed");
  }
  return res.json();
}

export async function delete_history_item(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/history/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Delete failed");
}

export async function create_manual_insight(
  analysis: AIAnalysis, project_id: string,
): Promise<HistoryItemResponse> {
  const res = await fetch(`${API_BASE}/api/v1/market_insight/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ ai_analysis: analysis, project_id }),
  });
  if (!res.ok) throw apiError("Create failed");
  return res.json();
}
