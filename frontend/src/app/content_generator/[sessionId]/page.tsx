"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ContentGeneratorExperience } from "@/components/content_generator/ContentGeneratorExperience";

export default function ContentCanvasDetailPage() {
  const params = useParams<{ sessionId: string }>();

  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <ContentGeneratorExperience canvasId={params.sessionId} />
    </Suspense>
  );
}
