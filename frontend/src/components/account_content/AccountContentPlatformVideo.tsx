"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_account_content_player } from "@/services/account_content_api";
import InlineIcon from "@/components/redesign/InlineIcon";

type PlayerState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

export default function AccountContentPlatformVideo({ projectId, accountId, videoId, cover, title }: {
  projectId: string; accountId: string; videoId: string; cover: string; title: string;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<PlayerState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState({ kind: "loading" });
    try {
      const response = await fetch_account_content_player(projectId, accountId, videoId, active.signal);
      if (!active.signal.aborted) setState({ kind: "ready", url: response.data.player_url });
    } catch (error: unknown) {
      if (!active.signal.aborted) setState({ kind: "error", message: localizeErrorMessage(
        error instanceof Error ? error.message : "Could not load account video player", locale,
      ) });
    }
  };
  return (
    <div className="amp-account-content-platform-video">
      {state.kind === "ready"
        ? <iframe src={state.url} title={t("抖音视频：{title}", "Douyin video: {title}", { title })}
          sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture"
          allowFullScreen referrerPolicy="no-referrer" />
        : <>
          {cover && <Image src={cover} alt="" width={960} height={600} unoptimized referrerPolicy="no-referrer" />}
          <div className="amp-account-content-platform-video-actions">
            {state.kind === "loading"
              ? <p role="status">{t("播放器加载中…", "Loading player…")}</p>
              : <>
                {state.kind === "error" && <p role="alert">{state.message}</p>}
                <button type="button" className="amp-button amp-button-primary" onClick={() => void load()}>
                  <InlineIcon name="media" />{state.kind === "error" ? t("重试", "Retry") : t("播放视频", "Play video")}
                </button>
              </>}
          </div>
        </>}
    </div>
  );
}
