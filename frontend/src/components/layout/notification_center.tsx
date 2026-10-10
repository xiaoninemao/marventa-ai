"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import type { Translate } from "@/i18n/locale";
import {
  fetch_notifications, mark_all_notifications_read, mark_notification_read,
} from "@/services/notification_api";
import type { NotificationItem } from "@/types/notifications";
import InlineIcon from "@/components/redesign/InlineIcon";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_ACTIONS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";

function notificationContent(
  item: NotificationItem,
  t: Translate,
): { title: string; detail: string } {
  const organization = item.data.organization_name || t("组织", "organization");
  const role = item.data.role === "admin" ? t("管理员", "Administrator") : t("成员", "Member");
  if (item.kind === "organization_invitation") {
    return {
      title: t("你已加入「{name}」", "You joined {name}", { name: organization }),
      detail: t(
        "{actor} 将你添加为{role}",
        "{actor} added you as {role}",
        { actor: item.data.actor_name || t("组织所有者", "The organization owner"), role },
      ),
    };
  }
  if (item.kind === "organization_role_changed") {
    return {
      title: t("组织权限已更新", "Organization role updated"),
      detail: t(
        "你在「{name}」中的权限已变更为{role}",
        "Your role in {name} is now {role}",
        { name: organization, role },
      ),
    };
  }
  return {
    title: t("系统通知", "System notification"),
    detail: t("你有一条新通知", "You have a new notification"),
  };
}

function notificationTime(value: string, locale: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const difference = date.getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return date.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN");
}

export default function NotificationCenter() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async (showLoading = false) => {
    if (!user) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await fetch_notifications();
      if (!response.success || !response.data) throw new Error(response.message || "Could not load notifications");
      setItems(response.data.items);
      setUnreadCount(response.data.unread_count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load notifications");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      setOpen(false);
      return;
    }
    const refresh = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, loadNotifications]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const openNotification = async (item: NotificationItem) => {
    if (!item.is_read) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
      setUnreadCount((count) => Math.max(0, count - 1));
      try {
        await mark_notification_read(item.id);
      } catch {
        void loadNotifications();
      }
    }
    setOpen(false);
    if (item.action_url.startsWith("/")) router.push(item.action_url);
  };

  const readAll = async () => {
    if (!unreadCount) return;
    setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    setUnreadCount(0);
    try {
      await mark_all_notifications_read();
    } catch {
      void loadNotifications();
    }
  };

  return (
    <div ref={containerRef} className="amp-notification-center">
      <button
        type="button"
        className="amp-app-topbar-action amp-app-topbar-icon-only amp-notification-trigger"
        aria-label={unreadCount
          ? t("系统通知，{count} 条未读", "Notifications, {count} unread", { count: unreadCount })
          : t("系统通知", "Notifications")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void loadNotifications(items.length === 0);
        }}
      >
        <InlineIcon name="bell" className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="amp-notification-badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="amp-notification-menu" role="menu" aria-label={t("通知", "Notifications")}>
          <div className="amp-notification-menu-header">
            <strong>{t("通知", "Notifications")}</strong>
            {unreadCount > 0 && (
              <button type="button" className="amp-text-action amp-text-action-primary" onClick={() => void readAll()}>
                {t(CHINESE_ACTIONS.markAllRead, ENGLISH_ACTIONS.markAllRead)}
              </button>
            )}
          </div>
          <div className="amp-notification-list">
            {loading ? (
              <p className="amp-notification-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</p>
            ) : error ? (
              <div className="amp-notification-state" role="alert">
                <p>{t("通知加载失败", "Could not load notifications")}</p>
                <button type="button" className="amp-text-action amp-text-action-primary" onClick={() => void loadNotifications(true)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
              </div>
            ) : items.length === 0 ? (
              <div className="amp-notification-empty">
                <InlineIcon name="bell" />
                <strong>{t("暂无通知", "No notifications")}</strong>
                <span>{t("新的协作动态会显示在这里", "New collaboration updates will appear here")}</span>
              </div>
            ) : items.map((item) => {
              const content = notificationContent(item, t);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`amp-notification-item ${item.is_read ? "" : "amp-notification-item-unread"}`}
                  onClick={() => void openNotification(item)}
                >
                  <span className="amp-notification-item-icon"><InlineIcon name="organization" /></span>
                  <span className="amp-notification-item-copy">
                    <strong>{content.title}</strong>
                    <span>{content.detail}</span>
                    <time>{notificationTime(item.created_at, locale)}</time>
                  </span>
                  {!item.is_read && <span className="amp-notification-unread-dot" aria-label={t("未读", "Unread")} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
