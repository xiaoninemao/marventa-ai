import type { ProjectChannelAccount } from "./publishing";

export type AccountContentStatus = "ready" | "unsupported_platform" | "authorization_required" | "scope_required" | "configuration_required";
export type AccountContentSource = "platform" | "marventa";

export interface AccountContentAccount extends ProjectChannelAccount {
  project_title: string;
  content_status: AccountContentStatus;
  required_scope: string;
  content_message: string;
}

export interface AccountContentPost {
  id: string;
  title: string;
  content: string;
  cover_url: string;
  image_urls?: string[];
  video_url?: string;
  platform_video_id?: string;
  share_url: string;
  published_at: string;
  media_type: "video" | "image_text" | "unknown";
  visibility: "published" | "reviewing" | "not_public" | "unknown" | "accepted";
  statistics: { likes: number | null; comments: number | null; views: number | null; shares: number | null };
  plan_id: string;
}

export interface AccountContentPlayer {
  video_id: string;
  player_url: string;
}

export interface AccountContentPage {
  account: AccountContentAccount;
  source: AccountContentSource;
  status: AccountContentStatus;
  items: AccountContentPost[];
  next_cursor: string | null;
  has_more: boolean;
  page: number;
  page_size: number;
  limited: boolean;
  message: string;
}
