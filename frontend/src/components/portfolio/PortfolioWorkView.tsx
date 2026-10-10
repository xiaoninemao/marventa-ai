"use client";

import Image from "next/image";
import { Fragment, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton, GuardedInput, GuardedTextarea } from "@/components/redesign/GuardedControls";
import type { PortfolioScript } from "@/types/portfolio";
import PortfolioAddMedia from "./PortfolioAddMedia";

export function insertPortfolioMedia(ids: string[], from: string, gap: number): string[] {
  const source = ids.indexOf(from);
  if (source < 0 || !Number.isInteger(gap) || gap < 0 || gap > ids.length) return ids;
  const target = gap > source ? gap - 1 : gap;
  if (source === target) return ids;
  const result = [...ids];
  result.splice(source, 1);
  result.splice(target, 0, from);
  return result;
}

export function portfolioInsertionIndex(bounds: readonly { left: number; right: number }[], x: number): number {
  const index = bounds.findIndex(item => x < (item.left + item.right) / 2);
  return index < 0 ? bounds.length : index;
}

export function portfolioEdgeScroll(x: number, left: number, right: number): number {
  const edge = Math.min(40, (right - left) / 4);
  if (edge <= 0 || x < left || x > right) return 0;
  if (x < left + edge) return -Math.ceil((left + edge - x) / edge * 12);
  if (x > right - edge) return Math.ceil((x - right + edge) / edge * 12);
  return 0;
}

