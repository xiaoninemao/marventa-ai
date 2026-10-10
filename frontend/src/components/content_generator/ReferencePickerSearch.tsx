"use client";

import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function ReferencePickerSearch({ value, onChange, ariaLabel, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const { t } = useI18n();
  return <label className="relative w-full sm:min-w-0 sm:flex-1">
    <InlineIcon name="search" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    <input value={value} onChange={event => onChange(event.target.value)} aria-label={ariaLabel} placeholder={placeholder}
      className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-8 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
    {value && <button type="button" onClick={() => onChange("")} aria-label={t("清除搜索", "Clear search")}
      className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
      <InlineIcon name="close" className="h-3 w-3" />
    </button>}
  </label>;
}
