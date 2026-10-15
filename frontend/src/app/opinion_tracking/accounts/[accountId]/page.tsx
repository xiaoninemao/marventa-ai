import { redirect } from "next/navigation";

export default async function AccountAnalysisRedirect({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const search = await searchParams;
  const query = new URLSearchParams({ view: "accounts" });
  for (const key of ["project", "days", "tab", "date"]) {
    const value = search[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  if (search.tab !== "opinion") query.set("account", accountId);
  else query.delete("view");
  redirect(`/opinion_tracking?${query}`);
}
