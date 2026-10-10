"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent } from "react";
import { useBlockedInteraction } from "@/components/redesign/GuardedControls";
import { useI18n } from "@/contexts/i18n_context";
import type { MessageReferencePosition } from "@/types/content_generator";
import { createInlineIconElement } from "@/components/redesign/InlineIcon";
import { referenceIconNames } from "./referenceIcons";

export interface ComposerToken {
  id: string;
  kind: MessageReferencePosition["kind"];
  title: string;
}

export interface InlineComposerHandle {
  focus: () => void;
  read: () => { text: string; positions: MessageReferencePosition[] };
}

function readEditor(root: HTMLElement) {
  let text = "";
  const positions: MessageReferencePosition[] = [];
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.dataset.referenceId) {
      const kind = node.dataset.referenceKind;
      if (kind === "image" || kind === "insight" || kind === "case" || kind === "material") {
        positions.push({ offset: text.length, id: node.dataset.referenceId, kind });
      }
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent || ""; return; }
    if (node instanceof HTMLBRElement) { text += "\n"; return; }
    if (node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName) && text && !text.endsWith("\n")) text += "\n";
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return { text, positions };
}

export default forwardRef<InlineComposerHandle, {
  value: string;
  tokens: ComposerToken[];
  placeholder: string;
  disabled: boolean;
  blockedReason: string;
  onChange: (value: string) => void;
  onRemove: (token: ComposerToken) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}>(function InlineMessageComposer({ value, tokens, placeholder, disabled, blockedReason, onChange, onRemove, onKeyDown }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const isDisabled = useRef(disabled);
  isDisabled.current = disabled;
  const selection = useRef<Range | null>(null);
  const previousText = useRef(value);
  const remove = useRef(onRemove);
  remove.current = onRemove;
  const blocked = useBlockedInteraction(disabled, blockedReason);
  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    read: () => editor.current ? readEditor(editor.current) : { text: "", positions: [] },
  }));

  useEffect(() => {
    const root = editor.current;
    if (!root) return;
    if (value !== previousText.current) {
      root.textContent = value;
      selection.current = null;
    }
    previousText.current = value;
    if (disabled) return;
    const key = (kind: string, id: string) => `${kind}:${id}`;
    const active = new Set(tokens.map(token => key(token.kind, token.id)));
    root.querySelectorAll<HTMLElement>("[data-reference-id]").forEach(node => {
      if (!active.has(key(node.dataset.referenceKind || "", node.dataset.referenceId || ""))) node.remove();
    });
    const existing = new Set(Array.from(root.querySelectorAll<HTMLElement>("[data-reference-id]"))
      .map(node => key(node.dataset.referenceKind || "", node.dataset.referenceId || "")));
    for (const token of tokens) {
      if (existing.has(key(token.kind, token.id))) continue;
      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.className = "amp-inline-reference";
      chip.dataset.referenceId = token.id;
      chip.dataset.referenceKind = token.kind;
      chip.title = token.title;
      const icon = createInlineIconElement(referenceIconNames[token.kind]);
      icon.classList.add("amp-inline-reference-icon");
      const label = document.createElement("span");
      label.textContent = token.title;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "×";
      button.setAttribute("aria-label", t("取消引用：{title}", "Remove reference: {title}", { title: token.title }));
      button.addEventListener("click", () => { if (!isDisabled.current) remove.current(token); });
      chip.append(icon, label, button);
      const range = selection.current?.cloneRange() || document.createRange();
      if (!root.contains(range.startContainer)) { range.selectNodeContents(root); range.collapse(false); }
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      selection.current = range.cloneRange();
      if (!disabled) {
        root.focus();
        const current = window.getSelection();
        current?.removeAllRanges();
        current?.addRange(range);
      }
      existing.add(key(token.kind, token.id));
    }
  }, [value, tokens, placeholder, disabled, t]);

  const saveSelection = () => {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
  };
  return <div ref={editor} role="textbox" aria-multiline="true" aria-label={placeholder}
    aria-disabled={disabled || undefined} contentEditable={!disabled} suppressContentEditableWarning
    className="amp-content-prompt-input amp-inline-message-editor" data-placeholder={placeholder}
    onClickCapture={blocked.onClickCapture}
    onInput={() => {
      if (!editor.current || disabled) return;
      const snapshot = readEditor(editor.current);
      previousText.current = snapshot.text;
      onChange(snapshot.text);
      const present = new Set(snapshot.positions.map(p => `${p.kind}:${p.id}`));
      tokens.filter(token => !present.has(`${token.kind}:${token.id}`)).forEach(token => onRemove(token));
      saveSelection();
    }}
    onKeyDown={(event) => { if (!blocked.guard(event)) onKeyDown(event); }}
    onKeyUp={saveSelection} onMouseUp={saveSelection} onBlur={saveSelection}
    onPaste={(event) => {
      event.preventDefault();
      if (blocked.guard(event)) return;
      const current = window.getSelection();
      const range = current?.rangeCount ? current.getRangeAt(0) : null;
      if (!range || !editor.current?.contains(range.startContainer)) return;
      range.deleteContents();
      const text = document.createTextNode(event.clipboardData.getData("text/plain"));
      range.insertNode(text); range.setStartAfter(text); range.collapse(true);
      previousText.current = readEditor(editor.current).text;
      onChange(previousText.current); saveSelection();
    }} />;
});
