"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n_context";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import ProjectQuickSearchList from "@/components/projects/ProjectQuickSearchList";

const STORAGE_KEY = "amp-publishing-sidebar-collapsed";
const MODULES = {
  publishing: {
    path: "/publishing", storage: STORAGE_KEY, icon: "send",
    filter: ["发布项目筛选", "Publishing project filter"],
    expand: ["展开发布侧栏", "Expand publishing sidebar"],
    collapse: ["收起发布侧栏", "Collapse publishing sidebar"],
    all: ["全部发布", "All publishing"],
  },
  accountContent: {
    path: "/account_content", storage: "amp-account-content-sidebar-collapsed", icon: "content",
    filter: ["账号内容项目筛选", "Account content project filter"],
    expand: ["展开账号内容侧栏", "Expand account content sidebar"],
    collapse: ["收起账号内容侧栏", "Collapse account content sidebar"],
    all: ["全部账号", "All accounts"],
  },
  leadTracking: {
    path: "/lead_tracking", storage: "amp-lead-tracking-sidebar-collapsed", icon: "target",
    filter: ["线索追踪项目筛选", "Lead tracking project filter"],
    expand: ["展开线索追踪侧栏", "Expand lead tracking sidebar"],
    collapse: ["收起线索追踪侧栏", "Collapse lead tracking sidebar"],
    all: ["全部账号", "All accounts"],
  },
} as const;

export default function PublishingProjectSidebar({
  projects,
  selectedProjectId,
  accountContent = false,
  module = accountContent ? "accountContent" : "publishing",
}: {
  projects: ContentProject[];
  selectedProjectId?: string;
  accountContent?: boolean;
  module?: keyof typeof MODULES;
}) {
  const { t } = useI18n();
  const settings = MODULES[module];
  const basePath = settings.path;
  const storageKey = settings.storage;
  const [collapsed, setCollapsed] = useState(false);
  const [transitionReady, setTransitionReady] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(window.localStorage.getItem(storageKey) === "true");
    const frame = window.requestAnimationFrame(() => setTransitionReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  };

  return (
    <aside
      className={`amp-project-quick-sidebar ${collapsed ? "amp-project-quick-sidebar-collapsed" : ""} ${transitionReady ? "" : "amp-project-quick-sidebar-initializing"}`}
      aria-label={t(settings.filter[0], settings.filter[1])}
    >
      <div className="amp-project-quick-sidebar-header">
        <span>{t("快速访问", "Quick access")}</span>
        <button type="button" onClick={toggle}
          aria-label={collapsed ? t(settings.expand[0], settings.expand[1]) : t(settings.collapse[0], settings.collapse[1])}>
          <InlineIcon name={collapsed ? "panelLeftOpen" : "panelLeftClose"} />
        </button>
      </div>
      <nav className="amp-project-quick-nav">
        <Link href={basePath}
          aria-current={!selectedProjectId ? "page" : undefined}
          className={!selectedProjectId ? "amp-project-quick-active" : ""}>
          <span className="amp-project-quick-icon"><InlineIcon name={settings.icon} /></span>
          <span className="amp-project-quick-label">{t(settings.all[0], settings.all[1])}</span>
        </Link>
        <div className="amp-project-quick-divider" />
        <p className="amp-project-quick-section-label">{t("按项目查看", "By project")}</p>
        <ProjectQuickSearchList projects={projects} renderProject={(project) => (
          <Link key={project.id}
            href={`${basePath}?project=${encodeURIComponent(project.id)}`}
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
