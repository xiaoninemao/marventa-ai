"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { GuardedButton } from "./GuardedControls";

type RedesignButtonVariant = "primary" | "secondary" | "ghost";

interface RedesignButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode;
  variant?: RedesignButtonVariant;
  blockedReason?: string;
}

export default function RedesignButton({
  children,
  className = "",
  icon,
  type = "button",
  variant = "primary",
  blockedReason,
  ...props
}: RedesignButtonProps) {
  const { t } = useI18n();
  const variantClass = {
    primary: "amp-button-primary",
    secondary: "amp-button-secondary",
    ghost: "amp-button-ghost",
  }[variant];

  return (
    <GuardedButton
      type={type}
      className={`amp-button ${variantClass} ${className}`.trim()}
      {...props}
      blockedReason={blockedReason || t("此操作当前不可用", "This action is currently unavailable")}
    >
      {icon}
      <span>{children}</span>
    </GuardedButton>
  );
}
