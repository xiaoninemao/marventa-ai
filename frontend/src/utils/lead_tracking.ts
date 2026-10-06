import type { AccountContentAccount } from "@/types/account_content";

export interface LeadTrackingEntity {
  key: string;
  platform: AccountContentAccount["platform"];
  platform_user_id: string;
  account_name: string;
  bindings: AccountContentAccount[];
}

function identity(account: AccountContentAccount): string {
  const platformUserId = account.platform_user_id.trim();
  return platformUserId
    ? `${account.platform}:${platformUserId}`
    : `${account.platform}:binding:${account.id}`;
}

export function groupLeadTrackingEntities(
  accounts: readonly AccountContentAccount[],
): LeadTrackingEntity[] {
  const grouped = new Map<string, LeadTrackingEntity>();
  for (const account of accounts) {
    const key = identity(account);
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.bindings.some((binding) =>
        binding.id === account.id && binding.project_id === account.project_id)) {
        existing.bindings.push(account);
      }
    } else {
      grouped.set(key, {
        key,
        platform: account.platform,
        platform_user_id: account.platform_user_id,
        account_name: account.account_name,
        bindings: [account],
      });
    }
  }
  return [...grouped.values()].map((entity) => ({
    ...entity,
    bindings: [...entity.bindings].sort((left, right) =>
      left.project_title.localeCompare(right.project_title)
      || left.project_id.localeCompare(right.project_id)),
  }));
}

export function leadTrackingEntityHref(
  entity: LeadTrackingEntity,
  preferredProjectId = "",
): string {
  const binding = entity.bindings.find((item) => item.project_id === preferredProjectId)
    || entity.bindings[0];
  return `/lead_tracking/${encodeURIComponent(binding.id)}?project=${encodeURIComponent(binding.project_id)}`;
}

export function filterLeadTrackingEntities(
  entities: readonly LeadTrackingEntity[],
  query: string,
  platform: "all" | AccountContentAccount["platform"],
  projectId = "",
): LeadTrackingEntity[] {
  const term = query.trim().toLowerCase();
  return entities.filter((entity) =>
    (platform === "all" || entity.platform === platform)
    && (!projectId || entity.bindings.some((binding) => binding.project_id === projectId))
    && [
      entity.account_name,
      ...entity.bindings.map((binding) => binding.project_title),
      entity.platform,
      entity.platform === "douyin" ? "抖音" : "小红书",
    ].join(" ").toLowerCase().includes(term));
}
