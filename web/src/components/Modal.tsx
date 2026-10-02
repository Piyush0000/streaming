import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/format';

/** Shared dialog shell: backdrop, Esc-to-close, accessible title. */
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
  useEffect(() => {
    if (!dismissible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
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
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-xl border bg-panel shadow-2xl sm:rounded-xl',
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
          <h2 className="min-w-0 truncate text-base font-semibold text-text-primary">{title}</h2>
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
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
