"use client";

import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import type { AccountContentPost } from "@/types/account_content";

export function ContentVisibility({ value }: { value: AccountContentPost["visibility"] }) {
  const { t } = useI18n();
  const labels = {
    published: t("已发布", "Published"), reviewing: t("审核中", "In review"),
    not_public: t("不公开", "Not public"), unknown: t("状态未知", "Unknown status"),
    accepted: t("平台已受理", "Accepted by platform"),
  };
  return <span className={`amp-account-content-status is-${value}`}>{labels[value]}</span>;
}

export default function AccountContentCard({ post, onOpen }: {
  post: AccountContentPost;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const title = post.title || t("无标题", "Untitled content");
  const cover = post.cover_url || post.image_urls?.[0];
  const date = post.published_at ? new Date(post.published_at) : null;
  return (
    <article className="amp-account-content-card">
      <button type="button" onClick={onOpen} aria-label={t("查看内容：{title}", "View content: {title}", { title })}>
        <span className="amp-account-content-cover">
          {cover ? <Image src={cover} alt="" width={480} height={300} unoptimized referrerPolicy="no-referrer" />
            : <InlineIcon name={post.media_type === "video" ? "video" : "image"} />}
          <span className="amp-account-content-kind">
            <InlineIcon name={post.media_type === "video" ? "video" : "image"} />
            {post.media_type === "video" ? t("视频", "Video") : post.media_type === "image_text"
              ? (post.image_urls?.length || 0) > 1
                ? t("图文（{count} 张）", "Gallery ({count} images)", { count: post.image_urls?.length || 0 })
                : t("图文", "Gallery")
              : t("内容", "Content")}
          </span>
        </span>
        <span className="amp-account-content-caption">
          <strong title={title}>{title}</strong>
          <span><ContentVisibility value={post.visibility} />
            {date && !Number.isNaN(date.getTime()) && <time dateTime={post.published_at}>{date.toLocaleDateString(locale)}</time>}
          </span>
        </span>
      </button>
    </article>
  );
}
