import type { ChatMessage } from "@/types/content_generator";
import InlineIcon from "@/components/redesign/InlineIcon";
import { referenceIconNames } from "./referenceIcons";

export default function InlineMessageContent({ message, imageLabel }: { message: ChatMessage; imageLabel: string }) {
  let offset = 0;
  const parts = [];
  for (const [index, position] of [...(message.reference_positions || [])].sort((a, b) => a.offset - b.offset).entries()) {
    parts.push(message.content.slice(offset, position.offset));
    const title = position.kind === "image" ? imageLabel
      : message.references?.find(ref => ref.kind === position.kind && ref.id === position.id)?.title;
    if (title) parts.push(<span key={index} className="amp-inline-reference" data-reference-kind={position.kind}>
      <InlineIcon name={referenceIconNames[position.kind]} className="amp-inline-reference-icon" />
      <span>{title}</span>
    </span>);
    offset = position.offset;
  }
  parts.push(message.content.slice(offset));
  return <>{parts}</>;
}
