"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_project_material_content } from "@/services/api_client";
import type { ProjectMaterial } from "@/types/publishing";
import { materialCopyDocument } from "@/utils/material_copy_document";

export default function MaterialDocumentThumbnail({ material }: { material: ProjectMaterial }) {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    setContent(null);
    setError("");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      fetch_project_material_content(material.project_id, material.id)
        .then((response) => { if (!cancelled) setContent(response.data.content); })
        .catch((reason: unknown) => {
          if (!cancelled) setError(localizeErrorMessage(
            reason instanceof Error ? reason.message : "Could not load material content", locale,
          ));
        });
    }, { rootMargin: "200px" });
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [material, locale]);

  return (
    <span ref={containerRef} className="amp-material-document-thumbnail">
      {error ? (
        <span className="amp-material-thumbnail-message" title={error}>
          {t("预览失败，点击查看", "Preview unavailable. Open to retry.")}
        </span>
      ) : content === null ? (
        <span className="amp-material-thumbnail-message">{t("加载中…", "Loading…")}</span>
      ) : (
        <iframe title={material.name} sandbox="" tabIndex={-1} aria-hidden="true"
          srcDoc={materialCopyDocument(content, true)} />
      )}
    </span>
  );
}
