"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import type { OrganizationDetails } from "@/types/auth";
import { organizationName, organizationRole } from "@/utils/organizations";
import OrganizationAvatar from "@/components/layout/organization_avatar";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";

export default function OrganizationsPage() {
  const { user, loading, organizations, organizationsLoading, organizationsError, organizationBusy, createOrganization, deleteOrganization, switchOrganization } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [organizationMenuId, setOrganizationMenuId] = useState<string | null>(null);
  const [organizationToDelete, setOrganizationToDelete] = useState<OrganizationDetails | null>(null);
  const organizationMenuRef = useRef<HTMLDivElement>(null);
  const current = user?.current_organization ?? user?.default_organization;

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (editorOpen && !dialog.open) dialog.showModal();
    else if (!editorOpen && dialog.open) dialog.close();
  }, [editorOpen]);

  useEffect(() => {
    const message = organizationsError || actionError || formError;
    if (message) showError(localizeErrorMessage(message, locale));
  }, [organizationsError, actionError, formError, locale, showError]);

  useEffect(() => {
    if (!organizationMenuId) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !organizationMenuRef.current?.contains(event.target)
      ) {
        setOrganizationMenuId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [organizationMenuId]);

  const openEditor = () => {
    setName("");
    setFormError(null);
    setActionError(null);
    setEditorOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { showError(t("组织名称不能为空", "Organization name is required")); return; }
    if (trimmed.length > 80) { showError(t("组织名称不能超过 80 个字符", "Organization name must be at most 80 characters")); return; }
    setFormError(null);
    try {
      await createOrganization(trimmed);
      setEditorOpen(false);
      showSuccess(t("组织已创建，可点击“切换到此组织”开始使用。", 'Organization created. Select "Switch to organization" to make it your current organization.'));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create organization");
    }
  };

  const activate = async (id: string) => {
    setActionError(null);
    try {
      await switchOrganization(id);
      showSuccess(t("已切换当前组织，刷新后仍会保留选择。", "Current organization changed. Your selection will be retained after refreshing."));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not switch organization");
    }
  };

  const removeOrganization = async () => {
    if (!organizationToDelete) return;
    setActionError(null);
    try {
      await deleteOrganization(organizationToDelete.id);
      setOrganizationToDelete(null);
      showSuccess(t("组织已删除", "Organization deleted"));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete organization");
    }
  };

  if (loading || !user) return <div className="amp-page-state" role="status">{t("加载中...", "Loading...")}</div>;

  return (
    <div className="amp-redesign amp-workspace-page amp-state-page max-w-5xl">
      <header className="amp-module-header">
        <h1 className="amp-module-title">{t("组织管理", "Organizations")}</h1>
        <p className="amp-module-description">{t("管理所属组织、成员与当前工作空间。", "Manage your organizations, members, and current workspace.")}</p>
      </header>
      <div className="amp-workspace-command-bar">
        <h2 className="amp-workspace-section-title">{t("所属组织", "Your organizations")} {!organizationsLoading && !organizationsError && `(${organizations.length})`}</h2>
        <button type="button" className="amp-button amp-button-primary" disabled={organizationBusy || organizationsLoading}
          onClick={openEditor}>{t("创建组织", "Create organization")}</button>
      </div>

      {organizationsLoading ? <p role="status" className="amp-page-state">{t("正在加载组织...", "Loading organizations...")}</p>
        : organizations.length === 0 && !organizationsError ? <div className="amp-page-state amp-empty-state">
          <EmptyStateIcon name="organization" />
          <p>{t("暂未读取到组织，请尝试刷新。", "No organizations were returned. Try refreshing.")}</p>
        </div>
          : <div className="grid gap-4">{organizations.map((item) => (
            <article key={item.id} data-organization-id={item.id} className="amp-workspace-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <Link href={`/organizations/${encodeURIComponent(item.id)}`}
                  className="flex min-w-0 flex-1 gap-4 rounded-lg outline-none transition hover:opacity-75 focus-visible:ring-2 focus-visible:ring-blue-500">
                  <OrganizationAvatar organization={item} className="h-11 w-11 text-sm" />
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold text-slate-950">{organizationName(item, t)}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{organizationRole(item.role, t)}</span>
                      <span className="text-slate-500">{t("成员数：{count}", "Members: {count}", { count: item.member_count })}</span>
                    </div>
                    <p className="mt-3 break-all text-xs text-slate-400">ID: {item.id}</p>
                  </div>
                </Link>
                <div className="flex flex-wrap gap-2">
                  {current?.id === item.id && (
                    <span className="inline-flex min-h-[38px] items-center rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-emerald-700">
                      {t("当前组织", "Current organization")}
                    </span>
                  )}
                  {(current?.id !== item.id || (item.role === "owner" && !item.is_default)) && (
                    <div ref={organizationMenuId === item.id ? organizationMenuRef : undefined}
                      className="relative inline-flex">
                      <button type="button" className="amp-member-action-more"
                        disabled={organizationBusy}
                        aria-haspopup="menu"
                        aria-expanded={organizationMenuId === item.id}
                        aria-label={t(
                          "{name} 的组织操作",
                          "Organization actions for {name}",
                          { name: organizationName(item, t) },
                        )}
                        onClick={() => setOrganizationMenuId((value) =>
                          value === item.id ? null : item.id)}>
                        <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                      </button>
                      {organizationMenuId === item.id && (
                        <div role="menu" className="amp-member-action-menu"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setOrganizationMenuId(null);
                            }
                          }}>
                          {current?.id !== item.id && (
                            <button type="button" role="menuitem"
                              disabled={organizationBusy}
                              onClick={() => {
                                setOrganizationMenuId(null);
                                void activate(item.id);
                              }}>
                              <InlineIcon name="organization" />
                              {t("切换到此组织", "Switch to organization")}
                            </button>
                          )}
                          {item.role === "owner" && !item.is_default && (
                            <button type="button" role="menuitem"
                              className="amp-member-action-danger"
                              disabled={organizationBusy}
                              onClick={() => {
                                setOrganizationMenuId(null);
                                setOrganizationToDelete(item);
                              }}>
                              <InlineIcon name="trash" />
                              {t("删除组织", "Delete organization")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}</div>}

      <dialog ref={dialogRef} aria-labelledby="organization-dialog-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { event.preventDefault(); if (!organizationBusy) setEditorOpen(false); }}
        onClose={() => setEditorOpen(false)}>
        <h2 id="organization-dialog-title" className="mb-5 text-lg font-semibold">{t("创建组织", "Create organization")}</h2>
        <form onSubmit={save} noValidate>
          <label htmlFor="organization-name" className="mb-2 block text-sm font-medium">{t("组织名称", "Organization name")}</label>
          <input id="organization-name" autoFocus value={name} maxLength={80} disabled={organizationBusy}
            onChange={(event) => setName(event.target.value)} placeholder={t("例如：产品团队", "For example: Product Team")}
            className="amp-workspace-control w-full" />
          <p className="mt-2 text-xs leading-5 text-slate-500">{t("最多 80 个字符。自定义名称按原文保存，不会自动翻译。", "Up to 80 characters. Custom names are saved as entered and are not translated.")}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={organizationBusy} onClick={() => setEditorOpen(false)}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={organizationBusy}>
              {organizationBusy ? t("保存中...", "Saving...") : t("创建", "Create")}
            </button>
          </div>
        </form>
      </dialog>

      <DeleteConfirmDialog
        open={Boolean(organizationToDelete)}
        title={t("删除组织", "Delete organization")}
        message={t(
          "删除后，该组织内的项目、洞察、案例、作品和成员关系都将永久删除，且无法恢复。确认删除“{name}”吗？",
          "All projects, insights, cases, portfolio work, and memberships in this organization will be permanently deleted. Delete “{name}”?",
          { name: organizationToDelete ? organizationName(organizationToDelete, t) : "" },
        )}
        cancelLabel={t("取消", "Cancel")}
        confirmLabel={t("删除组织", "Delete organization")}
        busyLabel={t("删除中...", "Deleting...")}
        busy={organizationBusy}
        onCancel={() => setOrganizationToDelete(null)}
        onConfirm={() => void removeOrganization()}
      />
    </div>
  );
}
