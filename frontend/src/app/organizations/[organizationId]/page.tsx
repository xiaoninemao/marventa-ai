"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  fetch_organization,
  invite_organization_member,
  remove_organization_member,
  update_organization_member_role,
} from "@/services/organization_api";
import type { OrganizationDetail, OrganizationMember } from "@/types/auth";
import { organizationName } from "@/utils/organizations";
import InlineIcon from "@/components/redesign/InlineIcon";
import OrganizationAvatar from "@/components/layout/organization_avatar";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import { userAvatarColor as memberAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

type EditableRole = "admin" | "member";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

function memberAvatarUrl(value: string) {
  if (!value) return "";
  return value.startsWith("http") ? value : `${API_BASE}${value}`;
}

export default function OrganizationDetailPage() {
  const params = useParams<{ organizationId: string }>();
  const organizationId = params.organizationId;
  const router = useRouter();
  const { user, loading: authLoading, renameOrganization, updateOrganizationAvatar, reloadOrganizations } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<EditableRole>("member");
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);
  const [memberMenuUserId, setMemberMenuUserId] = useState<string | null>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);

  const loadOrganization = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch_organization(organizationId);
      if (!response.success || !response.data) throw new Error(response.message || "Could not load organization");
      setOrganization(response.data);
      setName(organizationName(response.data, t));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organization");
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) void loadOrganization();
  }, [user, loadOrganization]);

  useEffect(() => {
    const message = formError || error;
    if (message) showError(localizeErrorMessage(message, locale));
  }, [formError, error, locale, showError]);

  useEffect(() => {
    if (!memberMenuUserId) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !memberMenuRef.current?.contains(event.target)) {
        setMemberMenuUserId(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [memberMenuUserId]);

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { showError(t("组织名称不能为空", "Organization name is required")); return; }
    if (trimmed.length > 80) { showError(t("组织名称不能超过 80 个字符", "Organization name must be at most 80 characters")); return; }
    setActionBusy(true);
    setFormError(null);
    try {
      await renameOrganization(organizationId, trimmed);
      setOrganization((current) => current ? { ...current, name: trimmed } : current);
      renameDialogRef.current?.close();
      showSuccess(t("组织名称已更新。", "Organization name updated."));
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Could not rename organization");
    } finally {
      setActionBusy(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) { showError(t("请输入邮箱", "Email is required")); return; }
    setActionBusy(true);
    setFormError(null);
    try {
      const response = await invite_organization_member(organizationId, email, inviteRole);
      if (!response.success || !response.data) throw new Error(response.message || "Could not add organization member");
      setOrganization((current) => current ? {
        ...current,
        member_count: current.member_count + 1,
        members: [...current.members, response.data],
      } : current);
      setInviteEmail("");
      setInviteRole("member");
      reloadOrganizations();
      inviteDialogRef.current?.close();
      showSuccess(t("成员已加入组织。", "The member was added to the organization."));
    } catch (inviteError) {
      setFormError(inviteError instanceof Error ? inviteError.message : "Could not add organization member");
    } finally {
      setActionBusy(false);
    }
  };

  const changeRole = async (member: OrganizationMember, role: EditableRole) => {
    if (member.role === role) return;
    setActionBusy(true);
    setError(null);
    try {
      const response = await update_organization_member_role(organizationId, member.user_id, role);
      if (!response.success || !response.data) throw new Error(response.message || "Could not update member permissions");
      setOrganization((current) => current ? {
        ...current,
        members: current.members.map((item) => item.user_id === member.user_id ? response.data : item),
      } : current);
      showSuccess(t("成员权限已更新。", "Member permissions updated."));
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Could not update member permissions");
    } finally {
      setActionBusy(false);
    }
  };

  const removeMember = async (member: OrganizationMember) => {
    setActionBusy(true);
    setError(null);
    try {
      await remove_organization_member(organizationId, member.user_id);
      setOrganization((current) => current ? {
        ...current,
        member_count: Math.max(1, current.member_count - 1),
        members: current.members.filter((item) => item.user_id !== member.user_id),
      } : current);
      reloadOrganizations();
      removeDialogRef.current?.close();
      setMemberToRemove(null);
      showSuccess(t("成员已移出组织。", "The member was removed from the organization."));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove organization member");
    } finally {
      setActionBusy(false);
    }
  };

  const selectAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
      showError(t("请选择 PNG、JPEG、GIF 或 WebP 图片", "Choose a PNG, JPEG, GIF, or WebP image."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showError(t("组织头像不能超过 2 MB", "The organization image must be 2 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showError(t("组织头像读取失败", "Could not read the organization image."));
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      setActionBusy(true);
      setFormError(null);
      try {
        const updated = await updateOrganizationAvatar(organizationId, reader.result);
        setOrganization((current) => current ? { ...current, ...updated } : current);
        showSuccess(t("组织头像已更新。", "Organization image updated."));
      } catch (avatarError) {
        setFormError(avatarError instanceof Error ? avatarError.message : "Could not update organization avatar");
      } finally {
        setActionBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (authLoading || (loading && !organization)) {
    return <div className="amp-page-state" role="status">{t("加载中...", "Loading...")}</div>;
  }

  if (!organization) {
    return (
      <div className="amp-redesign amp-workspace-page max-w-5xl">
        <Link href="/organizations" className="amp-workspace-back-link">
          <InlineIcon name="arrowLeft" className="h-4 w-4" />
          {t("返回组织管理", "Back to organizations")}
        </Link>
      </div>
    );
  }

  const canManage = organization.role === "owner" || organization.role === "admin";
  const canEditOrganization = organization.role === "owner";
  const roleOptions = [
    { value: "member" as const, label: t("成员", "Member") },
    { value: "admin" as const, label: t("管理员", "Administrator") },
  ];
  const inviteRoleOptions = organization.role === "owner"
    ? roleOptions
    : roleOptions.filter((option) => option.value === "member");

  return (
    <div className="amp-redesign amp-workspace-page max-w-5xl">
      <Link href="/organizations" className="amp-workspace-back-link mb-5">
        <InlineIcon name="arrowLeft" className="h-4 w-4" />
        {t("返回组织管理", "Back to organizations")}
      </Link>

      <div className="amp-workspace-header">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            className={`group relative shrink-0 rounded-xl ${canEditOrganization ? "cursor-pointer" : "cursor-default"}`}
            disabled={!canEditOrganization || actionBusy}
            aria-label={canEditOrganization ? t("上传组织头像", "Upload organization image") : undefined}
            onClick={() => avatarInputRef.current?.click()}
          >
            <OrganizationAvatar organization={organization} className="h-14 w-14 text-lg" />
            {canEditOrganization && (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/0 text-white opacity-0 transition group-hover:bg-slate-950/45 group-hover:opacity-100 group-focus-visible:bg-slate-950/45 group-focus-visible:opacity-100">
                <InlineIcon name="upload" className="h-5 w-5" />
              </span>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={selectAvatar}
          />
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="amp-workspace-title break-words">{organizationName(organization, t)}</h1>
            {canEditOrganization && (
              <button type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-slate-500 hover:text-blue-600"
                aria-label={t("编辑组织名称", "Edit organization name")}
                title={t("编辑组织名称", "Edit organization name")}
                onClick={() => {
                  setName(organizationName(organization, t));
                  setFormError(null);
                  renameDialogRef.current?.showModal();
                }}>
                <InlineIcon name="edit" className="h-4 w-4" />
              </button>
            )}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && (
            <button type="button"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => {
                setInviteEmail("");
                setInviteRole("member");
                setFormError(null);
                inviteDialogRef.current?.showModal();
              }}>
              {t("邀请成员", "Invite member")}
            </button>
          )}
        </div>
      </div>

      <section className="amp-workspace-card p-5">
        <h2 className="text-base font-semibold text-slate-950">{t("组织成员", "Organization members")}</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {organization.members.map((member) => {
            const canEditMember = canManage
              && member.role !== "owner"
              && member.user_id !== user?.id
              && (organization.role === "owner" || member.role === "member");
            const displayName = member.nickname || member.username;
            return (
              <div key={member.user_id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(220px,1fr)_72px] sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ${memberAvatarColor(member.user_id)}`}>
                    {member.avatar_url ? (
                      <Image
                        src={memberAvatarUrl(member.avatar_url)}
                        alt=""
                        fill
                        sizes="36px"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      userAvatarInitial(displayName)
                    )}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-slate-900">{displayName}</strong>
                    <small className="mt-1 block truncate text-xs text-slate-500">{member.email || `@${member.username}`}</small>
                  </span>
                </div>
                <div className="flex items-center text-sm text-slate-600 sm:justify-self-start">
                  {canEditMember ? (
                    <EnterpriseSelect
                      value={member.role as EditableRole}
                      options={roleOptions}
                      onChange={(role) => void changeRole(member, role)}
                      ariaLabel={t("设置 {name} 的权限", "Set permissions for {name}", { name: displayName })}
                      disabled={actionBusy}
                      variant="inline"
                      className="w-auto"
                    />
                  ) : (
                    <span className="text-sm font-[550] leading-5 text-[#344054]">
                      {member.role === "owner" ? t("所有者", "Owner") : member.role === "admin" ? t("管理员", "Administrator") : t("成员", "Member")}
                    </span>
                  )}
                </div>
                <div className="sm:justify-self-end">
                  {canEditMember && (
                    <div ref={memberMenuUserId === member.user_id ? memberMenuRef : undefined}
                      className="relative inline-flex">
                      <button type="button" disabled={actionBusy}
                        className="amp-member-action-more"
                        aria-haspopup="menu"
                        aria-expanded={memberMenuUserId === member.user_id}
                        aria-label={t("{name} 的成员操作", "Member actions for {name}", { name: displayName })}
                        onClick={() => setMemberMenuUserId((current) =>
                          current === member.user_id ? null : member.user_id)}>
                        <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                      </button>
                      {memberMenuUserId === member.user_id && (
                        <div role="menu" className="amp-member-action-menu"
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setMemberMenuUserId(null);
                            }
                          }}>
                          <button type="button" role="menuitem"
                            className="amp-member-action-danger" disabled={actionBusy}
                            onClick={() => {
                              setMemberMenuUserId(null);
                              setMemberToRemove(member);
                              removeDialogRef.current?.showModal();
                            }}>
                            <InlineIcon name="trash" />
                            {t("移出成员", "Remove member")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <dialog ref={renameDialogRef} aria-labelledby="rename-organization-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (actionBusy) event.preventDefault(); }}>
        <h2 id="rename-organization-title" className="text-lg font-semibold">{t("编辑组织名称", "Edit organization name")}</h2>
        <form onSubmit={saveName} className="mt-5">
          <label className="block text-sm font-medium text-slate-700">
            {t("组织名称", "Organization name")}
            <input autoFocus value={name} maxLength={80} disabled={actionBusy}
              onChange={(event) => setName(event.target.value)}
              className="amp-workspace-control mt-2 w-full font-normal" />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={actionBusy}
              onClick={() => renameDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={actionBusy}>
              {actionBusy ? t("保存中...", "Saving...") : t("保存", "Save")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={inviteDialogRef} aria-labelledby="invite-member-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (actionBusy) event.preventDefault(); }}>
        <h2 id="invite-member-title" className="text-lg font-semibold">{t("邀请成员", "Invite member")}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {t("输入已注册用户的邮箱，成员将立即加入组织。", "Enter a registered user's email. They will join immediately.")}
        </p>
        <form onSubmit={inviteMember} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            {t("邮箱", "Email")}
            <input autoFocus type="email" value={inviteEmail} disabled={actionBusy}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={t("请输入邮箱", "Enter email")}
              className="amp-workspace-control mt-2 w-full font-normal" />
          </label>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">{t("权限", "Permission")}</legend>
            <EnterpriseSelect
              value={inviteRole}
              options={inviteRoleOptions}
              onChange={setInviteRole}
              ariaLabel={t("邀请成员权限", "Invited member permission")}
              disabled={actionBusy}
              className="mt-2 w-full"
            />
          </fieldset>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={actionBusy}
              onClick={() => inviteDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={actionBusy}>
              {actionBusy ? t("邀请中...", "Inviting...") : t("邀请", "Invite")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={removeDialogRef} aria-labelledby="remove-organization-member-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (actionBusy) event.preventDefault(); }}
        onClose={() => { if (!actionBusy) setMemberToRemove(null); }}>
        <h2 id="remove-organization-member-title" className="text-lg font-semibold">{t("移出组织成员", "Remove organization member")}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {t(
            "确定将「{name}」移出组织吗？该成员将同时失去此组织内所有项目的访问权限。",
            "Remove {name} from the organization? They will also lose access to every project in this organization.",
            { name: memberToRemove?.nickname || memberToRemove?.username || "" },
          )}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={actionBusy}
            onClick={() => removeDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
          <button type="button" className="amp-button bg-red-600 text-white hover:bg-red-700" disabled={actionBusy || !memberToRemove}
            onClick={() => memberToRemove && void removeMember(memberToRemove)}>
            <InlineIcon name="trash" className="h-4 w-4" />
            {actionBusy ? t("移出中...", "Removing...") : t("确认移出", "Remove")}
          </button>
        </div>
      </dialog>

    </div>
  );
}
