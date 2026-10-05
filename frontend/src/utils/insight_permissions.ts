import type { User } from "@/types/auth";
import type { HistoryRecord } from "@/types/market_insight";

export function canManageInsight(
  user: User | null,
  insight: Pick<HistoryRecord, "owner_id" | "organization_id" | "project_role">,
): boolean {
  if (!user) return false;
  const organization = user.current_organization ?? user.default_organization;
  return Boolean(organization?.id && insight.organization_id === organization.id && (
    insight.owner_id === user.id
    || insight.project_role === "owner"
    || insight.project_role === "admin"
  ));
}

export function isInsightAnalyzed(
  insight: Pick<HistoryRecord, "status" | "ai_analysis">,
): boolean {
  return insight.status === "completed" && Boolean(insight.ai_analysis);
}

export function canEditInsightResults(
  user: User | null,
  insight: Pick<HistoryRecord, "owner_id" | "organization_id" | "project_role" | "source_type">,
): boolean {
  return insight.source_type === "manual" && canManageInsight(user, insight);
}
