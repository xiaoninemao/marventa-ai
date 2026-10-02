"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import LanguageSwitcher from "@/components/shared/language_switcher";
import InlineIcon from "@/components/redesign/InlineIcon";
import RedesignButton from "@/components/redesign/RedesignButton";
import RedesignInput from "@/components/redesign/RedesignInput";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";

interface Props {
  mode: "login" | "register";
  open: boolean;
  onClose: () => void;
  onSwitch: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SlidingPanel({ mode, open, onClose, onSwitch }: Props) {
  const { login, register } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showWarning } = useToast();
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const isLogin = mode === "login";
  const resetForm = useCallback(() => {
    setLoading(false);
    setLoginEmail("");
    setLoginPassword("");
    setShowLoginPassword(false);
    setRegisterEmail("");
    setRegisterPassword("");
    setShowRegisterPassword(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSwitch = useCallback(() => {
    resetForm();
    onSwitch();
  }, [onSwitch, resetForm]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  if (!open) return null;

  const doLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    if (!loginEmail.trim() || !loginPassword) {
      showError(t("请填写邮箱和密码", "Enter your email and password."));
      return;
    }
    setLoading(true);
    try {
      await login(loginEmail.trim(), loginPassword);
      handleClose();
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : "登录失败", locale));
    } finally {
      setLoading(false);
    }
  };

  const doRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    const email = registerEmail.trim();
    if (!email || !registerPassword) {
      showError(t("请填写邮箱和密码", "Enter your email and password."));
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      showError(t("邮箱格式不正确", "Enter a valid email address."));
      return;
    }
    if (registerPassword.length < 6) {
      showError(t("密码至少需要 6 个字符", "Use at least 6 characters for your password."));
      return;
    }
    setLoading(true);
    try {
      await register(email, registerPassword);
      handleClose();
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : "注册失败", locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="amp-redesign">
      <div className="amp-slide-root">
        <button type="button" className="amp-slide-overlay" aria-label={t("关闭登录面板", "Close sign-in panel")} onClick={handleClose} />
        <aside className="amp-slide-panel" role="dialog" aria-modal="true" aria-label={isLogin ? t("登录账号", "Sign in") : t("注册", "Sign up")}>
          <section className="amp-slide-brand-panel">
            <div className="amp-slide-brand-content">
              <div className="amp-slide-brand-art" aria-hidden="true">
                <Image src="/assets/illustrations/login-paper-landscape.webp" alt="" fill
                  sizes="(max-width: 960px) 48vw, 440px" />
              </div>

              <div className="amp-slide-brand-main">
                <h2>{t("资料沉淀，", "Research organized.")}<br />{t("作品交付。", "Work delivered.")}</h2>
                <p>{isLogin
                  ? t("登录后继续你的项目与作品", "Sign in to continue your projects and work.")
                  : t("注册后开始你的第一个营销项目", "Sign up to start your first marketing project.")}</p>
              </div>
            </div>
          </section>

          <section className={`amp-slide-form-panel ${isLogin ? "is-login" : "is-register"}`}>
            <div className="amp-slide-topline">
              <LanguageSwitcher variant="minimal" />
              <span>{isLogin ? t("没有账号？", "New here?") : t("已有账号？", "Have an account?")}</span>
              <button type="button" onClick={handleSwitch}>
                {isLogin ? t(CHINESE_ACTIONS.signUp, ENGLISH_ACTIONS.signUp) : t(CHINESE_ACTIONS.signIn, ENGLISH_ACTIONS.signIn)}
              </button>
              <button type="button" onClick={handleClose} className="amp-modal-close" aria-label={t("关闭", "Close")}>
                <InlineIcon name="close" className="h-5 w-5" />
              </button>
            </div>

            <h2 className="amp-form-title">{isLogin ? t("登录账号", "Sign in") : t("注册", "Sign up")}</h2>
            <p className="amp-form-subtitle">
              {isLogin ? t("登录你的 Marventa AI 账号", "Sign in to your Marventa AI account") : t("注册后即可使用 Marventa AI", "Sign up to use Marventa AI")}
            </p>

            {isLogin ? (
              <form onSubmit={doLogin} className="amp-login-compact-form" noValidate>
                <label>
                  <span className="amp-form-label">{t("邮箱", "Email")}</span>
                  <RedesignInput
                    autoFocus
                    autoComplete="email"
                    leftIcon={<InlineIcon name="mail" className="h-5 w-5" />}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder={t("请输入邮箱", "Enter your email")}
                    type="email"
                    value={loginEmail}
                  />
                </label>
                <label>
                  <span className="amp-form-label">{t("密码", "Password")}</span>
                  <RedesignInput
                    leftIcon={<InlineIcon name="lock" className="h-5 w-5" />}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder={t("请输入密码", "Enter your password")}
                    rightIcon={<InlineIcon name={showLoginPassword ? "eye" : "eyeOff"} className="h-5 w-5" />}
                    rightIconLabel={showLoginPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}
                    onRightIconClick={() => setShowLoginPassword((value) => !value)}
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                  />
                </label>

                <RedesignButton type="submit" disabled={loading} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")} className="amp-login-submit">
                  {loading ? t(CHINESE_PROGRESS.signingIn, ENGLISH_PROGRESS.signingIn) : t(CHINESE_ACTIONS.signIn, ENGLISH_ACTIONS.signIn)}
                </RedesignButton>
              </form>
            ) : (
              <form onSubmit={doRegister} className="amp-login-compact-form amp-register-compact-form" noValidate>
                <label>
                  <span className="amp-form-label">{t("邮箱", "Email")}</span>
                  <RedesignInput
                    autoFocus
                    autoComplete="email"
                    leftIcon={<InlineIcon name="mail" className="h-5 w-5" />}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder={t("请输入邮箱", "Enter your email")}
                    type="email"
                    value={registerEmail}
                  />
                </label>
                <label>
                  <span className="amp-form-label">{t("密码", "Password")}</span>
                  <RedesignInput
                    leftIcon={<InlineIcon name="lock" className="h-5 w-5" />}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    placeholder={t("至少 6 个字符", "At least 6 characters")}
                    rightIcon={<InlineIcon name={showRegisterPassword ? "eye" : "eyeOff"} className="h-5 w-5" />}
                    rightIconLabel={showRegisterPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}
                    onRightIconClick={() => setShowRegisterPassword((value) => !value)}
                    type={showRegisterPassword ? "text" : "password"}
                    value={registerPassword}
                  />
                </label>

                <RedesignButton type="submit" disabled={loading} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")} className="amp-login-submit">
                  {loading ? t(CHINESE_PROGRESS.signingUp, ENGLISH_PROGRESS.signingUp) : t(CHINESE_ACTIONS.signUp, ENGLISH_ACTIONS.signUp)}
                </RedesignButton>
              </form>
            )}

          </section>
        </aside>
      </div>
    </div>
  );
}
