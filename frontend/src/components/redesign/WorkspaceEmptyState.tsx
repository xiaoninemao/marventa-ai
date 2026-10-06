import type { ReactNode } from "react";
import InlineIcon, { type InlineIconName } from "./InlineIcon";

export default function WorkspaceEmptyState({ icon, title, description }: {
  icon: InlineIconName;
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="amp-projects-state">
      <span className="amp-projects-empty-icon"><InlineIcon name={icon} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
