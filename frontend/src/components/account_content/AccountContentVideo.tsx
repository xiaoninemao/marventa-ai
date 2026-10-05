"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";

export default function AccountContentVideo({ url, cover }: { url: string; cover: string }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="amp-account-content-video">
      <video ref={video} src={url} poster={cover || undefined} controls playsInline preload="metadata"
        aria-label={t("视频预览", "Video preview")} onError={() => setFailed(true)} />
      {failed && <div className="amp-dialog-state" role="alert">
        <p>{t("视频加载失败，请稍后重试。", "Video could not load. Try again.")}</p>
        <button type="button" className="amp-button amp-button-secondary" onClick={() => {
          setFailed(false);
          video.current?.load();
        }}>{t("重试", "Retry")}</button>
      </div>}
    </div>
  );
}
