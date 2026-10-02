"use client";

import { Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import CaseCard from "@/components/case_library/case_card";
import { selectUploadFiles } from "@/utils/upload_selection";
import CaseProjectSidebar from "@/components/case_library/CaseProjectSidebar";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import Pagination from "@/components/redesign/Pagination";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import InlineIcon from "@/components/redesign/InlineIcon";
import RedesignInput from "@/components/redesign/RedesignInput";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import {
  create_case_import_task,
  create_image_text_case,
  create_video_case,
  analyze_case,
  delete_case,
  favorite_case,
  fetch_case,
  fetch_content_projects,
  fetch_my_favorites,
  fetch_my_cases,
  update_case,
  unfavorite_case,
} from "@/services/api_client";
import type { CaseItem } from "@/types/case_library";
import type { ContentProject } from "@/types/publishing";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";
import { GuardedButton, GuardedInput, GuardedTextarea, useBlockedInteraction } from "@/components/redesign/GuardedControls";
import { useAuth } from "@/contexts/auth_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { Locale, Translate } from "@/i18n/locale";
import { canManageCase } from "@/utils/case_permissions";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

type FilterValue = "全部类型" | "图文" | "视频";
type AnalysisStatusFilter = "all" | "not_analyzed" | "analyzing" | "completed" | "failed";
type CaseSort = "latest" | "oldest" | "name";
type AnalysisBlock = { key: string; title: string; text?: string; items?: string[] };

const contentTypes: FilterValue[] = ["全部类型", "图文", "视频"];

function extractCases(data: unknown): CaseItem[] {
  if (Array.isArray(data)) return data as CaseItem[];
  if (data && typeof data === "object" && Array.isArray((data as { cases?: unknown }).cases)) {
    return (data as { cases: CaseItem[] }).cases;
  }
  return [];
}

async function loadAllCases(favoritesRoom: boolean, projectId: string, isActive: () => boolean) {
  const items: CaseItem[] = [];
  const seenIds = new Set<string>();
  const favoriteIds = new Set<string>();
  const batchSize = 100;
  for (let offset = 0; isActive(); offset += batchSize) {
    const response = favoritesRoom
      ? await fetch_my_favorites(batchSize, offset)
      : await fetch_my_cases(batchSize, offset, "", projectId);
    if (!isActive()) break;
    const batch = extractCases(response.data);
    if (!favoritesRoom && !Array.isArray(response.data)) {
      for (const id of response.data.favorite_ids || []) favoriteIds.add(id);
    }
    let added = 0;
    for (const item of batch) {
      if (favoritesRoom || item.is_favorited || item.isFavorited) favoriteIds.add(item.id);
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      items.push(item);
      added += 1;
    }
    if (batch.length < batchSize || added === 0) break;
  }
  return { items: items.map(hydrateCase), favoriteIds: [...favoriteIds] };
}

function mediaUrl(value?: string): string {
  if (!value) return "";
  if (value.startsWith("http") || value.startsWith("/")) return value.startsWith("/media/") ? `${API_BASE}${value}` : value;
  return `${API_BASE}/media/${value}`;
}

function hydrateCase(item: CaseItem): CaseItem {
  return {
    ...item,
    cover_url: mediaUrl(item.cover_url || item.image_urls?.[0]),
    image_urls: (item.image_urls || []).map(mediaUrl),
    video_url: mediaUrl(item.video_url),
    body: item.body || item.description,
    published_at: item.published_at || item.created_at?.slice(0, 10),
    platform: item.platform || item.source || "待确认",
    recognition_status: item.recognition_status || "recognized",
    reusable_structure: item.reusable_structure || item.ai_analysis?.similar_approaches || [],
    rewrite_suggestions: item.rewrite_suggestions || item.ai_analysis?.improvement_suggestions || [],
  };
}

function contentTypeLabel(type: CaseItem["content_type"]): "图文" | "视频" | "待确认" {
  if (type === "image_text") return "图文";
  if (type === "video") return "视频";
  return "待确认";
}

function caseAnalysisStatus(item: CaseItem): Exclude<AnalysisStatusFilter, "all"> {
  if (item.ai_status === "analyzing") return "analyzing";
  if (item.ai_status === "failed") return "failed";
  if (item.ai_status === "completed" || item.ai_analysis) return "completed";
  return "not_analyzed";
}

function caseTimestamp(item: CaseItem): number {
  const value = item.updated_at || item.created_at;
  if (!value) return 0;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatNumber(value: number | null | undefined, locale: Locale, t: Translate): string {
  if (value === undefined || value === null) return t("未公开", "Not disclosed");
  if (locale === "en") return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`;
  return String(value);
}

function detectPlatform(value: string): string | null {
  const text = value.toLowerCase();
  if (text.includes("xiaohongshu") || text.includes("xhslink") || value.includes("小红书")) return "小红书";
  if (text.includes("douyin") || text.includes("iesdouyin") || value.includes("抖音")) return "抖音";
  return null;
}

export default function CaseLibraryPage() {
  const { user } = useAuth();
  const organizationId = (user?.current_organization ?? user?.default_organization)?.id;
  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <CaseLibraryContent key={`${user?.id || ""}:${organizationId || ""}`} />
    </Suspense>
  );
}

function CaseLibraryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [contentType, setContentType] = useState<FilterValue>("全部类型");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatusFilter>("all");
  const [sort, setSort] = useState<CaseSort>("latest");
  const [search, setSearch] = useState("");
  const [importInput, setImportInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseItem | null>(null);
  const [pendingDeleteCase, setPendingDeleteCase] = useState<CaseItem | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const createSelectedFilesRef = useRef<HTMLDivElement>(null);
  const closingCaseIdRef = useRef("");
  const [createMode, setCreateMode] = useState<"link" | "image_text" | "video">("link");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createImages, setCreateImages] = useState<File[]>([]);
  const [createVideo, setCreateVideo] = useState<File | null>(null);
  const [createFilesExpanded, setCreateFilesExpanded] = useState(false);
  const projectId = searchParams.get("project") || "";
  const favoritesRoom = searchParams.get("view") === "favorites";
  const selectedCaseId = searchParams.get("case") || "";
  const importingReason = t("正在处理中，请稍候。", "Please wait for the current operation to finish.");
  const uploadInteraction = useBlockedInteraction(isImporting, importingReason);
  const selectedCreateFiles = useMemo(
    () => createMode === "video" ? (createVideo ? [createVideo] : []) : createMode === "image_text" ? createImages : [],
    [createImages, createMode, createVideo],
  );
  const reportLoadError = useEffectEvent(() => showError(t("案例读取失败，请稍后重试。", "Failed to load cases. Please try again later.")));

  useEffect(() => {
    if (!createFilesExpanded) return;
    const collapseOnOutsideClick = (event: PointerEvent) => {
      if (!createSelectedFilesRef.current?.contains(event.target as Node)) {
        setCreateFilesExpanded(false);
      }
    };
    document.addEventListener("pointerdown", collapseOnOutsideClick);
    return () => document.removeEventListener("pointerdown", collapseOnOutsideClick);
  }, [createFilesExpanded]);

  useEffect(() => {
    let alive = true;
    if (!user) return;
    setLoadingCases(true);
    setCases([]);
    setFavoriteIds([]);
    setSelectedCase(null);
    setPendingDeleteCase(null);
    createDialogRef.current?.close();
    const load = async () => {
      try {
        const projectResponse = await fetch_content_projects();
        if (!alive) return;
        const availableProjects = projectResponse.data || [];
        setProjects(availableProjects);
        if (!favoritesRoom && projectId && !availableProjects.some((project) => project.id === projectId)) {
          router.replace("/case_library");
          return;
        }
        const response = await loadAllCases(favoritesRoom, projectId, () => alive);
        if (!alive) return;
        setCases(response.items);
        setFavoriteIds(response.favoriteIds);
      } catch {
        if (alive) reportLoadError();
      } finally {
        if (alive) setLoadingCases(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [favoritesRoom, projectId, router, user]);

  useEffect(() => {
    if (!user || !cases.some((item) => (
      item.ai_status === "analyzing" || item.recognition_status === "pending"
    ))) return;
    let alive = true;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void loadAllCases(favoritesRoom, projectId, () => alive)
        .then((response) => {
          if (!alive) return;
          const items = response.items;
          setCases(items);
          setSelectedCase((current) => (
            current ? items.find((item) => item.id === current.id) || current : current
          ));
          setFavoriteIds(response.favoriteIds);
        })
        .catch((error) => {
          if (!alive) return;
          window.clearInterval(timer);
          showError(localizeErrorMessage(
            error instanceof Error ? error.message : t("案例状态刷新失败", "Could not refresh case status"),
            locale,
          ));
        })
        .finally(() => { refreshing = false; });
    }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [cases, favoritesRoom, locale, projectId, showError, t, user]);

  useEffect(() => {
    if (!selectedCaseId) {
      closingCaseIdRef.current = "";
      return;
    }
    if (closingCaseIdRef.current === selectedCaseId) return;
    const requestedCase = cases.find((item) => item.id === selectedCaseId);
    if (requestedCase && selectedCase?.id !== requestedCase.id) {
      setSelectedCase(requestedCase);
    }
  }, [cases, selectedCase?.id, selectedCaseId]);

  const openCaseDetail = (item: CaseItem) => {
    closingCaseIdRef.current = "";
    setSelectedCase(item);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("case", item.id);
    router.replace(`/case_library?${nextParams.toString()}`, { scroll: false });
  };

  const closeCaseDetail = () => {
    closingCaseIdRef.current = selectedCase?.id || selectedCaseId;
    setSelectedCase(null);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("case");
    const query = nextParams.toString();
    router.replace(query ? `/case_library?${query}` : "/case_library", {
      scroll: false,
    });
  };


  const visibleCases = useMemo(() => {
    const filtered = cases
      .filter((item) => {
        return !favoritesRoom || favoriteIds.includes(item.id) || item.is_favorited || item.isFavorited;
      })
      .filter((item) => contentType === "全部类型" || contentTypeLabel(item.content_type) === contentType)
      .filter((item) => analysisStatus === "all" || caseAnalysisStatus(item) === analysisStatus)
      .filter((item) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return [item.title, item.description, item.body, item.industry, ...(item.tags || [])].join(" ").toLowerCase().includes(query);
      });
    return [...filtered].sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title, locale);
      const difference = caseTimestamp(left) - caseTimestamp(right);
      return sort === "oldest" ? difference : -difference;
    });
  }, [analysisStatus, favoritesRoom, cases, contentType, favoriteIds, locale, search, sort]);
  const paginationResetKey = JSON.stringify([search, contentType, analysisStatus, sort, favoritesRoom, projectId]);
  const pagination = usePagination(visibleCases, paginationResetKey, 12);

  const toggleFavorite = async (caseId: string, currentlyFavorite: boolean) => {
    try {
      if (currentlyFavorite) await unfavorite_case(caseId);
      else await favorite_case(caseId);
      setFavoriteIds((prev) => currentlyFavorite ? prev.filter((id) => id !== caseId) : Array.from(new Set([...prev, caseId])));
      setCases((current) => current.map((item) => item.id === caseId
        ? { ...item, is_favorited: !currentlyFavorite, isFavorited: !currentlyFavorite }
        : item));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : t("操作失败", "Action failed"), locale));
    }
  };

  const deleteCaseFromLibrary = async () => {
    if (!pendingDeleteCase) return;
    const target = pendingDeleteCase;
    setPendingDeleteCase(null);
    setDeletingCase(true);
    try {
      await delete_case(target.id);
      setCases((current) => current.filter((caseItem) => caseItem.id !== target.id));
      setFavoriteIds((current) => current.filter((favoriteId) => favoriteId !== target.id));
      showSuccess(t("案例已删除。", "Case deleted."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : t("删除失败", "Delete failed"), locale));
    } finally {
      setDeletingCase(false);
    }
  };

  const handleImport = async () => {
    if (isImporting) { showWarning(importingReason); return; }
    if (!createProjectId) {
      showError(t("请选择所属项目", "Select a project first."));
      return;
    }
    const rawInput = importInput.trim();
    if (!rawInput || !detectPlatform(rawInput)) {
      showError(t("请粘贴小红书或抖音链接/分享文本。", "Paste a Xiaohongshu or Douyin link or share text."));
      return;
    }
    setIsImporting(true);
    try {
      const res = await create_case_import_task(rawInput, createProjectId, "", true);
      const imported = res.data.case;
      if (imported) {
        const next = hydrateCase(imported);
        setCases((items) => [next, ...items.filter((item) => item.id !== next.id)]);
        setImportInput("");
        createDialogRef.current?.close();
        showSuccess(t(
          "案例已创建，正在后台识别公开信息",
          "Case created. Public information is being recognized in the background.",
        ));
      } else {
        showSuccess(t("导入任务状态：{status}", "Import status: {status}", { status: recognitionStatusLabel(res.data.recognition_status, t) }));
      }
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : t("导入失败", "Import failed"), locale));
    } finally {
      setIsImporting(false);
    }
  };

  const openCreateDialog = () => {
    setCreateProjectId(projectId || projects[0]?.id || "");
    setCreateMode("link");
    setImportInput("");
    setCreateTitle("");
    setCreateDescription("");
    setCreateImages([]);
    setCreateVideo(null);
    setCreateFilesExpanded(false);
    createDialogRef.current?.showModal();
  };

  const createUploadedCase = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isImporting) { showWarning(importingReason); return; }
    if (createMode === "link") {
      await handleImport();
      return;
    }
    if (!createProjectId || !createTitle.trim()) {
      showError(t("请填写所属项目和案例标题", "Project and title are required."));
      return;
    }
    if (createMode === "video" && !createVideo) {
      showError(t("请选择视频文件", "Select a video file."));
      return;
    }
    if (createMode === "image_text" && createImages.length === 0) {
      showError(t("请至少选择一张图片", "Select at least one image."));
      return;
    }
    setIsImporting(true);
    try {
      const response = createMode === "video"
        ? await create_video_case(
          createTitle.trim(), createDescription.trim(), [], createVideo!,
          createProjectId,
        )
        : await create_image_text_case(
          createTitle.trim(), createDescription.trim(), [], createImages,
          createProjectId,
        );
      const next = hydrateCase(response.data);
      setCases((items) => [next, ...items.filter((item) => item.id !== next.id)]);
      createDialogRef.current?.close();
      showSuccess(t("案例已创建", "Case created"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : t("创建失败", "Create failed"), locale));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="amp-projects-layout">
      <CaseProjectSidebar projects={projects} favoritesRoom={favoritesRoom}
        selectedProjectId={favoritesRoom ? undefined : projectId} />
      <main className="amp-projects-main">
        <div className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{favoritesRoom ? t("收藏案例", "Favorite cases") : t("案例库", "Case Library")}</h1>
            <p>{favoritesRoom
              ? t("当前组织下属于你的个人案例收藏。", "Your personal case favorites in the current organization.")
              : projectId
              ? t("浏览和管理当前项目中的营销案例。", "Browse and manage cases in the selected project.")
              : t("浏览当前组织可访问项目中的案例。", "Cases across accessible projects in the current organization.")}</p>
          </div>
          {!favoritesRoom && (
            <button type="button" className="amp-button amp-button-primary" onClick={openCreateDialog}>
              {t(CHINESE_ACTIONS.upload, ENGLISH_ACTIONS.upload)}
            </button>
          )}
        </div>

        <div className="amp-case-toolbar">
          <div className="amp-projects-search">
            <RedesignInput
              leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("搜索案例", "Search cases")}
              aria-label={t("搜索案例", "Search cases")}
            />
          </div>
          <EnterpriseSelect
            value={analysisStatus}
            options={[
              { value: "all", label: t("全部状态", "All statuses") },
              { value: "not_analyzed", label: t("未分析", "Not analyzed") },
              { value: "analyzing", label: t("分析中", "Analyzing") },
              { value: "completed", label: t("已分析", "Analyzed") },
              { value: "failed", label: t("分析失败", "Failed") },
            ]}
            onChange={setAnalysisStatus}
            ariaLabel={t("AI 分析状态", "AI analysis status")}
            className="w-36"
          />
          <EnterpriseSelect
            value={contentType}
            options={contentTypes.map((option) => ({ value: option, label: filterLabel(option, t) }))}
            onChange={setContentType}
            ariaLabel={t("内容形式", "Content format")}
            className="w-36"
          />
          <EnterpriseSelect
            value={sort}
            options={[
              { value: "latest", label: t("最近更新", "Latest") },
              { value: "oldest", label: t("最早创建", "Oldest") },
              { value: "name", label: t("案例名称", "Case name") },
            ]}
            onChange={setSort}
            ariaLabel={t("案例时间排序", "Case time sorting")}
            className="w-36"
          />
        </div>

        {loadingCases ? (
          <div className="amp-projects-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
        ) : visibleCases.length === 0 ? (
          <div className="amp-projects-state">
            <span className="amp-projects-empty-icon"><InlineIcon name="case" /></span>
            <strong>{favoritesRoom ? t("暂无收藏案例", "No favorite cases") : t("暂无案例", "No cases yet")}</strong>
            <p>{favoritesRoom
              ? t("在案例卡片的三点菜单中收藏，案例会保存到这里。", "Favorite a case from its action menu and it will appear here.")
              : projectId ? t("导入链接或上传一个案例。", "Import a link or upload a case.") : t("当前组织暂无可浏览案例。", "No cases are available in this organization.")}</p>
          </div>
        ) : (
          <>
          <div className="amp-case-grid">
            {pagination.pageItems.map((item) => (
              <CaseCard key={item.id} item={item}
                is_favorited={favoriteIds.includes(item.id) || item.is_favorited || item.isFavorited}
                canDelete={canManageCase(user, item)}
                onFavorite={toggleFavorite} onDelete={setPendingDeleteCase}
                onOpen={openCaseDetail} />
            ))}
          </div>
          <Pagination page={pagination.page} pageSize={pagination.pageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            totalItems={pagination.totalItems} totalPages={pagination.totalPages}
            onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
          </>
        )}
      </main>

      <dialog ref={createDialogRef} aria-labelledby="create-case-title"
        className="amp-workspace-dialog amp-insight-create-dialog m-auto w-[calc(100%_-_32px)] max-w-2xl bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          if (isImporting) { event.preventDefault(); showWarning(importingReason); }
        }}>
        <h2 id="create-case-title" className="text-xl font-semibold">{t("上传案例", "Add case")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("选择所属项目和案例创建方式。", "Select a project and creation method.")}</p>
        <form className="mt-6" onSubmit={createUploadedCase}>
          <label className="mb-2 block text-sm font-medium">{t("所属项目", "Project")}</label>
          <EnterpriseSelect
            value={createProjectId}
            options={projects.map((project) => ({ value: project.id, label: project.title }))}
            onChange={setCreateProjectId}
            ariaLabel={t("选择所属项目", "Select project")}
            placeholder={projects.length ? t("请选择项目", `${ENGLISH_ACTIONS.select} a project`) : t("暂无可用项目", "No projects available")}
            disabled={isImporting || projects.length === 0}
            disabledReason={isImporting ? importingReason : t("请先创建项目。", "Create a project first.")}
            className="w-full"
          />

          <div className="amp-insight-create-modes" role="tablist">
            <button type="button" role="tab" aria-selected={createMode === "link"} onClick={() => { setCreateMode("link"); setCreateFilesExpanded(false); }}>
              <InlineIcon name="share" />{t(CHINESE_ACTIONS.import, ENGLISH_ACTIONS.import)}
            </button>
            <button type="button" role="tab" aria-selected={createMode === "image_text"} onClick={() => { setCreateMode("image_text"); setCreateFilesExpanded(false); }}>
              <InlineIcon name="image" />{t("图文上传", "Image post")}
            </button>
            <button type="button" role="tab" aria-selected={createMode === "video"} onClick={() => { setCreateMode("video"); setCreateFilesExpanded(false); }}>
              <InlineIcon name="video" />{t("视频上传", "Video")}
            </button>
          </div>

          <div className="amp-insight-create-panel">
            {createMode === "link" ? (
              <label><span>{t("链接或分享文本", "Link or share text")}</span>
                <GuardedTextarea className="amp-workspace-control mt-2 w-full resize-none" rows={4}
                  value={importInput} disabled={isImporting}
                  blockedReason={importingReason}
                  onChange={(event) => setImportInput(event.target.value)}
                  placeholder={t("粘贴小红书 / 抖音链接或完整分享文本", "Paste a Xiaohongshu / Douyin link or full share text")} /></label>
            ) : (
              <div className="amp-case-upload-fields">
                <div className="amp-case-upload-copy">
                  <label><span>{t("案例标题", "Case title")}</span>
                    <GuardedInput className="amp-workspace-control mt-2 w-full" value={createTitle}
                      blockedReason={importingReason}
                      disabled={isImporting} onChange={(event) => setCreateTitle(event.target.value)} /></label>
                  <label><span>{t("案例描述", "Description")}</span>
                    <GuardedTextarea className="amp-workspace-control mt-2 w-full resize-none" rows={1}
                      blockedReason={importingReason}
                      value={createDescription} disabled={isImporting}
                      onChange={(event) => setCreateDescription(event.target.value)} /></label>
                </div>
                <label className="amp-insight-upload amp-case-upload-dropzone" role="button" tabIndex={isImporting ? 0 : undefined}
                  aria-disabled={uploadInteraction["aria-disabled"]}
                  data-blocked-action={uploadInteraction["data-blocked-action"]}
                  onClickCapture={uploadInteraction.onClickCapture}
                  onKeyDownCapture={uploadInteraction.onKeyDownCapture}>
                  <InlineIcon name="upload" />
                  <strong>{createMode === "video" ? t("选择视频", `${ENGLISH_ACTIONS.select} video`) : t("选择图片", `${ENGLISH_ACTIONS.select} images`)}</strong>
                  <span>{createMode === "video"
                    ? t("支持 MP4、MOV、WebM 和 M4V，最多 1 个文件", "MP4, MOV, WebM, and M4V; up to 1 file")
                    : t("支持 JPG、PNG、GIF 和 WebP", "JPG, PNG, GIF, and WebP")}</span>
                  <input type="file" disabled={isImporting}
                    style={{ pointerEvents: isImporting ? "none" : undefined }}
                    accept={createMode === "video" ? ".mp4,.mov,.webm,.m4v" : "image/*"}
                    multiple={createMode === "image_text"}
                    onChange={(event) => {
                      const isVideo = createMode === "video";
                      const result = selectUploadFiles(
                        isVideo ? (createVideo ? [createVideo] : []) : createImages,
                        Array.from(event.target.files || []),
                        isVideo ? 1 : 10,
                      );
                      if (isVideo) setCreateVideo(result.files[0] || null);
                      else setCreateImages(result.files);
                      const messages: string[] = [];
                      if (result.duplicates.length > 0) {
                        messages.push(t(
                          "已选择以下文件，请勿重复添加：{names}",
                          "These files are already selected: {names}",
                          { names: [...new Set(result.duplicates)].join(", ") },
                        ));
                      }
                      if (result.limitExceeded) {
                        messages.push(isVideo ? t(
                            "只能上传一个视频，请先移除已选择的视频。",
                            "Only one video can be uploaded. Remove the selected video first.",
                          ) : t(
                            "最多选择 10 张图片，超出的图片未添加。",
                            "You can select up to 10 images. Additional images were not added.",
                          ));
                      }
                      if (messages.length > 0) showError(messages.join("\n"));
                      event.currentTarget.value = "";
                    }} />
                </label>
              </div>
            )}
          </div>

          <div className="amp-insight-create-actions">
            {selectedCreateFiles.length > 0 && (
              <div ref={createSelectedFilesRef} className="amp-insight-selected-files">
                <button type="button" className="amp-insight-selected-files-toggle"
                  aria-expanded={createFilesExpanded} onClick={() => setCreateFilesExpanded((current) => !current)}>
                  <span>{t("已选择 {count} 个文件", "{count} files selected", { count: selectedCreateFiles.length })}</span>
                  <InlineIcon name="chevronRight" className={createFilesExpanded ? "is-expanded" : ""} />
                </button>
                {createFilesExpanded && (
                  <ul>
                    {selectedCreateFiles.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                        <span className="amp-insight-selected-file-copy">
                          <span className="amp-insight-selected-file-name" title={file.name}>{file.name}</span>
                          <small>{file.size >= 1024 * 1024
                            ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                            : `${(file.size / 1024).toFixed(1)} KB`}</small>
                        </span>
                        <GuardedButton type="button" disabled={isImporting} blockedReason={importingReason}
                          aria-label={t("移除文件：{name}", "Remove file: {name}", { name: file.name })}
                          onClick={() => {
                            if (createMode === "video") setCreateVideo(null);
                            else setCreateImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
                            if (selectedCreateFiles.length === 1) setCreateFilesExpanded(false);
                          }}>
                          <InlineIcon name="close" />
                        </GuardedButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="amp-insight-create-action-buttons">
              <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={isImporting} blockedReason={importingReason}
                onClick={() => createDialogRef.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
              <GuardedButton type="submit" className="amp-button amp-button-primary" disabled={isImporting || !createProjectId}
                blockedReason={isImporting ? importingReason : t("请选择所属项目", "Select a project first.")}>
                {isImporting ? t(CHINESE_PROGRESS.uploading, ENGLISH_PROGRESS.uploading) : t(CHINESE_ACTIONS.upload, ENGLISH_ACTIONS.upload)}
              </GuardedButton>
            </div>
          </div>
        </form>
      </dialog>

      {selectedCase && (
        <CaseDetailModal
          item={selectedCase}
          onClose={closeCaseDetail}
          onUpdate={(updatedCase) => {
            const hydrated = hydrateCase(updatedCase);
            setSelectedCase(hydrated);
            setCases((current) => current.map((caseItem) => caseItem.id === hydrated.id ? hydrated : caseItem));
          }}
        />
      )}
      <DeleteConfirmDialog
        open={Boolean(pendingDeleteCase)}
        title={t("删除案例", "Delete case")}
        message={t(
          "确定删除「{name}」吗？删除后无法恢复。",
          "Delete “{name}”? This action cannot be undone.",
          { name: pendingDeleteCase?.title || "" },
        )}
        cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
        confirmLabel={t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
        busyLabel={t(CHINESE_PROGRESS.deleting, ENGLISH_PROGRESS.deleting)}
        busy={deletingCase}
        onCancel={() => setPendingDeleteCase(null)}
        onConfirm={() => void deleteCaseFromLibrary()}
      />
    </div>
  );
}

function CaseDetailModal({
  item,
  onClose,
  onUpdate,
}: {
  item: CaseItem;
  onClose: () => void;
  onUpdate: (item: CaseItem) => void;
}) {
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState<"media" | "analysis">("media");
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftContent, setDraftContent] = useState(item.body || item.description || "");
  const isAnalyzing = item.ai_status === "analyzing";
  const canEditContent = canManageCase(user, item);

  useEffect(() => {
    if (!isAnalyzing) return;
    let pollErrorShown = false;
    const interval = window.setInterval(() => {
      fetch_case(item.id)
        .then((response) => {
          pollErrorShown = false;
          const updated = response.data;
          onUpdate(updated);
          if (updated.ai_status === "completed" && updated.ai_analysis) {
            showSuccess(t("AI 分析已完成", "AI analysis complete"));
          } else if (updated.ai_status === "failed") {
            showError(t("AI 分析失败，请重试。", "AI analysis failed. Please try again."));
          }
        })
        .catch(() => {
          if (!pollErrorShown) {
            pollErrorShown = true;
            showError(t("AI 分析状态刷新失败，请稍后重试。", "Failed to refresh AI analysis status. Please try again later."));
          }
        });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [isAnalyzing, item.id, onUpdate, showError, showSuccess, t]);

  const handleAnalyze = async () => {
    if (!canEditContent) {
      showError(t("你没有权限分析此案例。", "You do not have permission to analyze this case."));
      return;
    }
    if (isAnalyzing || isStartingAnalysis) {
      showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish."));
      return;
    }
    setIsStartingAnalysis(true);
    try {
      await analyze_case(item.id, locale);
      onUpdate({ ...item, ai_status: "analyzing" });
      setTab("analysis");
      showSuccess(t("AI 分析已开始，将在后台自动完成。", "AI analysis started and will finish in the background."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : t("AI 分析启动失败", "Failed to start AI analysis"), locale));
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const cancelContentEdit = () => {
    setDraftTitle(item.title);
    setDraftContent(item.body || item.description || "");
    setIsEditingContent(false);
  };

  const saveContent = async () => {
    if (isSavingContent) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    if (!canEditContent) {
      showError(t("你没有权限编辑此案例。", "You do not have permission to edit this case."));
      return;
    }
    const title = draftTitle.trim();
    if (!title) {
      showError(t("标题不能为空。", "Title is required."));
      return;
    }
    setIsSavingContent(true);
    try {
      const response = await update_case(item.id, { title, description: draftContent.trim() });
      onUpdate(response.data);
      setIsEditingContent(false);
      showSuccess(t("案例内容已更新。", "Case content updated."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : t("保存失败", "Save failed"), locale));
    } finally {
      setIsSavingContent(false);
    }
  };


  const analysis = item.ai_analysis;
  const galleryImages = Array.from(new Set([item.cover_url, ...(item.image_urls || [])].filter((url): url is string => Boolean(url))));
  const activeImage = galleryImages[Math.min(activeImageIndex, Math.max(galleryImages.length - 1, 0))];
  const analysisMediaLabel = item.content_type === "video"
    ? t("基于视频与案例内容", "Based on the video and case content")
    : t("基于 {count} 张图片与案例内容", "Based on {count} images and case content", { count: galleryImages.length });
  const analyzedAt = item.ai_analyzed_at || item.updated_at;
  const analyzedAtDate = analyzedAt ? new Date(`${analyzedAt.replace(" ", "T")}Z`) : null;
  const analysisMeta = analyzedAtDate && !Number.isNaN(analyzedAtDate.getTime())
    ? t("{media} · 分析于 {time}", "{media} · Analyzed {time}", {
      media: analysisMediaLabel,
      time: analyzedAtDate.toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    })
    : analysisMediaLabel;
  const textBlock = (key: string, title: string, text?: string): AnalysisBlock | null => {
    const value = text?.trim();
    return value ? { key, title, text: value } : null;
  };
  const listBlock = (key: string, title: string, items?: string[]): AnalysisBlock | null => {
    const values = (items || []).map((value) => value.trim()).filter(Boolean);
    return values.length > 0 ? { key, title, items: values } : null;
  };
  const judgmentBlocks = analysis ? [
    textBlock("hook", t("爆点分析", "Hook analysis"), analysis.hook_analysis),
    textBlock("marketing", t("营销角度", "Marketing angle"), analysis.marketing_angle),
    textBlock("audience", t("目标受众", "Target audience"), analysis.target_audience),
  ].filter((block): block is AnalysisBlock => Boolean(block)) : [];
  const reusableBlocks = analysis ? [
    textBlock("experience", t("经验提炼", "Lessons learned"), analysis.experience_extraction),
    listBlock("highlights", t("关键亮点", "Key highlights"), analysis.key_highlights),
    listBlock("structure", t("可复用结构", "Reusable structure"), item.reusable_structure || analysis.similar_approaches),
  ].filter((block): block is AnalysisBlock => Boolean(block)) : [];
  const outputBlocks = analysis ? [
    listBlock("improvements", t("改进建议", "Suggestions for improvement"), item.rewrite_suggestions || analysis.improvement_suggestions),
    listBlock("titles", t("标题建议", "Title suggestions"), analysis.title_suggestions),
    listBlock("tags", t("标签建议", "Tag suggestions"), analysis.tag_suggestions),
    listBlock("rewrites", t("改写示例", "Rewrite examples"), analysis.rewrite_examples),
  ].filter((block): block is AnalysisBlock => Boolean(block)) : [];
  const videoBlocks = analysis && item.content_type === "video" ? [
    textBlock("opening-hook", t("前三秒钩子", "Opening hook"), analysis.opening_hook),
    textBlock("pacing", t("节奏分析", "Pacing analysis"), analysis.pacing_analysis),
    textBlock("shots", t("镜头结构", "Shot structure"), analysis.shot_structure),
    textBlock("script", t("脚本结构", "Script structure"), analysis.script_structure),
  ].filter((block): block is AnalysisBlock => Boolean(block)) : [];
  const summaryBlock = analysis
    ? textBlock("summary", t("内容解析", "Content analysis"), analysis.content_analysis)
    : null;
  const hasAnalysisContent = Boolean(summaryBlock)
    || judgmentBlocks.length > 0
    || reusableBlocks.length > 0
    || outputBlocks.length > 0
    || videoBlocks.length > 0;
  const analyzeLabel = isAnalyzing
    ? t(CHINESE_PROGRESS.analyzing, ENGLISH_PROGRESS.analyzing)
    : analysis
      ? t(CHINESE_ACTIONS.analyze, ENGLISH_ACTIONS.analyze)
      : t(CHINESE_ACTIONS.analyze, ENGLISH_ACTIONS.analyze);

  const copyAnalysisBlock = async (block: AnalysisBlock) => {
    const content = block.text || block.items?.join("\n") || "";
    try {
      await navigator.clipboard.writeText(`${block.title}\n${content}`);
      showSuccess(t("已复制“{title}”", "Copied “{title}”", { title: block.title }));
    } catch {
      showError(t("复制失败，请重试。", "Copy failed. Please try again."));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("案例详情", "Case details")}>
      <div className="amp-case-detail-dialog">
        <div className={`amp-case-detail-body amp-case-detail-body-${tab}`}>
          <div className="amp-case-detail-topbar">
            <div className="amp-case-detail-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "media"}
                onClick={() => setTab("media")}>
                <InlineIcon name="media" />
                {t("案例媒体", "Case media")}
              </button>
              <button type="button" role="tab" aria-selected={tab === "analysis"}
                onClick={() => setTab("analysis")}>
                <InlineIcon name="chart" />
                {t("内容分析", "Content analysis")}
              </button>
            </div>
            <div className="amp-case-detail-actions">
              <button type="button" onClick={onClose} className="amp-case-detail-close" aria-label={t("关闭详情", "Close details")}>
                <InlineIcon name="close" />
              </button>
            </div>
          </div>
          <aside className="amp-case-detail-media">
            <div className={`amp-case-detail-media-gallery${item.content_type !== "video" && galleryImages.length > 1 ? " amp-case-detail-media-gallery-with-thumbnails" : ""}`}>
              {item.content_type === "video" && item.video_url ? (
                <div className="amp-case-detail-video-frame">
                  <video src={item.video_url} controls playsInline preload="metadata" />
                </div>
              ) : activeImage ? (
                <>
                  <div className="amp-case-detail-media-frame">
                    <Image
                      src={activeImage}
                      alt={t("{title}，第 {index} 张", "{title}, image {index}", { title: item.title, index: activeImageIndex + 1 })}
                      fill
                      unoptimized
                      sizes="560px"
                      className="object-contain"
                    />
                    {galleryImages.length > 1 && (
                      <>
                        <button type="button" className="amp-case-gallery-arrow amp-case-gallery-arrow-prev"
                          aria-label={t("上一张图片", "Previous image")}
                          onClick={() => setActiveImageIndex((index) => (index - 1 + galleryImages.length) % galleryImages.length)}>
                          <InlineIcon name="chevronRight" />
                        </button>
                        <button type="button" className="amp-case-gallery-arrow amp-case-gallery-arrow-next"
                          aria-label={t("下一张图片", "Next image")}
                          onClick={() => setActiveImageIndex((index) => (index + 1) % galleryImages.length)}>
                          <InlineIcon name="chevronRight" />
                        </button>
                        <span className="amp-case-gallery-count">{activeImageIndex + 1} / {galleryImages.length}</span>
                      </>
                    )}
                  </div>
                  {galleryImages.length > 1 && (
                    <div className="amp-case-gallery-thumbnails" aria-label={t("案例图片列表", "Case image list")}>
                      {galleryImages.map((image, index) => (
                        <button key={image} type="button" aria-label={t("查看第 {index} 张图片", "View image {index}", { index: index + 1 })}
                          aria-current={index === activeImageIndex} onClick={() => setActiveImageIndex(index)}>
                          <Image src={image} alt="" fill unoptimized sizes="56px" className="object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="amp-case-detail-media-frame amp-case-detail-media-empty">{t("待补充媒体", "No media yet")}</div>
              )}
            </div>
            <div className="amp-case-media-content">
              {isEditingContent && canEditContent ? (
                <div className="amp-case-content-editor">
                  <label>
                    <span>{t("标题", "Title")}</span>
                    <GuardedInput value={draftTitle} disabled={isSavingContent}
                      blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                      onChange={(event) => setDraftTitle(event.target.value)} />
                  </label>
                  <label>
                    <span>{t("内容", "Content")}</span>
                    <GuardedTextarea value={draftContent} disabled={isSavingContent}
                      blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                      onChange={(event) => setDraftContent(event.target.value)} />
                  </label>
                  <div className="amp-case-content-editor-actions">
                    <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel"
                      blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                      disabled={isSavingContent} onClick={cancelContentEdit}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
                    <GuardedButton type="button" className="amp-button amp-button-primary"
                      blockedReason={isSavingContent ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : t("请输入案例标题", "Enter a case title.")}
                      disabled={isSavingContent || !draftTitle.trim()} onClick={saveContent}>
                      {isSavingContent ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
                    </GuardedButton>
                  </div>
                </div>
              ) : (
                <>
                  {canEditContent && (
                    <div className="amp-case-content-actions">
                      <button type="button" onClick={() => setIsEditingContent(true)}>
                        <InlineIcon name="edit" />
                        {t(CHINESE_ACTIONS.edit, ENGLISH_ACTIONS.edit)}
                      </button>
                    </div>
                  )}
                  <div className="amp-case-detail-tab-panel">
                    <DetailSection title={t("标题", "Title")}>{item.title}</DetailSection>
                    <DetailSection title={t("内容", "Content")}>{item.body || item.description || t("待补充", "Not available yet")}</DetailSection>
                  </div>
                </>
              )}
            </div>
            <div className="amp-case-detail-metrics">
              <Metric icon="heart" label={t("点赞", "Likes")} value={formatNumber(item.likes, locale, t)} />
              <Metric icon="star" label={t("收藏", "Favorites")} value={formatNumber(item.favorites_count, locale, t)} />
              <Metric icon="message" label={t("评论", "Comments")} value={formatNumber(item.comments, locale, t)} />
            </div>
          </aside>
          <div className="amp-case-detail-content">
            {tab === "analysis" ? (
              <div className="amp-case-detail-scroll amp-case-detail-analysis-page">
                <div className="amp-case-analysis-toolbar">
                  {hasAnalysisContent && (
                    <div>
                      <strong>{t("AI 分析结果", "AI analysis results")}</strong>
                      <span>{analysisMeta}</span>
                    </div>
                  )}
                  {canEditContent && (
                    <GuardedButton type="button" className={`amp-button ${hasAnalysisContent ? "amp-button-secondary" : "amp-button-primary"} amp-case-analyze-button`}
                      blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                      onClick={handleAnalyze} disabled={isAnalyzing || isStartingAnalysis}>
                      {(isAnalyzing || isStartingAnalysis) && (
                        <span className="amp-case-analysis-spinner" aria-hidden="true" />
                      )}
                      {analyzeLabel}
                    </GuardedButton>
                  )}
                </div>
                {isAnalyzing ? (
                  <div className="amp-case-analysis-empty" role="status">
                    <span className="amp-case-analysis-spinner" aria-hidden="true" />
                    <strong>{t("AI 正在分析案例", "AI is analyzing this case")}</strong>
                    <p>{t("分析会在后台完成，结果将自动刷新。", "Analysis will finish in the background and refresh automatically.")}</p>
                  </div>
                ) : analysis && hasAnalysisContent ? (
                  <div className="amp-case-detail-analysis">
                    {summaryBlock && <AnalysisCard block={summaryBlock} featured onCopy={copyAnalysisBlock} />}
                    <AnalysisGroup title={t("内容判断", "Content assessment")} blocks={judgmentBlocks} onCopy={copyAnalysisBlock} />
                    <AnalysisGroup title={t("可复用洞察", "Reusable insights")} blocks={reusableBlocks} onCopy={copyAnalysisBlock} />
                    {videoBlocks.length > 0 && (
                      <AnalysisGroup title={t("视频结构", "Video structure")} blocks={videoBlocks} onCopy={copyAnalysisBlock} />
                    )}
                    <AnalysisGroup title={t("优化输出", "Optimization output")} blocks={outputBlocks} onCopy={copyAnalysisBlock} />
                  </div>
                ) : (
                  <div className="amp-case-analysis-empty">
                    <InlineIcon name="sparkle" />
                    <strong>{t("尚未进行 AI 分析", "No AI analysis yet")}</strong>
                    <p>{canEditContent
                      ? t("点击上方“AI 分析”，提炼内容亮点、可复用结构与改写建议。", "Select Analyze above for highlights, reusable structures, and editing suggestions.")
                      : t("有管理权限的成员完成分析后，你可以在这里查看结果。", "Results will appear here after an authorized member runs the analysis.")}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: "heart" | "star" | "message"; label: string; value: string }) {
  return (
    <div>
      <span className="amp-case-metric-icon"><InlineIcon name={icon} /></span>
      <div className="amp-case-metric-copy">
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-sm font-semibold text-slate-950 dark:text-white">{value}</div>
      </div>
    </div>
  );
}

function AnalysisGroup({
  title,
  blocks,
  onCopy,
}: {
  title: string;
  blocks: AnalysisBlock[];
  onCopy: (block: AnalysisBlock) => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <section className="amp-case-analysis-group">
      <h3>{title}</h3>
      <div className="amp-case-analysis-columns">
        {blocks.map((block) => (
          <AnalysisCard key={block.key} block={block} onCopy={onCopy} />
        ))}
      </div>
    </section>
  );
}

function AnalysisCard({
  block,
  featured = false,
  onCopy,
}: {
  block: AnalysisBlock;
  featured?: boolean;
  onCopy: (block: AnalysisBlock) => void;
}) {
  const { t } = useI18n();

  return (
    <section className={`amp-case-analysis-card${featured ? " amp-case-analysis-card-featured" : ""}`}>
      <div className="amp-case-analysis-card-header">
        <h4>{block.title}</h4>
        <button type="button" onClick={() => onCopy(block)}
          aria-label={t("复制{title}", "Copy {title}", { title: block.title })} title={t(CHINESE_ACTIONS.copy, ENGLISH_ACTIONS.copy)}>
          <InlineIcon name="copy" />
        </button>
      </div>
      {block.items ? <BulletList items={block.items} /> : <p>{block.text}</p>}
    </section>
  );
}

function DetailSection({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`amp-case-detail-section${wide ? " amp-case-detail-section-wide" : ""}`}>
      <h3 className="text-sm font-semibold text-slate-950 dark:text-white">{title}</h3>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <span>—</span>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function filterLabel(value: FilterValue, t: Translate): string {
  const labels = { "全部类型": "All types", "图文": "Image post", "视频": "Video" };
  return t(value, labels[value]);
}

function recognitionStatusLabel(value: string, t: Translate): string {
  const labels: Record<string, string> = {
    pending: t("等待中", "Pending"),
    processing: t("处理中", "Processing"),
    recognized: t("已识别", "Recognized"),
    failed: t("失败", "Failed"),
  };
  return labels[value] || value;
}