export default function PortfolioWorkView({ work, editable, saving, onReorder, editing = false,
  tagsText = "", onTextChange, onTagsChange, onUpload, onRemove, onPickMaterials }: {
  work: Pick<PortfolioScript, "name" | "title" | "content" | "media_kind" | "media" | "tags">;
  editable: boolean;
  saving: boolean;
  onReorder: (ids: string[]) => void;
  editing?: boolean;
  tagsText?: string;
  onTextChange?: (field: "title" | "content", value: string) => void;
  onTagsChange?: (value: string) => void;
  onUpload?: (files: File[], gap: number) => void;
  onRemove?: (id: string) => void;
  onPickMaterials?: (gap: number) => void;
}) {
  const { t } = useI18n();
  const reorderHintId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const strip = useRef<HTMLOListElement>(null);
  const dragId = useRef<string | null>(null);
  const dragX = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadGap = useRef(0);
  const media = work.media || [];
  const hasMedia = media.length > 0;
  const showThumbnails = hasMedia && work.media_kind !== "video";
  const selected = media.find(item => item.id === selectedId) || media[0];
  const selectedIndex = selected ? media.findIndex(item => item.id === selected.id) : -1;
  const selectedMediaId = selected?.id;
  const canReorder = editable && !saving && work.media_kind !== "video" && media.length > 1;
  const visual = media.length > 0 || Boolean(work.media_kind) || editing;
  const savingReason = t("正在保存作品，请稍候", "Work is being saved. Please wait.");
  useEffect(() => {
    const root = strip.current;
    const item = root && Array.from(root.querySelectorAll<HTMLLIElement>("li[data-media-id]"))
      .find(node => node.dataset.mediaId === selectedMediaId);
    if (!root || !item) return;
    const bounds = root.getBoundingClientRect();
    const thumb = item.getBoundingClientRect();
    if (thumb.left < bounds.left + 6) root.scrollLeft -= bounds.left + 6 - thumb.left;
    else if (thumb.right > bounds.right - 6) root.scrollLeft += thumb.right - bounds.right + 6;
  }, [selectedMediaId]);
  useEffect(() => {
    const root = strip.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (root.scrollWidth <= root.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const before = root.scrollLeft;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? root.clientWidth : 1;
      root.scrollLeft += event.deltaY * unit;
      if (root.scrollLeft !== before) event.preventDefault();
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [visual, showThumbnails]);
  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
  }, []);

  const reorder = (from: string, gap: number) => {
    if (!canReorder) return;
    const ids = media.map(item => item.id);
    const next = insertPortfolioMedia(ids, from, gap);
    if (next !== ids) {
      setSelectedId(from);
      onReorder(next);
    }
  };
  const insertionAt = (root: HTMLOListElement, x: number) => portfolioInsertionIndex(
    Array.from(root.querySelectorAll<HTMLLIElement>("li[data-media-index]")).map(item => item.getBoundingClientRect()), x,
  );
  const stopScrolling = () => {
    dragX.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  };
  const endDrag = () => {
    stopScrolling();
    dragId.current = null;
    setDraggedId(null);
    setDropIndex(null);
  };
  const startScrolling = () => {
    if (scrollFrame.current !== null) return;
    const tick = () => {
      const root = strip.current;
      const x = dragX.current;
      scrollFrame.current = null;
      if (!root || x === null || !dragId.current) return;
      const bounds = root.getBoundingClientRect();
      const delta = portfolioEdgeScroll(x, bounds.left, bounds.right);
      if (!delta) return;
      const before = root.scrollLeft;
      root.scrollLeft += delta;
      setDropIndex(insertionAt(root, x));
      if (root.scrollLeft !== before) scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  };
  const dragOver = (event: DragEvent<HTMLOListElement>) => {
    if (!canReorder || !dragId.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    dragX.current = event.clientX;
    setDropIndex(insertionAt(event.currentTarget, event.clientX));
    startScrolling();
  };
  const chooseSource = (source: "materials" | "upload", gap: number) => {
    if (source === "materials") onPickMaterials?.(gap);
    else { uploadGap.current = gap; uploadInput.current?.click(); }
  };
  const addSlot = (gap: number) => <li className="amp-portfolio-add-slot" key={`add-${gap}`}>
    <PortfolioAddMedia index={gap} disabled={saving} video={work.media_kind === "video"} onChoose={chooseSource} />
  </li>;
  return (
    <section className={`amp-portfolio-work${visual ? " has-media" : ""}${editing ? " is-editing" : ""}`}>
      {visual && <div className={`amp-portfolio-work-visual${hasMedia ? "" : " is-empty"}${work.media_kind === "video" ? " is-video" : ""}`}>
      {editable && <input ref={uploadInput} type="file" hidden multiple={work.media_kind !== "video"}
        accept={work.media_kind === "video" ? ".mp4,.mov,.webm,.m4v" : ".jpg,.jpeg,.png,.gif,.webp"}
        onChange={event => {
          if (!saving) onUpload?.(Array.from(event.target.files || []), uploadGap.current);
          event.target.value = "";
        }} />}
      <div className="amp-portfolio-work-media">
        {selected ? selected.media_type === "video"
          ? <video key={selected.id} src={selected.file_url} controls playsInline preload="metadata" aria-label={work.title || work.name} />
          : <Image src={selected.file_url} alt={selected.name} width={1200} height={900} unoptimized loading="eager" />
          : <div className="amp-portfolio-media-empty"><InlineIcon name={work.media_kind === "video" ? "video" : "image"} />
            <span>{t("尚未添加媒体", "No media added yet")}</span>
            {editable && <div className="amp-portfolio-media-empty-actions">
              <GuardedButton type="button" className="amp-button amp-button-secondary"
                disabled={saving} blockedReason={savingReason} onClick={() => chooseSource("materials", 0)}>
                <InlineIcon name="collection" />{t("从素材集选择", "Materials")}
              </GuardedButton>
              <GuardedButton type="button" className="amp-button amp-button-secondary"
                disabled={saving} blockedReason={savingReason} onClick={() => chooseSource("upload", 0)}>
                <InlineIcon name="upload" />{t("本地上传", "Upload")}
              </GuardedButton>
            </div>}</div>}
        {editing && selected?.media_type === "video" && <GuardedButton type="button"
          className="amp-portfolio-video-remove" aria-label={t("删除视频", "Delete video")}
          disabled={saving} blockedReason={savingReason} onClick={() => onRemove?.(selected.id)}>
          <InlineIcon name="close" />
        </GuardedButton>}
        {selected?.media_type === "image" && media.length > 1 && <>
          {selectedIndex > 0 && <button type="button" className="amp-publication-image-nav is-previous"
            aria-label={t("上一张图片", "Previous image")}
            onClick={() => setSelectedId(media[selectedIndex - 1].id)}>
            <InlineIcon name="arrowLeft" />
          </button>}
          {selectedIndex < media.length - 1 && <button type="button" className="amp-publication-image-nav is-next"
            aria-label={t("下一张图片", "Next image")}
            onClick={() => setSelectedId(media[selectedIndex + 1].id)}>
            <InlineIcon name="arrowLeft" />
          </button>}
        </>}
      </div>
      {showThumbnails && <div className="amp-portfolio-media-order">
        <span className="sr-only" role="status">{saving ? t("正在保存", "Saving") : ""}</span>
        {canReorder && <span className="sr-only" id={reorderHintId}>
          {t("拖到图片之间调整顺序，或使用 Alt + 方向键", "Drag between images to reorder, or use Alt + arrow keys")}
        </span>}
        <ol ref={strip} aria-label={t("作品媒体顺序", "Work media order")} aria-busy={saving}
          aria-describedby={canReorder ? reorderHintId : undefined}
          onDragOver={dragOver}
          onDragLeave={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right
              || event.clientY < bounds.top || event.clientY > bounds.bottom) {
              stopScrolling(); setDropIndex(null);
            }
          }}
          onScroll={event => {
            if (dragId.current && dragX.current !== null) setDropIndex(insertionAt(event.currentTarget, dragX.current));
          }}
          onDrop={event => {
            event.preventDefault();
            if (dragId.current) reorder(dragId.current, insertionAt(event.currentTarget, event.clientX));
            endDrag();
          }}>
          {media.map((item, index) => <Fragment key={item.id}>
            {editing && work.media_kind !== "video" && addSlot(index)}
            <li data-media-index={index} data-media-id={item.id}
            className={dropIndex === index ? "is-insert-before"
              : dropIndex === media.length && index === media.length - 1 ? "is-insert-after" : undefined}>
            <button type="button" draggable={canReorder}
              className={`amp-portfolio-thumbnail${selected?.id === item.id ? " is-selected" : ""}${draggedId === item.id ? " is-dragging" : ""}`}
              aria-pressed={selected?.id === item.id}
              aria-label={t("查看第 {count} 个媒体", "View media {count}", { count: index + 1 })}
              onClick={() => setSelectedId(item.id)}
              onDragStart={event => {
                if (!canReorder) { event.preventDefault(); return; }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                dragId.current = item.id;
                setDraggedId(item.id);
              }}
              onDragEnd={endDrag}
              onKeyDown={event => {
                if (!canReorder || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                if (event.key === "ArrowLeft" && index > 0) reorder(item.id, index - 1);
                if (event.key === "ArrowRight" && index < media.length - 1) reorder(item.id, index + 2);
              }}>
              {item.media_type === "image"
                ? <Image src={item.file_url} alt="" width={80} height={64} unoptimized draggable={false} />
                : <InlineIcon name="video" />}
              <b>{index + 1}</b>
            </button>
            {editing && <GuardedButton type="button" className="amp-portfolio-media-remove"
              aria-label={t("删除第 {count} 个媒体", "Remove media {count}", { count: index + 1 })}
              disabled={saving} blockedReason={savingReason} onClick={() => onRemove?.(item.id)}>
              <InlineIcon name="close" />
            </GuardedButton>}
          </li></Fragment>)}
          {editing && (work.media_kind !== "video" || media.length === 0) && addSlot(media.length)}
        </ol>
      </div>}
      </div>}
      <article className="amp-portfolio-work-copy">
        {editing ? <>
          <label>{t("标题", "Title")}
            <GuardedInput value={work.title} onChange={event => onTextChange?.("title", event.target.value)}
              maxLength={200} disabled={saving} blockedReason={savingReason} />
          </label>
          <label className="amp-portfolio-copy-editor">{t("文案", "Copy")}
            <GuardedTextarea aria-label={t("文案", "Copy")} value={work.content} onChange={event => onTextChange?.("content", event.target.value)}
              maxLength={20000} disabled={saving} blockedReason={savingReason} />
          </label>
          <label>{t("标签（用逗号分隔）", "Tags (comma-separated)")}
            <GuardedInput value={tagsText} onChange={event => onTagsChange?.(event.target.value)}
              disabled={saving} blockedReason={savingReason} />
          </label>
        </> : <>
        <h2>{work.title || t("尚未填写标题", "No title yet")}</h2>
        <p>{work.content}</p>
        {!!work.tags?.length && <div className="amp-portfolio-work-tags">
          {work.tags.map(tag => <span key={tag}>#{tag.replace(/^#+/, "")}</span>)}
        </div>}
        </>}
      </article>
    </section>
  );
}
