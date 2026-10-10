import type { MessageReferencePosition } from "@/types/content_generator";
import type { InlineIconName } from "@/components/redesign/InlineIcon";

export const referenceIconNames: Record<MessageReferencePosition["kind"], InlineIconName> = {
  insight: "insight", case: "case", material: "collection", image: "image",
};
