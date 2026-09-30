"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_publication_content_text } from "@/services/api_client";
import type { PublicationContent } from "@/types/publishing";

export default function PublicationContentMedia({ item, expanded = false }: {
  item: PublicationContent;
  expanded?: boolean;
}) {
  const { t, locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (item.media_type !== "document" || !root.current) return;
    let cancelled = false;
    setText(null);
    setError("");
    const load = () => {
      void fetch_publication_content_text(item.plan_id, item.id, "text")
        .then((response) => { if (!cancelled) setText(response.data.content); })
        .catch((reason: unknown) => {
          if (!cancelled) setError(localizeErrorMessage(
            reason instanceof Error ? reason.message : "Could not load publication content", locale,
          ));
        });
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "150px" });
    if (expanded) load();
    else observer.observe(root.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [item.id, item.plan_id, item.media_type, item.updated_at, locale, attempt, expanded]);

  return (
    <div ref={root} className={`amp-publication-content-media${expanded ? " is-expanded" : ""}`}>
      {item.media_type === "image" ? (
        <Image src={item.file_url} alt={item.name} width={1200} height={800} unoptimized />
      ) : item.media_type === "video" ? (
        <video src={item.file_url} controls={expanded} muted={!expanded} playsInline preload="metadata" />
      ) : error ? (
        <div className="amp-publication-content-message" role={expanded ? "alert" : undefined} title={error}>
          <span>{expanded ? error : t("预览失败", "Preview unavailable")}</span>
          {expanded && <button type="button" className="amp-button amp-button-secondary"
            onClick={() => setAttempt((value) => value + 1)}>{t("重试", "Retry")}</button>}
        </div>
      ) : text === null ? (
        <div className="amp-publication-content-message">{t("加载中…", "Loading…")}</div>
      ) : (
        <pre className="amp-publication-copy-preview" aria-label={item.name}>{text}</pre>
      )}
    </div>
  );
}
