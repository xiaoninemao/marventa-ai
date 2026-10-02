"use client";

import { GuardedButton } from "@/components/redesign/GuardedControls";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import { isLocale } from "@/i18n/locale";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import { userAvatarColor, userAvatarInitial } from "@/utils/user_avatar";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";

export default function SettingsPage() {
  const { user, loading, updateUser } = useAuth();
  const { locale, setLocale, t, persistenceError } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();
  const router = useRouter();

  const [nickname, set_nickname] = useState("");
  const [avatar_url, set_avatar_url] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving_profile, set_saving_profile] = useState(false);

  const feedbackText = (message: string) => {
    const messages: Record<string, string> = {
      "保存失败": "Could not save your profile",
    };
    return messages[message] ? t(message, messages[message]) : localizeErrorMessage(message, locale);
  };

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user) {
      set_nickname(user.nickname || "");
      set_avatar_url(user.avatar_url || "");
    }
  }, [user]);

  useEffect(() => {
    if (persistenceError) {
      showError(t(
        "当前语言已切换，但浏览器未能保存偏好。请允许本地存储；刷新后可能恢复默认语言。",
        "The language changed, but the browser could not save the preference. Allow local storage to keep it after refreshing.",
      ));
    }
  }, [persistenceError, showError, t]);

  if (loading) {
    return (
      <div className="amp-page-state" role="status" aria-label={t("加载中", "Loading")}>
        <svg className="w-8 h-8 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (!user) return null;

  const save_profile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving_profile) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    set_saving_profile(true);
    try {
      await updateUser({ nickname: nickname.trim(), avatar_url: avatar_url.trim() });
      showSuccess(t("个人信息已保存", "Profile saved"));
    } catch (err) {
      showError(feedbackText(err instanceof Error ? err.message : "保存失败"));
    } finally {
      set_saving_profile(false);
    }
  };

  const select_avatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError(t("请选择图片文件", "Select an image file."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showError(t("头像图片不能超过 2 MB", "The profile image must be 2 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showError(t("头像图片读取失败", "Could not read the profile image."));
    reader.onload = () => {
      if (typeof reader.result === "string") set_avatar_url(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const initial = userAvatarInitial(user.nickname || user.username);

  return (
    <div className="amp-redesign amp-workspace-page max-w-3xl">
      <header className="amp-module-header">
        <h1 className="amp-module-title">{t("设置", "Settings")}</h1>
        <p className="amp-module-description">{t("管理个人资料、语言和使用偏好。", "Manage your profile, language, and preferences.")}</p>
      </header>
      <section className="amp-workspace-card p-6 mb-5" aria-labelledby="interface-language-heading">
        <h2 id="interface-language-heading" className="amp-workspace-section-title">{t("界面语言", "Interface language")}</h2>
        <EnterpriseSelect
          value={locale}
          options={[
            { value: "en", label: "English" },
            { value: "zh-CN", label: "简体中文" },
          ]}
          onChange={(value) => { if (isLocale(value)) setLocale(value); }}
          ariaLabel={t("选择语言", "Select a language")}
          className="mt-3 w-full"
        />
      </section>

      {/* Profile card */}
      <div className="amp-workspace-card p-6 mb-5">
        <form onSubmit={save_profile} className="space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <span className="w-1 h-4 rounded-full bg-indigo-600" />
            <h2 className="amp-workspace-section-title">{t("个人信息", "Profile")}</h2>
          </div>
          <div className="flex items-end gap-4 py-2">
            <button type="button" className="group relative shrink-0 rounded-full"
              aria-label={t("上传头像", "Upload profile picture")} onClick={() => avatarInputRef.current?.click()}>
              {avatar_url ? (
                <img src={avatar_url} alt="" className="h-16 w-16 rounded-full border border-slate-200 object-cover" />
              ) : (
                <span className={`flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white ${userAvatarColor(user.id)}`}>
                  {initial}
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/0 text-white opacity-0 transition group-hover:bg-slate-950/45 group-hover:opacity-100">
                <InlineIcon name="upload" className="h-5 w-5" />
              </span>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={select_avatar} />
            <div className="min-w-0 flex-1">
              <label htmlFor="profile-nickname" className="text-xs font-semibold text-zinc-500 block mb-1.5">{t("昵称", "Display name")}</label>
              <input
                id="profile-nickname"
                type="text" value={nickname} onChange={e => set_nickname(e.target.value)}
                className="amp-workspace-control w-full"
              />
            </div>
            <GuardedButton type="submit" disabled={saving_profile} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")} className="amp-button amp-button-primary shrink-0">
              {saving_profile ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
            </GuardedButton>
          </div>
        </form>
      </div>

    </div>
  );
}
