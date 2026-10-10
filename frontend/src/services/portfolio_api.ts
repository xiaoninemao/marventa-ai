import { apiError } from "@/i18n/errors";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";
import type { PortfolioScript, PortfolioWorkInput } from "@/types/portfolio";

// ── Script Library ──

export async function fetch_scripts(project_id = ""): Promise<{
  success: boolean; message: string; data: PortfolioScript[]
}> {
  const params = new URLSearchParams();
  if (project_id) params.set("project_id", project_id);
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts?${params.toString()}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch scripts failed");
  return res.json();
}

export async function fetch_script(id: string): Promise<{
  success: boolean; message: string; data: PortfolioScript
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch script failed");
  return res.json();
}

export async function update_script(id: string, data: { name?: string; media_order?: string[]; expected_updated_at?: string }): Promise<{
  success: boolean; message: string; data: PortfolioScript
}> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await response_error(res, "Update script failed");
  return res.json();
}

export async function delete_script(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${id}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Delete script failed");
}

export async function save_portfolio_edit(id: string, metadata: PortfolioWorkInput & {
  expected_updated_at: string;
}, files: File[]): Promise<{ success: boolean; message: string; data: PortfolioScript }> {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  for (const file of files) form.append("files", file);
  const response = await fetch(`${API_BASE}/api/v1/portfolio/scripts/${encodeURIComponent(id)}/edit`, {
    method: "PUT", headers: auth_headers(), body: form,
  });
  if (!response.ok) throw await response_error(response, "Could not save portfolio work");
  return response.json();
}

export async function create_portfolio_work(data: {
  name: string; project_id: string; media_kind: "image" | "video";
}): Promise<{ success: boolean; message: string; data: PortfolioScript }> {
  const response = await fetch(`${API_BASE}/api/v1/portfolio/scripts`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw await response_error(response, "Could not create portfolio work");
  return response.json();
}
