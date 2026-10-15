import { redirect } from "next/navigation";

export default async function LegacyLeadTrackingAccountPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["project", "tab", "date"]) {
    const value = search[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  redirect(`/opinion_tracking/accounts/${encodeURIComponent(accountId)}${query.size ? `?${query}` : ""}`);
}
