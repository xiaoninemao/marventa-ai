import { apiError } from "@/i18n/errors";
import type { BrandProfile, ContentProject, ItemResponse, ListResponse, ProjectChannelAccount, ProjectMaterial, ProjectMember, PublicationPlan, PublicationContent } from "@/types/publishing";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";

// Project APIs retain their existing URL namespace.

export async function create_manual_content_project(payload: {
  title?: string;
  platform_hint?: string;
  content_type?: string;
  xhs_account?: string;
  final_snapshot?: Record<string, unknown>;
  notes?: string;
}): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Create manual project failed");
  }
  return res.json();
}

export async function fetch_content_projects(xhs_account = ""): Promise<ListResponse<ContentProject>> {
  const params = new URLSearchParams();
  if (xhs_account) params.set("xhs_account", xhs_account);
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects${params.toString() ? "?" + params.toString() : ""}`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw apiError("Fetch projects failed");
  return res.json();
}

export async function fetch_content_project(project_id: string): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    headers: auth_headers(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw apiError(err.detail || "Fetch project failed");
  }
  return res.json();
}

export async function update_content_project(
  project_id: string,
  payload: {
    title?: string;
    notes?: string;
    avatar_color?: string;
    avatar_icon?: string;
    brand_profile?: BrandProfile;
  },
): Promise<ItemResponse<ContentProject>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await response_error(res, "Could not update project");
  return res.json();
}

export async function delete_content_project(
  project_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}`, {
    method: "DELETE",
    headers: auth_headers(),
  });
  if (!res.ok) throw await response_error(res, "Could not delete project");
  return res.json();
}

export async function fetch_project_members(project_id: string): Promise<ListResponse<ProjectMember>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members`, {
    headers: auth_headers(),
  });
  if (!res.ok) throw await response_error(res, "Could not load project members");
  return res.json();
}

export async function invite_project_member(
  project_id: string, email: string, role: "admin" | "member",
): Promise<ItemResponse<ProjectMember>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw await response_error(res, "Could not add project member");
  return res.json();
}

export async function update_project_member_role(
  project_id: string, user_id: string, role: "admin" | "member",
): Promise<ItemResponse<ProjectMember>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members/${encodeURIComponent(user_id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ role }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not update project member");
  return res.json();
}

export async function remove_project_member(
  project_id: string, user_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/members/${encodeURIComponent(user_id)}`,
    { method: "DELETE", headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not remove project member");
  return res.json();
}

export async function fetch_project_channel_accounts(
  project_id: string,
): Promise<ListResponse<ProjectChannelAccount>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/channel-accounts`,
    { headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not load channel accounts");
  return res.json();
}

export async function start_project_channel_authorization(
  project_id: string,
  platform: "xiaohongshu" | "douyin",
): Promise<ItemResponse<{
  platform: "xiaohongshu" | "douyin";
  mode: "redirect" | "device";
  state: string;
  authorization_url: string;
  expires_in: number;
  interval: number;
  user_code: string;
}>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/channel-accounts/authorization`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ platform }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not start channel authorization");
  return res.json();
}

export async function poll_xiaohongshu_channel_authorization(
  project_id: string,
  state: string,
): Promise<ItemResponse<{
  status: "pending" | "scanned" | "authorized";
  interval: number;
  account?: ProjectChannelAccount;
}>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/channel-accounts/authorization/xiaohongshu/poll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ state }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not check channel authorization");
  return res.json();
}

export async function delete_project_channel_account(
  project_id: string, account_id: string,
): Promise<{
  success: boolean;
  message: string;
}> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/channel-accounts/${encodeURIComponent(account_id)}`,
    { method: "DELETE", headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not remove channel account");
  return res.json();
}

export async function fetch_publication_plans(
  project_id = "",
): Promise<ListResponse<PublicationPlan>> {
  const query = project_id
    ? `?project_id=${encodeURIComponent(project_id)}`
    : "";
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/publications${query}`,
    { headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not load publication plans");
  return res.json();
}

