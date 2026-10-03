"use client";

import { useEffect, useId, useRef } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { GuardedButton } from "./GuardedControls";

interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  blockedReason?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteConfirmDialog({
  open,
  title,
  message,
  cancelLabel,
  confirmLabel,
  busyLabel,
  busy = false,
  blockedReason: customBlockedReason,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useI18n();
  const { showWarning } = useToast();
  const blockedReason = customBlockedReason ?? t("正在删除，请等待操作完成。", "Deletion is in progress. Please wait for it to finish.");
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
        else showWarning(blockedReason);
      }}>
      <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={busy}
          blockedReason={blockedReason} onClick={onCancel}>{cancelLabel}</GuardedButton>
        <GuardedButton type="button" className="amp-button amp-project-delete-confirm" disabled={busy}
          blockedReason={blockedReason} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</GuardedButton>
      </div>
    </dialog>
  );
}
