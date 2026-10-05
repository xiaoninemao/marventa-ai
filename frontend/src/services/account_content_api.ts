import { API_BASE, auth_headers, response_error } from "./api_core";
import { apiError } from "@/i18n/errors";
import type { ItemResponse, ListResponse } from "@/types/publishing";
import type { AccountContentAccount, AccountContentPage, AccountContentPlayer, AccountContentSource } from "@/types/account_content";

const statuses = new Set(["ready", "unsupported_platform", "authorization_required", "scope_required", "configuration_required"]);
const visibility = new Set(["published", "reviewing", "not_public", "unknown", "accepted"]);
const statistics = ["likes", "comments", "views", "shares"] as const;

export async function fetch_account_content_accounts(
  projectId = "", signal?: AbortSignal,
): Promise<ListResponse<AccountContentAccount>> {
  const query = new URLSearchParams();
  if (projectId) query.set("project_id", projectId);
  const response = await fetch(`${API_BASE}/api/v1/publishing/account-content/accounts?${query}`, {
    headers: auth_headers(), signal,
  });
  if (!response.ok) throw await response_error(response, "Could not load channel accounts");
  const body: ListResponse<AccountContentAccount> = await response.json();
  if (!body.success || !Array.isArray(body.data)
    || body.data.some((account) => !account.id || !account.project_id || !statuses.has(account.content_status))) {
    throw apiError(body.message || "Account content response is invalid");
  }
  return body;
}

export async function fetch_account_content(
  projectId: string, accountId: string,
  options: { source: AccountContentSource; cursor: string; count: number; page: number },
  signal?: AbortSignal,
): Promise<ItemResponse<AccountContentPage>> {
  const query = new URLSearchParams({
    source: options.source, cursor: options.cursor, count: String(options.count), page: String(options.page),
  });
  const response = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/content?${query}`,
    { headers: auth_headers(), signal, cache: "no-store" },
  );
  if (!response.ok) throw await response_error(response, "Could not load account content");
  const body: ItemResponse<AccountContentPage> = await response.json();
  if (!body.success || !body.data || !body.data.account || !Array.isArray(body.data.items)
    || !statuses.has(body.data.status)
    || body.data.account.id !== accountId || body.data.account.project_id !== projectId
    || body.data.source !== options.source || body.data.page !== options.page
    || body.data.items.some((post) => !post.id || typeof post.title !== "string" || typeof post.content !== "string"
      || !visibility.has(post.visibility)
      || (post.video_url !== undefined && typeof post.video_url !== "string")
      || (post.platform_video_id !== undefined && (typeof post.platform_video_id !== "string"
        || (post.platform_video_id !== "" && !/^[1-9][0-9]{0,18}$/.test(post.platform_video_id))))
      || (post.image_urls !== undefined && (!Array.isArray(post.image_urls)
        || post.image_urls.some((url) => typeof url !== "string" || !url)))
      || !post.statistics || statistics.some((key) => {
        const value = post.statistics[key];
        return value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0);
      }))
    || (body.data.has_more && (!body.data.next_cursor || body.data.next_cursor === options.cursor))) {
    throw apiError("Account content response is invalid");
  }
  return body;
}

export async function fetch_account_content_player(
  projectId: string, accountId: string, videoId: string, signal?: AbortSignal,
): Promise<ItemResponse<AccountContentPlayer>> {
  const query = new URLSearchParams({ video_id: videoId });
  const response = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/content/player?${query}`,
    { headers: auth_headers(), signal, cache: "no-store" },
  );
  if (!response.ok) throw await response_error(response, "Could not load account video player");
  const body: ItemResponse<AccountContentPlayer> = await response.json();
  if (!body.success || !body.data || body.data.video_id !== videoId
    || typeof body.data.player_url !== "string" || !URL.canParse(body.data.player_url)) {
    throw apiError("Account content player response is invalid");
  }
  const url = new URL(body.data.player_url);
  if (url.origin !== "https://open.douyin.com" || url.pathname !== "/player/video"
    || url.username || url.password || url.hash || url.searchParams.size !== 2
    || url.searchParams.get("vid") !== videoId || url.searchParams.get("autoplay") !== "0") {
    throw apiError("Account content player response is invalid");
  }
  return body;
}
