"use client";

import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function ContentGeneratorEmptyState() {
  const { t } = useI18n();

  return (
    <section className="amp-content-result-panel" aria-labelledby="creation-empty-title">
      <div id="canvas-brief" className="amp-content-result-empty">
        <span className="amp-content-result-empty-icon" aria-hidden="true">
          <InlineIcon name="sparkle" strokeWidth={1.5} />
        </span>
        <h2 id="creation-empty-title">{t("开始创作", "Start creating")}</h2>
        <p>{t(
          "输入产品、受众或活动信息，开始梳理方向并生成内容。",
          "Add the product, audience, or campaign details to develop the direction and create content.",
        )}</p>
      </div>
    </section>
  );
}
