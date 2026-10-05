export function publicationReadOnly(status: string): boolean {
  return status === "scheduled" || status === "publishing" || status === "published";
}

export function publicationNeedsPolling(status: string): boolean {
  return status === "scheduled" || status === "publishing";
}

export function publicationHasScheduledRelease(status: string, scheduledFor: string): boolean {
  return status === "scheduled" && scheduledFor.trim() !== "";
}

export function publicationPublishedNotice(status: string): { zh: string; en: string } | null {
  if (status !== "published") return null;
  return {
    zh: "平台已接受创建请求；审核和展示由平台决定，不代表已公开可见。",
    en: "The platform accepted the creation request. Review and visibility are subject to the platform; this does not mean the post is publicly visible.",
  };
}
