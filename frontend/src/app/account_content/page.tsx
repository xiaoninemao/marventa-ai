"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { CHINESE_ACTIONS, CHINESE_PROGRESS, ENGLISH_ACTIONS, ENGLISH_PROGRESS } from "@/i18n/interaction_copy";
import { fetch_content_projects } from "@/services/api_client";
import { fetch_account_content, fetch_account_content_accounts } from "@/services/account_content_api";
import type { ContentProject, ProjectChannelAccount } from "@/types/publishing";
import type { AccountContentAccount, AccountContentPage, AccountContentPost, AccountContentSource, AccountContentStatus } from "@/types/account_content";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import Pagination from "@/components/redesign/Pagination";
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import AccountContentCard from "@/components/account_content/AccountContentCard";
import AccountContentPreview from "@/components/account_content/AccountContentPreview";
import AccountContentEmptyState from "@/components/account_content/AccountContentEmptyState";

export default function AccountContentPageRoute() {
  return <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}><AccountContentWorkspace /></Suspense>;
}

function AccountContentWorkspace() {
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const projectId = params.get("project") || "";
  const requestedAccount = params.get("account") || "";
  const organizationId = user?.current_organization?.id || user?.default_organization?.id || "";
  const scope = `${user?.id}:${organizationId}:${projectId}`;
  const [accountsState, setAccountsState] = useState<{
    scope: string; projects: ContentProject[]; accounts: AccountContentAccount[]; loading: boolean; error: string;
  }>({ scope: "", projects: [], accounts: [], loading: true, error: "" });
  const [selection, setSelection] = useState<{
    scope: string; platform: ProjectChannelAccount["platform"] | ""; accountId: string;
  }>({ scope: "", platform: "", accountId: "" });
  const platform = selection.scope === scope ? selection.platform : "";
  const accountId = selection.scope === scope ? selection.accountId : "";
  const [source, setSource] = useState<AccountContentSource>("platform");
  const [count, setCount] = useState(12);
  const [cursors, setCursors] = useState<string[]>(["0"]);
  const [pageIndex, setPageIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [postsState, setPostsState] = useState<{
    key: string; loading: boolean; error: string; data: AccountContentPage | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [preview, setPreview] = useState<{ key: string; post: AccountContentPost } | null>(null);
  const currentAccounts = accountsState.scope === scope ? accountsState.accounts : [];
  const projects = accountsState.scope === scope ? accountsState.projects : [];
  const channelAccounts = currentAccounts.filter((item) => item.platform === platform);
  const account = channelAccounts.find((item) => item.id === accountId);
  const cursor = cursors[pageIndex] || "0";
  const requestKey = `${scope}:${platform}:${accountId}:${source}:${count}:${pageIndex}:${cursor}:${refresh}`;
  const data = postsState.key === requestKey ? postsState.data : null;
  const error = postsState.key === requestKey ? postsState.error : "";
  const postsLoading = Boolean(account) && (postsState.key !== requestKey || postsState.loading);
  const accountsLoading = accountsState.scope !== scope || accountsState.loading;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let active = true;
    setAccountsState({ scope, projects: [], accounts: [], loading: true, error: "" });
    setCursors(["0"]);
    setPageIndex(0);
    void Promise.all([fetch_content_projects(), fetch_account_content_accounts(projectId, controller.signal)])
      .then(([projectResponse, accountResponse]) => {
        if (!projectResponse.success) throw new Error(projectResponse.message || "Could not load projects");
        if (!active) return;
        if (requestedAccount && !accountResponse.data.some((item) => item.id === requestedAccount)) {
          throw new Error("Connected channel account not found");
        }
        setAccountsState({ scope, projects: projectResponse.data, accounts: accountResponse.data, loading: false, error: "" });
        setSelection((current) => {
          const requested = accountResponse.data.find((item) => item.id === requestedAccount);
          if (requested) return { scope, platform: requested.platform, accountId: requested.id };
          if (current.scope !== scope) return { scope, platform: "", accountId: "" };
          const stillAvailable = accountResponse.data.some((item) => item.id === current.accountId
            && item.platform === current.platform);
          return { ...current, accountId: stillAvailable ? current.accountId : "" };
        });
      })
      .catch((reason: unknown) => {
        if (active) setAccountsState({ scope, projects: [], accounts: [], loading: false,
          error: localizeErrorMessage(reason instanceof Error ? reason.message : "Could not load channel accounts", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [user, scope, projectId, requestedAccount, attempt, locale]);

  useEffect(() => {
    if (!user || !account) return;
    const controller = new AbortController();
    let active = true;
    setPostsState({ key: requestKey, loading: true, error: "", data: null });
    void fetch_account_content(account.project_id, account.id, {
      source, cursor, count, page: pageIndex + 1,
    }, controller.signal).then((response) => {
      if (active) setPostsState({ key: requestKey, loading: false, error: "", data: response.data });
    }).catch((reason: unknown) => {
      if (active) setPostsState({ key: requestKey, loading: false, data: null,
        error: localizeErrorMessage(reason instanceof Error ? reason.message : "Could not load account content", locale) });
    });
    return () => { active = false; controller.abort(); };
  }, [user, account, requestKey, source, cursor, count, pageIndex, locale]);

  const resetPages = () => { setCursors(["0"]); setPageIndex(0); };
  const unavailable = (status: AccountContentStatus) => ({
    ready: "",
    unsupported_platform: t("此平台暂未提供已验证的账号作品读取接口。可查看本系统发布记录。", "No verified account-content API is available for this platform. You can view publications from this workspace."),
    authorization_required: t("账号授权已失效或不可用，请重新连接账号。", "Account authorization is unavailable or expired. Reconnect the account."),
    scope_required: t("账号缺少作品读取权限。应用获准 video.list 后，在 DOUYIN_CHANNEL_SCOPES 中加入该权限并重新授权。", "The account lacks video.list permission. After app approval, add it to DOUYIN_CHANNEL_SCOPES and reauthorize."),
    configuration_required: t("账号凭证配置不可用，请检查服务配置后重新连接。", "Account credential configuration is unavailable. Check the service configuration and reconnect."),
  })[status];

  if (authLoading || !user) return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;

  return (
    <div className="amp-projects-layout">
      <PublishingProjectSidebar projects={projects} selectedProjectId={projectId} accountContent />
      <main className="amp-projects-main amp-account-content-main">
        <header className="amp-account-content-heading">
          <div><h1>{t("账号内容", "Account Content")}</h1>
            <p>{t("按账号查看平台可读取的作品或本系统发布记录。", "Browse platform-readable works or this workspace's publication records by account.")}</p></div>
        </header>
        <div className="amp-account-content-toolbar">
          <EnterpriseSelect value={platform}
            options={[{ value: "douyin", label: t("抖音", "Douyin") }, { value: "xiaohongshu", label: t("小红书", "Xiaohongshu") }]}
            ariaLabel={t("选择渠道", "Select channel")} placeholder={t("选择渠道", "Select channel")}
            onChange={(value) => { setSelection({ scope, platform: value, accountId: "" }); resetPages(); }}
            className="amp-account-content-channel" />
          <EnterpriseSelect value={accountId}
            options={channelAccounts.map((item) => ({ value: item.id,
              label: item.account_name,
              description: item.project_title }))}
            ariaLabel={t("选择账号", "Select account")} placeholder={t("选择账号", "Select account")}
            title={account?.account_name}
            disabled={accountsLoading || !platform || !channelAccounts.length}
            disabledReason={accountsLoading ? t("账号正在加载，请稍候。", "Accounts are loading. Please wait.")
              : !platform ? t("请先选择渠道。", "Select a channel first.")
                : t("此渠道暂无已连接账号，请先在项目中连接账号。", "No connected accounts for this channel. Connect one in a project first.")}
            onChange={(value) => {
              setSelection({ scope, platform, accountId: value });
              resetPages();
              setRefresh((revision) => revision + 1);
            }} className="amp-account-content-select" />
          <EnterpriseSelect value={source}
            options={[{ value: "platform", label: t("平台作品", "Platform works") },
              { value: "marventa", label: t("本系统发布", "Published here") }]}
            ariaLabel={t("内容来源", "Content source")}
            onChange={(value) => { setSource(value); resetPages(); }}
            className="amp-account-content-source-select" />
        </div>
        {accountsState.scope === scope && accountsState.error ? <div className="amp-dialog-state" role="alert">
          <p>{accountsState.error}</p><button type="button" className="amp-button amp-button-secondary" onClick={() => setAttempt((value) => value + 1)}>
            {t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
        </div> : accountsLoading || postsLoading ? <div className="amp-dialog-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
          : !account ? <AccountContentEmptyState icon="content"
            title={t("请选择渠道和账号", "Select a channel and account")}
            description={t("在上方选择渠道和账号，查看对应的发布内容。", "Choose a channel and account above to view their published content.")} />
            : error ? <div className="amp-dialog-state" role="alert"><p>{error}</p>
              <button type="button" className="amp-button amp-button-secondary" onClick={() => setRefresh((value) => value + 1)}>
                {t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button></div>
              : data && data.status !== "ready" ? <AccountContentEmptyState icon="lock"
                title={t("账号内容暂不可用", "Account content unavailable")}
                description={<>{unavailable(data.status)}{" "}
                  <Link href={`/projects/${encodeURIComponent(account.project_id)}`} className="amp-account-content-inline-link">
                    {t("前往项目", "Go to project")}</Link></>} />
                : data ? <>
                  {data.items.length ? <div className="amp-account-content-grid">{data.items.map((post) => (
                    <AccountContentCard key={post.id} post={post} onOpen={() => setPreview({ key: requestKey, post })} />
                  ))}</div> : <AccountContentEmptyState icon="content"
                    title={source === "platform" ? t("暂无可读取的作品", "No readable works") : t("暂无本系统发布记录", "No publications from this workspace")}
                    description={source === "platform" ? t("当前接口读取范围内没有可显示的内容。", "No content is available in the current API reading range.")
                      : t("通过发布管理提交内容后，可在这里查看平台受理记录。", "Content submitted through Publishing appears here after platform acceptance.")} />}
                  <Pagination mode="cursor" page={pageIndex + 1} pageSize={count}
                    pageSizeOptions={[6, 12, 24]} pageItems={data.items.length} visitedPages={cursors.length}
                    hasMore={data.has_more && Boolean(data.next_cursor)}
                    nextBlockedReason={data.limited ? t("已达到平台读取范围上限。", "The platform's read limit has been reached.") : t("没有更多内容。", "No more content.")}
                    onPageChange={(value) => {
                      const nextIndex = value - 1;
                      if (nextIndex === pageIndex + 1) {
                          const nextCursor = data.next_cursor;
                          if (nextCursor) {
                            setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
                            setPageIndex(nextIndex);
                          }
                      } else if (nextIndex >= 0 && nextIndex < cursors.length) {
                        setPageIndex(nextIndex);
                      }
                    }}
                    onPageSizeChange={(value) => { setCount(value); resetPages(); }} />
                </> : null}
        <AccountContentPreview post={preview?.key === requestKey ? preview.post : null} account={account}
          onClose={() => setPreview(null)} />
      </main>
    </div>
  );
}
