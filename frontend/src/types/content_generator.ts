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
  image_reference?: ImageReference | null;
  reference_positions?: MessageReferencePosition[];
  agent_events?: AgentConversationEvent[];
}

export type AgentConversationEvent =
  | { type: "message"; id: string; content: string; streaming?: boolean; phase?: "commentary" | "answer" }
  | { type: "tool"; id: string; tool: "read_context" | "list_materials" | "import_material" | "generate_image" | "compose_work";
      status: "running" | "completed" | "failed" | "cancelled"; section?: string; details?: string[] };

export interface MessageReferencePosition {
  offset: number;
  id: string;
  kind: "image" | "insight" | "case" | "material";
}
export interface ImageReference {
  deliverable_id: string;
  index: number;
}

export interface CreationPlan {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface CreativeDeliverable {
  id: string;
  media_kind: "image" | "video";
  title: string;
  publication_copy: string;
  tags: string[];
  visual_prompt: string;
  image_material_id: string;
  image_url: string;
  additional_image_material_ids: string[];
  additional_image_urls: string[];
  video_url?: string;
  video_material_id?: string;
  source_version_id?: string;
  video_script: string;
  storyboard: string[];
  created_at: string;
}

export interface CreationActivity {
  id: string;
  activity_type:
    | "work_generation_started"
    | "agent_explored"
    | "deliverable_created";
  work_id: string;
  work_title: string;
  created_at: string;
}

export interface SessionRecord {
  agent_job?: AgentJob | null;
  id: string;
  user_id: string;
  creator_name?: string;
  project_id: string;
  organization_id?: string;
  project_role?: "owner" | "admin" | "member" | "";
  title: string;
  messages: ChatMessage[];
  deliverables?: CreativeDeliverable[];
  creation_kind?: "image" | "video";
  plans?: CreationPlan[];
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
    intent: "explore" | "create";
    deliverable?: CreativeDeliverable | null;
  };
}

export interface AgentJob {
  submitted_message?: ChatMessage | null;
  id: string;
  operation: "chat" | "rewrite" | "regenerate";
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted" | "timed_out";
  attempts: number;
  error: string;
  result: ChatResponse | null;
  created_at: string;
  updated_at: string;
}

export type AgentProgressStage =
  | "preparing_context"
  | "validating_context"
  | "routing_agent"
  | "chat_agent"
  | "plan_agent"
  | "action_agent"
  | "importing_material"
  | "composing_work"
  | "reading_plans"
  | "reading_brand_guidelines"
  | "reading_insights"
  | "reading_cases"
  | "reading_previous_deliverable"
  | "reading_context"
  | "analyzing_materials"
  | "planning_response"
  | "agent_response"
  | "preparing_copy"
  | "preparing_video"
  | "generating_image"
  | "finalizing";

export interface AgentProgress {
  revision: number;
  model_timings?: Array<{
    kind: string;
    model: string;
    elapsed_ms: number;
    first_token_ms: number | null;
    succeeded: boolean;
  }>;
  model_call_count?: number;
  model_elapsed_ms?: number;
  model_timings_truncated?: boolean;
  job_id?: string;
  status?: AgentJob["status"];
  error?: string;
  completed_session_updated_at?: string;
  parent_user_message_id?: string | null;
  steps: AgentProgressStage[];
  messages: Partial<Record<AgentProgressStage, string>>;
  events: Array<
    | { type: "status"; stage: AgentProgressStage }
    | { type: "message"; content: string; id?: string; streaming?: boolean; phase?: "commentary" | "answer" }
    | Extract<AgentConversationEvent, { type: "tool" }>
  >;
  active_stage: AgentProgressStage | "";
  running: boolean;
  failed: boolean;
}
