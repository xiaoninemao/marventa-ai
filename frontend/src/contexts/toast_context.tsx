"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import { ENGLISH_FEEDBACK, CHINESE_FEEDBACK } from "@/i18n/interaction_copy";

interface ToastItem {
  id: number;
  message: string;
  kind: "error" | "success" | "warning" | "info";
  closing?: boolean;
}

interface ToastContextValue {
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const closeTimers = useRef(new Map<number, number>());
  const lastToast = useRef({ message: "", shownAt: 0 });

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((items) => items.map((item) => item.id === id ? { ...item, closing: true } : item));
    if (closeTimers.current.has(id)) return;
    closeTimers.current.set(id, window.setTimeout(() => {
      closeTimers.current.delete(id);
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 120));
  }, []);

  const showToast = useCallback((message: string, kind: ToastItem["kind"]) => {
    const normalized = message.trim();
    if (!normalized) return;
    const now = Date.now();
    if (lastToast.current.message === normalized && now - lastToast.current.shownAt < 1000) return;
    lastToast.current = { message: normalized, shownAt: now };
    const id = nextId.current++;
    setToasts((items) => [...items.slice(-2), { id, message: normalized, kind }]);
    timers.current.set(id, window.setTimeout(() => dismiss(id), 4500));
  }, [dismiss]);

  const showError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  const showSuccess = useCallback((message: string) => showToast(message, "success"), [showToast]);
  const showWarning = useCallback((message: string) => showToast(message, "warning"), [showToast]);
  const showInfo = useCallback((message: string) => showToast(message, "info"), [showToast]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    closeTimers.current.forEach((timer) => window.clearTimeout(timer));
    closeTimers.current.clear();
  }, []);

  useEffect(() => {
    setMounted(true);
    const updateTarget = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      setPortalTarget(dialogs.item(dialogs.length - 1) ?? document.body);
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);

  const viewport = (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[10000] flex w-[calc(100%_-_40px)] max-w-[380px] flex-col gap-2"
      aria-live="assertive" aria-atomic="false">
      {toasts.map((toast) => {
        const success = toast.kind === "success";
        const warning = toast.kind === "warning";
        const info = toast.kind === "info";
        return (
        <div key={toast.id} role={toast.kind === "error" ? "alert" : "status"}
          className={`amp-toast pointer-events-auto rounded-md border border-slate-200 bg-white shadow-[0_4px_12px_rgba(15,23,42,0.08)] ${toast.closing ? "amp-toast-exit" : ""}`}>
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <span className={`flex h-6 w-5 shrink-0 items-center justify-center ${success ? "text-emerald-700" : warning ? "text-amber-700" : info ? "text-blue-700" : "text-red-700"}`} aria-hidden="true">
              <InlineIcon name={success ? "check" : warning ? "alert" : info ? "wand" : "close"} className="h-3.5 w-3.5" strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[13px] font-semibold leading-5 text-slate-900">
                {success ? t(CHINESE_FEEDBACK.success, ENGLISH_FEEDBACK.success) : warning ? t(CHINESE_FEEDBACK.notice, ENGLISH_FEEDBACK.notice) : info ? t(CHINESE_FEEDBACK.working, ENGLISH_FEEDBACK.working) : t(CHINESE_FEEDBACK.error, ENGLISH_FEEDBACK.error)}
              </strong>
              <span className="block break-words text-xs leading-[18px] text-slate-600">{toast.message}</span>
            </span>
            <button type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={success
                ? t("关闭成功提示", "Dismiss success message")
                : warning || info
                  ? t("关闭提示", "Dismiss notice")
                  : t("关闭错误提示", "Dismiss error")}
              onClick={() => dismiss(toast.id)}>
              <InlineIcon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );

  return (
    <ToastContext.Provider value={{ showError, showSuccess, showWarning, showInfo }}>
      {children}
      {mounted && portalTarget && createPortal(viewport, portalTarget)}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
