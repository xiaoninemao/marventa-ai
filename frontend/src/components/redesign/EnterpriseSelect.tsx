"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton, useBlockedInteraction } from "@/components/redesign/GuardedControls";
import { useI18n } from "@/contexts/i18n_context";

export interface EnterpriseSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface EnterpriseSelectProps<T extends string> {
  value: T;
  options: Array<EnterpriseSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  title?: string;
  placeholder?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  variant?: "default" | "inline";
}

export default function EnterpriseSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  title,
  placeholder = "",
  disabled = false,
  disabledReason,
  className = "",
  variant = "default",
}: EnterpriseSelectProps<T>) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState<number>();
  const [portalTarget, setPortalTarget] = useState<HTMLElement>();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);
  const blocked = disabled || options.length === 0;
  const blockedReason = disabledReason || (options.length === 0
    ? t("暂无可选项。", "No options available.")
    : t("选项已锁定。", "This selection is locked."));
  const interaction = useBlockedInteraction(blocked, blockedReason);
  const {
    open,
    position,
    triggerRef,
    menuRef,
    menuId,
    toggleMenu,
    closeMenu,
    handleTriggerKeyDown,
    handleMenuKeyDown,
  } = useDropdownMenu(options.length, "start");

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (open) {
      setTriggerWidth(triggerRef.current?.getBoundingClientRect().width);
      setPortalTarget(triggerRef.current?.closest<HTMLDialogElement>("dialog[open]") ?? document.body);
    }
  }, [open, triggerRef, value, options.length]);

  const select = (option: EnterpriseSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
  };

  return (
    <span className={`amp-enterprise-select amp-enterprise-select-${variant} ${className}`.trim()}>
      <GuardedButton
        ref={triggerRef}
        type="button"
        className="amp-enterprise-select-trigger"
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={blocked}
        blockedReason={blockedReason}
        onClick={() => toggleMenu(selectedIndex)}
        onKeyDown={handleTriggerKeyDown}
        onKeyDownCapture={(event) => {
          if (blocked && ["ArrowDown", "ArrowUp"].includes(event.key)) interaction.guard(event);
        }}
      >
        <span className={selected ? "" : "amp-enterprise-select-placeholder"}>
          {selected?.label || placeholder}
        </span>
        <InlineIcon name="chevronRight" className="amp-enterprise-select-chevron" />
      </GuardedButton>

      {mounted && open && portalTarget && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="amp-enterprise-select-menu"
          style={{
            left: position.left,
            top: position.top,
            minWidth: triggerWidth,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <GuardedButton
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                blockedReason={option.disabledReason || option.description
                  || t("当前无法选择“{name}”。", "“{name}” is unavailable.", { name: option.label })}
                className="amp-enterprise-select-option"
                onClick={() => select(option)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {active && <InlineIcon name="check" />}
              </GuardedButton>
            );
          })}
        </div>,
        portalTarget,
      )}
    </span>
  );
}
