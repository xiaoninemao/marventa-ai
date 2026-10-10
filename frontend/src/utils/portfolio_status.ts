import type { PortfolioScript } from "../types/portfolio";

export type PortfolioWorkStatus = "draft" | PortfolioScript["status"];

export function portfolioWorkStatus(
  work: Pick<PortfolioScript, "status" | "media">,
): PortfolioWorkStatus {
  if (work.status !== "completed") return work.status;
  return work.media?.length ? "completed" : "draft";
}
