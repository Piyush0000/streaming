import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { Channel, ChannelInvite, InviteStatus } from '@streaming/shared-types';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { createInvite, inviteUrl, listInvites, revokeInvite } from '../lib/channels';
import { copyText } from '../lib/clipboard';
import { useSession } from '../context/SessionContext';
import ConfirmButton from './ConfirmButton';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { cx } from '../lib/format';

const EXPIRY_OPTIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '1 day' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
] as const;

const STATUS_STYLE: Record<InviteStatus, string> = {
  active: 'bg-success/15 text-success',
  expired: 'bg-warning/15 text-warning',
  exhausted: 'bg-hover text-text-secondary',
};
const STATUS_LABEL: Record<InviteStatus, string> = { active: 'Active', expired: 'Expired', exhausted: 'Used up' };

const fieldCls =
  'rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

function formatExpiry(iso: string, status: InviteStatus): string {
  const when = new Date(iso);
  const abs = when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return status === 'expired' ? `Expired ${abs}` : `Expires ${abs}`;
}

export default function InvitesTab({ channel }: { channel: Channel }) {
  const { session } = useSession();
  const token = session?.accessToken ?? '';

  const [invites, setInvites] = useState<ChannelInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [hours, setHours] = useState<number>(168);
  const [maxUses, setMaxUses] = useState('');
  const [maxUsesError, setMaxUsesError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setInvites(await listInvites(token, channel.id));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, channel.id]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(copyTimer.current);
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    setMaxUsesError(null);
    let uses: number | null = null;
    if (maxUses.trim() !== '') {
      const n = Number(maxUses);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        setMaxUsesError('Enter a whole number from 1 to 1000, or leave it empty for unlimited.');
        return;
      }
      uses = n;
    }
    setCreating(true);
    try {
      const created = await createInvite(token, channel.id, { expiresInHours: hours, maxUses: uses });
      setCreatedToken(created.token);
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(inviteToken: string) {
    const ok = await copyText(inviteUrl(inviteToken));
    if (!ok) {
      setActionError('Could not copy automatically. Select the link and copy it manually.');
      return;
    }
    setCopiedToken(inviteToken);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedToken(null), 2000);
  }

  async function handleRevoke(inviteToken: string) {
    setRevoking(inviteToken);
    setActionError(null);
    try {
      await revokeInvite(token, channel.id, inviteToken);
      setInvites((prev) => prev.filter((i) => i.token !== inviteToken));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      <form onSubmit={handleCreate} className="flex flex-col gap-3" noValidate>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Create invite link</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-expiry" className="text-xs text-text-secondary">
              Expires after
            </label>
            <select id="invite-expiry" value={hours} onChange={(e) => setHours(Number(e.target.value))} className={fieldCls}>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-max" className="text-xs text-text-secondary">
              Max uses
            </label>
            <input
              id="invite-max"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              placeholder="Unlimited"
              value={maxUses}
              onChange={(e) => {
                setMaxUses(e.target.value);
                setMaxUsesError(null);
              }}
              aria-invalid={!!maxUsesError}
              aria-describedby={maxUsesError ? 'invite-max-error' : undefined}
              className={fieldCls}
            />
          </div>
        </div>
        {maxUsesError && (
          <p id="invite-max-error" role="alert" className="-mt-1 text-xs text-danger">
            {maxUsesError}
          </p>
        )}
        <button
          type="submit"
          disabled={creating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
        >
          {creating ? <Spinner size={14} className="text-white" /> : <Plus size={15} aria-hidden />}
          Create invite
        </button>
      </form>

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

      <section aria-labelledby="invites-heading">
        <h3 id="invites-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Invite links {!loading && !loadError && <span className="text-text-muted">({invites.length})</span>}
        </h3>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size={18} />
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-start gap-2">
            <ErrorBanner message={loadError} />
            <button onClick={() => void load()} className="text-sm font-medium text-accent hover:underline">
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && invites.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <Link2 size={20} className="text-text-muted" aria-hidden />
            <p className="text-sm text-text-secondary">No invite links yet.</p>
            <p className="text-xs text-text-muted">Create one above and share it with the people you want to bring in.</p>
          </div>
        )}

        {!loading && !loadError && invites.length > 0 && (
          <ul className="flex flex-col gap-2">
            {invites.map((inv) => {
              const copied = copiedToken === inv.token;
              const fresh = createdToken === inv.token;
              return (
                <li
                  key={inv.token}
                  className={cx('rounded-lg border px-3 py-2.5', fresh ? 'border-accent/60 bg-accent-soft' : 'border-border')}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_STYLE[inv.status])}>
                      {STATUS_LABEL[inv.status]}
                    </span>
                    <span className="text-xs text-text-secondary">
                      Uses {inv.uses} / {inv.maxUses ?? 'unlimited'}
                    </span>
                    <span className="text-xs text-text-muted">{formatExpiry(inv.expiresAt, inv.status)}</span>
                  </div>
                  <p className="mt-1.5 break-all rounded bg-base px-2 py-1 font-mono text-xs text-text-secondary" aria-label="Invite link">
                    {inviteUrl(inv.token)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">by {inv.createdByUsername}</span>
                    <div className="flex items-center gap-1">
                      {inv.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => void handleCopy(inv.token)}
                          className={cx(
                            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                            copied ? 'bg-success/15 text-success' : 'bg-hover text-text-primary hover:bg-border'
                          )}
                        >
                          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                          <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
                        </button>
                      )}
                      <ConfirmButton
                        ariaLabel="Revoke invite"
                        confirmLabel="Revoke"
                        busy={revoking === inv.token}
                        onConfirm={() => handleRevoke(inv.token)}
                      >
                        <Trash2 size={13} aria-hidden /> Revoke
                      </ConfirmButton>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