export async function create_publication_plan(payload: {
  project_id: string;
  name: string;
}): Promise<ItemResponse<PublicationPlan>> {
  const res = await fetch(`${API_BASE}/api/v1/publishing/publications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await response_error(res, "Could not create publication plan");
  return res.json();
}

export async function fetch_publication_plan(plan_id: string): Promise<ItemResponse<PublicationPlan>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(plan_id)}`,
    { headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not load publication plan");
  return res.json();
}

export async function select_publication_work(planId: string, portfolioId: string): Promise<ItemResponse<PublicationPlan>> {
  const response = await fetch(`${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(planId)}/work`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...auth_headers() },
    body: JSON.stringify({ portfolio_id: portfolioId }),
  });
  if (!response.ok) throw await response_error(response, "Could not update publication plan");
  return response.json();
}

function publicationContentsUrl(planId: string) {
  return `${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(planId)}/contents`;
}

export async function fetch_publication_copy(planId: string): Promise<ItemResponse<{ title: string; content: string; tags: string[] }>> {
  const response = await fetch(`${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(planId)}/copy`, {
    headers: auth_headers(),
  });
  if (!response.ok) throw await response_error(response, "Could not load publication copy");
  return response.json();
}

export async function fetch_publication_contents(planId: string): Promise<ListResponse<PublicationContent>> {
  const response = await fetch(publicationContentsUrl(planId), { headers: auth_headers() });
  if (!response.ok) throw await response_error(response, "Could not load publication content");
  return response.json();
}

export async function update_publication_plan(
  plan_id: string,
  payload: {
    name?: string;
    channel_account_id?: string;
    scheduled_for?: string;
    note?: string;
    status?: "draft" | "scheduled" | "cancelled";
  },
): Promise<ItemResponse<PublicationPlan>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(plan_id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not update publication plan");
  return res.json();
}

export async function delete_publication_plan(
  plan_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/publications/${encodeURIComponent(plan_id)}`,
    { method: "DELETE", headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not delete publication plan");
  return res.json();
}

export async function fetch_project_materials(
  project_id: string,
  material_set_id = "",
): Promise<ListResponse<ProjectMaterial>> {
  const query = material_set_id
    ? `?material_set_id=${encodeURIComponent(material_set_id)}`
    : "";
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials${query}`,
    { headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not load project materials");
  return res.json();
}

export async function upload_project_material(
  project_id: string,
  file: File,
  material_set_id: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const data = new FormData();
  data.append("file", file);
  data.append("material_set_id", material_set_id);
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials`,
    {
      method: "POST",
      headers: auth_headers(),
      body: data,
    },
  );
  if (!res.ok) throw await response_error(res, "Could not upload project material");
  return res.json();
}

export async function create_project_material_copy(
  project_id: string,
  material_set_id: string,
  title: string,
  content: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials/copy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ material_set_id, title, content }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not create material copy");
  return res.json();
}

export async function fetch_project_material_content(
  project_id: string,
  material_id: string,
  format: "html" | "text" = "html",
): Promise<ItemResponse<{ content: string; format: "html" | "text" }>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials/${encodeURIComponent(material_id)}/content?format=${format}`,
    { headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not load material content");
  return res.json();
}

export async function update_project_material_content(
  project_id: string,
  material_id: string,
  content: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials/${encodeURIComponent(material_id)}/content`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not save material copy");
  return res.json();
}

export async function create_project_material_set(
  project_id: string,
  name: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/material-sets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not create material set");
  return res.json();
}

export async function update_project_material_set(
  project_id: string,
  material_set_id: string,
  name: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/material-sets/${encodeURIComponent(material_set_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not rename material set");
  return res.json();
}

export async function update_project_material(
  project_id: string,
  material_id: string,
  name: string,
): Promise<ItemResponse<ProjectMaterial>> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials/${encodeURIComponent(material_id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth_headers() },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw await response_error(res, "Could not rename material");
  return res.json();
}

export async function delete_project_material(
  project_id: string,
  material_id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(project_id)}/materials/${encodeURIComponent(material_id)}`,
    { method: "DELETE", headers: auth_headers() },
  );
  if (!res.ok) throw await response_error(res, "Could not delete project material");
  return res.json();
}
