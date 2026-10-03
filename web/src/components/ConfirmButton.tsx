import { ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '../lib/format';
import Spinner from './Spinner';

/**
 * Two-step destructive button: the first press swaps it for an inline
 * "Confirm / Cancel" pair (no nested dialog needed). Auto-disarms after 8s.
 */
export default function ConfirmButton({
  children,
  confirmLabel = 'Confirm',
  ariaLabel,
  onConfirm,
  busy,
  disabled,
  className,
}: {
  children: ReactNode;
  confirmLabel?: string;
  ariaLabel: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    confirmRef.current?.focus();
    const t = window.setTimeout(() => setArmed(false), 8000);
    return () => window.clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (!busy) setArmed(false);
  }, [busy]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        disabled={disabled || busy}
        aria-label={ariaLabel}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-danger/15 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <span role="group" aria-label={`Confirm: ${ariaLabel}`} className="inline-flex items-center gap-1">
      <button
        ref={confirmRef}
        type="button"
        onClick={() => void onConfirm()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-danger/90 disabled:opacity-60"
      >
        {busy && <Spinner size={12} className="text-white" />}
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={busy}
        className="rounded-md px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text-primary"
      >
        Cancel
      </button>
    </span>
  );
}
