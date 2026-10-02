"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { userAvatarColor, userAvatarInitial } from "@/utils/user_avatar";
import { ENGLISH_ACTIONS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [open, set_open] = useState(false);
  const menu_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menu_ref.current && !menu_ref.current.contains(e.target as Node)) {
        set_open(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!user) return null;

  const nickname = user.nickname || user.username;
  const initial = userAvatarInitial(nickname);

  return (
    <div ref={menu_ref} className="relative shrink-0">
      <button
        onClick={() => set_open(!open)}
        className="amp-user-menu-trigger flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={nickname}
            className="w-8 h-8 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${userAvatarColor(user.id)} ${user.avatar_url ? "hidden" : ""}`}>
          {initial}
        </span>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hidden sm:inline">
          {nickname}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xl py-1 z-50">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate font-heading">{nickname}</p>
            {user.email && (
              <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500" title={user.email}>
                {user.email}
              </p>
            )}
          </div>
          <button
            onClick={() => { set_open(false); logout(); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors min-h-[44px]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {t(CHINESE_ACTIONS.signOut, ENGLISH_ACTIONS.signOut)}
          </button>
        </div>
      )}
    </div>
  );
}
