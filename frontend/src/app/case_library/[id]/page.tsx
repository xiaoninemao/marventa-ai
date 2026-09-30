import { redirect } from "next/navigation";

export default async function LegacyCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/case_library?case=${encodeURIComponent(id)}`);
}
