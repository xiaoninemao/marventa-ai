"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import InlineIcon from "@/components/redesign/InlineIcon";
import Pagination from "@/components/redesign/Pagination";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import LeadTrackingEntityCard from "./LeadTrackingEntityCard";
import { filterLeadTrackingEntities, groupLeadTrackingEntities } from "@/utils/lead_tracking";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import type { AccountContentAccount } from "@/types/account_content";

export default function AccountTrackingList({ accounts, projectId, scope }: {
  accounts: AccountContentAccount[];
  projectId: string;
  scope: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"all" | AccountContentAccount["platform"]>("all");
  const entities = useMemo(() => groupLeadTrackingEntities(
    accounts.filter((account) => account.project_id === projectId),
  ), [accounts, projectId]);
  const filtered = useMemo(() => filterLeadTrackingEntities(entities, query, platform, projectId),
    [entities, query, platform, projectId]);
  const pagination = usePagination(filtered, `${scope}:${projectId}:${query}:${platform}`);
  return <section className="amp-opinion-account-list" aria-label={t("账号分析", "Account analysis")}>
    <div className="amp-insight-toolbar">
      <div className="amp-projects-search">
        <RedesignInput leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
          value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t("搜索账号", "Search accounts")} aria-label={t("搜索账号", "Search accounts")} />
      </div>
      <EnterpriseSelect value={platform} onChange={setPlatform}
        options={[{ value: "all", label: t("全部渠道", "All channels") },
          { value: "douyin", label: t("抖音", "Douyin") },
          { value: "xiaohongshu", label: t("小红书", "Xiaohongshu") }]}
        ariaLabel={t("账号渠道", "Account channel")} className="w-36" />
    </div>
    {!entities.length ? <WorkspaceEmptyState icon="user" title={t("暂无渠道账号", "No channel accounts")}
      description={t("先在此项目中连接渠道账号。", "Connect channel accounts in this project first.")} />
      : !filtered.length ? <WorkspaceEmptyState icon="search" title={t("没有匹配的账号", "No matching accounts")}
        description={t("请调整搜索关键词或渠道筛选。", "Adjust the search term or channel filter.")} />
        : <>
          <div className="amp-lead-tracking-grid">{pagination.pageItems.map((entity) =>
            <LeadTrackingEntityCard key={entity.key} entity={entity} selectedProjectId={projectId} />)}</div>
          <Pagination page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
            pageSize={pagination.pageSize} pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
        </>}
  </section>;
}
