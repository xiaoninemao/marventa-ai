import { useI18n } from "@/contexts/i18n_context";

export default function ContentGeneratorSkeleton() {
  const { t } = useI18n();
  return (
    <section className="amp-content-generation-skeleton" aria-busy="true" aria-label={t("Agent 正在工作", "Agent working")}>
      <header>
        <div>
          <span className="amp-content-skeleton-line w-36" />
          <span className="amp-content-skeleton-line mt-2 w-52" />
        </div>
        <span className="amp-content-skeleton-action" />
      </header>

      <div className="amp-agent-work-skeleton-canvas" aria-hidden="true" />

      <div className="amp-content-detail-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
