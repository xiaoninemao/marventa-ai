"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/contexts/i18n_context";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import LeadTrackingEntityCard from "@/components/lead_tracking/LeadTrackingEntityCard";
import { useLeadTrackingEntities } from "@/components/lead_tracking/useLeadTrackingEntities";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import InlineIcon from "@/components/redesign/InlineIcon";
import Pagination from "@/components/redesign/Pagination";
import { filterLeadTrackingEntities, groupLeadTrackingEntities } from "@/utils/lead_tracking";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import { CHINESE_PROGRESS, ENGLISH_PROGRESS } from "@/i18n/interaction_copy";
import type { AccountContentAccount } from "@/types/account_content";

export default function LeadTrackingPage() {
  return <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}><LeadTrackingList /></Suspense>;
}

function LeadTrackingList() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
  const projectId = params.get("project") || "";
  const { user, authLoading, projects, accounts, scope, loading, error, retry } = useLeadTrackingEntities();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"all" | AccountContentAccount["platform"]>("all");
  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);
  const entities = useMemo(() => groupLeadTrackingEntities(accounts), [accounts]);
  const filtered = useMemo(
    () => filterLeadTrackingEntities(entities, query, platform, projectId),
    [entities, query, platform, projectId],
  );
  const pagination = usePagination(filtered, `${scope}:${projectId}:${query}:${platform}`);
  if (authLoading || !user) return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;

  return (
    <div className="amp-projects-layout">
      <PublishingProjectSidebar module="leadTracking" projects={projects} selectedProjectId={projectId} />
      <main className="amp-projects-main">
        <header className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{t("线索追踪", "Lead Tracking")}</h1>
            <p>{t("按渠道账号查看关联项目，选择账号后进入线索分析。",
              "Browse channel accounts and their linked projects, then open an account to analyze leads.")}</p>
          </div>
        </header>
        <div className="amp-insight-toolbar">
          <div className="amp-projects-search">
            <RedesignInput leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索账号或项目", "Search accounts or projects")} aria-label={t("搜索账号或项目", "Search accounts or projects")} />
          </div>
          <EnterpriseSelect value={platform} onChange={setPlatform}
            options={[{ value: "all", label: t("全部渠道", "All channels") }, { value: "douyin", label: t("抖音", "Douyin") },
              { value: "xiaohongshu", label: t("小红书", "Xiaohongshu") }]}
            ariaLabel={t("线索渠道", "Lead channel")} className="w-36" />
        </div>
        {loading ? <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
          : error ? <div className="amp-projects-state" role="alert"><strong>{error}</strong>
            <button type="button" className="amp-button amp-button-secondary" onClick={retry}>{t("重试", "Retry")}</button></div>
            : !entities.length ? <WorkspaceEmptyState icon="target" title={t("暂无渠道账号", "No channel accounts")}
              description={<>{t("先在项目中连接渠道账号，账号会按项目展示在这里。", "Connect channel accounts in a project to see them here.")}
                {" "}<Link className="amp-account-content-inline-link" href="/projects">{t("前往项目", "Go to projects")}</Link></>} />
              : !filtered.length ? <WorkspaceEmptyState icon="search" title={t("没有匹配的账号", "No matching accounts")}
                description={t("请调整搜索关键词或渠道筛选。", "Adjust the search term or channel filter.")} />
                : <>
                  <div className="amp-lead-tracking-grid">{pagination.pageItems.map((entity) =>
                    <LeadTrackingEntityCard key={entity.key} entity={entity} selectedProjectId={projectId} />)}</div>
                  <Pagination page={pagination.page} totalPages={pagination.totalPages} totalItems={pagination.totalItems}
                    pageSize={pagination.pageSize} pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
                    onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
                </>}
      </main>
    </div>
  );
}
