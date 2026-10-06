import type { SpeakRequestInfo } from '@streaming/shared-types';
import { Check, Hand, X } from 'lucide-react';
import Avatar from './Avatar';

/** Host/admin view of listeners waiting to be let onto the stage. */
export default function SpeakRequestQueue({
  requests,
  onApprove,
  onDeny,
}: {
  requests: SpeakRequestInfo[];
  onApprove: (peerId: string) => void;
  onDeny: (peerId: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <Hand size={26} className="mb-2 origin-bottom animate-wiggle text-text-muted" />
        <p className="text-sm text-text-primary">No speak requests</p>
        <p className="mt-1 text-xs text-text-muted">Listeners who ask to speak will show up here.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 px-4 py-3" aria-label="Speak requests">
      {requests.map((r) => (
        <li key={r.peerId} className="glass glass-glow flex animate-slide-down items-center gap-2.5 rounded-xl px-3 py-2.5">
          <Avatar name={r.username} size={32} glow />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text-primary">{r.username}</p>
            <p className="text-[11px] text-text-muted">wants to speak</p>
          </div>
          <button
            onClick={() => onApprove(r.peerId)}
            className="flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1.5 text-xs font-semibold text-success hover:bg-success/25"
            aria-label={`Approve ${r.username} to speak`}
          >
            <Check size={14} /> Approve
          </button>
          <button
            onClick={() => onDeny(r.peerId)}
            className="flex items-center gap-1 rounded-md bg-hover px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-border"
            aria-label={`Deny ${r.username}`}
          >
            <X size={14} /> Deny
          </button>
        </li>
      ))}
    </ul>
  );
}
