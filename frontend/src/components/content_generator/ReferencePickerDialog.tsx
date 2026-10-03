"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export default function ReferencePickerDialog({
  open, title, leading, className = "", children, onClose,
}: {
  open: boolean;
  title: string;
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      className={`amp-workspace-dialog amp-reference-picker-dialog ${className} m-auto w-[calc(100%_-_32px)] max-w-2xl overflow-hidden bg-white p-0 text-zinc-900 dark:bg-zinc-950 dark:text-white backdrop:bg-slate-950/40`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="amp-reference-picker-layout">
        <header className="amp-reference-picker-header">
          {leading}
          <h2 id={titleId}>{title}</h2>
        </header>
        {children}
      </div>
    </dialog>
  );
}
