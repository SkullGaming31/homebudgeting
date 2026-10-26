import React, { useEffect } from 'react';

export type ToastItem = { id: string; message: string; type?: 'info' | 'success' | 'error' };

export default function Toasts({ toasts, remove }: { toasts: ToastItem[]; remove: (id: string) => void }) {
  useEffect(() => {
    const timers = toasts.map((t) => {
      const id = setTimeout(() => remove(t.id), 3500);
      return () => clearTimeout(id as unknown as number);
    });
    return () => timers.forEach((fn) => fn());
  }, [toasts, remove]);

  if (!toasts.length) return null;

  return (
    <div className="toast-container" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          <span>{t.message}</span>
          <button className="btn muted" aria-label="Dismiss notification" onClick={() => remove(t.id)} style={{ marginLeft: 8 }}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
