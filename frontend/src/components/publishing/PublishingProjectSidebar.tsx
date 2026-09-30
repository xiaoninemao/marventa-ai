"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n_context";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import ProjectQuickSearchList from "@/components/projects/ProjectQuickSearchList";

const STORAGE_KEY = "amp-publishing-sidebar-collapsed";

export default function PublishingProjectSidebar({
  projects,
  selectedProjectId,
}: {
  projects: ContentProject[];
  selectedProjectId?: string;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [transitionReady, setTransitionReady] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
    const frame = window.requestAnimationFrame(() => setTransitionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <aside
      className={`amp-project-quick-sidebar ${collapsed ? "amp-project-quick-sidebar-collapsed" : ""} ${transitionReady ? "" : "amp-project-quick-sidebar-initializing"}`}
      aria-label={t("发布项目筛选", "Publishing project filter")}
    >
      <div className="amp-project-quick-sidebar-header">
        <span>{t("快速访问", "Quick access")}</span>
        <button type="button" onClick={toggle}
          aria-label={collapsed ? t("展开发布侧栏", "Expand publishing sidebar") : t("收起发布侧栏", "Collapse publishing sidebar")}>
          <InlineIcon name={collapsed ? "panelLeftOpen" : "panelLeftClose"} />
        </button>
      </div>
      <nav className="amp-project-quick-nav">
        <Link href="/publishing"
          aria-current={!selectedProjectId ? "page" : undefined}
          className={!selectedProjectId ? "amp-project-quick-active" : ""}>
          <span className="amp-project-quick-icon"><InlineIcon name="send" /></span>
          <span className="amp-project-quick-label">{t("全部发布", "All publishing")}</span>
        </Link>
        <div className="amp-project-quick-divider" />
        <p className="amp-project-quick-section-label">{t("按项目查看", "By project")}</p>
        <ProjectQuickSearchList projects={projects} renderProject={(project) => (
          <Link key={project.id}
            href={`/publishing?project=${encodeURIComponent(project.id)}`}
            aria-current={selectedProjectId === project.id ? "page" : undefined}
            className={selectedProjectId === project.id ? "amp-project-quick-active" : ""}
            title={project.title}>
            <span className="amp-project-quick-avatar"
              style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
              {project.avatar_icon || "💡"}
            </span>
            <span className="amp-project-quick-label">{project.title}</span>
          </Link>
        )} />
      </nav>
    </aside>
  );
}
