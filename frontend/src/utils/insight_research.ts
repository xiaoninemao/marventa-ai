import type { Translate } from "@/i18n/locale";
import type { InsightResearch } from "@/types/market_insight";

export function insightSupportsResearch(sourceType: string): boolean {
  return sourceType !== "manual";
}

export function researchStatusLabel(research: InsightResearch | null | undefined, t: Translate): string {
  switch (research?.status) {
    case "completed": return t("研究完成", "Research complete");
    case "partial": return t("研究不完整", "Research incomplete");
    case "unavailable": return t("未进行外部检索", "External research unavailable");
    case "edited": return t("结果已人工修改", "Result manually edited");
    default: return t("暂无研究证据", "No research evidence");
  }
}

export function researchStatusDescription(research: InsightResearch | null | undefined, t: Translate): string {
  switch (research?.status) {
    case "completed":
      return t("查看分析依据、竞品对比和资料来源。引用不等于独立事实认证。", "Review the evidence, competitor comparisons and sources. Citations are not independent fact certification.");
    case "partial":
      return t("部分信息未能核实，请结合下方资料与限制说明使用结果。", "Some information could not be checked. Review the sources and limitations below.");
    case "unavailable":
      return t("本次分析未进行外部检索，结果基于输入资料和模型知识。", "No external search was performed. The result uses the input material and model knowledge.");
    case "edited":
      return t("洞察已人工修改，下方资料仅供参考，不代表当前内容已获核验。", "The insight was manually edited. These sources are for reference and do not verify the current content.");
    default:
      return t("本次分析未收集外部研究资料。", "No external research material was collected for this analysis.");
  }
}

export function researchSourceHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function researchSourceAnchor(id: string): string {
  return `insight-research-source-${encodeURIComponent(id)}`;
}
