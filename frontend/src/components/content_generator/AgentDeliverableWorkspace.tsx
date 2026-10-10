"use client";

import Image from "next/image";
import { useState, type PointerEvent } from "react";
import type { CreativeDeliverable } from "@/types/content_generator";
import { useI18n } from "@/contexts/i18n_context";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";

function AgentImageComposition({ images, title, label }: {
  images: string[];
  title: string;
  label: string;
}) {
  const { t } = useI18n();
  const [focusedImage, setFocusedImage] = useState<number | null>(null);
  const dense = images.length > 4;
  const rowCount = Math.max(1, Math.round(Math.sqrt(images.length)));
  const perRow = Math.floor(images.length / rowCount);
  const extra = images.length % rowCount;
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    start: index * perRow + Math.min(index, extra),
    count: perRow + (index < extra ? 1 : 0),
  }));
  const focusedRow = rows.findIndex(row =>
    focusedImage !== null && focusedImage >= row.start && focusedImage < row.start + row.count);
  const tracks = (weights: number[], focused: number) => weights.map((weight, index) =>
    `minmax(0, ${weight * (index === focused ? 1.5 : 1)}fr)`).join(" ");
  const gap = (count: number) => `min(8px, ${12.5 / count}%)`;

  const handleImagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || images.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    let next = 0;
    if (images.length === 2) {
      next = x < 0.5 ? 0 : 1;
    } else if (images.length === 3) {
      next = x < 0.574 ? 0 : y < 0.5 ? 1 : 2;
    } else if (images.length === 4) {
      next = (y < 0.5 ? 0 : 2) + (x < 0.5 ? 0 : 1);
    } else {
      const row = rows.find(row => y < (row.start + row.count) / images.length) || rows[rows.length - 1];
      next = row.start + Math.max(0, Math.min(row.count - 1, Math.floor(x * row.count)));
    }
    if (next !== focusedImage) setFocusedImage(next);
  };

  const renderImage = (image: string, index: number) => (
    <figure key={image} className={focusedImage === index ? "is-focused" : undefined}>
      <Image src={image}
        alt={images.length > 1
          ? t("{title}，图片 {count}", "{title}, image {count}", { title, count: index + 1 })
          : title}
        fill
        sizes={`${Math.ceil(100 / (dense ? rows[0].count : images.length === 1 ? 1 : 2))}vw`}
        unoptimized
        priority={index === 0} />
    </figure>
  );

  return (
    <div
      className={`amp-agent-image-composition is-count-${images.length}${
        focusedImage === null ? "" : ` is-focused-${focusedImage + 1}`
      }`}
      style={dense ? { gridTemplateRows: tracks(rows.map(row => row.count), focusedRow), rowGap: gap(rowCount) } : undefined}
      aria-label={label}
      onPointerMove={handleImagePointerMove}
      onPointerLeave={() => setFocusedImage(null)}
    >
      {dense ? rows.map((row, index) => (
        <div key={index} className="amp-agent-image-row"
          style={{ gridTemplateColumns: tracks(Array.from({ length: row.count }, () => 1), focusedRow === index && focusedImage !== null
            ? focusedImage - row.start : -1), columnGap: gap(row.count) }}>
          {images.slice(row.start, row.start + row.count).map((image, offset) => renderImage(image, row.start + offset))}
        </div>
      )) : images.map(renderImage)}
    </div>
  );
}

