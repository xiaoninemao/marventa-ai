"use client";

import type { FormEvent, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import RedesignInput from "@/components/redesign/RedesignInput";
import UserMenu from "@/components/layout/user_menu";
import OrganizationSwitcher from "@/components/layout/organization_switcher";
import NotificationCenter from "@/components/layout/notification_center";

const navItems: Array<{ label: string; labelEn: string; path: string; icon: InlineIconName }> = [
  { label: "首页", labelEn: "Home", path: "/", icon: "home" },
  { label: "项目", labelEn: "Projects", path: "/projects", icon: "folder" },
  { label: "市场洞察", labelEn: "Market Insight", path: "/market_insight", icon: "insight" },
  { label: "案例库", labelEn: "Case Library", path: "/case_library", icon: "case" },
  { label: "智能创作", labelEn: "Content Studio", path: "/content_generator", icon: "edit" },
  { label: "作品集", labelEn: "Portfolio", path: "/portfolio", icon: "briefcase" },
  { label: "发布管理", labelEn: "Publishing", path: "/publishing", icon: "send" },
  { label: "账号内容", labelEn: "Account Content", path: "/account_content", icon: "content" },
];

const utilityNavItems: Array<{ label: string; labelEn: string; path: string; icon: InlineIconName }> = [
  { label: "组织管理", labelEn: "Organizations", path: "/organizations", icon: "organization" },
  { label: "设置", labelEn: "Settings", path: "/settings", icon: "settings" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const isHome = pathname === "/";
  const shouldUseShell = Boolean(user) || pathname !== "/";
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("amp-theme");
    setTheme(stored === "light" ? "light" : "dark");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("amp-theme", theme);
  }, [theme]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return [...navItems, ...utilityNavItems]
      .filter((item) => [item.label, item.labelEn, item.path].join(" ").toLowerCase().includes(query))
      .slice(0, 6);
  }, [searchQuery]);

  const goToSearchResult = (path: string) => {
    setSearchQuery("");
    setSearchFocused(false);
    router.push(path);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchResults[0]) goToSearchResult(searchResults[0].path);
  };

  if (!shouldUseShell) {
    return <div className="amp-public-scroll">{children}</div>;
  }

  if (loading) {
    return <main className="amp-redesign amp-app-pending">{children}</main>;
  }

  return (
    <div className={`amp-redesign amp-app-shell ${theme === "dark" ? "amp-nav-dark" : "amp-nav-light"} ${sidebarExpanded ? "amp-app-shell-expanded" : "amp-app-shell-collapsed"}`}>
      <header className="amp-app-topbar">
        <OrganizationSwitcher />
        <form className="amp-app-quick-search" role="search" onSubmit={submitSearch}>
          <RedesignInput
            leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            placeholder={t("搜索功能", "Search features")}
            aria-label={t("搜索功能", "Search features")}
          />
          {searchFocused && searchResults.length > 0 && (
            <div className="amp-app-quick-search-results">
              {searchResults.map((item) => (
                <button key={item.path} type="button" onMouseDown={(event) => event.preventDefault()}
                  onClick={() => goToSearchResult(item.path)}>
                  <InlineIcon name={item.icon} />
                  <span>{t(item.label, item.labelEn)}</span>
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="amp-app-topbar-tools">
          <NotificationCenter />
          <button
            type="button"
            className="amp-app-icon-button amp-app-theme-button"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            aria-label={theme === "dark" ? t("切换浅色主题", "Switch to light theme") : t("切换深色主题", "Switch to dark theme")}
          >
            <InlineIcon name={theme === "dark" ? "sun" : "moon"} className="h-[18px] w-[18px]" />
          </button>
          {user ? <UserMenu /> : (
            <Link href="/" prefetch={false} className="amp-app-topbar-action">
              <InlineIcon name="user" className="h-4 w-4" />
              <span>{t("个人中心", "Account")}</span>
            </Link>
          )}
        </div>
      </header>

      <div className="amp-app-body">
        <aside
          className="amp-app-sidebar"
          aria-label={t("主导航", "Main navigation")}
          onMouseEnter={() => setSidebarExpanded(true)}
          onMouseLeave={() => setSidebarExpanded(false)}
          onFocus={() => setSidebarExpanded(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSidebarExpanded(false);
          }}
        >
          <nav className="amp-dashboard-nav" aria-label={t("工作台导航", "Workspace navigation")}>
            {navItems.map((item) => {
              const active = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
              const content = (
                <>
                  <span className="amp-app-nav-icon">
                    <InlineIcon name={item.icon} />
                  </span>
                  <span className="amp-app-nav-label">{t(item.label, item.labelEn)}</span>
                </>
              );

              return (
                <Fragment key={item.path}>
                {item.path === "/market_insight" && (
                  <div className="amp-app-nav-divider" role="separator" aria-label={t("生产", "Production")}>
                    <span>{t("生产", "Production")}</span>
                  </div>
                )}
                <Link href={item.path} prefetch={false} className={`amp-dashboard-nav-item ${active ? "amp-dashboard-nav-item-active" : ""}`} title={t(item.label, item.labelEn)}>
                  {content}
                </Link>
                {item.path === "/portfolio" && (
                  <div className="amp-app-nav-divider" role="separator" aria-label={t("运营", "Operations")}>
                    <span>{t("运营", "Operations")}</span>
                  </div>
                )}
                </Fragment>
              );
            })}
          </nav>

          <div className="amp-dashboard-sidebar-bottom">
            {utilityNavItems.map((item) => {
              const active = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
              const content = (
                <>
                  <span className="amp-app-nav-icon">
                    <InlineIcon name={item.icon} />
                  </span>
                  <span className="amp-app-nav-label">{t(item.label, item.labelEn)}</span>
                </>
              );

              return (
                <Link key={item.path} href={item.path} prefetch={false} className={`amp-dashboard-nav-item ${active ? "amp-dashboard-nav-item-active" : ""}`} title={t(item.label, item.labelEn)}>
                  {content}
                </Link>
              );
            })}
          </div>
        </aside>

        <main className="amp-app-main">
          <div className={`amp-app-content ${isHome ? "amp-app-content-home" : ""}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}
