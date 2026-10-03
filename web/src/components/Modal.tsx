import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/format';

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

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      // Prefer a field/body control over the header's close button.
      const body = dialog.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE.replace(/, /g, ',')})`);
      (body ?? dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    }
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) {
        onClose();
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
  }, [dismissible, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-0 sm:items-center sm:px-4"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-xl border bg-panel shadow-2xl outline-none sm:rounded-xl',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-md',
          size === 'lg' && 'sm:max-w-xl',
          tone === 'default' && 'border-border',
          tone === 'warning' && 'border-warning/50',
          tone === 'danger' && 'border-danger/50'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-text-primary">
            {title}
          </h2>
          {dismissible && (
            <button
              onClick={onClose}
              className="shrink-0 rounded p-1 text-text-secondary hover:bg-hover hover:text-text-primary"
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