export default function AgentDeliverableWorkspace({
  deliverable,
  disabled,
  blockedReason,
  savingWork,
  onSaveWork,
  onCopy,
  historical = false,
  restoreDisabled = false,
  onRestore,
  onReturnToCurrent,
}: {
  deliverable: CreativeDeliverable;
  disabled: boolean;
  blockedReason: string;
  savingWork: boolean;
  onSaveWork: () => void;
  onCopy: (value: string) => void;
  historical?: boolean;
  restoreDisabled?: boolean;
  onRestore?: () => void;
  onReturnToCurrent?: () => void;
}) {
  const { t } = useI18n();
  const isVideo = deliverable.media_kind === "video";
  const images = [...new Set([
    deliverable.image_url,
    ...(deliverable.additional_image_urls || []),
  ].filter(Boolean))];

  return (
    <section className="amp-agent-deliverable" aria-labelledby="agent-deliverable-title">
      {historical && <div className="amp-work-history-banner">
        <div className="amp-work-history-status">
          <InlineIcon name="history" />
          <span>{t("正在预览历史版本", "Previewing a historical version")}</span>
        </div>
        <div className="amp-work-history-actions">
          <button type="button" className="amp-work-history-return amp-text-action"
            onClick={onReturnToCurrent}>{t("返回当前版本", "Back to current")}</button>
          <GuardedButton type="button" className="amp-work-history-restore amp-text-action amp-text-action-primary"
            disabled={restoreDisabled} blockedReason={blockedReason}
            onClick={onRestore}>
            {t("恢复为新版本", "Restore as new version")}
          </GuardedButton>
        </div>
      </div>}
      <header className="amp-agent-deliverable-header">
        <div>
          <span>{isVideo
            ? deliverable.video_url ? t("视频作品", "Video work") : t("视频创作方案", "Video creation package")
            : t("图文成品", "Image content package")}</span>
          <h2 id="agent-deliverable-title">{deliverable.title || t("尚未填写标题", "No title yet")}</h2>
        </div>
        <div className="amp-agent-deliverable-actions">
          <GuardedButton type="button" className="amp-button amp-button-primary"
            disabled={disabled || savingWork}
            blockedReason={blockedReason}
            onClick={onSaveWork}>
            {savingWork ? t("保存中", "Saving") : t("保存作品", "Save")}
          </GuardedButton>
        </div>
      </header>

      <div className="amp-agent-deliverable-layout">
        <div className="amp-agent-image-gallery">
          {isVideo && deliverable.video_url ? (
            <video className="amp-agent-work-video" src={deliverable.video_url}
              controls playsInline preload="metadata" aria-label={deliverable.title} />
          ) : images.length > 0 ? (
            <AgentImageComposition key={deliverable.id} images={images} title={deliverable.title}
              label={isVideo ? t("视频关键视觉", "Video key visuals") : t("生成图片", "Generated images")} />
          ) : (
            <div className="amp-agent-deliverable-visual">
            <div className="amp-agent-deliverable-visual-empty">
              <InlineIcon name="image" />
              <p>{isVideo ? t("尚未加入视频", "No video added yet") : t("本次成品未生成图片", "No image was generated for this deliverable")}</p>
            </div>
              <span>{t("文字成品", "Text deliverable")}</span>
            </div>
          )}
        </div>

        <div className="amp-agent-deliverable-content">
          <article>
            <header>
              <h3>{t("标题", "Title")}</h3>
              {deliverable.title.trim() && <button type="button" onClick={() => onCopy(deliverable.title)}
                aria-label={t("复制标题", "Copy title")}>
                <InlineIcon name="copy" />
              </button>}
            </header>
            <p>{deliverable.title.trim() ? deliverable.title : t("尚未填写标题", "No title yet")}</p>
          </article>

          <article>
            <header>
              <h3>{t("发布文案", "Publication copy")}</h3>
              {deliverable.publication_copy.trim() && <button type="button" onClick={() => onCopy(deliverable.publication_copy)}
                aria-label={t("复制文案", "Copy publication copy")}>
                <InlineIcon name="copy" />
              </button>}
            </header>
            <p className="amp-agent-deliverable-copy">{deliverable.publication_copy.trim()
              ? deliverable.publication_copy : t("尚未填写文案", "No copy yet")}</p>
          </article>

          <article>
            <header><h3>{t("标签", "Tags")}</h3></header>
            <div className="amp-agent-deliverable-tags">
              {deliverable.tags.map((tag) => <span key={tag}>#{tag.replace(/^#+/, "")}</span>)}
            </div>
          </article>

          {isVideo && (
            <>
              <article>
                <header>
                  <h3>{t("视频脚本", "Video script")}</h3>
                  <button type="button" onClick={() => onCopy(deliverable.video_script)}
                    aria-label={t("复制视频脚本", "Copy video script")}>
                    <InlineIcon name="copy" />
                  </button>
                </header>
                <p className="amp-agent-deliverable-copy">{deliverable.video_script}</p>
              </article>
              <article>
                <header><h3>{t("分镜", "Storyboard")}</h3></header>
                <ol>
                  {deliverable.storyboard.map((shot, index) => (
                    <li key={`${index}-${shot}`}>
                      <span>{index + 1}</span>
                      <p>{shot}</p>
                    </li>
                  ))}
                </ol>
              </article>
            </>
          )}

        </div>
      </div>
    </section>
  );
}
