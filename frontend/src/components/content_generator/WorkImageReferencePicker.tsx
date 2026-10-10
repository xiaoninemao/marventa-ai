"use client";

import { useState } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";
import type { CreativeDeliverable, ImageReference } from "@/types/content_generator";

export default function WorkImageReferencePicker({ work, selected, disabled, blockedReason, onSelect }: {
  work: CreativeDeliverable;
  selected: ImageReference | null;
  disabled: boolean;
  blockedReason: string;
  onSelect: (reference: ImageReference) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const images = [work.image_url, ...work.additional_image_urls].filter(Boolean);
  if (work.media_kind !== "image" || !images.length) return null;
  return (
    <div className="amp-work-image-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
      }}>
      <GuardedButton type="button"
        className={`amp-content-preference-toggle amp-reference-image${selected ? " is-active" : ""}`}
        disabled={disabled} blockedReason={blockedReason}
        aria-label={t("引用作品图片", "Reference work image")}
        title={t("引用作品图片", "Reference work image")}
        aria-expanded={open && !disabled} aria-haspopup="menu"
        onClick={() => setOpen(!open)}>
        <InlineIcon name="image" className="h-4 w-4" />
      </GuardedButton>
      {open && !disabled && <>
        <button type="button" className="amp-agent-mode-backdrop"
          aria-label={t("关闭图片选择", "Close image picker")} onClick={() => setOpen(false)} />
        <div role="menu" aria-label={t("选择作品图片", "Select work image")}
          className="amp-work-image-picker-menu">
          <strong>{t("引用作品图片", "Reference work image")}</strong>
          {images.map((image, index) => (
            <button type="button" role="menuitemradio" key={`${image}-${index}`}
              autoFocus={index === 0}
              aria-label={t("引用图片 {count}", "Reference image {count}", { count: index + 1 })}
              aria-checked={selected?.deliverable_id === work.id && selected.index === index}
              onClick={() => { onSelect({ deliverable_id: work.id, index }); setOpen(false); }}>
              <Image src={image} alt="" width={32} height={32} unoptimized draggable={false} />
              <span>{t("图片 {count}", "Image {count}", { count: index + 1 })}</span>
              {selected?.deliverable_id === work.id && selected.index === index && <InlineIcon name="check" />}
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}
