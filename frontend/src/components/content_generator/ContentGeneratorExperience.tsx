"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkImageReferencePicker from "./WorkImageReferencePicker";
import InlineMessageComposer, { type InlineComposerHandle, type ComposerToken } from "./InlineMessageComposer";
import InlineMessageContent from "./InlineMessageContent";
import AgentConversation from "./AgentConversation";
import CreationDraftPreview from "./CreationDraftPreview";
import type { AgentJob, AgentProgress, ChatMessage, CreationActivity, SessionRecord, ImageReference } from "@/types/content_generator";
import {
  create_session, fetch_sessions, fetch_session, restore_work_version,
  send_chat_message, regenerate_latest_reply, rewrite_latest_reply,
  cancel_agent_job, AgentTaskCancelledError,
  delete_session, rename_session,
  save_creation_work,
  fetch_content_projects,
} from "@/services/api_client";
import { agentStateObserver } from "@/services/agent_state_observer";
import type { ContentProject } from "@/types/publishing";

import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";
import { GuardedButton, GuardedInput, GuardedTextarea } from "@/components/redesign/GuardedControls";
import type { Translate } from "@/i18n/locale";
import ReferencePanel, { type RefLabel } from "@/components/content_generator/ReferencePanel";
import MaterialReferencePicker from "@/components/content_generator/MaterialReferencePicker";
import { MAX_MATERIAL_REFERENCES } from "@/utils/material_references";
import ContentGeneratorEmptyState from "@/components/content_generator/ContentGeneratorEmptyState";
import CreationPresence from "@/components/content_generator/CreationPresence";
import CreationContextPanel, { type CreationContextPage } from "@/components/content_generator/CreationContextPanel";
import ContentGeneratorSkeleton from "@/components/content_generator/ContentGeneratorSkeleton";
import AgentDeliverableWorkspace from "@/components/content_generator/AgentDeliverableWorkspace";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import Pagination from "@/components/redesign/Pagination";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import RedesignInput from "@/components/redesign/RedesignInput";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import ContentProjectSidebar from "@/components/content_generator/ContentProjectSidebar";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import { canManageCreation } from "@/utils/creation_permissions";
import {
  ACTIVE_SESSION_STORAGE_KEY,
  type Feedback,
} from "@/components/content_generator/contentGeneratorHelpers";

function sessionTimestamp(value: string): number {
  const timestamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid creation timestamp");
  return timestamp;
}

const get_activity_text = (activity: CreationActivity, t: Translate) => {
  if (activity.activity_type === "agent_explored") {
    return t("Agent 已继续探索创作方向", "Agent explored the creative direction");
  }
  if (activity.activity_type === "deliverable_created") {
    return t("Agent 已生成“{title}”", "Agent created “{title}”", {
      title: activity.work_title,
    });
  }
  return t("已开始生成作品", "Started generating a work");
};

// ── Main Page ──

