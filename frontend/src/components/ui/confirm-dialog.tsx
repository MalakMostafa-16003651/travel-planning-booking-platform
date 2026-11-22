"use client";

import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Button, buttonClassName } from "./button";
import { ErrorAlert } from "./error-alert";

export interface ConfirmDialogProps {
  triggerLabel: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
  children?: ReactNode;
}

export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel = "Please wait…",
  cancelLabel = "Cancel",
  variant = "danger",
  disabled = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirming = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function openDialog(event: MouseEvent<HTMLButtonElement>) {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    triggerRef.current = event.currentTarget;
    setError("");
    dialog.showModal();
    cancelRef.current?.focus();
  }

  async function confirm() {
    if (confirming.current) return;
    confirming.current = true;
    cancelRef.current?.focus();
    setPending(true);
    setError("");
    try {
      await onConfirm();
      dialogRef.current?.close();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Please try again.");
    } finally {
      confirming.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={openDialog} aria-haspopup="dialog">
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-card border border-border bg-card p-6 text-body shadow-xl backdrop:bg-ink/50"
        onCancel={(event) => {
          if (confirming.current) event.preventDefault();
        }}
        onClose={() => triggerRef.current?.focus()}
      >
        <div className="grid gap-4">
          <h2 id={`${id}-title`} className="m-0">{title}</h2>
          <div id={`${id}-description`} className="text-muted">{description}</div>
          {children && (
            <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
              {children}
            </fieldset>
          )}
          {error && <ErrorAlert message={error} />}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              ref={cancelRef}
              type="button"
              className={buttonClassName("secondary", pending ? "cursor-not-allowed opacity-60" : "")}
              aria-disabled={pending}
              onClick={() => {
                if (!confirming.current) dialogRef.current?.close();
              }}
            >
              {cancelLabel}
            </button>
            <Button variant={variant} disabled={pending} onClick={confirm}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
          <span role="status" className="sr-only">{pending ? pendingLabel : ""}</span>
        </div>
      </dialog>
    </>
  );
}
