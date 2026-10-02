import type { ModerationUserState } from '@streaming/shared-types';
import { STREAM_MAX_WARNINGS } from '../lib/streamLimits';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import Avatar from './Avatar';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { relativeTime } from '../lib/format';
import type { ModerationTarget, ParticipantAction } from './ModerationMenu';

/** "Moderation" tab: everyone with a warning / mute / ban in this stream, with undo actions. */
export default function ModerationPanel({
  users,
  loading,
  error,
  onRefresh,
  onAction,
}: {
  users: ModerationUserState[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAction: (action: ParticipantAction, target: ModerationTarget) => void;
}) {
  const rows = users.filter((u) => u.warnings > 0 || u.muted || u.banned);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-xs text-text-muted">
          {rows.length} {rows.length === 1 ? 'person' : 'people'} with active actions
        </p>
        <button
          onClick={onRefresh}
          className="rounded p-1.5 text-text-secondary hover:bg-hover hover:text-text-primary"
          aria-label="Refresh moderation list"
          title="Refresh"
        >
          {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && <ErrorBanner message={error} />}
        {!error && rows.length === 0 && !loading && (
          <div className="flex flex-col items-center py-10 text-center">
            <ShieldAlert size={26} className="mb-2 text-text-muted" />
            <p className="text-sm text-text-primary">No warnings, mutes or bans</p>
            <p className="mt-1 text-xs text-text-muted">Actions you take will be listed here.</p>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((u) => {
            const name = u.username ?? `user ${u.userId.slice(0, 8)}`;
            return (
              <li key={u.userId} className="rounded-lg border border-border bg-base px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Avatar name={name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{name}</p>
                    <p className="text-[11px] text-text-muted">last action {relativeTime(u.lastActionAt)}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {u.warnings > 0 && (
                    <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                      {u.warnings}/{STREAM_MAX_WARNINGS} warnings
                    </span>
                  )}
                  {u.muted && <span className="rounded bg-hover px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">Muted</span>}
                  {u.banned && <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[11px] font-medium text-danger">Banned</span>}
                  <span className="ml-auto flex gap-1.5">
                    {u.muted && (
                      <button
                        onClick={() => onAction('unmute', { userId: u.userId, username: name })}
                        className="rounded-md bg-hover px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-border"
                      >
                        Unmute
                      </button>
                    )}
                    {u.banned && (
                      <button
                        onClick={() => onAction('unban', { userId: u.userId, username: name })}
                        className="rounded-md bg-hover px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-border"
                      >
                        Unban
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
