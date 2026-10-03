export interface ChatReference {
  id: string;
  kind: "insight" | "case" | "material";
  title: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  client_message_id?: string;
  references?: ChatReference[];
}

export interface ContentCard {
  id: string;
  card_type: "script" | "title" | "copy" | "hashtags" | "visual";
  title: string;
  preview: string;
  content: string;
  tips: string[];
}

export interface CreationActivity {
  id: string;
  activity_type: "cards_generated" | "card_modified" | "work_generation_started";
  card_id: string;
  card_title: string;
  card_count: number;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  creator_name?: string;
  project_id: string;
  organization_id?: string;
  project_role?: "owner" | "admin" | "member" | "";
  title: string;
  messages: ChatMessage[];
  cards: ContentCard[];
  status: "drafting" | "generating" | "completed" | "failed";
  insight_ids: string[];
  case_ids: string[];
  material_ids?: string[];
  preference_keys?: string[];
  activities?: CreationActivity[];
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  success: boolean;
  message: string;
  data: SessionRecord[];
}

export interface SessionDetailResponse {
  success: boolean;
  message: string;
  data: SessionRecord;
}

export interface CreationPresenceMember {
  id: string;
  username: string;
  nickname: string;
  avatar_url: string;
}

export interface CreationPresenceResponse {
  success: boolean;
  message: string;
  data: { members: CreationPresenceMember[] };
}

export interface ChatResponse {
  success: boolean;
  message: string;
  data: {
    reply: ChatMessage;
    session: SessionRecord;
  };
}

export interface GenerateResponse {
  success: boolean;
  message: string;
  data: { status: string };
}

export interface ContentVersion {
  id: string;
  session_id: string;
  version_label: string;
  major: number;
  minor: number;
  version_type?: "generation" | "edit" | "rollback";
  source_version_label?: string;
  changed_card_ids?: string[];
  cards: ContentCard[];
  created_at: string;
}

export interface VersionListResponse {
  success: boolean;
  message: string;
  data: ContentVersion[];
}

export interface VersionRestoreResponse {
  success: boolean;
  message: string;
  data: {
    version: ContentVersion;
    session: SessionRecord;
  };
}
