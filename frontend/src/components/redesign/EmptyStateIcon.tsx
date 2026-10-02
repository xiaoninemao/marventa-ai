import InlineIcon, { type InlineIconName } from "./InlineIcon";

export default function EmptyStateIcon({ name }: { name: InlineIconName }) {
  return <InlineIcon name={name} className="amp-empty-state-icon" data-empty-state-icon={name} />;
}
