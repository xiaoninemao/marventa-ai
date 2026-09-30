"use client";

import { Suspense } from "react";
import { ContentGeneratorExperience } from "@/components/content_generator/ContentGeneratorExperience";

export default function ContentGeneratorPage() {
  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <ContentGeneratorExperience />
    </Suspense>
  );
}
