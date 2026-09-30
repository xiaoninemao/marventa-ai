"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import type { PublicationContent } from "@/types/publishing";
import { insertPublicationImage, movePublicationImage } from "@/utils/publication_media";

export default function PublicationImageGallery({
  items, editable, disabled, onReorder, onRemove, onPreview,
}: {
  items: PublicationContent[];
  editable: boolean;
  disabled: boolean;
  onReorder: (ids: string[]) => Promise<void>;
  onRemove: (item: PublicationContent) => void;
  onPreview: (item: PublicationContent) => void;
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const drag = useRef<{
    id: string; x: number; y: number; moved: boolean; slot: number | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const [insertion, setInsertion] = useState<{ left: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ item: PublicationContent; x: number; y: number } | null>(null);
  const index = Math.max(0, items.findIndex((item) => item.id === activeId));
  const active = items[index];
  if (!active) return null;

  const move = (direction: -1 | 1) => {
    const ids = items.map((item) => item.id);
    const next = movePublicationImage(ids, active.id, direction);
    if (next !== ids) void onReorder(next);
  };

  return (
    <div className="amp-publication-image-gallery">
      <div className="amp-publication-image-stage">
        <button type="button" className="amp-publication-image-main"
          aria-label={t("预览：{name}", "Preview: {name}", { name: active.name })}
          onClick={() => onPreview(active)}>
          <Image src={active.file_url} alt={active.name} width={1200} height={1600} unoptimized />
        </button>
        {items.length > 1 && <>
          <button type="button" className="amp-publication-image-nav is-previous"
            aria-label={t("上一张", "Previous image")} disabled={index === 0}
            onClick={() => setActiveId(items[index - 1].id)}>
            <InlineIcon name="arrowLeft" />
          </button>
          <button type="button" className="amp-publication-image-nav is-next"
            aria-label={t("下一张", "Next image")} disabled={index === items.length - 1}
            onClick={() => setActiveId(items[index + 1].id)}>
            <InlineIcon name="arrowLeft" />
          </button>
        </>}
        <span className="amp-publication-image-counter">{index + 1} / {items.length}</span>
      </div>
      <div className="amp-publication-image-caption">
        <strong title={active.name}>{active.name}</strong>
        {editable && <div className="amp-publication-image-order">
          <button type="button" disabled={disabled || index === 0}
            aria-label={t("前移：{name}", "Move earlier: {name}", { name: active.name })}
            onClick={() => move(-1)}><InlineIcon name="arrowLeft" /></button>
          <button type="button" disabled={disabled || index === items.length - 1}
            aria-label={t("后移：{name}", "Move later: {name}", { name: active.name })}
            onClick={() => move(1)}><InlineIcon name="arrowLeft" className="is-forward" /></button>
          <button type="button" disabled={disabled}
            aria-label={t("移除：{name}", "Remove: {name}", { name: active.name })}
            onClick={() => onRemove(active)}><InlineIcon name="trash" /></button>
        </div>}
      </div>
      <div className="amp-publication-image-thumbnails" aria-label={t("图片顺序", "Image order")}>
        {items.map((item, itemIndex) => (
          <button key={item.id} type="button" aria-pressed={item.id === active.id}
            aria-label={t("图片 {index}：{name}", "Image {index}: {name}", {
              index: itemIndex + 1, name: item.name,
            })}
            data-image-id={item.id}
            className={dragPreview?.item.id === item.id ? "is-dragging" : undefined}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setActiveId(item.id);
            }}
            onPointerDown={(event) => {
              suppressClick.current = false;
              if (!editable || disabled || event.button !== 0 || !event.isPrimary) return;
              drag.current = {
                id: item.id, x: event.clientX, y: event.clientY, moved: false, slot: null,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || !editable || disabled || !event.isPrimary) return;
              if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
              current.moved = true;
              suppressClick.current = true;
              setDragPreview({
                item,
                x: Math.max(8, Math.min(event.clientX + 16, window.innerWidth - 120)),
                y: Math.max(8, Math.min(event.clientY + 16, window.innerHeight - 144)),
              });
              const strip = event.currentTarget.parentElement;
              if (!strip) return;
              const bounds = strip.getBoundingClientRect();
              if (event.clientY < bounds.top - 12 || event.clientY > bounds.bottom + 12
                || event.clientX < bounds.left - 16 || event.clientX > bounds.right + 16) {
                current.slot = null;
                setInsertion(null);
                return;
              }
              if (event.clientX < bounds.left + 24) strip.scrollLeft -= 12;
              else if (event.clientX > bounds.right - 24) strip.scrollLeft += 12;
              const targets = Array.from(strip.querySelectorAll<HTMLButtonElement>("button[data-image-id]"));
              const slot = targets.findIndex((button) => {
                const rect = button.getBoundingClientRect();
                return event.clientX < rect.left + rect.width / 2;
              });
              current.slot = slot < 0 ? targets.length : slot;
              const before = targets[current.slot - 1];
              const after = targets[current.slot];
              const left = before && after
                ? (before.offsetLeft + before.offsetWidth + after.offsetLeft) / 2
                : after ? after.offsetLeft - 2 : before.offsetLeft + before.offsetWidth + 2;
              setInsertion({ left });
            }}
            onPointerCancel={() => {
              drag.current = null;
              suppressClick.current = false;
              setInsertion(null);
              setDragPreview(null);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setInsertion(null);
              setDragPreview(null);
            }}
            onPointerUp={(event) => {
              if (!event.isPrimary) return;
              const current = drag.current;
              drag.current = null;
              setInsertion(null);
              setDragPreview(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (!editable || disabled || !current?.moved || current.slot === null) return;
              const ids = items.map((current) => current.id);
              const next = insertPublicationImage(ids, current.id, current.slot);
              if (next !== ids) void onReorder(next);
            }}>
            <Image src={item.file_url} alt="" width={120} height={120} unoptimized draggable={false} />
            <span>{itemIndex + 1}</span>
          </button>
        ))}
        {insertion && <div className="amp-publication-image-insertion" aria-hidden="true"
          style={{ left: insertion.left }} />}
      </div>
      {dragPreview && createPortal(
        <div className="amp-publication-image-drag-preview" aria-hidden="true"
          style={{ left: dragPreview.x, top: dragPreview.y }}>
          <Image src={dragPreview.item.file_url} alt="" width={92} height={92}
            unoptimized draggable={false} />
          <span>{dragPreview.item.name}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