export function ContentGeneratorExperience({ canvasId = "" }: { canvasId?: string }) {
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();

  const { user, loading: auth_loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sessions, set_sessions] = useState<SessionRecord[]>([]);
  const [session, set_session] = useState<SessionRecord | null>(null);
  const [messages, set_messages] = useState<ChatMessage[]>([]);
  const [input, set_input] = useState("");
  const [agent_mode, set_agent_mode] = useState<"auto" | "explore" | "create">("auto");
  const [show_agent_mode_menu, set_show_agent_mode_menu] = useState(false);
  const [sending, set_sending] = useState(false);
  const [reply_action, set_reply_action] = useState<"rewrite" | "regenerate" | null>(null);
  const [resuming_job, set_resuming_job] = useState<AgentJob | null>(null);
  const [cancelling_job, set_cancelling_job] = useState(false);
  const [reply_failed, set_reply_failed] = useState(false);
  const [agent_progress, set_agent_progress] = useState<AgentProgress>({
    revision: 0,
    steps: [],
    messages: {},
    events: [],
    active_stage: "",
    running: false,
    failed: false,
  });
  const [editing_message, set_editing_message] = useState(false);
  const [message_edit_size, set_message_edit_size] = useState<{ width: number; height: number } | null>(null);
  const message_edit_ref = useRef<HTMLDivElement>(null);
  const message_edit_input_ref = useRef<HTMLTextAreaElement>(null);
  const [rewrite_message, set_rewrite_message] = useState("");
  useLayoutEffect(() => {
    const editor = message_edit_input_ref.current;
    if (!editing_message || !editor) return;
    const borderHeight = editor.offsetHeight - editor.clientHeight;
    editor.style.height = "0px";
    editor.style.height = `${Math.max(message_edit_size?.height || 0, editor.scrollHeight + borderHeight)}px`;
  }, [editing_message, rewrite_message, message_edit_size]);
  useEffect(() => {
    if (!editing_message || reply_action) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !message_edit_ref.current?.contains(event.target)) {
        set_editing_message(false);
        set_rewrite_message("");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [editing_message, reply_action]);
  const [error, set_error] = useState<Feedback | null>(null);
  const [filter_text, set_filter_text] = useState("");
  const [sort_order, set_sort_order] = useState<"newest" | "oldest" | "name">("newest");
  const [status_filter, set_status_filter] = useState<"all" | SessionRecord["status"]>("all");
  const [type_filter, set_type_filter] = useState<"all" | "image" | "video">("all");
  const [workspace_open, set_workspace_open] = useState(false);
  const [assistant_tab, set_assistant_tab] = useState<"ai" | "context" | "deliverables" | "activity">("ai");
  const [context_page, set_context_page] = useState<CreationContextPage>("insights");
  const [menu_session_id, set_menu_session_id] = useState<string | null>(null);
  const [session_loading, set_session_loading] = useState(true);
  const [insight_ids, set_insight_ids] = useState<string[]>([]);
  const [case_ids, set_case_ids] = useState<string[]>([]);
  const [insight_labels, set_insight_labels] = useState<RefLabel[]>([]);
  const [case_labels, set_case_labels] = useState<RefLabel[]>([]);
  const [material_ids, set_material_ids] = useState<string[]>([]);
  const [material_labels, set_material_labels] = useState<RefLabel[]>([]);
  const [show_material_picker, set_show_material_picker] = useState(false);
  const [show_ref_panel, set_show_ref_panel] = useState(false);
  const [reference_panel_tab, set_reference_panel_tab] = useState<"insight" | "case">("insight");

  const [saving_work, set_saving_work] = useState(false);

  const [image_reference, set_image_reference] = useState<ImageReference | null>(null);
  const [preview_work_id, set_preview_work_id] = useState<string | null>(null);
  const [restoring_work, set_restoring_work] = useState(false);

  const [delete_target, set_delete_target] = useState<SessionRecord | null>(null);
  const [rename_target, set_rename_target] = useState<SessionRecord | null>(null);
  const [rename_name, set_rename_name] = useState("");
  const [renaming, set_renaming] = useState(false);
  const [project_id, set_project_id] = useState(() => searchParams.get("project") || "");
  const [new_project_id, set_new_project_id] = useState("");
  const [new_creation_name, set_new_creation_name] = useState("");
  const [new_creation_kind, set_new_creation_kind] = useState<"image" | "video" | "">("");
  const [available_projects, set_available_projects] = useState<ContentProject[]>([]);
  const selected_project_id = searchParams.get("project") || "";

  const chat_messages_ref = useRef<HTMLDivElement>(null);
  const follow_latest_ref = useRef(true);
  const chat_scroll_top_ref = useRef(0);
  const last_chat_root_ref = useRef<HTMLDivElement | null>(null);

  const prompt_input_ref = useRef<InlineComposerHandle>(null);

  const operation_epoch_ref = useRef(0);
  const operation_abort_ref = useRef(new AbortController());
  const operation_session_ref = useRef<string | undefined>(undefined);
  const current_session_ref = useRef(session);
  useLayoutEffect(() => { current_session_ref.current = session; }, [session]);
  useLayoutEffect(() => {
    if (operation_session_ref.current && operation_session_ref.current !== session?.id) {
      operation_epoch_ref.current++;
      operation_abort_ref.current.abort();
      operation_abort_ref.current = new AbortController();
    }
    operation_session_ref.current = session?.id;
  }, [session?.id]);
  useLayoutEffect(() => {
    if (operation_abort_ref.current.signal.aborted) operation_abort_ref.current = new AbortController();
    return () => {
      operation_epoch_ref.current++;
      operation_abort_ref.current.abort();
    };
  }, []);
  const local_busy_ref = useRef(false);
  useLayoutEffect(() => { local_busy_ref.current = sending || Boolean(reply_action); }, [sending, reply_action]);
  const project_dialog_ref = useRef<HTMLDialogElement>(null);
  const rename_dialog_ref = useRef<HTMLDialogElement>(null);
  const menu_ref = useRef<HTMLDivElement>(null);
  const can_manage_session = session ? canManageCreation(user, session) : false;
  const session_has_output = Boolean(
    session?.deliverables?.length,
  );
  const permissionReason = t("仅创建者、项目所有者或项目管理员可修改此创作", "Only the creator, project owner or project administrator can modify this creation.");
  const operationReason = session && !can_manage_session
    ? permissionReason
    : session?.status === "generating"
      ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.")
      : t("正在处理中，请稍候。", "Please wait for the current operation to finish.");
  const replyReason = reply_action
    ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.")
    : operationReason;

  useEffect(() => {
    set_resuming_job(null);
    set_agent_progress({ revision: 0, steps: [], messages: {}, events: [], active_stage: "", running: false, failed: false });
    if (!session?.id) return;
    const sessionId = session.id;
    const abort = new AbortController();
    let stopped = false;
    let reported = false;
    let observedJob = "";
    let terminalHandled = "";
    let refreshing = false;
    const unsubscribe = agentStateObserver.subscribe(sessionId, {
      onState: ({ job, progress }) => {
        const current = current_session_ref.current;
        if (stopped || current?.id !== sessionId) return;
        reported = false;
        const active = job && ["queued", "running", "cancelling"].includes(job.status);
        if (active) {
          observedJob = job.id;
          terminalHandled = "";
          set_agent_progress(progress);
          if (!local_busy_ref.current && can_manage_session) {
            set_resuming_job(job);
            const submitted = job.submitted_message;
            if (submitted && !current.messages.some(message => message.client_message_id === submitted.client_message_id)) {
              set_messages([...current.messages, submitted]);
            }
          }
          return;
        }
        set_resuming_job(null);
        // Local submit/rewrite waiters own their completion and optimistic message reconciliation.
        if (local_busy_ref.current) {
          if (job?.id === observedJob) set_agent_progress(progress);
          return;
        }
        const completedAt = progress.completed_session_updated_at;
        const updated = job?.result?.data?.session;
        const newer = updated && updated.id === sessionId
          && sessionTimestamp(updated.updated_at) > sessionTimestamp(current.updated_at);
        const refreshNeeded = completedAt
          && sessionTimestamp(completedAt) > sessionTimestamp(current.updated_at);
        const terminalKey = job ? `${job.id}:${job.status}` : "";
        if (job && terminalKey !== terminalHandled && (observedJob === job.id || newer || refreshNeeded)) {
          terminalHandled = terminalKey;
          set_agent_progress(progress);
          set_reply_failed(progress.failed);
          if (job.status === "cancelled") showWarning(t("任务已取消", "Task cancelled"));
          else if (progress.failed) showError(job.error || t("任务未完成", "Agent task failed"));
        }
        if (newer) {
          current_session_ref.current = updated;
          set_session(updated);
          set_messages(updated.messages);
          set_preview_work_id(null);
          set_reply_failed(false);
        } else if (refreshNeeded && !refreshing) {
          refreshing = true;
          void fetch_session(sessionId, abort.signal).then(refreshed => {
            const latest = current_session_ref.current;
            if (!stopped && refreshed.success && latest?.id === sessionId
              && sessionTimestamp(refreshed.data.updated_at) > sessionTimestamp(latest.updated_at)) {
              current_session_ref.current = refreshed.data;
              set_session(refreshed.data);
              set_messages(refreshed.data.messages);
            }
          }).catch(failure => {
            if (!stopped) showError(failure instanceof Error ? failure.message : t("无法读取任务状态", "Could not load Agent task"));
          }).finally(() => { refreshing = false; });
        }
      },
      onError: failure => {
        if (stopped) return;
        set_agent_progress(current => ({ ...current, failed: true }));
        if (!reported) {
          reported = true;
          showError(failure.message);
        }
      },
    });
    return () => {
      stopped = true;
      abort.abort();
      unsubscribe();
    };
  }, [session?.id, can_manage_session, showError, showWarning, t]);

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
    set_material_ids([]);
    set_material_labels([]);
    set_show_material_picker(false);
  }, [canvasId, selected_project_id]);

  useEffect(() => {
    set_material_ids([]);
    set_material_labels([]);
    set_show_material_picker(false);
  }, [project_id, user?.id, user?.current_organization?.id]);

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

  useLayoutEffect(() => {
    const root = chat_messages_ref.current;
    if (!root) {
      last_chat_root_ref.current = null;
      return;
    }
    if (follow_latest_ref.current) {
      root.scrollTop = root.scrollHeight;
    } else if (last_chat_root_ref.current !== root) {
      root.scrollTop = chat_scroll_top_ref.current;
    }
    chat_scroll_top_ref.current = root.scrollTop;
    last_chat_root_ref.current = root;
  }, [messages, agent_progress, assistant_tab]);

  const localize_feedback = useCallback((message: Feedback) => (
    typeof message === "string" ? message : t(message.zh, message.en, message.values)
  ), [t]);

  const show_success = useCallback((message: Feedback) => {
    showSuccess(localize_feedback(message));
  }, [localize_feedback, showSuccess]);

  const show_failure = useCallback((message: Feedback) => {
    showError(localize_feedback(message));
  }, [localize_feedback, showError]);

  // ── Session management ──

  const handle_save_work = useCallback(async () => {
    if (!session || saving_work || !can_manage_session || sending || session.status === "generating" || !session_has_output) {
      showWarning(!session ? t("请先创建或打开一个创作", "Create or open a creation first.")
        : saving_work ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.")
          : !can_manage_session || sending || session.status === "generating" ? operationReason
            : t("请先让 Agent 生成创作成果", "Ask the Agent to create a deliverable first."));
      return;
    }
    set_saving_work(true);
    try {
      const res = await save_creation_work(session.id);
      if (res.success) {
        show_success({ zh: "作品已保存到作品集", en: "Work saved to Portfolio" });
      } else {
        show_failure({ zh: "作品保存失败", en: "Could not save the work" });
      }
    } catch (failure) {
      show_failure(failure instanceof Error ? failure.message : { zh: "作品保存失败", en: "Could not save the work" });
    } finally {
      set_saving_work(false);
    }
  }, [can_manage_session, session, saving_work, sending, session_has_output, operationReason, showWarning, t, show_failure, show_success]);

  // ── Reset: clear everything ──

  const handle_reset = useCallback(async () => {
    follow_latest_ref.current = true;
    chat_scroll_top_ref.current = 0;
    operation_epoch_ref.current += 1;
    operation_abort_ref.current.abort();
    operation_abort_ref.current = new AbortController();
    set_sending(false);
    set_resuming_job(null);

    set_session(null);
    set_messages([]);
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    set_input("");
    set_error(null);
    set_insight_ids([]);
    set_case_ids([]);
    set_insight_labels([]);
    set_case_labels([]);
    set_material_ids([]);
    set_material_labels([]);
    set_show_material_picker(false);
    set_image_reference(null);
    set_preview_work_id(null);

    set_reply_action(null);
    set_reply_failed(false);
    set_editing_message(false);
    set_rewrite_message("");
  }, []);

  const open_new_creation = useCallback(() => {
    set_new_project_id(project_id || available_projects[0]?.id || "");
    set_new_creation_name("");
    set_new_creation_kind("");
    project_dialog_ref.current?.showModal();
  }, [available_projects, project_id]);

  const start_new_creation = useCallback(async () => {
    const target_project_id = new_project_id;
    const title = new_creation_name.trim();
    if (!new_creation_kind) {
      showWarning(t("请选择创作类型", "Select a creation type."));
      return;
    }
    if (!target_project_id || !title) {
      showWarning(!target_project_id ? t("请选择所属项目", "Select a project first.") : t("请输入创作名称", "Enter a creation name."));
      return;
    }
    await handle_reset();
    try {
      const response = await create_session(target_project_id, title, new_creation_kind);
      if (!response.success || !response.data) {
        throw new Error(response.message || "Could not create creation");
      }
      showSuccess(t("创作已创建", "Creation created"));
      router.push(`/content_generator/${encodeURIComponent(response.data.id)}`);
    } catch (createError) {
      set_error(createError instanceof Error ? createError.message : { zh: "新建创作失败", en: "Could not create creation" });
    }
  }, [handle_reset, new_creation_kind, new_creation_name, new_project_id, router, showSuccess, showWarning, t]);

  const close_workspace = useCallback(async () => {
    const target_project_id = project_id;
    await handle_reset();
    set_workspace_open(false);
    router.push(target_project_id
      ? `/content_generator?project=${encodeURIComponent(target_project_id)}`
      : "/content_generator");
  }, [handle_reset, project_id, router]);

  const load_session = useCallback(async (id: string) => {
    const epoch = ++operation_epoch_ref.current;
    operation_abort_ref.current.abort();
    operation_abort_ref.current = new AbortController();
    set_resuming_job(null);
    try {

      set_error(null);
      const res = await fetch_session(id);
      if (epoch !== operation_epoch_ref.current) return;
      if (res.success && res.data) {
        if (current_session_ref.current?.id !== id) {
          follow_latest_ref.current = true;
          chat_scroll_top_ref.current = 0;
        }
        set_workspace_open(true);
        set_project_id(res.data.project_id);
        set_session(res.data);
        set_resuming_job(res.data.agent_job || null);
        window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, res.data.id);
        set_messages(res.data.messages || []);
        const submitted = res.data.agent_job?.submitted_message;
        if (submitted && !res.data.messages.some((message) => message.client_message_id === submitted.client_message_id)) {
          set_messages([...res.data.messages, submitted]);
        }
        set_insight_ids([]);
        set_case_ids([]);
        set_insight_labels([]);
        set_case_labels([]);
        set_material_ids([]);
        set_material_labels([]);
        set_show_material_picker(false);
        set_image_reference(null);
        set_preview_work_id(null);

        set_sending(false);
        set_reply_action(null);
        set_reply_failed(false);
        set_editing_message(false);
        set_rewrite_message("");
        // Historical sessions may end with a user message if a previous AI request failed.
        // Load them as editable conversations instead of polling forever.
        const msgs = res.data.messages || [];
        if (!res.data.agent_job && msgs.length > 0 && msgs[msgs.length - 1].role === "user") {
          set_error({ zh: "上一次 AI 回复未完成，可以继续输入补充信息或重新发送。", en: "The previous AI response was not completed. Add more information or send your message again." });
        }
      }
    } catch {
      if (epoch !== operation_epoch_ref.current) return;
      set_error({ zh: "加载会话失败", en: "Could not load the conversation" });
    }
  }, []);

  useEffect(() => {
    if (!user || !canvasId) return;
    set_session_loading(true);
    void load_session(canvasId).finally(() => set_session_loading(false));
  }, [canvasId, load_session, user]);

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
    if (!rename_target || renaming) {
      showWarning(renaming ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : t("请先选择要重命名的创作", "Select a creation to rename first."));
      return;
    }
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

  const handle_send = useCallback(async () => {
    const draft = prompt_input_ref.current?.read();
    const text = draft?.text ?? input;
    const reference_positions = draft?.positions || [];
    if (sending || reply_action || resuming_job || restoring_work || session?.status === "generating" || (session && !can_manage_session)) {
      showWarning(reply_action ? replyReason : operationReason);
      return;
    }
    if (!text.trim()) { showWarning(t("请输入消息内容", "Enter a message first.")); return; }
    follow_latest_ref.current = true;
    const epoch = operation_epoch_ref.current;
    const draft_insight_ids = [...insight_ids];
    const draft_case_ids = [...case_ids];
    const draft_material_ids = [...material_ids];
    const draft_preferences: string[] = [];
    const draft_image_reference = image_reference || undefined;
    const draft_references = [
      ...insight_labels.map((item) => ({ id: item.id, kind: "insight" as const, title: item.label })),
      ...case_labels.map((item) => ({ id: item.id, kind: "case" as const, title: item.label })),
      ...material_labels.map((item) => ({ id: item.id, kind: "material" as const, title: item.label })),
    ];
    const client_message_id = crypto.randomUUID();
    const apply_accepted_session = (accepted: SessionRecord) => {
      if (epoch !== operation_epoch_ref.current) return;
      set_reply_failed(false);
      set_messages(accepted.messages || []);
      set_session(accepted);
      set_sessions((previous) => previous.map((item) => item.id === accepted.id ? accepted : item));
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, accepted.id);
      set_insight_ids((current) => JSON.stringify(current) === JSON.stringify(draft_insight_ids) ? [] : current);
      set_case_ids((current) => JSON.stringify(current) === JSON.stringify(draft_case_ids) ? [] : current);
      set_material_ids((current) => JSON.stringify(current) === JSON.stringify(draft_material_ids) ? [] : current);
      set_insight_labels((current) => JSON.stringify(current) === JSON.stringify(insight_labels) ? [] : current);
      set_case_labels((current) => JSON.stringify(current) === JSON.stringify(case_labels) ? [] : current);
      set_material_labels((current) => JSON.stringify(current) === JSON.stringify(material_labels) ? [] : current);
      set_image_reference(null);
      set_preview_work_id(null);
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
        if (!project_id || !new_creation_kind) {
          open_new_creation();
          return;
        }
        set_sending(true);
        const res = await create_session(project_id, t("未命名创作", "Untitled creation"), new_creation_kind);
        if (epoch !== operation_epoch_ref.current) return;
        if (!res.success || !res.data) throw new Error(res.message || "Could not create creation");
        if (res.success && res.data) {
          const s = res.data;
          created_session_id = s.id;
          set_session(s);
          window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, s.id);
          set_sessions((prev) => [s, ...prev]);
          set_input("");
          set_error(null);
          set_sending(true);
          set_messages([{ role: "user", content: text, client_message_id, references: draft_references, image_reference: draft_image_reference, reference_positions }]);

          const chat_res = await send_chat_message(
            s.id, text, draft_insight_ids, draft_case_ids, draft_preferences, client_message_id,
            draft_material_ids, agent_mode, draft_image_reference, reference_positions,
            operation_abort_ref.current.signal,
          );
          if (chat_res.success && chat_res.data) {
            apply_accepted_session(chat_res.data.session);
          } else throw new Error(chat_res.message || "Could not send message");
        }
      } catch (error) {
        if (epoch !== operation_epoch_ref.current) return;
        const accepted = created_session_id
          ? await recover_accepted_session(created_session_id).catch(() => false) : false;
        if (epoch !== operation_epoch_ref.current) return;
        if (!accepted) {
          set_messages([]);
          set_input(text);
        }
        if (error instanceof AgentTaskCancelledError) showWarning(t("任务已取消", "Task cancelled"));
        else set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
      } finally {
        if (epoch === operation_epoch_ref.current) set_sending(false);
      }
      return;
    }

    set_input("");
    set_error(null);
    set_sending(true);

    const optimistic: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, client_message_id, references: draft_references, image_reference: draft_image_reference, reference_positions },
    ];
    set_messages(optimistic);

    try {
      const res = await send_chat_message(
        session.id, text, draft_insight_ids, draft_case_ids, draft_preferences, client_message_id,
        draft_material_ids, agent_mode, draft_image_reference, reference_positions,
        operation_abort_ref.current.signal,
      );
      if (res.success && res.data) {
        apply_accepted_session(res.data.session);
      } else throw new Error(res.message || "Could not send message");
    } catch (error) {
      if (epoch !== operation_epoch_ref.current) return;
      const accepted = await recover_accepted_session(session.id).catch(() => false);
      if (epoch !== operation_epoch_ref.current) return;
      if (!accepted) {
        set_messages(messages);
        set_input(text);
      }
      if (error instanceof AgentTaskCancelledError) showWarning(t("任务已取消", "Task cancelled"));
      else set_error(error instanceof Error ? error.message : { zh: "发送失败，请重试", en: "Could not send. Please try again." });
    } finally {
      if (epoch === operation_epoch_ref.current) set_sending(false);
    }
  }, [
    agent_mode,
    input, sending, reply_action, resuming_job, session, can_manage_session, messages, insight_ids, case_ids, image_reference,
    insight_labels, case_labels, material_ids, material_labels, project_id, t, showWarning, operationReason,
    replyReason,
    new_creation_kind, open_new_creation, restoring_work,
  ]);

  const handle_keydown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handle_send();
    }
  }, [handle_send]);

  const handle_copy_message = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      show_success({ zh: "已复制消息", en: "Message copied" });
    } catch {
      show_failure({ zh: "复制失败，请重试。", en: "Copy failed. Please try again." });
    }
  }, [show_success, show_failure]);

  const apply_replaced_reply = useCallback((updated: SessionRecord) => {
    set_reply_failed(false);
    set_session(updated);
    set_messages(updated.messages || []);
    set_preview_work_id(null);
    set_image_reference(null);
    set_sessions((current) => current.map((item) => (
      item.id === updated.id ? updated : item
    )));
  }, []);

  const handle_restore_work = async (versionId: string) => {
    const latest = session?.deliverables?.at(-1);
    if (!session || !latest || sending || reply_action || restoring_work || !can_manage_session) {
      showWarning(operationReason);
      return;
    }
    set_restoring_work(true);
    try {
      const response = await restore_work_version(session.id, versionId, latest.id);
      if (!response.success) throw new Error(response.message);
      apply_replaced_reply(response.data);
      showSuccess(t("已恢复为新版本", "Restored as a new version"));
    } catch (failure) {
      showError(failure instanceof Error ? failure.message : t("版本恢复失败", "Could not restore version"));
    } finally {
      set_restoring_work(false);
    }
  };

  const handle_regenerate_reply = useCallback(async () => {
    if (!session || reply_action || resuming_job || !can_manage_session || session.status === "generating") {
      showWarning(!session ? t("请先打开一个创作", "Open a creation first.") : replyReason);
      return;
    }
    const epoch = operation_epoch_ref.current;
    follow_latest_ref.current = true;
    set_reply_action("regenerate");
    try {
      const response = await regenerate_latest_reply(session.id, agent_mode, operation_abort_ref.current.signal);
      if (epoch !== operation_epoch_ref.current) return;
      if (!response.success || !response.data?.session) {
        throw new Error(response.message || "Could not regenerate reply");
      }
      apply_replaced_reply(response.data.session);
      show_success({ zh: "已重新生成回复", en: "Reply regenerated" });
    } catch (failure) {
      if (epoch !== operation_epoch_ref.current) return;
      if (failure instanceof AgentTaskCancelledError) {
        showWarning(t("任务已取消，原回复已保留", "Task cancelled. The original reply was kept."));
      } else {
        set_reply_failed(true);
        show_failure({ zh: "重新生成失败，原回复已保留", en: "Could not regenerate. The original reply was kept." });
      }
    } finally {
      if (epoch === operation_epoch_ref.current) set_reply_action(null);
    }
  }, [agent_mode, apply_replaced_reply, can_manage_session, reply_action, resuming_job, session, replyReason, showWarning, t, show_failure, show_success]);

  const handle_rewrite_reply = useCallback(async () => {
    const message = rewrite_message.trim();
    if (!session || !message || reply_action || resuming_job || !can_manage_session || session.status === "generating") {
      showWarning(!session ? t("请先打开一个创作", "Open a creation first.")
        : reply_action || !can_manage_session || session.status === "generating" ? replyReason
          : t("请输入改写后的消息", "Enter the updated message."));
      return;
    }
    const epoch = operation_epoch_ref.current;
    follow_latest_ref.current = true;
    set_reply_action("rewrite");
    try {
      const response = await rewrite_latest_reply(session.id, message, agent_mode, operation_abort_ref.current.signal);
      if (epoch !== operation_epoch_ref.current) return;
      if (!response.success || !response.data?.session) {
        throw new Error(response.message || "Could not rewrite reply");
      }
      apply_replaced_reply(response.data.session);
      set_editing_message(false);
      set_rewrite_message("");
      show_success({ zh: "消息已修改，回复已重新生成", en: "Message updated and reply regenerated" });
    } catch (failure) {
      if (epoch !== operation_epoch_ref.current) return;
      if (failure instanceof AgentTaskCancelledError) {
        showWarning(t("任务已取消，原对话已保留", "Task cancelled. The original conversation was kept."));
      } else {
        set_reply_failed(true);
        show_failure({ zh: "修改失败，原对话已保留", en: "Could not update the message. The original conversation was kept." });
      }
    } finally {
      if (epoch === operation_epoch_ref.current) set_reply_action(null);
    }
  }, [
    apply_replaced_reply,
    agent_mode,
    can_manage_session,
    reply_action,
    resuming_job,
    rewrite_message,
    session,
    show_failure,
    show_success,
    replyReason,
    showWarning,
    t,
  ]);

  // ── Filtered sessions ──

  const filtered_sessions = useMemo(() => {
    let result = [...sessions];
    if (type_filter !== "all") {
      result = result.filter((item) => (item.creation_kind || "image") === type_filter);
    }
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
  }, [sessions, filter_text, locale, sort_order, status_filter, type_filter]);
  const paginationResetKey = JSON.stringify([filter_text, status_filter, type_filter, sort_order, selected_project_id]);
  const pagination = usePagination(filtered_sessions, paginationResetKey, 12);
  const has_active_filters = Boolean(filter_text.trim()) || status_filter !== "all" || type_filter !== "all";

  useEffect(() => {
    set_menu_session_id(null);
  }, [pagination.page, pagination.pageSize, paginationResetKey]);

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
        {session_loading ? t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading) : t("无法加载该创作", "Could not load this creation")}
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
              {t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
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
              value={type_filter}
              options={[
                { value: "all", label: t("全部类型", "All types") },
                { value: "image", label: t("图文创作", "Image and copy") },
                { value: "video", label: t("视频创作", "Video creation") },
              ]}
              onChange={set_type_filter}
              ariaLabel={t("类型", "Type")}
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
            <div className="amp-projects-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
          ) : filtered_sessions.length === 0 ? (
            <div className="amp-projects-state">
              <span className="amp-projects-empty-icon"><InlineIcon name="edit" /></span>
              <strong>{has_active_filters ? t("没有匹配的创作", "No matching creations") : t("暂无创作", "No creations yet")}</strong>
              <p>{has_active_filters ? t("请调整搜索关键词或筛选条件。", "Adjust your search or filters.")
                : t("点击“新建创作”，开始生成营销内容方案。", "Select Create to start a marketing content plan.")}</p>
            </div>
          ) : (
            <>
            <div className="amp-content-canvas-grid">
              {pagination.pageItems.map((item) => {
                const projectTitle = available_projects.find((project) => project.id === item.project_id)?.title
                  || t("未关联项目", "No project");

                const latestDeliverable = item.deliverables?.at(-1);
                const hasOutput = Boolean(latestDeliverable);
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
                        !hasOutput ? "amp-content-canvas-preview-empty" : ""
                      }${latestDeliverable ? " amp-content-canvas-preview-agent" : ""}`} aria-hidden="true">
                        <span className="amp-case-type-overlay">{item.creation_kind === "video"
                          ? t("视频", "Video") : t("图文", "Image post")}</span>
                        {latestDeliverable ? (
                          <span className="amp-agent-canvas-preview"
                            style={{ backgroundImage: `url("${latestDeliverable.image_url}")` }} />
                        ) : (
                          <CreationDraftPreview kind={item.creation_kind || "image"} />
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
                          <GuardedButton type="button" role="menuitem" disabled={!canManageCreation(user, item)}
                            blockedReason={t("仅创建者、项目所有者或项目管理员可重命名此创作", "Only the creator, project owner or project administrator can rename this creation.")}
                            onClick={() => open_rename_dialog(item)}>
                            <InlineIcon name="edit" />{t(CHINESE_ACTIONS.rename, ENGLISH_ACTIONS.rename)}
                          </GuardedButton>
                          <GuardedButton type="button" role="menuitem" className="amp-insight-card-delete"
                            blockedReason={t("仅创建者、项目所有者或项目管理员可删除此创作", "Only the creator, project owner or project administrator can delete this creation.")}
                            disabled={!canManageCreation(user, item)} onClick={() => {
                            set_menu_session_id(null);
                            set_delete_target(item);
                          }}>
                            <InlineIcon name="trash" />{t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
                          </GuardedButton>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <Pagination page={pagination.page} pageSize={pagination.pageSize}
              pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
              totalItems={pagination.totalItems} totalPages={pagination.totalPages}
              onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
            </>
          )}
        </main>

        <dialog
          ref={project_dialog_ref}
          aria-labelledby="select-content-project-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        >
          <h2 id="select-content-project-title" className="text-xl font-semibold">{t("新建创作", "New creation")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("选择所属项目并填写创作名称。", "Select a project and name the creation.")}</p>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            {t("所属项目", "Project")}
            <EnterpriseSelect
              value={new_project_id}
              options={available_projects.map((project) => ({ value: project.id, label: project.title }))}
              onChange={set_new_project_id}
              ariaLabel={t("选择所属项目", "Select project")}
              placeholder={available_projects.length ? t("请选择项目", `${ENGLISH_ACTIONS.select} a project`) : t("暂无可用项目", "No projects available")}
              disabled={available_projects.length === 0}
              disabledReason={t("请先创建项目。", "Create a project first.")}
              className="mt-2 w-full"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {t("创作类型", "Creation type")}
            <EnterpriseSelect
              value={new_creation_kind}
              options={[
                { value: "image", label: t("图文创作", "Image and copy") },
                { value: "video", label: t("视频创作", "Video creation") },
              ]}
              onChange={(value) => set_new_creation_kind(value === "video" ? "video" : "image")}
              ariaLabel={t("创作类型", "Creation type")}
              placeholder={t("请选择创作类型", "Select a creation type")}
              className="mt-2 w-full"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
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
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" onClick={() => project_dialog_ref.current?.close()}>
              {t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
            </button>
            <GuardedButton
              type="button"
              className="amp-button amp-button-primary"
              disabled={!new_project_id || !new_creation_name.trim() || !new_creation_kind}
              blockedReason={!new_creation_kind ? t("请选择创作类型", "Select a creation type.") : !new_project_id ? t("请选择所属项目", "Select a project first.") : t("请输入创作名称", "Enter a creation name.")}
              onClick={() => {
                project_dialog_ref.current?.close();
                void start_new_creation();
              }}
            >
              {t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
            </GuardedButton>
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
          cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
          confirmLabel={t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
          busyLabel={t(CHINESE_PROGRESS.deleting, ENGLISH_PROGRESS.deleting)}
          onCancel={() => set_delete_target(null)}
          onConfirm={() => void confirm_delete_session()}
        />
        <dialog
          ref={rename_dialog_ref}
          aria-labelledby="rename-creation-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => {
            if (renaming) {
              event.preventDefault();
              showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish."));
            }
          }}
          onClose={() => { if (!renaming) set_rename_target(null); }}
        >
          <h2 id="rename-creation-title" className="text-lg font-semibold">{t("重命名创作", "Rename creation")}</h2>
          <form className="mt-5" onSubmit={confirm_rename_session}>
            <label htmlFor="rename-creation-name" className="mb-2 block text-sm font-medium">{t("创作名称", "Creation name")}</label>
            <GuardedInput id="rename-creation-name" autoFocus required maxLength={80}
              className="amp-workspace-control w-full" value={rename_name} disabled={renaming}
              blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
              onChange={(event) => set_rename_name(event.target.value)} />
            <div className="mt-6 flex justify-end gap-3">
              <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={renaming}
                blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                onClick={() => rename_dialog_ref.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
              <GuardedButton type="submit" className="amp-button amp-button-primary" disabled={renaming || !rename_name.trim()}
                blockedReason={renaming ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : t("请输入创作名称", "Enter a creation name.")}>
                {renaming ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
              </GuardedButton>
            </div>
          </form>
        </dialog>
      </div>
    );
  }

  const is_generating = session?.status === "generating" || restoring_work || Boolean(resuming_job);

  const latest_deliverable = session?.deliverables?.at(-1) || null;
  const displayed_work = session?.deliverables?.find((work) => work.id === preview_work_id) || latest_deliverable;
  const is_historical_work = Boolean(displayed_work && latest_deliverable && displayed_work.id !== latest_deliverable.id);
  const activities = session?.activities || [];
  const latest_user_message_index = messages.reduce(
    (latest, message, index) => message.role === "user" ? index : latest,
    -1,
  );
  const latest_assistant_message_index = messages.reduce(
    (latest, message, index) => (
      message.role === "assistant" && index > latest_user_message_index ? index : latest
    ),
    -1,
  );
  const can_retry_reply = latest_user_message_index >= 0
    && (reply_failed || latest_assistant_message_index < 0);
  const show_stopped_activity = Boolean(
    agent_progress.parent_user_message_id
    && agent_progress.parent_user_message_id === messages[latest_user_message_index]?.client_message_id
    && ["failed", "cancelled", "interrupted", "timed_out"].includes(agent_progress.status || "")
    && agent_progress.events.some(event => event.type !== "status"),
  );
  const progress_events: AgentProgress["events"] = agent_progress.events || [];
  const composer_tokens: ComposerToken[] = [
    ...insight_labels.map(item => ({ kind: "insight" as const, id: item.id, title: item.label })),
    ...case_labels.map(item => ({ kind: "case" as const, id: item.id, title: item.label })),
    ...material_labels.map(item => ({ kind: "material" as const, id: item.id, title: item.label })),
    ...(image_reference ? [{ kind: "image" as const,
      id: `${image_reference.deliverable_id}:${image_reference.index}`,
      title: t("图片 {count}", "Image {count}", { count: image_reference.index + 1 }),
    }] : []),
  ];

  return (
    <div className="amp-projects-layout amp-content-full-canvas">
      <main className="amp-projects-main amp-content-editor-main">
      <div className="amp-content-studio-grid">
      {/* ── Left Panel ── */}
      <section className="amp-content-assistant-panel" aria-label={t("创作 Agent", "Creation Agent")}>
        <header className="amp-content-editor-header">
          <div>
            <button type="button" className="amp-project-detail-back"
              aria-label={t("返回创作列表", "Back to creation list")}
              onClick={() => void close_workspace()}>
              <InlineIcon name="arrowLeft" />
            </button>
            {session && <CreationPresence sessionId={session.id} />}
            <span className="amp-creation-kind-label">{session?.creation_kind === "video"
              ? t("视频创作", "Video creation") : t("图文创作", "Image and copy")}</span>
          </div>
        </header>
        <div className="amp-content-assistant-tabs" role="tablist" aria-label={t("创作助手功能", "Creative assistant features")}>
          {([
            ["ai", t("创作对话", "Creative chat")],
            ["context", t("上下文", "Context")],
            ["deliverables", t("成果记录", "Deliverables")],
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
            <div ref={chat_messages_ref} className="amp-content-assistant-messages space-y-4"
              onScroll={event => {
                const root = event.currentTarget;
                chat_scroll_top_ref.current = root.scrollTop;
                follow_latest_ref.current = root.scrollHeight - root.clientHeight - root.scrollTop <= 48;
              }}>
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
                    reply_action && m.role === "assistant" && i === latest_assistant_message_index ? null :
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`amp-content-message-group amp-content-message-group-${m.role}${
                        editing_message && m.role === "user" && i === latest_user_message_index ? " is-editing" : ""
                      }`} style={editing_message && m.role === "user" && i === latest_user_message_index && message_edit_size
                        ? { width: message_edit_size.width } : undefined}>
                        {editing_message && m.role === "user" && i === latest_user_message_index ? (
                          <div ref={message_edit_ref} className="amp-content-inline-message-edit">
                            <GuardedTextarea ref={message_edit_input_ref} value={rewrite_message}
                              autoFocus rows={4}
                              disabled={Boolean(reply_action)} blockedReason={replyReason}
                              aria-label={t("编辑最新消息", "Edit latest message")}
                              onChange={(event) => set_rewrite_message(event.target.value)}
                              onKeyDown={(event) => {
                                if (reply_action) return;
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  set_editing_message(false);
                                  set_rewrite_message("");
                                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)
                                  && !event.nativeEvent.isComposing) {
                                  event.preventDefault();
                                  void handle_rewrite_reply();
                                }
                              }}
                              className="amp-content-inline-message-textarea"
                              style={message_edit_size ? { height: message_edit_size.height } : undefined} />
                            <div className="amp-content-message-actions">
                              <GuardedButton type="button"
                                disabled={Boolean(reply_action) || !rewrite_message.trim()}
                                blockedReason={reply_action ? replyReason : t("请输入改写后的消息", "Enter the updated message.")}
                                aria-label={t("确认改写", "Confirm edit")}
                                title={t("确认改写", "Confirm edit")}
                                onClick={() => void handle_rewrite_reply()}>
                                <InlineIcon name="check" />
                              </GuardedButton>
                              <GuardedButton type="button" disabled={Boolean(reply_action)}
                                blockedReason={replyReason}
                                aria-label={t("取消改写", "Cancel edit")}
                                title={t("取消改写", "Cancel edit")}
                                onClick={() => { set_editing_message(false); set_rewrite_message(""); }}>
                                <InlineIcon name="close" />
                              </GuardedButton>
                            </div>
                          </div>
                        ) : <>
                        <div className={`amp-content-message amp-content-message-${m.role}`}>
                          {m.role === "assistant"
                            ? <AgentConversation events={m.agent_events || []} finalReply={m.content} />
                            : <InlineMessageContent message={m} imageLabel={t("图片 {count}", "Image {count}", { count: (m.image_reference?.index || 0) + 1 })} />}
                          {!m.reference_positions?.length && m.image_reference && <small className="amp-work-reference-caption">
                            {t("引用图片 {count}", "Referenced image {count}", { count: m.image_reference.index + 1 })}
                          </small>}
                          {m.role === "user" && !m.reference_positions?.length && (m.references?.length || 0) > 0 && (
                            <div className="amp-content-message-references">
                              {m.references?.map((reference) => (
                                <span key={`${reference.kind}:${reference.id}`}
                                  data-reference-kind={reference.kind}>
                                  <InlineIcon name={reference.kind === "material" ? "collection" : reference.kind === "insight" ? "insight" : "case"} />
                                  {reference.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {m.role === "user" && i === latest_user_message_index && !sending && !resuming_job && (
                          <div className="amp-content-message-actions">
                            <button type="button"
                              aria-label={t("复制消息", "Copy message")}
                              title={t("复制消息", "Copy message")}
                              onClick={() => void handle_copy_message(m.content)}>
                              <InlineIcon name="copy" />
                            </button>
                            <GuardedButton type="button"
                              disabled={Boolean(reply_action) || is_generating || !can_manage_session}
                              blockedReason={replyReason}
                              aria-label={t("改写最新消息", "Edit latest message")}
                              title={t("改写最新消息", "Edit latest message")}
                              onClick={(event) => {
                                const bubble = event.currentTarget.closest(".amp-content-message-group")
                                  ?.querySelector(".amp-content-message-user");
                                if (bubble) {
                                  const bounds = bubble.getBoundingClientRect();
                                  set_message_edit_size({ width: bounds.width, height: bounds.height });
                                }
                                set_rewrite_message(m.content);
                                set_editing_message(true);
                              }}>
                              <InlineIcon name="pen" />
                            </GuardedButton>
                            {can_retry_reply && <GuardedButton type="button"
                              disabled={Boolean(reply_action) || is_generating || !can_manage_session}
                              blockedReason={replyReason}
                              aria-label={t("重新生成回复", "Regenerate reply")}
                              title={t("重新生成回复", "Regenerate reply")}
                              onClick={() => void handle_regenerate_reply()}>
                              <InlineIcon name="refresh"
                                className={reply_action === "regenerate" ? "animate-spin" : ""} />
                            </GuardedButton>}
                          </div>
                        )}
                        </>}
                      </div>
                    </div>
                  ))}
                  {(sending || reply_action || resuming_job || show_stopped_activity) && (
                    <div className="flex justify-start">
                      <div className="amp-agent-live-conversation">
                        <AgentConversation events={progress_events} running={agent_progress.running} />
                        <div className="amp-agent-working-status" role="status">
                          {(sending || reply_action || resuming_job) && <span className="amp-agent-working-dot" aria-hidden="true" />}
                          {show_stopped_activity && !(sending || reply_action || resuming_job)
                            ? agent_progress.status === "cancelled" ? t("已停止", "Stopped") : t("本次执行未完成", "This attempt did not complete")
                            : agent_progress.status === "queued"
                            ? t("任务排队中", "Task queued")
                            : agent_progress.status === "cancelling"
                              ? t("正在停止…", "Stopping…")
                              : t("正在处理…", "Working…")}
                        </div>
                        {agent_progress.failed && (
                          <p>{t("暂时无法读取最新执行状态", "Latest execution status is temporarily unavailable")}</p>
                        )}
                        {agent_progress.status === "cancelling" && (
                          <p>{t("正在停止，等待当前模型请求返回；未保存的结果不会写入作品。", "Stopping after the current model request returns. Unsaved results will not modify the work.")}</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Input area */}
            <div className="amp-content-assistant-composer">
              <div className="amp-content-prompt-row">
                <InlineMessageComposer
                  ref={prompt_input_ref}
                  value={input}
                  onChange={set_input}
                  tokens={composer_tokens}
                  onRemove={(token) => {
                    if (token.kind === "image") set_image_reference(null);
                    else if (token.kind === "insight") {
                      set_insight_ids(ids => ids.filter(id => id !== token.id));
                      set_insight_labels(labels => labels.filter(label => label.id !== token.id));
                    } else if (token.kind === "case") {
                      set_case_ids(ids => ids.filter(id => id !== token.id));
                      set_case_labels(labels => labels.filter(label => label.id !== token.id));
                    } else {
                      set_material_ids(ids => ids.filter(id => id !== token.id));
                      set_material_labels(labels => labels.filter(label => label.id !== token.id));
                    }
                  }}
                  onKeyDown={handle_keydown}
                  placeholder={agent_mode === "create"
                    ? t("输入需要制作的内容与交付要求…", "Enter the content and delivery requirements…")
                    : agent_mode === "explore"
                      ? t("输入产品背景、目标与现有约束…", "Enter the product context, goals, and constraints…")
                      : t("输入产品、受众、平台或活动目标…", "Add the product, audience, platform, or campaign goal…")}
                  disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session)}
                  blockedReason={operationReason}
                />
                <div className="amp-content-prompt-toolbar">
                <GuardedButton type="button"
                  onClick={() => {
                    set_reference_panel_tab("insight");
                    set_show_ref_panel(true);
                  }}
                  disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session)}
                  blockedReason={operationReason}
                  className={`amp-content-preference-toggle amp-reference-insight shrink-0${insight_ids.length ? " is-active" : ""}`}
                  aria-label={t("引用洞察", "Reference insights")}
                  title={t("引用洞察", "Reference insights")}
                >
                  <InlineIcon name="insight" className="h-4 w-4" />
                </GuardedButton>
                <GuardedButton type="button"
                  onClick={() => {
                    set_reference_panel_tab("case");
                    set_show_ref_panel(true);
                  }}
                  disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session)}
                  blockedReason={operationReason}
                  className={`amp-content-preference-toggle amp-reference-case shrink-0${case_ids.length ? " is-active" : ""}`}
                  aria-label={t("引用案例", "Reference cases")}
                  title={t("引用案例", "Reference cases")}
                >
                  <InlineIcon name="case" className="h-4 w-4" />
                </GuardedButton>
                <GuardedButton type="button"
                  onClick={() => set_show_material_picker(true)}
                  disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session) || !project_id}
                  blockedReason={!project_id ? t("请选择所属项目", "Select a project first.") : operationReason}
                  className={`amp-content-preference-toggle amp-reference-material shrink-0${material_ids.length ? " is-active" : ""}`}
                  aria-label={t("引用素材", "Reference materials")}
                  title={t("引用素材", "Reference materials")}
                >
                  <InlineIcon name="collection" className="h-4 w-4" />
                </GuardedButton>
                {latest_deliverable && <WorkImageReferencePicker
                  key={latest_deliverable.id} work={latest_deliverable} selected={image_reference}
                  disabled={sending || Boolean(reply_action) || is_generating || !can_manage_session}
                  blockedReason={operationReason}
                  onSelect={(reference) => {
                    set_image_reference(reference);
                    prompt_input_ref.current?.focus();
                  }}
                />}
                <div className="amp-agent-mode-picker">
                  <GuardedButton type="button"
                    className="amp-agent-mode-trigger"
                    aria-haspopup="menu"
                    aria-expanded={show_agent_mode_menu}
                    disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session)}
                    blockedReason={operationReason}
                    onClick={() => set_show_agent_mode_menu((open) => !open)}>
                    <InlineIcon name={agent_mode === "create"
                      ? "bolt"
                      : agent_mode === "explore" ? "listBullet" : "shuffle"} />
                    <span>{agent_mode === "create"
                      ? t("行动", "Act")
                      : agent_mode === "explore" ? t("计划", "Plan") : t("自动", "Auto")}</span>
                  </GuardedButton>
                  {show_agent_mode_menu && (
                    <>
                      <button type="button" className="amp-agent-mode-backdrop"
                        aria-label={t("关闭创作模式菜单", "Close creation mode menu")}
                        onClick={() => set_show_agent_mode_menu(false)} />
                      <div role="menu" className="amp-agent-mode-menu"
                        aria-label={t("创作模式", "Creation mode")}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") set_show_agent_mode_menu(false);
                        }}>
                        <strong>{t("创作模式", "Creation mode")}</strong>
                        {([
                          ["auto", "shuffle", t("自动", "Auto"), t("根据当前请求选择合适流程", "Choose the flow from the current request")],
                          ["explore", "listBullet", t("计划", "Plan"), t("先梳理目标、方向与约束", "Clarify goals, direction, and constraints")],
                          ["create", "bolt", t("行动", "Act"), t("直接生成可交付成果", "Create the deliverable immediately")],
                        ] as const).map(([mode, icon, label, description]) => (
                          <GuardedButton key={mode} type="button" role="menuitemradio"
                            aria-checked={agent_mode === mode}
                            blockedReason={operationReason}
                            onClick={() => {
                              set_agent_mode(mode);
                              set_show_agent_mode_menu(false);
                            }}>
                            <InlineIcon name={icon} />
                            <span>
                              <b>{label}</b>
                              <small>{description}</small>
                            </span>
                            {agent_mode === mode && <InlineIcon name="check" />}
                          </GuardedButton>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {(sending || reply_action || resuming_job) && session && (
                  <GuardedButton type="button" className="amp-content-send-button"
                    aria-label={t("停止生成", "Stop generation")} title={t("停止生成", "Stop generation")}
                    disabled={cancelling_job || agent_progress.status === "cancelling" || !agent_progress.job_id}
                    blockedReason={t("正在等待任务状态更新", "Waiting for the task status to update")}
                    onClick={async () => {
                      if (!agent_progress.job_id) return;
                      set_cancelling_job(true);
                      try {
                        await cancel_agent_job(session.id, agent_progress.job_id);
                        showWarning(t("已请求停止任务", "Task cancellation requested"));
                      } catch (failure) {
                        showError(failure instanceof Error ? failure.message : t("取消任务失败", "Could not cancel Agent task"));
                      } finally {
                        set_cancelling_job(false);
                      }
                    }}>
                    <InlineIcon name="stop" className="h-5 w-5" />
                  </GuardedButton>
                )}
                {input.trim().length > 0 && !(sending || reply_action || resuming_job) && (
                  <GuardedButton
                    onClick={handle_send}
                    aria-label={t("发送消息", "Send message")}
                    disabled={sending || Boolean(reply_action) || is_generating || Boolean(session && !can_manage_session)}
                    blockedReason={operationReason}
                    className="amp-content-send-button"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </GuardedButton>
                )}
                </div>
              </div>
            </div>
          </>
        ) : assistant_tab === "context" ? (
          <CreationContextPanel page={context_page} onPageChange={set_context_page}
            insightIds={session?.insight_ids || []} caseIds={session?.case_ids || []}
            plans={session?.plans || []}
            projectId={session?.project_id || project_id} materialIds={session?.material_ids || []} />
        ) : assistant_tab === "deliverables" ? (
          <div className="amp-content-side-panel amp-content-card-panel">
            {(session?.deliverables?.length || 0) > 0 && (
              <ol className="amp-agent-deliverable-history">
                {[...(session?.deliverables || [])].reverse().map((deliverable, index) => (
                  <li key={deliverable.id} className={displayed_work?.id === deliverable.id ? "is-selected" : undefined}>
                    <button type="button" className="amp-work-version-select"
                      aria-pressed={displayed_work?.id === deliverable.id}
                      onClick={() => set_preview_work_id(deliverable.id)}>
                      <span className="amp-work-version-meta">
                        <b>V{(session?.deliverables?.length || 0) - index}</b>
                        {index === 0 && <span className="amp-work-version-current">{t("当前", "Current")}</span>}
                        {deliverable.source_version_id && <small>{
                          t("从 {version} 恢复", "Restored from {version}", {
                            version: (() => {
                              const sourceIndex = session?.deliverables?.findIndex(
                                (work) => work.id === deliverable.source_version_id,
                              ) ?? -1;
                              return sourceIndex >= 0 ? `V${sourceIndex + 1}` : deliverable.source_version_id;
                            })(),
                          })
                        }</small>}
                        <time dateTime={deliverable.created_at}>{new Intl.DateTimeFormat(locale, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        }).format(new Date(deliverable.created_at))}</time>
                      </span>
                    <strong>{deliverable.title}</strong>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {!(session?.deliverables?.length || 0) && (
              <div className="amp-content-version-empty amp-empty-state">
                <EmptyStateIcon name="history" />
                <p className="amp-content-version-empty-title">
                  {t("暂无成果记录", "No deliverables yet")}
                </p>
              </div>
            )}

          </div>
        ) : (
          <div className="amp-content-side-panel amp-content-activity">
            <strong>{t("{count} 条活动", "{count} activities", {
              count: messages.length + activities.length,
            })}</strong>
            <ol className={messages.length === 0 && activities.length === 0 ? "amp-content-activity-empty" : undefined}>
              {messages.length > 0 ? messages.map((message, index) => (
                <li key={index}>
                  <span>{message.role === "user" ? t("你：", "You:") : "Agent："}</span>
                  <p>{message.content}</p>
                </li>
              )) : null}
              {activities.map((activity) => (
                <li key={activity.id}>
                  <span>Agent：</span>
                  <p>{get_activity_text(activity, t)}</p>
                </li>
              ))}
              {messages.length === 0 && activities.length === 0 && (
                <li className="amp-empty-state">
                  <EmptyStateIcon name="listBullet" />
                  <p>{t("暂无活动记录", "No activity yet")}</p>
                </li>
              )}
            </ol>
          </div>
        )}
        </div>
      </section>

      {/* ── Right Panel ── */}
      {is_generating && !latest_deliverable ? (
        <ContentGeneratorSkeleton />
      ) : displayed_work ? (
        <AgentDeliverableWorkspace
          deliverable={displayed_work}
          disabled={sending || Boolean(reply_action) || restoring_work || is_historical_work || is_generating || !can_manage_session}
          blockedReason={operationReason}
          historical={is_historical_work}
          restoreDisabled={sending || Boolean(reply_action) || restoring_work || !can_manage_session}
          onRestore={() => void handle_restore_work(displayed_work.id)}
          onReturnToCurrent={() => set_preview_work_id(null)}
          savingWork={saving_work}
          onSaveWork={handle_save_work}
          onCopy={(value) => {
            void navigator.clipboard.writeText(value);
            show_success({ zh: "已复制", en: "Copied" });
          }}
        />
      ) : (
        <ContentGeneratorEmptyState />
      )}

      {/* Reference Panel */}
      <MaterialReferencePicker
        open={show_material_picker}
        projectId={project_id}
        selectedIds={material_ids}
        selectedLabels={material_labels}
        onConfirm={(ids, labels) => {
          const boundedIds = [...new Set(ids)].slice(0, MAX_MATERIAL_REFERENCES);
          set_material_ids(boundedIds);
          set_material_labels(labels.filter((label) => boundedIds.includes(label.id)));
        }}
        onClose={() => set_show_material_picker(false)}
      />
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

      {/* AI Modify Modal */}

      </div>
      </main>
    </div>
  );
}
