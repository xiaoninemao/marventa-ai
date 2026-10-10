"use client";

import { useEffect, useId, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_case, fetch_history_item } from "@/services/api_client";
import { fetch_project_materials } from "@/services/publishing_api";
import MaterialDocumentThumbnail from "@/components/projects/MaterialDocumentThumbnail";
import type { ProjectMaterial } from "@/types/publishing";
import { eligibleMaterialReferences } from "@/utils/material_references";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import CaseCard from "@/components/case_library/case_card";
import type { CaseItem } from "@/types/case_library";
import type { CreationPlan } from "@/types/content_generator";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";

export type CreationContextPage = "insights" | "cases" | "materials" | "plans";

export async function loadMaterialReferences(projectId: string, ids: string[]): Promise<Array<{ id: string; material?: ProjectMaterial }>> {
  if (!ids.length) return [];
  if (!projectId) return ids.map((id) => ({ id }));
  const roots = await fetch_project_materials(projectId);
  if (!roots.success) throw new Error(roots.message || "Could not load project materials");
  const collections = roots.data.filter((item) => item.project_id === projectId && item.node_type === "collection");
  const children = await Promise.all(collections.map(async (collection) => {
    const response = await fetch_project_materials(projectId, collection.id);
    if (!response.success) throw new Error(response.message || "Could not load project materials");
    return response.data;
  }));
  const files = eligibleMaterialReferences([...roots.data, ...children.flat()], projectId)
    .filter((item) => ids.includes(item.id));
  return ids.map((id) => ({ id, material: files.find((item) => item.id === id) }));
}

function MaterialReferences({ projectId, ids }: { projectId: string; ids: string[] }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Array<{ id: string; material?: ProjectMaterial }>>([]);
  const [loading, setLoading] = useState(ids.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadMaterialReferences(projectId, ids)
      .then((loaded) => { if (active) setItems(loaded); })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load project materials");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, ids, attempt]);

  if (!ids.length) return (
    <div className="amp-content-context-empty amp-empty-state">
      <EmptyStateIcon name="collection" />
      <p>{t("尚未引用素材", "No materials selected")}</p>
    </div>
  );
  if (loading) return <p className="amp-content-context-empty" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</p>;
  if (error) return (
    <div className="amp-content-context-error" role="alert">
      <p>{localizeErrorMessage(error, locale)}</p>
      <button type="button" className="amp-button amp-button-secondary" onClick={() => {
        setError(null);
        setLoading(true);
        setAttempt((current) => current + 1);
      }}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
    </div>
  );
  return (
    <div className="amp-reference-card-grid">
      {items.map(({ id, material }) => (
        <article key={id} className="amp-reference-insight-card amp-reference-insight-card-selected" data-reference-kind="material">
          {material ? <>
            {(material.media_type === "image" || material.media_type === "video") && material.file_url && (
              <div className="amp-reference-material-preview">
                {material.media_type === "image"
                  ? <Image src={material.file_url} alt={material.name} width={600} height={450}
                      unoptimized className="amp-reference-material-media" />
                  : <video src={material.file_url} controls playsInline preload="metadata"
                      aria-label={material.name} className="amp-reference-material-media" />}
              </div>
            )}
            {material.media_type === "document" && (
              <div className="amp-reference-material-preview"><MaterialDocumentThumbnail material={material} /></div>
            )}
            <strong title={material.name}>{material.name}</strong>
            <p>{material.media_type === "image" ? t("图片", "Image")
              : material.media_type === "video" ? t("视频", "Video") : t("文案", "Document")}</p>
          </> : <>
            <EmptyStateIcon name="collection" />
            <strong>{t("素材不可用", "Material unavailable")}</strong>
            <p>{t("素材已删除或你没有访问权限。", "This material was removed or you no longer have access.")}</p>
            <small>{id}</small>
          </>}
        </article>
      ))}
    </div>
  );
}

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
  projectId?: string;
  materialIds?: string[];
  plans?: CreationPlan[];
}

const EMPTY_MATERIAL_IDS: string[] = [];

function PlanReference({ plan, number, open, onOpenChange }: {
  plan: CreationPlan; number: number; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const normalized = plan.created_at.includes(" ") ? `${plan.created_at.replace(" ", "T")}Z` : plan.created_at;
  const created = new Date(normalized);
  const validTime = Number.isFinite(created.getTime());
  return (
    <details className="amp-reference-insight-card amp-reference-insight-card-selected amp-creation-plan-card"
      data-plan-id={plan.id} open={open}>
      <summary aria-label={t("查看创作方案 {count}", "View creation plan {count}", { count: number })}
        onClick={(event) => {
          event.preventDefault();
          onOpenChange(!open);
        }}>
        <span className="amp-creation-plan-meta">
          <span><InlineIcon name="listBullet" />{t("方案 {count}", "Plan {count}", { count: number })}</span>
          {validTime ? <time dateTime={plan.created_at}>{new Intl.DateTimeFormat(locale, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          }).format(created)}</time> : <span>{t("生成时间不可用", "Creation time unavailable")}</span>}
        </span>
        <strong title={plan.title}>{plan.title || t("未命名方案", "Untitled plan")}</strong>
        <span className="amp-creation-plan-disclosure">
          <span className="is-closed">{t("查看原文", "View raw content")}</span>
          <span className="is-open">{t("收起原文", "Hide raw content")}</span>
          <InlineIcon name="chevronRight" />
        </span>
      </summary>
      <div className="amp-creation-plan-source">
        <span>{t("AI 创作方案原文", "Raw AI creation plan")}</span>
        <pre tabIndex={0} aria-label={t("创作方案原文", "Raw creation plan")}>{plan.content}</pre>
      </div>
    </details>
  );
}

function PlanReferences({ plans }: { plans: CreationPlan[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <div className="amp-reference-card-grid amp-creation-plans">
    {[...plans].reverse().map((plan, index) => (
      <PlanReference key={plan.id} plan={plan} number={plans.length - index}
        open={openId === plan.id}
        onOpenChange={(open) => setOpenId((current) => open ? plan.id : current === plan.id ? null : current)} />
    ))}
  </div>;
}

export default function CreationContextPanel({ page, onPageChange, insightIds, caseIds, projectId = "", materialIds = EMPTY_MATERIAL_IDS, plans = [] }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const id = useId();
  const scope = `${user?.id}:${user?.current_organization?.id}`;
  const tabs = [
    { key: "insights", label: t("市场洞察", "Insights"), count: insightIds.length, icon: "insight" as InlineIconName },
    { key: "cases", label: t("案例引用", "Cases"), count: caseIds.length, icon: "case" as InlineIconName },
    { key: "materials", label: t("素材", "Materials"), count: materialIds.length, icon: "collection" as InlineIconName },
    { key: "plans", label: t("创作方案", "Plans"), count: plans.length, icon: "listBullet" as InlineIconName },
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
        {page === "plans" ? (
          plans.length ? <PlanReferences key={`${scope}:${projectId}`} plans={plans} /> : <div className="amp-content-context-empty amp-empty-state">
            <EmptyStateIcon name="listBullet" />
            <p>{t("暂无创作方案", "No plans yet")}</p>
          </div>
        ) : page === "materials" ? (
          <MaterialReferences key={`${scope}:${projectId}:${materialIds.join(",")}`}
            projectId={projectId} ids={materialIds} />
        ) : (
          <ContextReferences key={`${scope}:${page}:${(page === "insights" ? insightIds : caseIds).join(",")}`}
            kind={page} ids={page === "insights" ? insightIds : caseIds} />
        )}
      </div>
    </div>
  );
}
