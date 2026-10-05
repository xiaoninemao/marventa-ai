import type { PublicationPlan, ProjectChannelAccount } from "@/types/publishing";
import { publicationScheduleReady } from "./publication_schedule";

export type PublicationSettingsIssue =
  | "missing-channel"
  | "unsupported-channel"
  | "missing-account"
  | "no-accounts"
  | "unavailable-account"
  | "missing-schedule"
  | "invalid-schedule"
  | "missing-content"
  | "invalid-video";

export interface PublicationSettingsValues {
  platform: PublicationPlan["platform"];
  accountId: string;
  accounts: ReadonlyArray<Pick<ProjectChannelAccount, "id" | "platform">>;
  scheduledFor: string;
  mediaMode: PublicationPlan["media_mode"];
  contentCount: number;
  videoCount: number;
}

export function publicationSettingsIssue(
  values: PublicationSettingsValues, now = new Date(),
): PublicationSettingsIssue | null {
  if (!values.platform) return "missing-channel";
  if (values.platform !== "douyin") return "unsupported-channel";
  const accounts = values.accounts.filter((account) => account.platform === values.platform);
  if (!accounts.some((account) => account.id === values.accountId)) {
    if (values.accountId) return "unavailable-account";
    return accounts.length ? "missing-account" : "no-accounts";
  }
  const [date, time] = values.scheduledFor.split("T");
  if (!date || !time) return "missing-schedule";
  if (!publicationScheduleReady(values.scheduledFor, now)) return "invalid-schedule";
  if (values.mediaMode === "video" && (!values.contentCount || values.videoCount !== 1)) return "invalid-video";
  if (!values.contentCount) return "missing-content";
  return null;
}
