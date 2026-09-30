"use client";

import { useState, useCallback, useEffect, useRef, useMemo, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChatMessage, ContentCard, ContentVersion, CreationActivity, SessionRecord } from "@/types/content_generator";
import {
  create_session, fetch_sessions, fetch_session,
  send_chat_message, regenerate_latest_reply, rewrite_latest_reply,
  generate_cards, delete_session, rename_session,
  modify_card, generate_document,
  fetch_content_projects, fetch_versions, restore_version,
} from "@/services/api_client";
import type { ContentProject } from "@/types/publishing";

import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import type { Translate } from "@/i18n/locale";
import ReferencePanel, { type RefLabel } from "@/components/content_generator/ReferencePanel";
import ContentGeneratorEmptyState from "@/components/content_generator/ContentGeneratorEmptyState";
import CreationPresence from "@/components/content_generator/CreationPresence";
import CreationContextPanel, { type CreationContextPage } from "@/components/content_generator/CreationContextPanel";
import ContentGeneratorSkeleton from "@/components/content_generator/ContentGeneratorSkeleton";
import ContentGeneratorCardWorkspace from "@/components/content_generator/ContentGeneratorCardWorkspace";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import InlineIcon from "@/components/redesign/InlineIcon";
import ContentProjectSidebar from "@/components/content_generator/ContentProjectSidebar";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import { canManageCreation } from "@/utils/creation_permissions";
import {
  get_card_content_format,
  get_card_detail_profile,
  get_card_preview_content,
} from "@/components/content_generator/contentGeneratorCardDetails";
import {
  ACTIVE_SESSION_STORAGE_KEY,
  CHIP_CATEGORIES,
  add_pending_document_session,
  remove_pending_document_session,
  type Feedback,
} from "@/components/content_generator/contentGeneratorHelpers";

// ── Card metadata ──

const get_card_meta = (t: Translate): Record<string, {
  icon: React.ReactNode;
  label: string;
  accentColor: string;
  tintColor: string;
  textColor: string;
}> => ({
  script: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25M3.375 4.5h17.25m-12.75 0v15m8.25-15v15M5.625 7.5h.008v.008H5.625V7.5zm0 3h.008v.008H5.625V10.5zm0 3h.008v.008H5.625V13.5z" /></svg>,
    label: t("脚本", "Script"),
    accentColor: "#475467",
    tintColor: "#f2f4f7",
    textColor: "#344054",
  },
  title: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>,
    label: t("标题", "Title"),
    accentColor: "#d97706",
    tintColor: "#fffaeb",
    textColor: "#b54708",
  },
  copy: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
    label: t("文案", "Copy"),
    accentColor: "#2563eb",
    tintColor: "#eff4ff",
    textColor: "#175cd3",
  },
  hashtags: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5" /></svg>,
    label: t("话题", "Hashtags"),
    accentColor: "#039855",
    tintColor: "#ecfdf3",
    textColor: "#027a48",
  },
  visual: {
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    label: t("视觉", "Visuals"),
    accentColor: "#c11574",
    tintColor: "#fdf2fa",
    textColor: "#c11574",
  },
});

const get_card_icon = (card: ContentCard, fallback: React.ReactNode) => (
  card.card_type === "title"
    ? (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 6V4.5h14V6M12 4.5v15M8.5 19.5h7" />
      </svg>
    )
    : fallback
);

const format_version_timestamp = (value: string, locale: string) => {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
};

const get_activity_text = (activity: CreationActivity, t: Translate, locale: string) => {
  if (activity.activity_type === "cards_generated") {
    return t("已生成 {count} 张内容卡片", "Generated {count} content cards", {
      count: activity.card_count.toLocaleString(locale),
    });
  }
  if (activity.activity_type === "card_modified") {
    return t("已修改“{title}”卡片", "Updated the “{title}” card", {
      title: activity.card_title,
    });
  }
  return t("已开始生成作品", "Started generating a work");
};

