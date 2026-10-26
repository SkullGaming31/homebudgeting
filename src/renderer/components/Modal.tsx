import React, { useEffect, useRef } from 'react';

type Props = {
  title?: string;
  children?: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
};

export default function Modal({ title, children, onClose, onConfirm, confirmLabel = 'Confirm' }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // focus the first focusable element inside the dialog
    const node = dialogRef.current;
    const focusable = node?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
      if (e.key === 'Tab') {
        // basic focus trap
        const focusables = node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // restore focus
      previouslyFocused.current?.focus();
    };
    // run once on mount
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" ref={dialogRef} aria-labelledby={title ? 'modal-title' : undefined}>
        {title && <h3 id="modal-title" className="modal-title">{title}</h3>}
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="btn muted" onClick={onClose} aria-label="Cancel">
            Cancel
          </button>
          {onConfirm && (
            <button className="btn danger" onClick={onConfirm} aria-label={confirmLabel}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
