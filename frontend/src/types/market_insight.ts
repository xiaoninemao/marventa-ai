export interface CodeBlock {
  language: string;
  code: string;
}

export interface Section {
  heading: string;
  level: number;
  content: string;
  subsections: Section[];
}

export interface ResearchSource {
  id: string;
  title: string;
  url: string | null;
  kind: "web" | "document";
  retrieved_at: string;
  excerpt: string;
}

export interface ResearchClaim {
  id: string;
  text: string;
  kind: "fact" | "inference";
  source_ids: string[];
  quote: string;
}

export interface ResearchCompetitor {
  name: string;
  comparison: string;
  source_ids: string[];
}

export interface InsightResearch {
  status: "completed" | "partial" | "unavailable" | "edited";
  sources: ResearchSource[];
  claims: ResearchClaim[];
  competitors: ResearchCompetitor[];
  limitations: string[];
  searched_at: string | null;
}

export interface AIAnalysis {
  product_name: string;
  product_category: string;
  product_description: string;
  product_images: string[];
  similar_products: string[];
  strengths: string[];
  weaknesses: string[];
  product_summary: string;
  target_audience: string;
  use_cases: string[];
  market_positioning: string;
  tech_highlights: string[];
  suggested_marketing_angles: string[];
  marketing_stage: string;
  research?: InsightResearch | null;
}

export interface ParsedDocument {
  title: string;
  source_type: string;
  sections: Section[];
  code_blocks: CodeBlock[];
  tech_stack: string[];
  features: string[];
  raw_text: string;
  ai_analysis: AIAnalysis | null;
  ai_model: string;
  record_id?: string;
}

export interface HistoryRecord {
  id: string;
  filename: string;
  file_size: number;
  upload_time: string;
  source_type: string;
  title: string;
  ai_model: string;
  ai_analysis: AIAnalysis | null;
  is_edited: boolean;
  status: string;
  owner_id: string;
  creator_name?: string;
  organization_id: string;
  project_id: string;
  project_title: string;
  project_role: "owner" | "admin" | "member";
}

export interface ParseResponse {
  success: boolean;
  message: string;
  data: ParsedDocument | null;
  warning?: string | null;
}

export interface HistoryListResponse {
  success: boolean;
  message: string;
  data: HistoryRecord[];
}

export interface HistoryItemResponse {
  success: boolean;
  message: string;
  data: HistoryRecord;
}

export interface SourcePreview {
  filename: string;
  source_type: string;
  content: string;
  offset: number;
  next_offset: number;
  total_length: number;
  has_more: boolean;
}

export interface SourcePreviewResponse {
  success: boolean;
  message: string;
  data: SourcePreview;
}

export interface InsightSource {
  id: string;
  insight_id: string;
  filename: string;
  file_size: number;
  source_type: string;
  upload_time: string;
  has_source_file: boolean;
}

export interface InsightSourcesResponse {
  success: boolean;
  message: string;
  data: InsightSource[];
}
