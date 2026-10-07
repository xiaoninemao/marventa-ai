"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS } from "@/i18n/interaction_copy";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import type { ContentCard, QualityReport, SessionRecord } from "@/types/content_generator";

type ContentGeneratorCardWorkspaceProps = {
  session: SessionRecord | null;
  locale: string;
  disabled: boolean;
  blockedReason: string;
  generating_document: boolean;
  checking_quality: boolean;
  quality_report: QualityReport | null;
  active_card_index: number;
  flipped_ids: Set<string>;
  on_active_card_change: (index: number) => void;
  on_generate_document: () => void;
  on_quality_check: () => void;
  render_card: (card: ContentCard, is_active: boolean, flipped: boolean) => ReactNode;
  render_detail: (card: ContentCard) => ReactNode;
};

export default function ContentGeneratorCardWorkspace({
  session,
  locale,
  disabled,
  blockedReason,
  generating_document,
  checking_quality,
  quality_report,
  active_card_index,
  flipped_ids,
  on_active_card_change,
  on_generate_document,
  on_quality_check,
  render_card,
  render_detail,
}: ContentGeneratorCardWorkspaceProps) {
  const { t } = useI18n();
  const cards = session?.cards || [];

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-x-hidden overflow-y-auto bg-zinc-50/30 dark:bg-zinc-950/30">
      <div className="flex flex-col items-center pt-8 lg:pt-12 px-2 lg:px-4 shrink-0">
        <div className="w-full max-w-3xl mb-3 px-2 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-200">
              {session?.title || t("创作结果", "Creative results")}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t(
                "{count} 张卡片 · 点击中间卡片翻转查看要点",
                "{count} cards · Click the center card to flip it and view key points",
                { count: cards.length.toLocaleString(locale) },
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <GuardedButton
              onClick={on_quality_check}
              disabled={disabled || checking_quality}
              blockedReason={checking_quality ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : blockedReason}
              className="amp-button amp-button-secondary shrink-0"
            >
              {checking_quality
                ? t("检查中", "Checking")
                : t("质量检查", "Quality check")}
            </GuardedButton>
            <GuardedButton
              onClick={on_generate_document}
              disabled={disabled || generating_document || quality_report?.ready === false}
              blockedReason={generating_document
                ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.")
                : quality_report?.ready === false
                  ? t("请先处理质量检查中的阻止项。", "Resolve blocking quality findings first.")
                  : blockedReason}
              className="amp-button amp-button-primary shrink-0"
            >
              {generating_document
                ? t(CHINESE_PROGRESS.generating, ENGLISH_PROGRESS.generating)
                : t("生成作品", `${ENGLISH_ACTIONS.generate} work`)}
            </GuardedButton>
          </div>
        </div>

        {quality_report && (
          <section
            className={`amp-content-quality ${quality_report.ready ? "amp-content-quality-ready" : "amp-content-quality-blocking"}`}
            aria-live="polite"
          >
            <div className="amp-content-quality-summary">
              <strong>
                {quality_report.ready
                  ? t("可继续交付", "Ready to continue")
                  : t("需要先处理", "Action required")}
              </strong>
              <span>{quality_report.summary}</span>
              <small>
                {t("{count} 个检查项", "{count} findings", {
                  count: quality_report.issues.length.toLocaleString(locale),
                })}
              </small>
            </div>
            {quality_report.issues.length > 0 && (
              <ul>
                {quality_report.issues.map((issue, index) => (
                  <li key={`${issue.category}-${issue.card_id}-${index}`}>
                    <span data-severity={issue.severity}>
                      {issue.severity === "blocking"
                        ? t("阻止发布", "Blocking")
                        : t("需注意", "Review")}
                    </span>
                    <div>
                      <strong>{issue.evidence}</strong>
                      <p>{issue.suggestion}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="relative w-full max-w-3xl h-[28rem] flex items-center justify-center overflow-visible">
          <button
            onClick={() => on_active_card_change((active_card_index - 1 + cards.length) % cards.length)}
            className="absolute left-1 z-40 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            aria-label={t("上一张", "Previous card")}
          >
            <svg className="h-10 w-10 text-slate-300 transition-colors group-hover:text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="relative w-full h-full" style={{ perspective: "1200px" }}>
            {cards.map((card, index) => {
              const raw_offset = ((index - active_card_index) + cards.length) % cards.length;
              const offset = raw_offset > Math.floor(cards.length / 2)
                ? raw_offset - cards.length
                : raw_offset;
              const abs_offset = Math.abs(offset);
              const sign = Math.sign(offset) || 0;
              const scale = 1 - abs_offset * 0.18;
              const x = sign * (90 + abs_offset * 50);
              const rotateY = sign * (5 + abs_offset * 7);
              const z = 30 - abs_offset * 10;
              const opacity = 1 - abs_offset * 0.25;
              const is_active = offset === 0;

              return (
                <div
                  key={card.id}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: `translate(calc(-50% + ${x}px), -50%) scale(${scale}) rotateY(${rotateY}deg)`,
                    zIndex: z,
                    opacity,
                    transition: "all 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                >
                  {render_card(card, is_active, flipped_ids.has(card.id))}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => on_active_card_change((active_card_index + 1) % cards.length)}
            className="absolute right-1 z-40 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            aria-label={t("下一张", "Next card")}
          >
            <svg className="h-10 w-10 text-slate-300 transition-colors group-hover:text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          {cards.map((card, index) => (
            <button
              key={card.id}
              onClick={() => on_active_card_change(index)}
              aria-label={t("查看第 {count} 张卡片", "View card {count}", { count: index + 1 })}
              aria-current={index === active_card_index}
              className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                index === active_card_index
                  ? "bg-blue-500 dark:bg-blue-400 w-4"
                  : "bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600"
              }`}
            />
          ))}
        </div>
      </div>

      {cards[active_card_index] && render_detail(cards[active_card_index])}
    </div>
  );
}