function SelectedPlanDetailPanel({
  card,
  disabled,
  on_modify,
  on_copy,
}: {
  card: ContentCard;
  disabled: boolean;
  on_modify: () => void;
  on_copy: () => void;
}) {
  const { t } = useI18n();
  const CARD_META = get_card_meta(t);
  const content_format = get_card_content_format(card);
  const CARD_DETAIL_PROFILE = get_card_detail_profile(t, content_format);
  const meta = CARD_META[card.card_type] || CARD_META.script;
  const profile = CARD_DETAIL_PROFILE[card.card_type] || CARD_DETAIL_PROFILE.copy;
  const preview_content = get_card_preview_content(card);
  const detail_rows = [
    { label: t("核心结构", "Core structure"), value: profile.core },
    { label: t("适用平台", "Recommended platforms"), value: profile.platforms },
    { label: t("语气风格", "Tone and style"), value: profile.tone },
  ];

  return (
    <section
      aria-label={t("选中方案详情预览面板", "Selected plan preview")}
      className="amp-content-plan-detail"
    >
      <div className="amp-content-plan-detail-main">
        <header className="amp-content-plan-detail-header">
          <span className="amp-content-plan-detail-icon"
            style={{ backgroundColor: meta.accentColor, color: "#ffffff" }}>
            {get_card_icon(card, meta.icon)}
          </span>
          <h4 style={{ color: meta.accentColor }}>{card.title}</h4>
          <span className="amp-content-plan-detail-format"
            style={{
              backgroundColor: meta.tintColor,
              border: `1px solid ${meta.accentColor}`,
              color: meta.accentColor,
            }}>
            {profile.format}
          </span>
          <div className="amp-content-plan-detail-actions">
            <button type="button" onClick={on_modify} disabled={disabled}>
              <InlineIcon name="sparkle" />
              {t("AI 修改", "Edit with AI")}
            </button>
            <button type="button" onClick={on_copy}>
              <InlineIcon name="copy" />
              {t("复制内容", "Copy content")}
            </button>
          </div>
        </header>

        <dl className="amp-content-plan-detail-meta">
          {detail_rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="amp-content-plan-detail-content">
          <div className="amp-content-plan-detail-content-header">
            <h5>{t("内容预览", "Content preview")}</h5>
          </div>
          <div className="amp-content-plan-detail-text">
            {preview_content || t("暂无内容", "No content yet")}
          </div>
        </div>
      </div>
    </section>
  );
}

function FlipCard3D({
  card,
  is_active,
  flipped,
  on_flip,
}: {
  card: ContentCard;
  is_active: boolean;
  flipped: boolean;
  on_flip: () => void;
}) {
  const { t } = useI18n();
  const CARD_META = get_card_meta(t);
  const meta = CARD_META[card.card_type] || CARD_META.script;
  return (
    <div style={{ width: 260, height: 350, perspective: "1000px" }}>
      <div
        onClick={() => is_active && on_flip()}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transformStyle: "preserve-3d",
          transition: "transform 0.6s",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          cursor: is_active ? "pointer" : "default",
        }}
      >
        <div
          className="rounded-xl bg-white text-slate-900 overflow-hidden border border-slate-200 shadow-xl shadow-slate-900/10 dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700"
          style={{
            position: "absolute",
            inset: 0,
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: meta.accentColor }} />
          <div className="relative flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: meta.tintColor, color: meta.textColor }}>
              {get_card_icon(card, meta.icon)}
            </div>
            <span className="text-xs font-medium px-2.5 py-1 rounded-md"
              style={{ backgroundColor: meta.tintColor, color: meta.textColor }}>
              {meta.label}
            </span>
          </div>
          <div className="relative flex-1 flex flex-col justify-center">
            <h3 className="text-lg font-bold mb-2 line-clamp-2">{card.title}</h3>
            <p className="text-sm text-slate-600 dark:text-zinc-300 line-clamp-3 leading-relaxed">{card.preview}</p>
          </div>
          <div className="relative text-xs text-slate-400 dark:text-zinc-500 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            {is_active ? t("点击翻转查看要点", "Click to flip and view key points") : ""}
          </div>
        </div>

        <div
          className="rounded-2xl bg-white/90 dark:bg-zinc-900/90 overflow-hidden shadow-2xl shadow-slate-900/10 ring-1 ring-white/40 dark:ring-white/10 backdrop-blur-xl"
          style={{
            position: "absolute",
            inset: 0,
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{ backgroundColor: meta.accentColor }}>
              {get_card_icon(card, meta.icon)}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block truncate">{card.title}</span>
              <span className="text-[10px] text-zinc-400">{t("{type} · 要点", "{type} · Key points", { type: meta.label })}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5">
            {card.tips.length > 0 ? card.tips.map((tip, index) => (
              <div key={`${index}-${tip}`} className="flex items-start gap-2.5">
                <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                  style={{ backgroundColor: meta.accentColor }}>
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{tip}</span>
              </div>
            )) : (
              <p className="text-sm text-zinc-400 text-center py-8">{t("暂无要点", "No key points yet")}</p>
            )}
          </div>
          <div className="text-[10px] text-zinc-400 text-center mt-3 shrink-0">
            {t("点击翻转回正面", "Click to flip back")}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreationVersionHistory({
  versions,
  selectedVersion,
  latestVersion,
  locale,
  restoring,
  canRestore,
  onSelect,
  onRestore,
}: {
  versions: ContentVersion[];
  selectedVersion: ContentVersion | null;
  latestVersion: ContentVersion | null;
  locale: string;
  restoring: boolean;
  canRestore: boolean;
  onSelect: (id: string | null) => void;
  onRestore: () => void;
}) {
  const { t } = useI18n();
  if (versions.length === 0) return null;

  return (
    <section className="amp-content-card-versions" aria-label={t("版本记录", "Version history")}>
      <header>
        <div>
          <h4>{t("版本记录", "Version history")}</h4>
        </div>
        <span>{t("{count} 个版本", "{count} versions", { count: versions.length.toLocaleString(locale) })}</span>
      </header>
      <div className="amp-content-card-version-grid">
        {[...versions].reverse().map((version) => {
          const expanded = version.id === selectedVersion?.id;
          const versionType = version.version_type || (version.minor === 0 ? "generation" : "edit");
          const versionIndex = versions.findIndex((item) => item.id === version.id);
          const previousVersion = versionIndex > 0 ? versions[versionIndex - 1] : null;
          const displayedCards = versionType === "edit"
            ? (version.changed_card_ids?.length
                ? version.cards.filter((card) => version.changed_card_ids?.includes(card.id))
                : version.cards.filter((card) => {
                    const previousCard = previousVersion?.cards.find((item) => item.id === card.id)
                      || previousVersion?.cards.find((item) => item.card_type === card.card_type);
                    return !previousCard
                      || card.title !== previousCard.title
                      || card.preview !== previousCard.preview
                      || card.content !== previousCard.content
                      || JSON.stringify(card.tips) !== JSON.stringify(previousCard.tips);
                  }))
            : version.cards;
          return (
            <div key={version.id} className="amp-content-card-version-item">
              <button type="button"
                aria-expanded={expanded}
                onClick={() => onSelect(expanded ? null : version.id)}
              >
                <span>
                  <b>
                    {version.version_label}
                    <i data-version-kind={versionType === "rollback" ? "rollback" : version.minor === 0 ? "major" : "minor"}>
                      {versionType === "rollback"
                        ? t("版本回溯", "Rollback")
                        : version.minor === 0
                          ? t("整组生成", "Full generation")
                          : t("单卡修改", "Card edit")}
                    </i>
                    {version.id === latestVersion?.id && (
                      <i data-version-current="true">{t("当前版本", "Current")}</i>
                    )}
                  </b>
                  <small>
                    {versionType === "rollback"
                      ? t("回溯自 {version}", "Restored from {version}", {
                          version: version.source_version_label || t("历史版本", "a historical version"),
                        })
                      : version.minor === 0
                        ? t("第 {count} 轮", "Round {count}", { count: version.major })
                        : t("基于 v{major}.0", "Based on v{major}.0", { major: version.major })}
                    {" · "}
                    {format_version_timestamp(version.created_at, locale)}
                  </small>
                </span>
                <span className="amp-content-card-version-toggle">
                  <em>{t("{count} 张", "{count} cards", { count: displayedCards.length.toLocaleString(locale) })}</em>
                  <InlineIcon name="chevronRight" />
                </span>
              </button>
              {expanded && (
                <div className="amp-content-card-version-detail">
                  <ul>
                    {displayedCards.map((card) => <li key={card.id}>{card.title}</li>)}
                  </ul>
                  {canRestore && version.id !== latestVersion?.id && (
                    <button type="button" onClick={onRestore} disabled={restoring}>
                      <InlineIcon name="history" />
                      {restoring ? t("恢复中...", "Restoring...") : t("恢复此版本", "Restore this version")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Main Page ──

export function ContentGeneratorExperience({ canvasId = "" }: { canvasId?: string }) {
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning, showInfo } = useToast();
  const CARD_META = get_card_meta(t);
  const { user, loading: auth_loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, set_sessions] = useState<SessionRecord[]>([]);
  const [session, set_session] = useState<SessionRecord | null>(null);
  const [messages, set_messages] = useState<ChatMessage[]>([]);
  const [input, set_input] = useState("");
  const [sending, set_sending] = useState(false);
  const [reply_action, set_reply_action] = useState<"rewrite" | "regenerate" | null>(null);
  const [show_rewrite_modal, set_show_rewrite_modal] = useState(false);
  const [rewrite_message, set_rewrite_message] = useState("");
  const [error, set_error] = useState<Feedback | null>(null);
  const [filter_text, set_filter_text] = useState("");
  const [sort_order, set_sort_order] = useState<"newest" | "oldest" | "name">("newest");
  const [status_filter, set_status_filter] = useState<"all" | SessionRecord["status"]>("all");
  const [workspace_open, set_workspace_open] = useState(false);
  const [assistant_tab, set_assistant_tab] = useState<"ai" | "context" | "cards" | "activity">("ai");
  const [context_page, set_context_page] = useState<CreationContextPage>("insights");
  const [menu_session_id, set_menu_session_id] = useState<string | null>(null);
  const [session_loading, set_session_loading] = useState(true);
  const [insight_ids, set_insight_ids] = useState<string[]>([]);
  const [case_ids, set_case_ids] = useState<string[]>([]);
  const [insight_labels, set_insight_labels] = useState<RefLabel[]>([]);
  const [case_labels, set_case_labels] = useState<RefLabel[]>([]);
  const [show_ref_panel, set_show_ref_panel] = useState(false);
  const [reference_panel_tab, set_reference_panel_tab] = useState<"insight" | "case">("insight");
  const [active_card_index, set_active_card_index] = useState(0);
  const [flipped_ids, set_flipped_ids] = useState<Set<string>>(new Set());
  const [modify_input, set_modify_input] = useState("");
  const [modifying, set_modifying] = useState(false);
  const [show_modify_modal, set_show_modify_modal] = useState(false);
  const [modify_target_index, set_modify_target_index] = useState(0);
  const [generating_doc, set_generating_doc] = useState(false);
  const [selected_chips, set_selected_chips] = useState<string[]>([]);
  const [show_chip_popover, set_show_chip_popover] = useState(false);
  const [version_refresh_key, set_version_refresh_key] = useState(0);
  const [versions, set_versions] = useState<ContentVersion[]>([]);
  const [selected_version_id, set_selected_version_id] = useState<string | null>(null);
  const [restoring_version, set_restoring_version] = useState(false);
  const [versions_loading, set_versions_loading] = useState(false);
  const [generation_status_error, set_generation_status_error] = useState(false);
  const [delete_target, set_delete_target] = useState<SessionRecord | null>(null);
  const [rename_target, set_rename_target] = useState<SessionRecord | null>(null);
  const [rename_name, set_rename_name] = useState("");
  const [renaming, set_renaming] = useState(false);
  const [project_id, set_project_id] = useState(() => searchParams.get("project") || "");
  const [new_project_id, set_new_project_id] = useState("");
  const [new_creation_name, set_new_creation_name] = useState("");
  const [available_projects, set_available_projects] = useState<ContentProject[]>([]);
  const selected_project_id = searchParams.get("project") || "";

  const chat_end_ref = useRef<HTMLDivElement>(null);
  const poll_interval_ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const prompt_input_ref = useRef<HTMLTextAreaElement>(null);
  const modify_abort_ref = useRef<AbortController | null>(null);
  const project_dialog_ref = useRef<HTMLDialogElement>(null);
  const rename_dialog_ref = useRef<HTMLDialogElement>(null);
  const menu_ref = useRef<HTMLDivElement>(null);
  const can_manage_session = session ? canManageCreation(user, session) : false;

  // Auth guard
  useEffect(() => {
    if (!auth_loading && !user) router.push("/");
  }, [user, auth_loading, router]);

  useEffect(() => {
    if (error) showError(typeof error === "string" ? error : t(error.zh, error.en, error.values));
  }, [error, showError, t]);

  // Load sessions on mount
  useEffect(() => {
    if (!user) return;
    fetch_content_projects()
      .then((response) => set_available_projects(response.data || []))
      .catch(() => set_error({ zh: "加载项目失败", en: "Could not load projects" }));
  }, [user]);

  useEffect(() => {
    if (canvasId) return;
    set_project_id(selected_project_id);
    set_workspace_open(false);
    set_session(null);
    set_messages([]);
  }, [canvasId, selected_project_id]);

  useEffect(() => {
    if (user && !canvasId) {
      let cancelled = false;
      set_session_loading(true);
      fetch_sessions(project_id)
        .then((res) => {
          if (!cancelled && res.success && res.data) set_sessions(res.data);
        })
        .catch(() => {
          if (!cancelled) set_error({ zh: "加载创作记录失败", en: "Could not load content sessions" });
        })
        .finally(() => {
          if (!cancelled) set_session_loading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [canvasId, project_id, user]);

  useEffect(() => {
    if (!user || canvasId || !sessions.some((item) => item.status === "generating")) return;
    const timer = window.setInterval(() => {
      void fetch_sessions(project_id)
        .then((response) => {
          if (response.success && response.data) set_sessions(response.data);
        })
        .catch(() => {
          window.clearInterval(timer);
          set_error({
            zh: "创作状态刷新失败，请刷新页面重试",
            en: "Could not refresh creation status. Reload the page and try again.",
          });
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [canvasId, project_id, sessions, user]);

  useEffect(() => {
    if (!menu_session_id) return;
    const close_on_outside_click = (event: PointerEvent) => {
      if (!menu_ref.current?.contains(event.target as Node)) set_menu_session_id(null);
    };
    document.addEventListener("pointerdown", close_on_outside_click);
    return () => document.removeEventListener("pointerdown", close_on_outside_click);
  }, [menu_session_id]);

  // Reset modify state when switching cards
  useEffect(() => {
    set_modifying(false);
    set_modify_input("");
  }, [active_card_index]);

  // Auto-scroll chat
  useEffect(() => {
    chat_end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (poll_interval_ref.current) clearInterval(poll_interval_ref.current);
    };
  }, []);

  const localize_feedback = useCallback((message: Feedback) => (
    typeof message === "string" ? message : t(message.zh, message.en, message.values)
  ), [t]);

  const show_success = useCallback((message: Feedback) => {
    showSuccess(localize_feedback(message));
  }, [localize_feedback, showSuccess]);

  const show_warning = useCallback((message: Feedback) => {
    showWarning(localize_feedback(message));
  }, [localize_feedback, showWarning]);

  const show_info = useCallback((message: Feedback) => {
    showInfo(localize_feedback(message));
  }, [localize_feedback, showInfo]);

  const show_failure = useCallback((message: Feedback) => {
    showError(localize_feedback(message));
  }, [localize_feedback, showError]);

  // ── Session management ──

  const toggle_flip = useCallback((id: string) => {
    set_flipped_ids((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handle_modify_card = useCallback(async () => {
    const instruction = modify_input.trim();
    if (!instruction || !session || modifying || !can_manage_session) return;
    const card = (session?.cards || [])[modify_target_index];
    if (!card) return;
    set_modifying(true);
    set_modify_input("");

    const controller = new AbortController();
    modify_abort_ref.current = controller;

    try {
      const res = await modify_card(session.id, card.id, instruction, controller.signal);
      if (res.success && res.data) {
        set_session(res.data.session);
        set_messages(res.data.session.messages || []);
        set_sessions((current) => current.map((item) => (
          item.id === res.data.session.id ? res.data.session : item
        )));
        set_show_modify_modal(false);
        set_version_refresh_key((k) => k + 1);
        show_success({ zh: "卡片已修改", en: "Card updated" });
      } else {
        show_failure({ zh: "修改失败，请重试", en: "Could not update the card. Please try again." });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled, no toast
      show_failure({ zh: "修改失败，请重试", en: "Could not update the card. Please try again." });
    } finally {
      set_modifying(false);
      modify_abort_ref.current = null;
    }
  }, [can_manage_session, modify_input, session, modifying, modify_target_index, show_failure, show_success]);

  const handle_generate_document = useCallback(async () => {
    if (!session || generating_doc || !can_manage_session) return;
    add_pending_document_session(session.id);
    set_generating_doc(true);
    try {
      const res = await generate_document(session.id);
      if (res.success) {
        show_success({ zh: "作品正在后台生成，可先切换到作品集等待", en: "Your work is being generated in the background. You can open Portfolio while you wait." });
        void fetch_session(session.id)
          .then((response) => {
            if (!response.success || !response.data) return;
            set_session(response.data);
            set_messages(response.data.messages || []);
            set_sessions((current) => current.map((item) => (
              item.id === response.data.id ? response.data : item
            )));
          })
          .catch(() => {
            show_warning({
              zh: "作品生成已开始，但活动记录刷新失败",
              en: "Work generation started, but the activity log could not be refreshed",
            });
          });
      } else {
        remove_pending_document_session(session.id);
        show_failure({ zh: "作品生成失败", en: "Could not generate the work" });
      }
    } catch {
      remove_pending_document_session(session.id);
      show_failure({ zh: "作品生成失败", en: "Could not generate the work" });
    } finally {
      set_generating_doc(false);
    }
  }, [can_manage_session, session, generating_doc, show_failure, show_success, show_warning]);

  // ── Reset: clear everything ──

  const handle_reset = useCallback(async () => {
    if (poll_interval_ref.current) {
      clearInterval(poll_interval_ref.current);
      poll_interval_ref.current = null;
    }
    set_session(null);
    set_messages([]);
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    set_input("");
    set_error(null);
    set_insight_ids([]);
    set_case_ids([]);
    set_insight_labels([]);
    set_case_labels([]);
    set_selected_chips([]);
    set_active_card_index(0);
    set_flipped_ids(new Set());
    set_reply_action(null);
    set_show_rewrite_modal(false);
    set_rewrite_message("");
  }, []);

  const open_new_creation = useCallback(() => {
    set_new_project_id(project_id || available_projects[0]?.id || "");
    set_new_creation_name("");
    project_dialog_ref.current?.showModal();
  }, [available_projects, project_id]);

  const start_new_creation = useCallback(async () => {
    const target_project_id = new_project_id;
    const title = new_creation_name.trim();
    if (!target_project_id || !title) return;
    await handle_reset();
    try {
      const response = await create_session(target_project_id, title);
      if (!response.success || !response.data) {
        throw new Error(response.message || "Could not create creation");
      }
      showSuccess(t("创作已创建", "Creation created"));
      router.push(`/content_generator/${encodeURIComponent(response.data.id)}`);
    } catch (createError) {
      set_error(createError instanceof Error ? createError.message : { zh: "新建创作失败", en: "Could not create creation" });
    }
  }, [handle_reset, new_creation_name, new_project_id, router, showSuccess, t]);

  const close_workspace = useCallback(async () => {
    const target_project_id = project_id;
    await handle_reset();
    set_workspace_open(false);
    router.push(target_project_id
      ? `/content_generator?project=${encodeURIComponent(target_project_id)}`
      : "/content_generator");
  }, [handle_reset, project_id, router]);

  const load_session = useCallback(async (id: string) => {
    try {
      if (poll_interval_ref.current) {
        clearInterval(poll_interval_ref.current);
        poll_interval_ref.current = null;
      }
      set_error(null);
      const res = await fetch_session(id);
      if (res.success && res.data) {
        set_workspace_open(true);
        set_project_id(res.data.project_id);
        set_session(res.data);
        window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, res.data.id);
        set_messages(res.data.messages || []);
        set_insight_ids([]);
        set_case_ids([]);
        set_insight_labels([]);
        set_case_labels([]);
        set_selected_chips([]);
        set_active_card_index(0);
        set_flipped_ids(new Set());
        set_modifying(false);
        set_modify_input("");
        set_sending(false);
        set_reply_action(null);
        set_show_rewrite_modal(false);
        set_rewrite_message("");
        // Historical sessions may end with a user message if a previous AI request failed.
        // Load them as editable conversations instead of polling forever.
        const msgs = res.data.messages || [];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
          set_error({ zh: "上一次 AI 回复未完成，可以继续输入补充信息或重新发送。", en: "The previous AI response was not completed. Add more information or send your message again." });
        }
      }
    } catch {
      set_error({ zh: "加载会话失败", en: "Could not load the conversation" });
    }
  }, []);

  useEffect(() => {
    if (!user || !canvasId) return;
    set_session_loading(true);
    void load_session(canvasId).finally(() => set_session_loading(false));
  }, [canvasId, load_session, user]);

  useEffect(() => {
    if (!session?.id) {
      set_versions_loading(false);
      set_generation_status_error(false);
      set_versions([]);
      set_selected_version_id(null);
      return;
    }

    let cancelled = false;
    set_versions_loading(true);
    set_generation_status_error(false);
    void fetch_versions(session.id)
      .then((response) => {
        if (cancelled) return;
        const data = response.data || [];
        set_versions(data);
        set_selected_version_id((current) => (
          current && data.some((version) => version.id === current)
            ? current
            : null
        ));
        set_versions_loading(false);
      })
      .catch(() => {
        if (!cancelled) {
          set_versions([]);
          set_selected_version_id(null);
          set_versions_loading(false);
          set_generation_status_error(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.id, version_refresh_key]);

  const handle_restore_selected_version = useCallback(async () => {
    if (!session || !selected_version_id || restoring_version) return;
    const selected = versions.find((version) => version.id === selected_version_id);
    const latest = versions[versions.length - 1];
    if (!selected || selected.id === latest?.id) return;

    set_restoring_version(true);
    try {
      const response = await restore_version(session.id, selected.id);
      if (!response.success || !response.data) {
        throw new Error(response.message || "Could not restore version");
      }
      const restored = response.data.version;
      set_session((current) => current ? { ...current, cards: restored.cards } : current);
      set_sessions((current) => current.map((item) => (
        item.id === session.id ? { ...item, cards: restored.cards } : item
      )));
      set_versions((current) => [...current, restored]);
      set_selected_version_id(restored.id);
      set_active_card_index(0);
      set_flipped_ids(new Set());
      show_success({
        zh: "已恢复到 {version}",
        en: "Restored to {version}",
        values: { version: selected.version_label },
      });
    } catch {
      show_failure({ zh: "版本恢复失败，请重试", en: "Could not restore the version. Please try again." });
    } finally {
      set_restoring_version(false);
    }
  }, [restoring_version, selected_version_id, session, show_failure, show_success, versions]);

  const confirm_delete_session = useCallback(async () => {
    if (!delete_target) return;
    if (!canManageCreation(user, delete_target)) {
      set_delete_target(null);
      showError(t("你没有删除该创作的权限", "You do not have permission to delete this creation"));
      return;
    }
    const id = delete_target.id;
    set_delete_target(null);
    try {
      await delete_session(id);
      set_sessions((prev) => prev.filter((s) => s.id !== id));
      if (session?.id === id) {
        set_session(null);
        set_messages([]);
        window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        if (poll_interval_ref.current) {
          clearInterval(poll_interval_ref.current);
          poll_interval_ref.current = null;
        }
      }
      showSuccess(t("创作已删除", "Creation deleted"));
    } catch (deleteError) {
      showError(deleteError instanceof Error ? deleteError.message : t("删除创作失败", "Could not delete creation"));
    }
  }, [delete_target, session, showError, showSuccess, t, user]);

  const open_rename_dialog = (item: SessionRecord) => {
    set_menu_session_id(null);
    if (!canManageCreation(user, item)) {
      showError(t("你没有重命名该创作的权限", "You do not have permission to rename this creation"));
      return;
    }
    set_rename_target(item);
    set_rename_name(item.title);
    rename_dialog_ref.current?.showModal();
  };

  const confirm_rename_session = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rename_target || renaming) return;
    if (!canManageCreation(user, rename_target)) {
      showError(t("你没有重命名该创作的权限", "You do not have permission to rename this creation"));
      return;
    }
    const title = rename_name.trim();
    if (!title) {
      showError(t("创作名称不能为空", "Creation name is required"));
      return;
    }
    set_renaming(true);
    try {
      const response = await rename_session(rename_target.id, title);
      set_sessions((current) => current.map((item) => item.id === response.data.id ? response.data : item));
      set_session((current) => current?.id === response.data.id ? response.data : current);
      rename_dialog_ref.current?.close();
      set_rename_target(null);
      showSuccess(t("创作名称已更新", "Creation name updated"));
    } catch (renameError) {
      showError(renameError instanceof Error ? renameError.message : t("重命名创作失败", "Could not rename creation"));
    } finally {
      set_renaming(false);
    }
  };

  // ── Chat ──

  const toggle_chip = useCallback((key: string) => {
    set_selected_chips((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      const category = CHIP_CATEGORIES.find((cat) => cat.chips.some((c) => c.key === key));
      if (category && category.key !== "content") {
        const cat_keys = new Set(category.chips.map((c) => c.key));
        return [...prev.filter((k) => !cat_keys.has(k)), key];
      }
      return [...prev, key];
    });
  }, []);

  const handle_send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || (session && !can_manage_session)) return;
    const draft_insight_ids = [...insight_ids];
    const draft_case_ids = [...case_ids];
    const draft_preferences = [...selected_chips];
    const draft_references = [
      ...insight_labels.map((item) => ({ id: item.id, kind: "insight" as const, title: item.label })),
      ...case_labels.map((item) => ({ id: item.id, kind: "case" as const, title: item.label })),
    ];
    const client_message_id = crypto.randomUUID();
    const apply_accepted_session = (accepted: SessionRecord) => {
      set_messages(accepted.messages || []);
      set_session(accepted);
      set_sessions((previous) => previous.map((item) => item.id === accepted.id ? accepted : item));
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, accepted.id);
      set_insight_ids([]);
      set_case_ids([]);
      set_insight_labels([]);
      set_case_labels([]);
      set_selected_chips([]);
    };
    const recover_accepted_session = async (session_id: string) => {
      const latest = await fetch_session(session_id);
      const accepted = latest.success
        && latest.data.messages.some((message) => message.client_message_id === client_message_id);
      if (accepted) apply_accepted_session(latest.data);
      return accepted;
    };

    if (!session) {
      let created_session_id = "";
      try {
        if (!project_id) {
          set_error({ zh: "请选择所属项目", en: "Select a project first" });
          return;
        }
        const res = await create_session(project_id, t("未命名创作", "Untitled creation"));
        if (res.success && res.data) {
          const s = res.data;
          created_session_id = s.id;
          set_session(s);
          window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, s.id);
          set_sessions((prev) => [s, ...prev]);
          set_input("");
          set_error(null);
          set_sending(true);
          set_messages([{ role: "user", content: text, client_message_id, references: draft_references }]);

          const chat_res = await send_chat_message(
            s.id, text, draft_insight_ids, draft_case_ids, draft_preferences, client_message_id,
          );
          if (chat_res.success && chat_res.data) {
            apply_accepted_session(chat_res.data.session);
          }
        }
      } catch (error) {
        const accepted = created_session_id
          ? await recover_accepted_session(created_session_id).catch(() => false) : false;
        if (!accepted) {
          set_messages([]);
          set_input(text);
        }
        set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
      } finally {
        set_sending(false);
      }
      return;
    }

    set_input("");
    set_error(null);
    set_sending(true);

    const optimistic: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, client_message_id, references: draft_references },
    ];
    set_messages(optimistic);

    try {
      const res = await send_chat_message(
        session.id, text, draft_insight_ids, draft_case_ids, draft_preferences, client_message_id,
      );
      if (res.success && res.data) {
        apply_accepted_session(res.data.session);
      }
    } catch (error) {
      const accepted = await recover_accepted_session(session.id).catch(() => false);
      if (!accepted) {
        set_messages(messages);
        set_input(text);
      }
      set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
    } finally {
      set_sending(false);
    }
  }, [
    input, sending, session, can_manage_session, messages, insight_ids, case_ids, selected_chips,
    insight_labels, case_labels, project_id, t,
  ]);

  const handle_keydown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handle_send();
    }
  }, [handle_send]);

  const apply_replaced_reply = useCallback((updated: SessionRecord) => {
    set_session(updated);
    set_messages(updated.messages || []);
    set_sessions((current) => current.map((item) => (
      item.id === updated.id ? updated : item
    )));
  }, []);

  const handle_regenerate_reply = useCallback(async () => {
    if (!session || reply_action || !can_manage_session) return;
    set_reply_action("regenerate");
    try {
      const response = await regenerate_latest_reply(session.id);
      if (!response.success || !response.data?.session) {
        throw new Error(response.message || "Could not regenerate reply");
      }
      apply_replaced_reply(response.data.session);
      show_success({ zh: "已重新生成回复", en: "Reply regenerated" });
    } catch {
      show_failure({ zh: "重新生成失败，原回复已保留", en: "Could not regenerate. The original reply was kept." });
    } finally {
      set_reply_action(null);
    }
  }, [apply_replaced_reply, can_manage_session, reply_action, session, show_failure, show_success]);

  const handle_rewrite_reply = useCallback(async () => {
    const message = rewrite_message.trim();
    if (!session || !message || reply_action || !can_manage_session) return;
    set_reply_action("rewrite");
    try {
      const response = await rewrite_latest_reply(session.id, message);
      if (!response.success || !response.data?.session) {
        throw new Error(response.message || "Could not rewrite reply");
      }
      apply_replaced_reply(response.data.session);
      set_show_rewrite_modal(false);
      set_rewrite_message("");
      show_success({ zh: "消息已修改，回复已重新生成", en: "Message updated and reply regenerated" });
    } catch {
      show_failure({ zh: "修改失败，原对话已保留", en: "Could not update the message. The original conversation was kept." });
    } finally {
      set_reply_action(null);
    }
  }, [
    apply_replaced_reply,
    can_manage_session,
    reply_action,
    rewrite_message,
    session,
    show_failure,
    show_success,
  ]);

  // ── Generate ──

  const handle_generate = useCallback(async () => {
    if (!session || sending || !can_manage_session) return;

    set_error(null);
    set_sending(true);
    try {
      const res = await generate_cards(session.id);
      if (res.success) {
        set_session((current) => current ? { ...current, status: "generating" } : current);
        set_sessions((current) => current.map((item) => (
          item.id === session.id ? { ...item, status: "generating" } : item
        )));
        show_info({ zh: "正在生成内容卡片...", en: "Generating content cards..." });

        const interval = setInterval(async () => {
          try {
            const updated = await fetch_session(session.id);
            if (updated.success && updated.data) {
              set_session(updated.data);
              set_messages(updated.data.messages || []);
              set_sessions((prev) => prev.map((s) => s.id === updated.data.id ? updated.data : s));
              if (updated.data.status === "completed" || updated.data.status === "failed") {
                clearInterval(interval);
                if (poll_interval_ref.current === interval) poll_interval_ref.current = null;
                if (updated.data.status === "completed") {
                  set_version_refresh_key((k) => k + 1);
                  show_success({ zh: "内容生成完成！点击卡片翻转查看详情", en: "Content generated! Click a card to flip it and view details." });
                } else {
                  set_error({ zh: "内容生成失败，请重试", en: "Could not generate content. Please try again." });
                }
              }
            }
          } catch {
            clearInterval(interval);
            if (poll_interval_ref.current === interval) poll_interval_ref.current = null;
            set_error({
              zh: "生成状态更新失败，请刷新页面重试",
              en: "Could not refresh generation status. Reload the page and try again.",
            });
          }
        }, 2000);
        poll_interval_ref.current = interval;
      }
    } catch {
      set_error({ zh: "生成失败，请重试", en: "Generation failed. Please try again." });
    } finally {
      set_sending(false);
    }
  }, [can_manage_session, session, sending, show_info, show_success]);

  // ── Filtered sessions ──

  const filtered_sessions = useMemo(() => {
    let result = [...sessions];
    if (status_filter !== "all") {
      result = result.filter((item) => item.status === status_filter);
    }
    if (filter_text.trim()) {
      const kw = filter_text.trim().toLowerCase();
      result = result.filter((s) =>
        s.title.toLowerCase().includes(kw)
      );
    }
    result.sort((a, b) => {
      if (sort_order === "name") return a.title.localeCompare(b.title, locale);
      const ta = new Date(a.updated_at || a.created_at).getTime();
      const tb = new Date(b.updated_at || b.created_at).getTime();
      return sort_order === "newest" ? tb - ta : ta - tb;
    });
    return result;
  }, [sessions, filter_text, locale, sort_order, status_filter]);

  // ── Render ──

  if (auth_loading || !user) {
    return (
      <div className="amp-page-state" role="status" aria-label={t("加载中", "Loading")}>
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (canvasId && !workspace_open) {
    return (
      <div className="amp-content-detail-loading" role="status">
        {session_loading ? t("正在加载创作...", "Loading creation...") : t("无法加载该创作", "Could not load this creation")}
      </div>
    );
  }

  if (!workspace_open) {
    return (
      <div className="amp-projects-layout">
        <ContentProjectSidebar projects={available_projects} selectedProjectId={selected_project_id} />
        <main className="amp-projects-main">
          <div className="amp-projects-header">
            <div>
              <h1 className="amp-module-title">{t("智能创作", "Content Studio")}</h1>
              <p>{selected_project_id
                ? t("查看当前项目中的创作。", "View creations in the selected project.")
                : t("汇总当前组织所有可访问项目中的创作。", "Creations across all accessible projects in this organization.")}</p>
            </div>
            <button type="button" className="amp-button amp-button-primary" onClick={open_new_creation}>
              {t("新建创作", "New creation")}
            </button>
          </div>

          <div className="amp-insight-toolbar">
            <div className="amp-projects-search">
              <RedesignInput
                leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
                value={filter_text}
                onChange={(event) => set_filter_text(event.target.value)}
                placeholder={t("搜索创作", "Search creations")}
                aria-label={t("搜索创作", "Search creations")}
              />
            </div>
            <EnterpriseSelect
              value={status_filter}
              options={[
                { value: "all", label: t("全部状态", "All statuses") },
                { value: "drafting", label: t("草稿", "Draft") },
                { value: "generating", label: t("生成中", "Generating") },
                { value: "completed", label: t("已完成", "Completed") },
                { value: "failed", label: t("失败", "Failed") },
              ]}
              onChange={set_status_filter}
              ariaLabel={t("创作状态", "Creation status")}
              className="w-36"
            />
            <EnterpriseSelect
              value={sort_order}
              options={[
                { value: "newest", label: t("最近更新", "Latest") },
                { value: "oldest", label: t("最早创建", "Oldest") },
                { value: "name", label: t("创作名称", "Creation name") },
              ]}
              onChange={set_sort_order}
              ariaLabel={t("创作排序", "Creation sorting")}
              className="w-40"
            />
          </div>

          {session_loading ? (
            <div className="amp-projects-state" role="status">{t("正在加载创作...", "Loading creations...")}</div>
          ) : filtered_sessions.length === 0 ? (
            <div className="amp-projects-state">
              <span className="amp-projects-empty-icon"><InlineIcon name="edit" /></span>
              <strong>{filter_text ? t("没有匹配的创作", "No matching creations") : t("暂无创作", "No creations yet")}</strong>
              <p>{t("点击“新建创作”，开始生成营销内容方案。", "Select “New creation” to start generating a marketing content plan.")}</p>
            </div>
          ) : (
            <div className="amp-content-canvas-grid">
              {filtered_sessions.map((item) => {
                const projectTitle = available_projects.find((project) => project.id === item.project_id)?.title
                  || t("未关联项目", "No project");
                const cardCount = item.cards?.length || 0;
                const statusLabel = item.status === "completed"
                  ? t("已完成", "Completed")
                  : item.status === "generating"
                    ? t("生成中", "Generating")
                    : item.status === "failed"
                      ? t("失败", "Failed")
                      : t("草稿", "Draft");
                const statusClass = item.status === "generating" ? "analyzing" : item.status;
                return (
                  <article key={item.id} className="amp-content-canvas-card">
                    <button
                      type="button"
                      className="amp-content-canvas-open"
                      onClick={() => router.push(`/content_generator/${encodeURIComponent(item.id)}`)}
                      aria-label={t("打开创作：{title}", "Open creation: {title}", { title: item.title || t("未命名创作", "Untitled creation") })}
                    >
                      <span className={`amp-content-canvas-preview ${
                        cardCount === 0 ? "amp-content-canvas-preview-empty" : ""
                      }`} aria-hidden="true">
                        {cardCount > 0
                          ? item.cards.slice(0, 5).map((card, index) => {
                              const cardMeta = CARD_META[card.card_type] || CARD_META.script;
                              return (
                                <span
                                  key={card.id}
                                  className="amp-content-canvas-preview-card"
                                  style={{ transform: `rotate(${(index - 2) * 2.5}deg)` }}
                                >
                                  <i style={{ backgroundColor: cardMeta.accentColor }} />
                                  <b style={{ color: cardMeta.textColor }}>{cardMeta.label}</b>
                                  <small>{card.title}</small>
                                </span>
                              );
                            })
                          : Array.from({ length: 5 }, (_, index) => (
                              <span
                                key={index}
                                className="amp-content-canvas-preview-card amp-content-canvas-preview-placeholder"
                                style={{ transform: `rotate(${(index - 2) * 2.5}deg)` }}
                              />
                            ))}
                        {cardCount === 0 && (
                          <em>{t("尚未生成内容卡片", "No content cards yet")}</em>
                        )}
                      </span>
                      <span className="amp-content-canvas-footer">
                        <strong title={item.title || t("未命名创作", "Untitled creation")}>{item.title || t("未命名创作", "Untitled creation")}</strong>
                        <span className="amp-content-canvas-meta">
                          <span title={projectTitle}>{projectTitle}</span>
                          <span className={`amp-insight-status amp-insight-status-${statusClass}`}>{statusLabel}</span>
                          <span className="amp-asset-creator">{item.creator_name || t("未知创建者", "Unknown creator")}</span>
                        </span>
                      </span>
                    </button>
                    <div ref={menu_session_id === item.id ? menu_ref : undefined} className="amp-content-canvas-menu">
                      <button
                        type="button"
                        className="amp-insight-card-more"
                        aria-label={t("{name} 创作操作", "Actions for {name}", { name: item.title || t("未命名创作", "Untitled creation") })}
                        aria-haspopup="menu"
                        aria-expanded={menu_session_id === item.id}
                        onClick={() => set_menu_session_id((current) => current === item.id ? null : item.id)}
                      >
                        <InlineIcon name="more" strokeWidth={3} />
                      </button>
                      {menu_session_id === item.id && (
                        <div role="menu" className="amp-insight-card-popover">
                          <button type="button" role="menuitem" disabled={!canManageCreation(user, item)}
                            onClick={() => open_rename_dialog(item)}>
                            <InlineIcon name="edit" />{t("重命名", "Rename")}
                          </button>
                          <button type="button" role="menuitem" className="amp-insight-card-delete"
                            disabled={!canManageCreation(user, item)} onClick={() => {
                            set_menu_session_id(null);
                            set_delete_target(item);
                          }}>
                            <InlineIcon name="trash" />{t("删除", "Delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>

        <dialog
          ref={project_dialog_ref}
          aria-labelledby="select-content-project-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        >
          <h2 id="select-content-project-title" className="text-xl font-semibold">{t("新建创作", "New creation")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("填写创作名称并选择所属项目。", "Name the creation and select its project.")}</p>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            {t("创作名称", "Creation name")}
            <input
              autoFocus
              value={new_creation_name}
              maxLength={80}
              onChange={(event) => set_new_creation_name(event.target.value)}
              placeholder={t("请输入创作名称", "Enter a creation name")}
              className="amp-workspace-control mt-2 w-full font-normal"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {t("所属项目", "Project")}
          <EnterpriseSelect
            value={new_project_id}
            options={available_projects.map((project) => ({ value: project.id, label: project.title }))}
            onChange={set_new_project_id}
            ariaLabel={t("选择所属项目", "Select project")}
            placeholder={available_projects.length ? t("请选择项目", "Choose a project") : t("暂无可用项目", "No projects available")}
            disabled={available_projects.length === 0}
            className="mt-2 w-full"
          />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" onClick={() => project_dialog_ref.current?.close()}>
              {t("取消", "Cancel")}
            </button>
            <button
              type="button"
              className="amp-button amp-button-primary"
              disabled={!new_project_id || !new_creation_name.trim()}
              onClick={() => {
                project_dialog_ref.current?.close();
                void start_new_creation();
              }}
            >
              {t("新建创作", "Create")}
            </button>
          </div>
        </dialog>

        <DeleteConfirmDialog
          open={Boolean(delete_target)}
          title={t("删除创作", "Delete creation")}
          message={t(
            "删除后将无法恢复“{title}”，确认删除吗？",
            "“{title}” cannot be recovered after deletion. Delete it?",
            { title: delete_target?.title || t("未命名创作", "Untitled creation") },
          )}
          cancelLabel={t("取消", "Cancel")}
          confirmLabel={t("删除", "Delete")}
          busyLabel={t("删除中...", "Deleting...")}
          onCancel={() => set_delete_target(null)}
          onConfirm={() => void confirm_delete_session()}
        />
        <dialog
          ref={rename_dialog_ref}
          aria-labelledby="rename-creation-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (renaming) event.preventDefault(); }}
          onClose={() => { if (!renaming) set_rename_target(null); }}
        >
          <h2 id="rename-creation-title" className="text-lg font-semibold">{t("重命名创作", "Rename creation")}</h2>
          <form className="mt-5" onSubmit={confirm_rename_session}>
            <label htmlFor="rename-creation-name" className="mb-2 block text-sm font-medium">{t("创作名称", "Creation name")}</label>
            <input id="rename-creation-name" autoFocus required maxLength={80}
              className="amp-workspace-control w-full" value={rename_name} disabled={renaming}
              onChange={(event) => set_rename_name(event.target.value)} />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={renaming}
                onClick={() => rename_dialog_ref.current?.close()}>{t("取消", "Cancel")}</button>
              <button type="submit" className="amp-button amp-button-primary" disabled={renaming || !rename_name.trim()}>
                {renaming ? t("保存中...", "Saving...") : t("保存", "Save")}
              </button>
            </div>
          </form>
        </dialog>
      </div>
    );
  }

  const is_generating = session?.status === "generating";
  const has_cards = (session?.cards?.length || 0) > 0;
  const activities = session?.activities || [];
  const latest_user_message_index = messages.reduce(
    (latest, message, index) => message.role === "user" ? index : latest,
    -1,
  );
  const selected_version = versions.find((version) => version.id === selected_version_id) || null;
  const latest_version = versions[versions.length - 1] || null;

  return (
    <div className="amp-projects-layout amp-content-full-canvas">
      <main className="amp-projects-main amp-content-editor-main">
      <div className="amp-content-studio-grid">
      {/* ── Left Panel ── */}
      <section className="amp-content-assistant-panel" aria-label={t("AI 创作助手", "AI creative assistant")}>
        <header className="amp-content-editor-header">
          <div>
            <button type="button" onClick={() => void close_workspace()}>
              <InlineIcon name="arrowLeft" />
              {t("返回创作列表", "Back to creation list")}
            </button>
            {session && <CreationPresence sessionId={session.id} />}
          </div>
        </header>
        <div className="amp-content-assistant-tabs" role="tablist" aria-label={t("创作助手功能", "Creative assistant features")}>
          {([
            ["ai", t("创作对话", "Creative chat")],
            ["context", t("上下文", "Context")],
            ["cards", t("版本记录", "Version history")],
            ["activity", t("活动", "Activity")],
          ] as const).map(([key, label], index, tabs) => (
            <button key={key} type="button" role="tab" aria-selected={assistant_tab === key}
              id={`assistant-tab-${key}`}
              aria-controls={`assistant-panel-${key}`}
              tabIndex={assistant_tab === key ? 0 : -1}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = tabs.length - 1;
                else return;
                event.preventDefault();
                const nextKey = tabs[nextIndex][0];
                set_assistant_tab(nextKey);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#assistant-tab-${nextKey}`)?.focus();
              }}
              onClick={() => set_assistant_tab(key)}>{label}</button>
          ))}
        </div>

        {/* Content */}
        <div className="amp-content-assistant-tab-panel" role="tabpanel"
          id={`assistant-panel-${assistant_tab}`} aria-labelledby={`assistant-tab-${assistant_tab}`}>
        {assistant_tab === "ai" ? (
          <>
            {/* Messages */}
            <div className="amp-content-assistant-messages space-y-4">
              {!session || messages.length === 0 ? (
                <div className="amp-content-assistant-empty">
                  <strong>{t("描述你想创作的内容", "Describe what you want to create")}</strong>
                  <div className="amp-content-assistant-prompts">
                    {[
                      { icon: "star" as const, label: t("产品卖点", "Product benefits"), prompt: t("请帮我梳理产品的核心卖点：", "Help me clarify the product's key benefits:") },
                      { icon: "user" as const, label: t("目标受众", "Target audience"), prompt: t("这次内容的目标受众是：", "The target audience for this content is:") },
                      { icon: "file" as const, label: t("平台与形式", "Platform and format"), prompt: t("我准备发布的平台和内容形式是：", "The platform and content format are:") },
                      { icon: "message" as const, label: t("品牌语气", "Brand tone"), prompt: t("希望内容呈现的品牌语气是：", "The desired brand tone is:") },
                    ].map(({ icon, label, prompt }) => (
                      <button key={label} type="button"
                        className={input === prompt ? "amp-content-assistant-prompt-active" : ""}
                        aria-pressed={input === prompt}
                        onClick={() => {
                        set_input(prompt);
                        window.requestAnimationFrame(() => {
                          prompt_input_ref.current?.focus();
                          prompt_input_ref.current?.setSelectionRange(prompt.length, prompt.length);
                        });
                      }}>
                        <InlineIcon name={icon} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`amp-content-message-group amp-content-message-group-${m.role}`}>
                        <div className={`amp-content-message amp-content-message-${m.role}`}>
                          {m.content}
                          {m.role === "user" && (m.references?.length || 0) > 0 && (
                            <div className="amp-content-message-references">
                              {m.references?.map((reference) => (
                                <span key={`${reference.kind}:${reference.id}`}
                                  data-reference-kind={reference.kind}>
                                  <InlineIcon name={reference.kind === "insight" ? "insight" : "case"} />
                                  {reference.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {m.role === "user" && i === latest_user_message_index && !sending && (
                          <div className="amp-content-message-actions">
                            <button type="button"
                              disabled={Boolean(reply_action) || is_generating || !can_manage_session}
                              aria-label={t("改写最新消息", "Edit latest message")}
                              title={t("改写最新消息", "Edit latest message")}
                              onClick={() => {
                                set_rewrite_message(m.content);
                                set_show_rewrite_modal(true);
                              }}>
                              <InlineIcon name="pen" />
                            </button>
                            <button type="button"
                              disabled={Boolean(reply_action) || is_generating || !can_manage_session}
                              aria-label={t("重新生成回复", "Regenerate reply")}
                              title={t("重新生成回复", "Regenerate reply")}
                              onClick={() => void handle_regenerate_reply()}>
                              <InlineIcon name="refresh"
                                className={reply_action === "regenerate" ? "animate-spin" : ""} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex justify-start">
                      <div className="amp-content-message amp-content-message-assistant">
                        <div className="flex gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={chat_end_ref} />
            </div>

            {/* Input area */}
            <div className="amp-content-assistant-composer">
              <div className="amp-content-prompt-row">
                <textarea
                  ref={prompt_input_ref}
                  value={input}
                  onChange={(e) => set_input(e.target.value)}
                  onKeyDown={handle_keydown}
                  placeholder={session ? t("描述你的产品、目标受众、风格偏好...", "Describe your product, target audience, and preferred style...") : t("点击输入框开始新对话...", "Start a new conversation here...")}
                  rows={2}
                  className="amp-content-prompt-input"
                  disabled={sending || is_generating || Boolean(session && !can_manage_session)}
                />
                <div className="amp-content-prompt-toolbar">
                <button type="button"
                  onClick={() => {
                    set_reference_panel_tab("insight");
                    set_show_ref_panel(true);
                  }}
                  disabled={sending || is_generating || Boolean(session && !can_manage_session)}
                  className="amp-content-preference-toggle relative shrink-0"
                  aria-label={t("引用洞察", "Reference insights")}
                  title={t("引用洞察", "Reference insights")}
                >
                  <InlineIcon name="insight" className="h-4 w-4" />
                  {insight_ids.length > 0 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-blue-50 px-1 text-[10px] text-blue-700">
                      {insight_ids.length}
                    </span>
                  )}
                </button>
                <button type="button"
                  onClick={() => {
                    set_reference_panel_tab("case");
                    set_show_ref_panel(true);
                  }}
                  disabled={sending || is_generating || Boolean(session && !can_manage_session)}
                  className="amp-content-preference-toggle relative shrink-0"
                  aria-label={t("引用案例", "Reference cases")}
                  title={t("引用案例", "Reference cases")}
                >
                  <InlineIcon name="case" className="h-4 w-4" />
                  {case_ids.length > 0 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-amber-50 px-1 text-[10px] text-amber-700">
                      {case_ids.length}
                    </span>
                  )}
                </button>
                <div className="shrink-0">
                  <button
                    onClick={() => set_show_chip_popover(!show_chip_popover)}
                    disabled={sending || is_generating || Boolean(session && !can_manage_session)}
                    className={`amp-content-preference-toggle relative${show_chip_popover || selected_chips.length > 0 ? " is-active" : ""}`}
                    aria-expanded={show_chip_popover}
                    title={t("选择偏好", "Choose preferences")}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                    {selected_chips.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-semibold flex items-center justify-center">
                        {selected_chips.length}
                      </span>
                    )}
                  </button>
                  {show_chip_popover && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => set_show_chip_popover(false)} />
                      <div className="absolute bottom-full left-0 mb-2 w-72 max-w-full max-h-80 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-4 z-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t("选择偏好", "Choose preferences")}</p>
                          {selected_chips.length > 0 && (
                            <button
                              onClick={() => set_selected_chips([])}
                              className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                            >
                              {t("清除全部", "Clear all")}
                            </button>
                          )}
                        </div>
                        {CHIP_CATEGORIES.map((cat) => (
                          <div key={cat.key} className="mb-3 last:mb-0">
                            <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 mb-1.5">{t(cat.label, cat.label_en)}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {cat.chips.map((chip) => {
                                const sel = selected_chips.includes(chip.key);
                                return (
                                  <button
                                    key={chip.key}
                                    onClick={() => toggle_chip(chip.key)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                      sel
                                        ? "bg-blue-500 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
                                    }`}
                                  >
                                    {t(chip.label, chip.label_en)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button type="button"
                  className="amp-content-chat-generate"
                  onClick={handle_generate}
                  disabled={!session || messages.length < 2 || sending || is_generating || !can_manage_session}
                  aria-busy={is_generating}
                >
                  <InlineIcon name="wand" />
                  {is_generating
                    ? t("生成中...", "Generating...")
                    : t("生成内容卡片", "Generate cards")}
                </button>
                {input.trim().length > 0 && (
                  <button
                    onClick={handle_send}
                    aria-label={t("发送消息", "Send message")}
                    disabled={sending || is_generating || Boolean(session && !can_manage_session)}
                    className="amp-content-send-button"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                )}
                </div>
              </div>
            </div>
          </>
        ) : assistant_tab === "context" ? (
          <CreationContextPanel page={context_page} onPageChange={set_context_page}
            insightIds={session?.insight_ids || []} caseIds={session?.case_ids || []} />
        ) : assistant_tab === "cards" ? (
          <div className="amp-content-side-panel amp-content-card-panel">
            {versions.length === 0 && (
              <div className="amp-content-version-empty">
                <strong>
                  {generation_status_error
                    ? t("无法加载版本记录", "Could not load version history")
                    : versions_loading
                      ? t("正在加载版本记录...", "Loading version history...")
                      : t("暂无版本记录", "No version history yet")}
                </strong>
                {!versions_loading && (
                  <p>{generation_status_error
                    ? t("请稍后重试。", "Please try again later.")
                    : t("生成内容卡片后，版本会自动记录在这里。", "Versions will appear here after content cards are generated.")}</p>
                )}
              </div>
            )}
            <CreationVersionHistory
              versions={versions}
              selectedVersion={selected_version}
              latestVersion={latest_version}
              locale={locale}
              restoring={restoring_version}
              canRestore={can_manage_session}
              onSelect={set_selected_version_id}
              onRestore={() => void handle_restore_selected_version()}
            />
          </div>
        ) : (
          <div className="amp-content-side-panel amp-content-activity">
            <strong>{t("{count} 条活动", "{count} activities", {
              count: messages.length + activities.length,
            })}</strong>
            <ol className={messages.length === 0 && activities.length === 0 ? "amp-content-activity-empty" : undefined}>
              {messages.length > 0 ? messages.map((message, index) => (
                <li key={index}>
                  <span>{message.role === "user" ? t("你：", "You:") : "AI："}</span>
                  <p>{message.content}</p>
                </li>
              )) : null}
              {activities.map((activity) => (
                <li key={activity.id}>
                  <span>AI：</span>
                  <p>{get_activity_text(activity, t, locale)}</p>
                </li>
              ))}
              {messages.length === 0 && activities.length === 0 && <li><p>{t("暂无活动记录", "No activity yet")}</p></li>}
            </ol>
          </div>
        )}
        </div>
      </section>

      {/* ── Right Panel ── */}
      {is_generating && !has_cards ? (
        <ContentGeneratorSkeleton />
      ) : has_cards ? (
        <ContentGeneratorCardWorkspace
          session={session}
          locale={locale}
          disabled={sending || is_generating || !can_manage_session}
          generating_document={generating_doc}
          active_card_index={active_card_index}
          flipped_ids={flipped_ids}
          on_active_card_change={set_active_card_index}
          on_generate_document={handle_generate_document}
          render_card={(card, card_is_active, flipped) => (
            <FlipCard3D
              card={card}
              is_active={card_is_active}
              flipped={flipped}
              on_flip={() => {
                if (card_is_active) toggle_flip(card.id);
              }}
            />
          )}
          render_detail={(card) => (
              <div className="px-4 py-4 lg:px-6 lg:py-5">
                <div className="mx-auto w-full max-w-5xl">
                  <SelectedPlanDetailPanel
                    card={card}
                    disabled={sending || is_generating || !can_manage_session}
                    on_modify={() => {
                      set_modify_target_index(active_card_index);
                      set_modify_input("");
                      set_show_modify_modal(true);
                    }}
                    on_copy={() => {
                      navigator.clipboard.writeText(card.content);
                      show_success({ zh: "已复制当前方案内容", en: "Selected plan copied" });
                    }}
                  />
                </div>
              </div>
          )}
        />
      ) : (
        <ContentGeneratorEmptyState />
      )}

      {/* Reference Panel */}
      <ReferencePanel
        open={show_ref_panel}
        initial_tab={reference_panel_tab}
        project_id={project_id}
        selected_insight_ids={insight_ids}
        selected_case_ids={case_ids}
        onConfirm={(iids, cids, ilabels, clabels) => {
          set_insight_ids(iids);
          set_case_ids(cids);
          if (reference_panel_tab === "insight") {
            set_insight_labels(ilabels);
          } else {
            set_case_labels(clabels);
          }
        }}
        onClose={() => set_show_ref_panel(false)}
      />

      {show_rewrite_modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog"
          aria-modal="true" aria-labelledby="rewrite-message-title">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => { if (!reply_action) set_show_rewrite_modal(false); }} />
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <h3 id="rewrite-message-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("改写最新消息", "Edit latest message")}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {t("修改用户消息后，将重新生成对应的 AI 回复。", "Update the user message, then regenerate its AI reply.")}
            </p>
            <textarea value={rewrite_message}
              onChange={(event) => set_rewrite_message(event.target.value)}
              rows={4} autoFocus disabled={Boolean(reply_action)}
              aria-label={t("编辑最新消息", "Edit latest message")}
              className="mt-4 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100" />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={Boolean(reply_action)}
                onClick={() => set_show_rewrite_modal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800">
                {t("取消", "Cancel")}
              </button>
              <button type="button"
                disabled={Boolean(reply_action) || !rewrite_message.trim()}
                onClick={() => void handle_rewrite_reply()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                {reply_action === "rewrite" ? t("生成中...", "Generating...") : t("保存并重新生成", "Save and regenerate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Modify Modal */}
      {show_modify_modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4">{t("AI 修改卡片", "Edit card with AI")}</h3>

            {/* Card selector */}
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("选择要修改的卡片", "Choose a card to edit")}</label>
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {(session?.cards || []).map((card, i) => {
                const meta = CARD_META[card.card_type] || CARD_META.script;
                return (
                  <button
                    key={card.id}
                    onClick={() => set_modify_target_index(i)}
                    className={`border p-2 rounded-xl text-center transition-all cursor-pointer ${
                      i === modify_target_index
                        ? "border-blue-500"
                        : "border-transparent bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                    style={i === modify_target_index
                      ? { backgroundColor: meta.tintColor, color: meta.textColor }
                      : undefined}
                  >
                    <div className="flex justify-center mb-1">{get_card_icon(card, meta.icon)}</div>
                    <span className="text-[10px] font-medium block truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Instruction input */}
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("修改要求", "Editing instructions")}</label>
            <input
              value={modify_input}
              onChange={(e) => set_modify_input(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handle_modify_card(); }}
              placeholder={t("如：缩短到100字、语气更活泼、增加emoji...", "For example: shorten to 100 characters, use a livelier tone, add emoji...")}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-blue-500 mb-4"
              autoFocus
            />

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  if (modifying) {
                    modify_abort_ref.current?.abort();
                    show_warning({ zh: "用户中止操作", en: "Operation cancelled" });
                  } else {
                    set_show_modify_modal(false);
                  }
                }}
                className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  modifying
                    ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/70"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {modifying ? t("中止", "Stop") : t("取消", "Cancel")}
              </button>
              <button
                onClick={handle_modify_card}
                disabled={modifying || !modify_input.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {modifying ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("修改中...", "Updating...")}
                  </>
                ) : (
                  t("确认修改", "Confirm changes")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </main>
    </div>
  );
}
