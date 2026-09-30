"use client";

import { useEffect, useId, useRef } from "react";

interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
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
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
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
      }}>
      <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={busy}
          onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="amp-button amp-project-delete-confirm" disabled={busy}
          onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </dialog>
  );
}
