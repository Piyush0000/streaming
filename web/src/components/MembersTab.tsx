import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Channel, ChannelMember, ChannelRole } from '@streaming/shared-types';
import { LogOut, Shield, ShieldOff, UserMinus, UserPlus } from 'lucide-react';
import { addMember, listMembers, removeMember, setMemberRole } from '../lib/channels';
import { useSession } from '../context/SessionContext';
import Avatar from './Avatar';
import RoleBadge from './RoleBadge';
import ConfirmButton from './ConfirmButton';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';

const ROLE_RANK: Record<ChannelRole, number> = { owner: 0, mod: 1, member: 2 };

function sortMembers(list: ChannelMember[]): ChannelMember[] {
  return [...list].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
  );
}

export default function MembersTab({
  channel,
  onChanged,
  onLeft,
}: {
  channel: Channel;
  /** Membership changed (add/remove/role): parent re-fetches the channel + sidebar list. */
  onChanged: () => void;
  /** The current user left the channel. */
  onLeft: () => void;
}) {
  const { session } = useSession();
  const token = session?.accessToken ?? '';
  const selfId = session?.user.id ?? '';
  const myRole = channel.myRole;
  const isOwner = myRole === 'owner';
  const canManage = myRole === 'owner' || myRole === 'mod';

  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMembers(sortMembers(await listMembers(token, channel.id)));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, channel.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setAdding(true);
    setAddError(null);
    setAddedNote(null);
    try {
      // An "@" means email; usernames are limited to letters, numbers, "_" and "-".
      const member = await addMember(token, channel.id, value.includes('@') ? { email: value } : { username: value });
      setMembers((prev) => sortMembers([...prev.filter((m) => m.userId !== member.userId), member]));
      setIdentifier('');
      setAddedNote(`Added ${member.username}.`);
      onChanged();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(m: ChannelMember) {
    setBusyId(m.userId);
    setActionError(null);
    try {
      await removeMember(token, channel.id, m.userId);
      setMembers((prev) => prev.filter((x) => x.userId !== m.userId));
      onChanged();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRole(m: ChannelMember) {
    setBusyId(m.userId);
    setActionError(null);
    try {
      const updated = await setMemberRole(token, channel.id, m.userId, m.role === 'mod' ? 'member' : 'mod');
      setMembers((prev) => sortMembers(prev.map((x) => (x.userId === updated.userId ? updated : x))));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const [leaving, setLeaving] = useState(false);
  async function handleLeave() {
    setLeaving(true);
    setActionError(null);
    try {
      await removeMember(token, channel.id, selfId);
      onLeft();
    } catch (err) {
      setActionError((err as Error).message);
      setLeaving(false);
    }
  }

  const count = useMemo(() => members.length, [members]);

  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      {canManage && (
        <form onSubmit={handleAdd} className="flex flex-col gap-1.5">
          <label htmlFor="member-identifier" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Add a member
          </label>
          <div className="flex gap-2">
            <input
              id="member-identifier"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setAddError(null);
                setAddedNote(null);
              }}
              placeholder="Username or email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!addError}
              aria-describedby="member-add-status"
              className="min-w-0 flex-1 rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={adding || !identifier.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? <Spinner size={14} className="text-white" /> : <UserPlus size={15} aria-hidden />}
              Add
            </button>
          </div>
          <p id="member-add-status" role={addError ? 'alert' : 'status'} className={`min-h-[1rem] text-xs ${addError ? 'text-danger' : 'text-success'}`}>
            {addError ?? addedNote}
          </p>
        </form>
      )}

      {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

      <section aria-labelledby="members-heading">
        <h3 id="members-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Members {!loading && !loadError && <span className="text-text-muted">({count})</span>}
        </h3>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size={18} />
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-start gap-2">
            <ErrorBanner message={loadError} />
            <button onClick={() => void load()} className="inline-flex min-h-[44px] items-center text-sm font-medium text-accent hover:underline">
              Try again
            </button>
          </div>
        )}

        {!loading && !loadError && members.length === 0 && (
          <p className="py-6 text-center text-sm text-text-muted">No members yet.</p>
        )}

        {!loading && !loadError && members.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {members.map((m) => {
              const isSelf = m.userId === selfId;
              const canRemove = canManage && !isSelf && m.role !== 'owner' && (isOwner || m.role === 'member');
              const canChangeRole = isOwner && !isSelf && m.role !== 'owner';
              const busy = busyId === m.userId;
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                  <Avatar name={m.username} size={32} />
                  <div className="min-w-0 flex-1 basis-32">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {m.username}
                      {isSelf && <span className="ml-1.5 text-xs font-normal text-text-muted">(you)</span>}
                    </p>
                    <p className="text-xs text-text-muted">
                      Joined{' '}
                      <time dateTime={m.joinedAt}>{new Date(m.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time>
                    </p>
                  </div>
                  <RoleBadge role={m.role} />
                  {(canChangeRole || canRemove) && (
                    <div className="flex flex-wrap items-center gap-1">
                      {canChangeRole && (
                        <button
                          type="button"
                          onClick={() => void handleRole(m)}
                          disabled={busy}
                          aria-label={m.role === 'mod' ? `Demote ${m.username} to member` : `Promote ${m.username} to moderator`}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-50"
                        >
                          {m.role === 'mod' ? <ShieldOff size={13} aria-hidden /> : <Shield size={13} aria-hidden />}
                          {m.role === 'mod' ? 'Demote' : 'Make mod'}
                        </button>
                      )}
                      {canRemove && (
                        <ConfirmButton ariaLabel={`Remove ${m.username}`} confirmLabel="Remove" busy={busy} onConfirm={() => handleRemove(m)}>
                          <UserMinus size={13} aria-hidden /> Remove
                        </ConfirmButton>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {myRole && (
        <section aria-labelledby="leave-heading" className="rounded-lg border border-border p-3">
          <h3 id="leave-heading" className="text-sm font-semibold text-text-primary">
            Leave channel
          </h3>
          {isOwner ? (
            <p className="mt-1 text-xs text-text-muted">
              You own this channel, so you can't leave it. Delete the channel from the Settings tab if you no longer want it.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-text-muted">
                {channel.visibility === 'private'
                  ? "You'll lose access and need a new invite to come back."
                  : 'You will no longer be listed as a member.'}
              </p>
              <div className="mt-2">
                <ConfirmButton
                  ariaLabel={`Leave #${channel.name}`}
                  confirmLabel="Yes, leave"
                  busy={leaving}
                  onConfirm={handleLeave}
                  className="border border-border"
                >
                  <LogOut size={13} aria-hidden /> Leave channel
                </ConfirmButton>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
