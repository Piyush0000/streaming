import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog shell: backdrop, Esc-to-close, accessible title, focus moved
 * into the dialog on open, Tab trapped inside, focus restored on close.
 */
export default function Modal({
  title,
  onClose,
  children,
  size = 'md',
  dismissible = true,
  tone = 'default',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** When false the backdrop/Esc/X don't close it (e.g. mid-request). */
  dismissible?: boolean;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Plays the exit animation, then hands control back to the parent (which unmounts us).
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onCloseRef.current();
    }, 150);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      // Prefer a field/body control over the header's close button.
      // On touch screens focusing a field pops the keyboard and hides the dialog: focus the dialog itself.
      const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const body = touch ? null : dialog.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE.replace(/, /g, ',')})`);
      (body ?? (touch ? dialog : dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog)).focus();
    }
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) {
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissible, requestClose]);

  return (
    <div
      className={cx(
        'fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-0 sm:items-center sm:px-4',
        closing ? 'animate-fade-out' : 'animate-fade-in'
      )}
      onClick={dismissible ? requestClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-xl border bg-panel pb-safe shadow-2xl outline-none sm:rounded-xl sm:pb-0',
          closing ? 'animate-pop-out' : 'animate-pop-in',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-md',
          size === 'lg' && 'sm:max-w-xl',
          tone === 'default' && 'border-border',
          tone === 'warning' && 'border-warning/50',
          tone === 'danger' && 'border-danger/50'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 sm:py-4">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-text-primary">
            {title}
          </h2>
          {dismissible && (
            <button
              onClick={requestClose}
              className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-hover hover:text-text-primary sm:mr-0 sm:h-8 sm:w-8"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div data-modal-body className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
