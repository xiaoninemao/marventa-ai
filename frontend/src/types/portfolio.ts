export interface PortfolioScript {
  id: string;
  name: string;
  user_id: string;
  creator_name?: string;
  title: string;
  content: string;
  source_session_id: string;
  source_version_id?: string;
  media_kind?: "image" | "video" | null;
  media?: PortfolioMedia[];
  tags?: string[];
  project_id: string;
  project_title: string;
  project_role: "owner" | "admin" | "member";
  status: "draft" | "generating" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}
export interface PortfolioMedia {
  id: string;
  name: string;
  media_type: "image" | "video";
  object_key: string;
  mime_type: string;
  file_url: string;
}

export interface PortfolioWorkInput {
  title: string;
  content: string;
  tags: string[];
  media_ids: string[];
}
