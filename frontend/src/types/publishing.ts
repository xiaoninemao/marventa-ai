
export interface BrandProfile {
  tone: string;
  audience: string;
  value_proposition: string;
  visual_style: string;
  prohibited_terms: string[];
}

export interface ContentProject {
  id: string;
  user_id: string;
  title: string;
  xhs_account: string;
  source_session_id: string;
  content_type: string;
  platform_hint: string;
  final_snapshot: Record<string, unknown>;
  notes: string;
  status: string;
  role: "owner" | "admin" | "member";
  avatar_color: string;
  avatar_icon: string;
  brand_profile: BrandProfile;
  members: ProjectMember[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  user_id: string;
  username: string;
  email: string;
  nickname: string;
  avatar_url: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface ProjectChannelAccount {
  id: string;
  project_id: string;
  platform: "xiaohongshu" | "douyin";
  account_name: string;
  platform_user_id: string;
  profile_url: string;
  notes: string;
  created_by_user_id: string;
  creator_name: string;
  creator_avatar_url: string;
  authorization_status: string;
  token_expires_at: string;
  refresh_token_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface PublicationPlan {
  id: string;
  media_mode: "image_text" | "video";
  name: string;
  project_id: string;
  project_title: string;
  portfolio_id: string;
  portfolio_title: string;
  channel_account_id: string;
  platform: "xiaohongshu" | "douyin" | "";
  account_name: string;
  created_by_user_id: string;
  creator_name: string;
  creator_avatar_url: string;
  status: "draft" | "scheduled" | "publishing" | "cancelled" | "published" | "failed";
  published_at: string;
  platform_post_id: string;
  platform_video_id: string;
  last_error: string;
  outcome_unknown: boolean;
  scheduled_for: string;
  note: string;
  publishing_ready: boolean;
  missing_scope: string;
  created_at: string;
  updated_at: string;
  content_count: number;
  has_copy: boolean;
  image_count: number;
  video_count: number;
  document_count: number;
}

export interface PublicationContent {
  id: string;
  position: number;
  plan_id: string;
  name: string;
  media_type: "image" | "video" | "document";
  mime_type: string;
  file_url: string;
  source_material_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMaterial {
  id: string;
  project_id: string;
  parent_id: string;
  node_type: "collection" | "file";
  name: string;
  media_type: "image" | "video" | "document";
  mime_type: string;
  file_size: number;
  object_key: string;
  file_url: string;
  material_count: number;
  image_count: number;
  video_count: number;
  document_count: number;
  covers: Array<{
    id: string;
    media_type: "image" | "video";
    object_key: string;
    file_url: string;
  }>;
  created_by_user_id: string;
  creator_name: string;
  creator_avatar_url: string;
  created_at: string;
  updated_at: string;
}

export interface ListResponse<T> {
  success: boolean;
  message: string;
  data: T[];
}

export interface ItemResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
