import { redirect } from "next/navigation";

export default async function LegacyOpinionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["project", "account", "days"] as const) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  redirect(`/opinion_tracking${query.size ? `?${query}` : ""}`);
}
