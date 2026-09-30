"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { Locale, Translate } from "@/i18n/locale";
import {
  fetch_content_projects,
  fetch_sessions,
} from "@/services/api_client";
import type { ContentProject } from "@/types/publishing";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import RedesignBadge from "@/components/redesign/RedesignBadge";
import RedesignCard from "@/components/redesign/RedesignCard";
import RedesignIconBox from "@/components/redesign/RedesignIconBox";
import RedesignMetricCard from "@/components/redesign/RedesignMetricCard";

const metricCards = [
  { key: "activeProjects", label: "进行中的项目", labelEn: "Active projects", icon: "folder" as InlineIconName, path: "/projects" },
  { key: "generatedContent", label: "已生成内容", labelEn: "Generated content", icon: "edit" as InlineIconName, path: "/content_generator" },
];

const zeroDashboardMetrics = {
  activeProjects: "0",
  generatedContent: "0",
};

type DashboardMetricKey = keyof typeof zeroDashboardMetrics;

type RecentProjectItem = {
  id: string;
  title: string;
  tag: string;
  time: string;
  avatarColor: string;
  avatarEmoji: string;
};

function formatProjectTime(value: string, locale: Locale, t: Translate) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("更新时间未知", "Update time unavailable");
  if (locale === "en") return `Updated ${date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`;
  const pad = (num: number) => String(num).padStart(2, "0");
  return `更新于 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function projectTag(project: ContentProject, t: Translate) {
  const platform = project.platform_hint?.trim();
  if (platform === "小红书" || platform === "xiaohongshu") return t("小红书", "Xiaohongshu");
  if (platform === "抖音" || platform === "douyin") return t("抖音", "Douyin");
  if (platform) return platform;
  const typeLabels: Record<string, string> = {
    image_text: t("图文内容", "Image post"),
    video: t("视频内容", "Video content"),
    mixed: t("混合内容", "Mixed content"),
  };
  return typeLabels[project.content_type] || t("内容项目", "Content project");
}

function toRecentProject(project: ContentProject, locale: Locale, t: Translate): RecentProjectItem {
  return {
    id: project.id,
    title: project.title || t("未命名项目", "Untitled project"),
    tag: projectTag(project, t),
    time: formatProjectTime(project.updated_at || project.created_at, locale, t),
    avatarColor: project.avatar_color || "#bfdbfe",
    avatarEmoji: project.avatar_icon || "💡",
  };
}

const quickActions = [
  { label: "市场洞察", labelEn: "Market Insight", path: "/market_insight", icon: "insight" as InlineIconName },
  { label: "案例库", labelEn: "Case Library", path: "/case_library", icon: "case" as InlineIconName },
  { label: "作品集", labelEn: "Portfolio", path: "/portfolio", icon: "briefcase" as InlineIconName },
  { label: "发布管理", labelEn: "Publishing", path: "/publishing", icon: "send" as InlineIconName },
  { label: "设置", labelEn: "Settings", path: "/settings", icon: "settings" as InlineIconName },
];

export default function ModuleListing() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const displayName = user?.nickname || user?.username || t("用户", "User");
  const [dashboardMetrics, setDashboardMetrics] = useState(zeroDashboardMetrics);
  const [recentProjectData, setRecentProjects] = useState<ContentProject[]>([]);
  const recentProjects = recentProjectData.map((project) => toRecentProject(project, locale, t));

  useEffect(() => {
    if (!user) {
      setDashboardMetrics(zeroDashboardMetrics);
      setRecentProjects([]);
      return;
    }

    let cancelled = false;

    async function loadDashboardMetrics() {
      try {
        const [sessionsRes, projectsRes] = await Promise.all([
          fetch_sessions(),
          fetch_content_projects(),
        ]);

        if (!sessionsRes.success || !projectsRes.success) {
          throw new Error(t("工作台数据加载失败", "Could not load dashboard data"));
        }
        const sessions = sessionsRes.data;
        const projects = projectsRes.data;
        const generatedContent = sessions.reduce((sum, session) => sum + (session.cards?.length || 0), 0);
        const activeProjects = projects.filter((project) => project.status !== "archived").length;

        if (!cancelled) {
          setDashboardMetrics({
            activeProjects: String(activeProjects),
            generatedContent: String(generatedContent),
          });
          setRecentProjects(projects.slice(0, 5));
        }
      } catch (error) {
        if (!cancelled) {
          showError(localizeErrorMessage(
            error instanceof Error ? error.message : t("工作台数据加载失败", "Could not load dashboard data"),
            locale,
          ));
        }
      }
    }

    loadDashboardMetrics();

    return () => {
      cancelled = true;
    };
  }, [user, locale, showError, t]);

  return (
    <div className="amp-redesign">
          <div className="amp-dashboard-content">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="amp-module-title">{t("欢迎回来，{name}", "Welcome back, {name}", { name: displayName })}</h1>
              </div>
              <Link href="/projects" className="amp-button amp-button-primary">
                {t("新建项目", "New project")}
              </Link>
            </div>

            <section className="amp-dashboard-grid">
              {metricCards.map((metric) => (
                <Link key={metric.label} href={metric.path} className="amp-dashboard-metric-link"
                  aria-label={t("打开{label}", "Open {label}", { label: t(metric.label, metric.labelEn) })}>
                  <RedesignMetricCard
                    label={t(metric.label, metric.labelEn)}
                    value={dashboardMetrics[metric.key as DashboardMetricKey]}
                    icon={
                      <RedesignIconBox>
                        <InlineIcon name={metric.icon} className="h-[22px] w-[22px]" />
                      </RedesignIconBox>
                    }
                  />
                </Link>
              ))}
              <RedesignCard className="amp-dashboard-panel amp-dashboard-quick-access">
                <h2 className="mb-4 text-base font-semibold text-slate-950">{t("快速访问", "Quick access")}</h2>
                <div className="amp-dashboard-quick-links">
                  {quickActions.map((item) => (
                    <Link key={item.path} href={item.path} className="text-center">
                      <RedesignIconBox className="mx-auto">
                        <InlineIcon name={item.icon} className="h-5 w-5" />
                      </RedesignIconBox>
                      <span className="mt-1 block text-xs font-bold text-slate-600">{t(item.label, item.labelEn)}</span>
                    </Link>
                  ))}
                </div>
              </RedesignCard>
            </section>

            <section className="amp-dashboard-details">
              <RedesignCard className="amp-dashboard-intro">
                <div className="amp-dashboard-intro-copy">
                  <h2>{t("用 AI 激发营销创意，加速品牌增长", "Turn ideas into content. Build your brand with AI.")}</h2>
                  <p>{t("智能洞察 · 案例参考 · 内容生成 · 作品与发布管理", "Market insight · Case studies · Content creation · Portfolio and publishing management")}</p>
                </div>
                <div className="amp-dashboard-intro-art">
                  <Image src="/assets/illustrations/dashboard-intro-art.webp" alt="" fill unoptimized loading="eager"
                    sizes="(max-width: 768px) 100vw, 50vw" />
                </div>
              </RedesignCard>
              <RedesignCard className="amp-dashboard-panel flex min-h-[356px] flex-col">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-950">{t("最近项目", "Recent projects")}</h2>
                  <Link href="/projects" className="text-sm font-bold text-blue-600">
                    {t("查看全部", "View all")}
                  </Link>
                </div>
                <div className={`grid flex-1 gap-2 ${recentProjects.length > 0 ? "content-start" : ""}`}>
                  {recentProjects.length > 0 ? (
                    recentProjects.map((project) => (
                      <Link href={`/projects/${encodeURIComponent(project.id)}`} key={project.id} className="flex items-center gap-4 border-b border-slate-100 py-3 last:border-b-0">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] text-xl"
                          style={{ backgroundColor: project.avatarColor }} aria-hidden="true">
                          {project.avatarEmoji}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{project.title}</p>
                          <RedesignBadge tone="cyan" className="mt-1">
                            {project.tag}
                          </RedesignBadge>
                          <span className="mt-1 block text-xs font-semibold text-slate-400">{project.time}</span>
                        </div>
                        <InlineIcon name="chevronRight" className="h-5 w-5 shrink-0 text-slate-300" />
                      </Link>
                    ))
                  ) : (
                    <div className="flex min-h-[230px] flex-col items-center justify-center px-6 text-center">
                      <RedesignIconBox>
                        <InlineIcon name="folder" className="h-5 w-5" />
                      </RedesignIconBox>
                      <p className="mt-3 text-sm font-semibold text-slate-900">{t("暂无项目", "No projects yet")}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{t("保存内容项目后会显示在这里", "Your saved content projects will appear here.")}</p>
                    </div>
                  )}
                </div>
              </RedesignCard>

            </section>

          </div>
    </div>
  );
}
