import { redirect } from "next/navigation";

export default async function LegacyLeadTrackingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (typeof params.project === "string" && params.project) query.set("project", params.project);
  redirect(`/opinion_tracking${query.size ? `?${query}` : ""}`);
}
