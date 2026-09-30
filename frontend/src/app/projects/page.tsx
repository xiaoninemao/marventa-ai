"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  create_manual_content_project,
  delete_content_project,
  fetch_content_projects,
  update_content_project,
} from "@/services/api_client";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import RedesignInput from "@/components/redesign/RedesignInput";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import ProjectQuickSidebar from "@/components/projects/ProjectQuickSidebar";
import { userAvatarColor as memberAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

type ProjectSort = "latest" | "oldest" | "name";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

const projectAvatarColors = [
  "#bfdbfe", "#93c5fd", "#a5b4fc", "#c7d2fe", "#ddd6fe", "#e9d5ff",
  "#f5d0fe", "#fbcfe8", "#fecdd3", "#bbf7d0", "#a7f3d0", "#fde68a",
  "#fcd34d", "#fed7aa", "#fdba74", "#fecaca", "#e5e7eb", "#d1d5db",
];

const projectAvatarEmojis = [
  "🎯", "🚀", "💡", "📣", "📈", "📊", "🧠", "✨", "📝",
  "🎨", "📷", "🎬", "🎙️", "🛍️", "🏷️", "📅", "💬", "🤝",
  "🌐", "🧪", "🧭", "💎", "🏆", "🚩", "🔥", "💰", "⭐",
];

function projectDate(value: string, locale: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function projectTimestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function memberAvatarUrl(url: string) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const customizeDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("latest");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<ContentProject | null>(null);
  const [customizingProject, setCustomizingProject] = useState<ContentProject | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customColor, setCustomColor] = useState(projectAvatarColors[0]);
  const [customIcon, setCustomIcon] = useState("💡");
  const [projectActionBusy, setProjectActionBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  useEffect(() => {
    if (!menuProjectId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuProjectId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuProjectId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setProjectsLoading(true);
    fetch_content_projects()
      .then((response) => {
        if (!cancelled) setProjects(response.data || []);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Fetch projects failed", locale));
        }
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, showError, user]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = normalizedQuery
      ? projects.filter((project) =>
        [project.title, project.notes, project.platform_hint, project.xhs_account]
          .join(" ")
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery))
      : projects;
    return [...filtered].sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title, locale);
      const difference = projectTimestamp(left.updated_at) - projectTimestamp(right.updated_at);
      return sort === "oldest" ? difference : -difference;
    });
  }, [locale, projects, query, sort]);

  const openCreateDialog = () => {
    setTitle("");
    setDescription("");
    setDialogOpen(true);
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      showError(t("项目名称不能为空", "Project name is required"));
      return;
    }
    const duplicate = projects.some(
      (project) => project.user_id === user?.id
        && project.title.trim().toLocaleLowerCase(locale)
        === normalizedTitle.toLocaleLowerCase(locale),
    );
    if (duplicate) {
      showError(t("项目名称已存在", "Project name already exists"));
      return;
    }
    setCreating(true);
    try {
      const response = await create_manual_content_project({
        title: normalizedTitle,
        notes: description.trim(),
        content_type: "mixed",
      });
      setProjects((current) => [response.data, ...current]);
      dialogRef.current?.close();
      setDialogOpen(false);
      showSuccess(t("项目已创建", "Project created"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Create manual project failed", locale));
    } finally {
      setCreating(false);
    }
  };

  const openProject = (projectId: string) => {
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const openDeleteDialog = (project: ContentProject) => {
    setMenuProjectId(null);
    setDeletingProject(project);
    requestAnimationFrame(() => deleteDialogRef.current?.showModal());
  };

  const openCustomizeDialog = (project: ContentProject) => {
    setMenuProjectId(null);
    setCustomizingProject(project);
    setCustomTitle(project.title);
    setCustomDescription(project.notes);
    setCustomColor(project.avatar_color || projectAvatarColors[0]);
    setCustomIcon(project.avatar_icon || "💡");
    requestAnimationFrame(() => customizeDialogRef.current?.showModal());
  };

  const customizeProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customizingProject) return;
    const title = customTitle.trim();
    if (!title) {
      showError(t("项目名称不能为空", "Project name is required"));
      return;
    }
    const duplicate = projects.some(
      (project) => project.id !== customizingProject.id
        && project.user_id === customizingProject.user_id
        && project.title.trim().toLocaleLowerCase(locale) === title.toLocaleLowerCase(locale),
    );
    if (duplicate) {
      showError(t("项目名称已存在", "Project name already exists"));
      return;
    }
    setProjectActionBusy(true);
    try {
      const response = await update_content_project(customizingProject.id, {
        title,
        notes: customDescription.trim(),
        avatar_color: customColor,
        avatar_icon: customIcon,
      });
      setProjects((current) => current.map((project) =>
        project.id === response.data.id ? response.data : project));
      customizeDialogRef.current?.close();
      setCustomizingProject(null);
      showSuccess(t("项目自定义设置已保存。", "Project customization saved."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not update project", locale));
    } finally {
      setProjectActionBusy(false);
    }
  };

  const deleteProject = async () => {
    if (!deletingProject) return;
    setProjectActionBusy(true);
    try {
      await delete_content_project(deletingProject.id);
      setProjects((current) => current.filter((project) => project.id !== deletingProject.id));
      deleteDialogRef.current?.close();
      setDeletingProject(null);
      showSuccess(t("项目已删除。", "Project deleted."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not delete project", locale));
    } finally {
      setProjectActionBusy(false);
    }
  };

  if (loading || !user) {
    return <div className="amp-page-state" role="status">{t("加载中...", "Loading...")}</div>;
  }

  return (
    <div className="amp-projects-layout">
      <ProjectQuickSidebar projects={projects} />
      <main className="amp-projects-main">
        <div className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{t("项目", "Projects")}</h1>
            <p>{t("在一个空间中管理市场洞察、案例、智能创作与作品。", "Manage market insights, cases, generated content, and portfolio work in one place.")}</p>
          </div>
          <button type="button" className="amp-button amp-button-primary" onClick={openCreateDialog}>
            {t("创建项目", "Create project")}
          </button>
        </div>

        <div className="amp-projects-toolbar">
          <div className="amp-projects-search">
            <RedesignInput
              leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索项目", "Search projects")}
              aria-label={t("搜索项目", "Search projects")}
            />
          </div>
          <EnterpriseSelect
            value={sort}
            options={[
              { value: "latest", label: t("最近更新", "Latest activity") },
              { value: "oldest", label: t("最早更新", "Oldest activity") },
              { value: "name", label: t("项目名称", "Project name") },
            ]}
            onChange={setSort}
            ariaLabel={t("项目排序", "Project sorting")}
            className="w-40"
          />
        </div>

        {projectsLoading ? (
          <div className="amp-projects-state" role="status">{t("正在加载项目...", "Loading projects...")}</div>
        ) : visibleProjects.length === 0 ? (
          <div className="amp-projects-state">
            <span className="amp-projects-empty-icon"><InlineIcon name="folder" /></span>
            <strong>{query ? t("没有匹配的项目", "No matching projects") : t("暂无项目", "No projects yet")}</strong>
            <p>{query
              ? t("尝试其他搜索关键词。", "Try a different search term.")
              : t("创建第一个项目来整理创作内容和素材。", "Create your first project to organize content and assets.")}</p>
          </div>
        ) : (
          <div className="amp-projects-grid">
            {visibleProjects.map((project) => (
              <article key={project.id} className="amp-project-card">
                <button type="button" className="amp-project-card-open" onClick={() => openProject(project.id)} aria-label={t("打开项目 {name}", "Open project {name}", { name: project.title })}>
                  <span className="amp-project-avatar amp-project-custom-avatar"
                    style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
                    <span className="amp-project-avatar-emoji">{project.avatar_icon || "💡"}</span>
                  </span>
                  <span className="amp-project-card-copy">
                    <strong>{project.title || t("未命名项目", "Untitled project")}</strong>
                    <span className="amp-project-card-description">
                      {project.notes || t("添加项目描述", "Add a description")}
                    </span>
                    <span className="amp-project-card-members"
                      aria-label={t("{count} 位项目成员", "{count} project members", { count: project.member_count })}>
                      {project.members.slice(0, 4).map((member, index) => (
                        <span key={member.user_id}
                          className={`amp-project-card-member-avatar text-white ${member.avatar_url ? "" : memberAvatarColor(member.user_id)}`}
                          style={{ zIndex: project.members.length - index }}
                          title={member.nickname || member.username}>
                          {member.avatar_url ? (
                            <Image src={memberAvatarUrl(member.avatar_url)} alt="" width={34} height={34} unoptimized />
                          ) : userAvatarInitial(member.nickname || member.username)}
                        </span>
                      ))}
                      {project.member_count > 4 && (
                        <span className="amp-project-card-member-avatar amp-project-card-member-more" title={t("更多成员", "More members")}>...</span>
                      )}
                    </span>
                    <span className="amp-project-card-meta">
                      {t("由 {name} 更新于 {date}", "Last updated by {name} on {date}", {
                        name: user.nickname || user.username,
                        date: projectDate(project.updated_at || project.created_at, locale),
                      })}
                    </span>
                  </span>
                </button>
                <div ref={menuProjectId === project.id ? menuRef : undefined} className="amp-project-card-menu">
                  <button type="button" className="amp-project-card-more"
                    aria-label={t("{name} 项目操作", "Actions for {name}", { name: project.title })}
                    aria-haspopup="menu" aria-expanded={menuProjectId === project.id}
                    onClick={() => setMenuProjectId((current) => current === project.id ? null : project.id)}>
                    <InlineIcon name="more" strokeWidth={3} />
                  </button>
                  {menuProjectId === project.id && (
                    <div role="menu" className="amp-project-card-popover">
                    <button type="button" role="menuitem"
                      disabled={project.role !== "owner" && project.role !== "admin"}
                      aria-disabled={project.role !== "owner" && project.role !== "admin"}
                      onClick={() => openCustomizeDialog(project)}>
                      <InlineIcon name="edit" />
                      {t("自定义", "Customize")}
                    </button>
                    <button type="button" role="menuitem" className="amp-project-card-delete"
                      disabled={project.role !== "owner" && project.role !== "admin"}
                      aria-disabled={project.role !== "owner" && project.role !== "admin"}
                      onClick={() => openDeleteDialog(project)}>
                      <InlineIcon name="trash" />
                      {t("删除", "Delete")}
                    </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <dialog
        ref={dialogRef}
        aria-labelledby="create-project-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          event.preventDefault();
          if (!creating) setDialogOpen(false);
        }}
        onClose={() => setDialogOpen(false)}
      >
        <h2 id="create-project-title" className="text-xl font-semibold">{t("创建项目", "Create project")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("创建后可添加市场洞察、案例、智能创作和作品等资产。", "Add market insights, cases, generated content, portfolio work, and other assets after creating the project.")}</p>
        <form onSubmit={createProject} className="mt-6">
          <label htmlFor="project-title" className="mb-2 block text-sm font-medium">{t("项目名称", "Project name")}</label>
          <input
            id="project-title"
            autoFocus
            required
            maxLength={120}
            value={title}
            disabled={creating}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("例如：秋季新品推广", "For example: Fall product launch")}
            className="amp-workspace-control w-full"
          />
          <label htmlFor="project-description" className="mb-2 mt-5 block text-sm font-medium">{t("项目描述", "Description")}</label>
          <textarea
            id="project-description"
            rows={4}
            maxLength={500}
            value={description}
            disabled={creating}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("简要说明项目目标（可选）", "Briefly describe the project goal (optional)")}
            className="amp-workspace-control w-full resize-none"
          />
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={creating} onClick={() => setDialogOpen(false)}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={creating}>
              {creating ? t("创建中...", "Creating...") : t("创建", "Create")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={customizeDialogRef} aria-labelledby="customize-project-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-2xl bg-white p-0 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (projectActionBusy) event.preventDefault(); }}
        onClose={() => { if (!projectActionBusy) setCustomizingProject(null); }}>
        <form className="amp-project-customize amp-project-customize-dialog" onSubmit={customizeProject}>
          <h2 id="customize-project-title">{t("自定义项目", "Customize project")}</h2>
          <div className="amp-project-customize-identity">
            <span className="amp-project-customize-preview" style={{ backgroundColor: customColor }}>
              <span>{customIcon}</span>
            </span>
            <label>
              <span>{t("项目名称", "Project name")}</span>
              <input value={customTitle} maxLength={120} disabled={projectActionBusy}
                onChange={(event) => setCustomTitle(event.target.value)}
                className="amp-workspace-control" />
            </label>
          </div>
          <label className="amp-project-customize-description">
            <span>{t("项目描述", "Description")}</span>
            <textarea value={customDescription} maxLength={500} rows={3} disabled={projectActionBusy}
              onChange={(event) => setCustomDescription(event.target.value)}
              className="amp-workspace-control" />
          </label>
          <fieldset className="amp-project-customize-colors">
            <legend>{t("颜色", "Color")}</legend>
            <div>
              {projectAvatarColors.map((color) => (
                <button key={color} type="button" aria-label={t("选择颜色 {color}", "Select color {color}", { color })}
                  aria-pressed={customColor === color} style={{ backgroundColor: color }}
                  onClick={() => setCustomColor(color)}>
                  {customColor === color && <InlineIcon name="check" />}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="amp-project-customize-emojis">
            <legend>{t("表情", "Emoji")}</legend>
            <div>
              {projectAvatarEmojis.map((emoji) => (
                <button key={emoji} type="button" aria-label={t("选择 {emoji}", "Select {emoji}", { emoji })}
                  aria-pressed={customIcon === emoji} onClick={() => setCustomIcon(emoji)}>
                  <span>{emoji}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="amp-project-customize-actions">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={projectActionBusy}
              onClick={() => customizeDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={projectActionBusy}>
              {projectActionBusy ? t("保存中...", "Saving...") : t("保存", "Save")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={deleteDialogRef} aria-labelledby="delete-project-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (projectActionBusy) event.preventDefault(); }}
        onClose={() => { if (!projectActionBusy) setDeletingProject(null); }}>
        <h2 id="delete-project-title" className="text-xl font-semibold">{t("删除项目", "Delete project")}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {t("确定删除「{name}」吗？项目成员关系和项目内资产将被删除，此操作无法撤销。", "Delete {name}? Project memberships and project assets will be removed. This cannot be undone.", {
            name: deletingProject?.title || "",
          })}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={projectActionBusy}
            onClick={() => deleteDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
          <button type="button" className="amp-button amp-project-delete-confirm" disabled={projectActionBusy}
            onClick={() => void deleteProject()}>
            {projectActionBusy ? t("删除中...", "Deleting...") : t("确认删除", "Delete")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
