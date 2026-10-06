"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_content_projects } from "@/services/api_client";
import { fetch_account_content_accounts } from "@/services/account_content_api";
import type { AccountContentAccount } from "@/types/account_content";
import type { ContentProject } from "@/types/publishing";

export function useLeadTrackingEntities() {
  const { user, loading: authLoading } = useAuth();
  const { locale } = useI18n();
  const organizationId = user?.current_organization?.id || user?.default_organization?.id || "";
  const scope = `${user?.id}:${organizationId}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    scope: string; projects: ContentProject[]; accounts: AccountContentAccount[]; loading: boolean; error: string;
  }>({ scope: "", projects: [], accounts: [], loading: true, error: "" });

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let active = true;
    setState({ scope, projects: [], accounts: [], loading: true, error: "" });
    void Promise.all([fetch_content_projects(), fetch_account_content_accounts("", controller.signal)])
      .then(([projects, accounts]) => {
        if (!projects.success || !Array.isArray(projects.data)) throw new Error(projects.message || "Could not load projects");
        if (active) setState({ scope, projects: projects.data, accounts: accounts.data, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (active) setState({ scope, projects: [], accounts: [], loading: false,
          error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load channel accounts", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [user, scope, locale, attempt]);

  return {
    user, authLoading, scope,
    projects: state.scope === scope ? state.projects : [],
    accounts: state.scope === scope ? state.accounts : [],
    loading: state.scope !== scope || state.loading,
    error: state.scope === scope ? state.error : "",
    retry: () => setAttempt((value) => value + 1),
  };
}
