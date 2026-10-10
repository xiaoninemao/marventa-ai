"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_publication_contents, fetch_publication_copy } from "@/services/api_client";
import type { PublicationContent, PublicationPlan } from "@/types/publishing";
import type { PortfolioScript } from "@/types/portfolio";
import PortfolioWorkView from "@/components/portfolio/PortfolioWorkView";

type WorkPreview = Pick<PortfolioScript, "name" | "title" | "content" | "media_kind" | "media" | "tags">;

export function publicationWorkPreview(plan: Pick<PublicationPlan, "name" | "media_mode">,
  contents: PublicationContent[], copy: { title: string; content: string; tags: string[] }): WorkPreview {
  return {
    name: plan.name, ...copy, media_kind: plan.media_mode === "video" ? "video" : "image",
    media: [...contents].sort((a, b) => a.position - b.position).flatMap(item =>
      item.media_type === "document" ? [] : [{
        id: item.id, name: item.name, media_type: item.media_type, file_url: item.file_url,
        mime_type: item.mime_type, object_key: "",
      }]),
  };
}

export default function PublicationWorkPreview({ plan }: { plan: PublicationPlan }) {
  const { id, name, media_mode } = plan;
  const { t, locale } = useI18n();
  const [work, setWork] = useState<WorkPreview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setWork(null); setError("");
    Promise.all([fetch_publication_contents(id), fetch_publication_copy(id)])
      .then(([contents, copy]) => {
        if (!contents.success || !copy.success) throw new Error(contents.message || copy.message);
        if (!cancelled) setWork(publicationWorkPreview({ name, media_mode }, contents.data, copy.data));
      })
      .catch(failure => {
        if (!cancelled) setError(localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load publication content", locale));
      });
    return () => { cancelled = true; };
  }, [id, name, media_mode, locale, attempt]);
  if (error) return <div className="amp-dialog-state" role="alert"><p>{error}</p>
    <button type="button" className="amp-button amp-button-secondary"
      onClick={() => setAttempt(value => value + 1)}>{t("重试", "Retry")}</button></div>;
  if (!work) return <div className="amp-dialog-state" role="status">{t("加载中", "Loading")}</div>;
  return <PortfolioWorkView work={work} editable={false} saving={false} onReorder={() => {}} />;
}
