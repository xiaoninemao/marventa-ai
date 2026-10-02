"use client";

import {
  forwardRef, useCallback,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes,
  type TextareaHTMLAttributes, type SyntheticEvent, type KeyboardEvent,
} from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";

export interface BlockedControlProps {
  blockedReason: string;
}

export function preventBlockedInteraction(
  event: Pick<SyntheticEvent, "preventDefault" | "stopPropagation">,
  message: string,
  notify: (message: string) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  notify(message);
}

export function useBlockedInteraction(blocked: boolean, blockedReason: string) {
  const { showWarning } = useToast();
  const { t } = useI18n();
  const guard = useCallback((event: SyntheticEvent): boolean => {
    if (!blocked) return false;
    preventBlockedInteraction(
      event, blockedReason.trim() || t("此操作当前不可用", "This action is currently unavailable"), showWarning,
    );
    return true;
  }, [blocked, blockedReason, showWarning, t]);
  return {
    guard,
    "aria-disabled": blocked || undefined,
    "data-blocked-action": blocked ? "true" : undefined,
    onClickCapture: (event: SyntheticEvent) => { guard(event); },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") guard(event);
    },
  };
}

function ariaBlocked(value: boolean | "true" | "false" | undefined): boolean {
  return value === true || value === "true";
}

function editingKey(event: KeyboardEvent<HTMLElement>, type = "text"): boolean {
  if (event.ctrlKey || event.metaKey) return ["v", "x", "z", "y"].includes(event.key.toLowerCase());
  if (event.altKey) return false;
  return event.key.length === 1 || ["Backspace", "Delete", "Enter"].includes(event.key)
    || (["number", "range", "date", "time", "datetime-local", "checkbox", "radio", "select"].includes(type)
      && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key));
}

export const GuardedButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & BlockedControlProps>(
  function GuardedButton({
    disabled, blockedReason, onPointerDownCapture, onMouseDownCapture,
    onTouchStartCapture, onClickCapture, onKeyDownCapture, ...props
  }, ref) {
    const blocked = Boolean(disabled) || ariaBlocked(props["aria-disabled"]);
    const interaction = useBlockedInteraction(blocked, blockedReason);
    return <button {...props} ref={ref} aria-disabled={interaction["aria-disabled"]}
      data-blocked-action={interaction["data-blocked-action"]}
      onPointerDownCapture={(event) => { if (!interaction.guard(event)) onPointerDownCapture?.(event); }}
      onMouseDownCapture={(event) => { if (!interaction.guard(event)) onMouseDownCapture?.(event); }}
      onTouchStartCapture={(event) => { if (!interaction.guard(event)) onTouchStartCapture?.(event); }}
      onClickCapture={(event) => { if (!interaction.guard(event)) onClickCapture?.(event); }}
      onKeyDownCapture={(event) => {
        if (blocked && ["Enter", " "].includes(event.key)) {
          interaction.guard(event);
        } else onKeyDownCapture?.(event);
      }} />;
  },
);

export const GuardedInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & BlockedControlProps>(
  function GuardedInput({
    disabled, blockedReason, readOnly, onClickCapture, onKeyDownCapture,
    onBeforeInputCapture, onChangeCapture, onFocusCapture, ...props
  }, ref) {
    const blocked = Boolean(disabled) || ariaBlocked(props["aria-disabled"]);
    const interaction = useBlockedInteraction(blocked, blockedReason);
    return <input {...props} ref={ref} readOnly={blocked || readOnly}
      aria-disabled={interaction["aria-disabled"]} data-blocked-action={interaction["data-blocked-action"]}
      onClickCapture={(event) => { if (!interaction.guard(event)) onClickCapture?.(event); }}
      onKeyDownCapture={(event) => {
        if (blocked && editingKey(event, props.type)) interaction.guard(event);
        else onKeyDownCapture?.(event);
      }}
      onBeforeInputCapture={(event) => { if (!interaction.guard(event)) onBeforeInputCapture?.(event); }}
      onChangeCapture={(event) => { if (!interaction.guard(event)) onChangeCapture?.(event); }}
      onFocusCapture={(event) => {
        if (blocked) event.stopPropagation();
        else onFocusCapture?.(event);
      }} />;
  },
);

export const GuardedTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & BlockedControlProps>(
  function GuardedTextarea({
    disabled, blockedReason, readOnly, onClickCapture, onKeyDownCapture,
    onBeforeInputCapture, onChangeCapture, onFocusCapture, ...props
  }, ref) {
    const blocked = Boolean(disabled) || ariaBlocked(props["aria-disabled"]);
    const interaction = useBlockedInteraction(blocked, blockedReason);
    return <textarea {...props} ref={ref} readOnly={blocked || readOnly}
      aria-disabled={interaction["aria-disabled"]} data-blocked-action={interaction["data-blocked-action"]}
      onClickCapture={(event) => { if (!interaction.guard(event)) onClickCapture?.(event); }}
      onKeyDownCapture={(event) => {
        if (blocked && editingKey(event)) interaction.guard(event);
        else onKeyDownCapture?.(event);
      }}
      onBeforeInputCapture={(event) => { if (!interaction.guard(event)) onBeforeInputCapture?.(event); }}
      onChangeCapture={(event) => { if (!interaction.guard(event)) onChangeCapture?.(event); }}
      onFocusCapture={(event) => {
        if (blocked) event.stopPropagation();
        else onFocusCapture?.(event);
      }} />;
  },
);

export const GuardedSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & BlockedControlProps>(
  function GuardedSelect({
    disabled, blockedReason, onPointerDownCapture, onClickCapture, onKeyDownCapture,
    onChangeCapture, ...props
  }, ref) {
    const blocked = Boolean(disabled) || ariaBlocked(props["aria-disabled"]);
    const interaction = useBlockedInteraction(blocked, blockedReason);
    return <select {...props} ref={ref} aria-disabled={interaction["aria-disabled"]}
      data-blocked-action={interaction["data-blocked-action"]}
      onPointerDownCapture={(event) => { if (!interaction.guard(event)) onPointerDownCapture?.(event); }}
      onClickCapture={(event) => { if (!interaction.guard(event)) onClickCapture?.(event); }}
      onKeyDownCapture={(event) => {
        if (blocked && editingKey(event, "select")) interaction.guard(event);
        else onKeyDownCapture?.(event);
      }}
      onChangeCapture={(event) => { if (!interaction.guard(event)) onChangeCapture?.(event); }} />;
  },
);
