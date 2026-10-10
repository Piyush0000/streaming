import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../lib/format';

/** Full-area notice (removed, banned, not found, ended...) with a way back. */
export default function NoticeScreen({
  icon,
  title,
  message,
  tone = 'default',
  actionLabel = 'Back to live streams',
  actionTo = '/live',
  children,
}: {
  icon: ReactNode;
  title: string;
  message?: ReactNode;
  tone?: 'default' | 'danger' | 'warning';
  actionLabel?: string;
  actionTo?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div
        className={cx(
          'mb-4 flex h-14 w-14 items-center justify-center rounded-2xl',
          tone === 'default' && 'bg-accent-soft text-accent',
          tone === 'danger' && 'bg-danger/15 text-danger',
          tone === 'warning' && 'bg-warning/15 text-warning'
        )}
      >
        {icon}
      </div>
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
      {message && <p className="mt-1.5 max-w-md break-words text-sm text-text-secondary">{message}</p>}
      {children}
      <Link
        to={actionTo}
        className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
