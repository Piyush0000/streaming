import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cx } from '../lib/format';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  leaving?: boolean;
}

interface ToastContextValue {
  /** Shows a transient message. `durationMs` defaults to 5s (errors 8s). */
  showToast: (message: string, kind?: ToastKind, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONS = { info: Info, success: CheckCircle2, error: AlertTriangle, warning: AlertTriangle } as const;
const STYLES: Record<ToastKind, string> = {
  info: 'border-accent/40 text-text-primary',
  success: 'border-success/40 text-text-primary',
  error: 'border-danger/40 text-text-primary',
  warning: 'border-warning/40 text-text-primary',
};
const ICON_STYLES: Record<ToastKind, string> = {
  info: 'text-accent',
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  // Flag the toast as leaving so it can slide out, then drop it once the exit animation is done.
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 170);
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info', durationMs?: number) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), durationMs ?? (kind === 'error' ? 8000 : 5000));
    },
    [dismiss]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={cx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-panel px-3.5 py-3 text-sm shadow-2xl',
                t.leaving ? 'animate-slide-out-right' : 'animate-slide-in-right',
                STYLES[t.kind]
              )}
            >
              <Icon size={16} className={cx('mt-0.5 shrink-0', ICON_STYLES[t.kind])} />
              <span className="min-w-0 flex-1 break-words">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-0.5 text-text-muted hover:bg-hover hover:text-text-primary"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
