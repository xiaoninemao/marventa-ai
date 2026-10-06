import type { AccountContentSource } from "@/types/account_content";

export function parseAccountContentSource(value: string | null): AccountContentSource | null {
  if (value === null || value === "platform") return "platform";
  if (value === "marventa") return "marventa";
  return null;
}

export function accountContentSourceHref(query: string, source: AccountContentSource): string {
  const params = new URLSearchParams(query);
  params.set("source", source);
  return `/account_content?${params.toString()}`;
}
