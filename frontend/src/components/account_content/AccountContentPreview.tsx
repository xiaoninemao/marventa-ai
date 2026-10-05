"use client";

import { useEffect, useId, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import { ContentVisibility } from "./AccountContentCard";
import AccountContentGallery from "./AccountContentGallery";
import AccountContentVideo from "./AccountContentVideo";
import AccountContentPlatformVideo from "./AccountContentPlatformVideo";
import type { AccountContentAccount, AccountContentPost } from "@/types/account_content";

export default function AccountContentPreview({ post, account, onClose }: {
  post: AccountContentPost | null;
  account?: Pick<AccountContentAccount, "id" | "project_id">;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (post && !element.open) element.showModal();
    if (!post && element.open) element.close();
  }, [post]);
  const metrics = post ? [
    ["views", "media", t("播放", "Views"), post.statistics.views],
    ["likes", "heart", t("点赞", "Likes"), post.statistics.likes],
    ["comments", "message", t("评论", "Comments"), post.statistics.comments],
    ["shares", "shareForward", t("分享", "Shares"), post.statistics.shares],
  ] as const : [];
  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      className="amp-workspace-dialog amp-account-content-preview m-auto w-[calc(100%_-_32px)] max-w-3xl bg-white"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header>
        <h2 id={titleId}>{t("内容详情", "Content details")}</h2>
        <button type="button" className="amp-modal-close" aria-label={t("关闭", "Close")} onClick={onClose}>
          <InlineIcon name="close" className="h-[18px] w-[18px]" />
        </button>
      </header>
      {post && <div className="amp-account-content-preview-body">
        {post.media_type === "video" && post.video_url
          ? <AccountContentVideo key={post.video_url} url={post.video_url} cover={post.cover_url} />
          : post.media_type === "video" && post.platform_video_id && account
            ? <AccountContentPlatformVideo key={`${account.project_id}:${account.id}:${post.id}:${post.platform_video_id}`}
              projectId={account.project_id} accountId={account.id} videoId={post.platform_video_id}
              cover={post.cover_url} title={post.title || t("无标题", "Untitled content")} />
          : post.media_type === "image_text"
          ? <AccountContentGallery key={post.id} images={post.image_urls?.length ? post.image_urls : post.cover_url ? [post.cover_url] : []}
            title={post.title || t("无标题", "Untitled content")} />
          : post.cover_url && <Image src={post.cover_url} alt="" width={960} height={600} unoptimized referrerPolicy="no-referrer" />}
        <dl className="amp-account-content-metrics">{metrics.map(([key, icon, label, value]) => (
          <div key={key} data-metric={key}>
            <dt><span className="amp-account-content-metric-icon"><InlineIcon name={icon} /></span>{label}</dt>
            <dd>{value === null ? "—" : value.toLocaleString(locale)}</dd>
          </div>
        ))}</dl>
        {post.visibility !== "published" && <ContentVisibility value={post.visibility} />}
        <h3 className="amp-account-content-preview-title">{post.title || t("无标题", "Untitled content")}</h3>
        {post.content && <p>{post.content}</p>}
        {post.published_at && <time>{new Date(post.published_at).toLocaleString(locale)}</time>}
        {post.visibility === "accepted" && <p className="amp-account-content-explanation">
          {t("这是平台受理记录，不代表内容已公开展示。", "This records platform acceptance, not confirmed public visibility.")}
        </p>}
        <div className="amp-account-content-preview-links">
          {post.share_url && <a href={post.share_url} target="_blank" rel="noopener noreferrer" className="amp-button amp-button-primary">
            <InlineIcon name="share" />{t("在平台查看", "View on platform")}
          </a>}
          {post.plan_id && <Link href={`/publishing/${encodeURIComponent(post.plan_id)}`} className="amp-button amp-button-secondary">
            <InlineIcon name="send" />{t("查看发布记录", "View publication")}
          </Link>}
        </div>
      </div>}
    </dialog>
  );
}
