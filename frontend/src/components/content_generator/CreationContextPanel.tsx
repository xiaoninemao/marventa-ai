"use client";

import { useEffect, useId, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_case, fetch_history_item } from "@/services/api_client";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import CaseCard from "@/components/case_library/case_card";
import type { CaseItem } from "@/types/case_library";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";

export type CreationContextPage = "insights" | "cases";

interface ReferenceItem {
  id: string;
  title: string;
  summary: string;
  caseItem?: CaseItem;
}

function ContextReferences({ kind, ids }: { kind: "insights" | "cases"; ids: string[] }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(ids.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ids.length) return;
    let active = true;
    Promise.all(ids.map(async (id): Promise<ReferenceItem> => {
      if (kind === "insights") {
        const response = await fetch_history_item(id);
        if (!response.success) throw new Error(response.message || "Could not load creation references");
        const item = response.data;
        return {
          id: item.id, title: item.title || item.filename,
          summary: item.ai_analysis?.product_summary || item.ai_analysis?.product_description || "",
        };
      }
      const response = await fetch_case(id);
      if (!response.success) throw new Error(response.message || "Could not load creation references");
      const item = response.data;
      return {
        id: item.id,
        title: item.title,
        summary: item.description || item.ai_analysis?.content_analysis || "",
        caseItem: item,
      };
    })).then((loaded) => {
      if (active) setItems(loaded);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error && failure.message ? failure.message : "Could not load creation references");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [ids, kind, attempt]);

  if (!ids.length) {
    return <div className="amp-content-context-empty amp-empty-state">
      <EmptyStateIcon name={kind === "insights" ? "insight" : "case"} />
      <p>{kind === "insights"
        ? t("尚未引用市场洞察", "No market insights selected")
        : t("尚未引用案例", "No cases selected")}</p>
    </div>;
  }
  if (loading) return <p className="amp-content-context-empty" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</p>;
  if (error) {
    return (
      <div className="amp-content-context-error" role="alert">
        <p>{localizeErrorMessage(error, locale)}</p>
        <button type="button" className="amp-button amp-button-secondary" onClick={() => {
          setError(null);
          setLoading(true);
          setAttempt((current) => current + 1);
        }}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
      </div>
    );
  }
  if (kind === "cases") {
    return (
      <div className="amp-reference-card-grid">
        {items.map((item) => item.caseItem && (
          <CaseCard key={item.id} item={item.caseItem}
            is_favorited={item.caseItem.is_favorited}
            selectionMode selected staticMedia showSelectionIndicator={false} />
        ))}
      </div>
    );
  }
  return (
    <div className="amp-reference-card-grid">
      {items.map((item) => (
        <article key={item.id} className="amp-reference-insight-card amp-reference-insight-card-selected">
          <strong title={item.title}>{item.title}</strong>
          <p>{item.summary || t("暂无洞察摘要", "No insight summary")}</p>
          <span className="amp-reference-card-check amp-reference-card-check-selected" aria-hidden="true">
            <InlineIcon name="check" />
          </span>
        </article>
      ))}
    </div>
  );
}

interface Props {
  page: CreationContextPage;
  onPageChange: (page: CreationContextPage) => void;
  insightIds: string[];
  caseIds: string[];
}

export default function CreationContextPanel({ page, onPageChange, insightIds, caseIds }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const id = useId();
  const scope = `${user?.id}:${user?.current_organization?.id}`;
  const tabs = [
    { key: "insights", label: t("市场洞察", "Insights"), count: insightIds.length, icon: "insight" as InlineIconName },
    { key: "cases", label: t("案例引用", "Cases"), count: caseIds.length, icon: "case" as InlineIconName },
  ] as const;

  return (
    <div className="amp-content-context-panel">
      <div className="amp-content-context-tabs" role="tablist" aria-label={t("上下文模块", "Context sections")}>
        {tabs.map((tab, index) => (
          <button key={tab.key} id={`${id}-${tab.key}`} type="button" role="tab"
            title={tab.label}
            aria-selected={page === tab.key} aria-controls={`${id}-panel`}
            tabIndex={page === tab.key ? 0 : -1}
            onClick={() => onPageChange(tab.key)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              event.stopPropagation();
              onPageChange(tabs[next].key);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}>
            <InlineIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.count > 0 && <small>{tab.count}</small>}
          </button>
        ))}
      </div>
      <div className="amp-content-context-page" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${page}`}>
        <ContextReferences key={`${scope}:${page}:${(page === "insights" ? insightIds : caseIds).join(",")}`}
          kind={page} ids={page === "insights" ? insightIds : caseIds} />
      </div>
    </div>
  );
}
