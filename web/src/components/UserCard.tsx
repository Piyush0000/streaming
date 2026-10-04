import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Ban, Flag, ShieldCheck } from 'lucide-react';
import Modal from './Modal';
import Avatar from './Avatar';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { useBlocks } from '../hooks/useBlocks';
import { primeProfile } from '../hooks/useProfiles';
import { fetchUserProfile, reportUser, type UserProfileDetail } from '../lib/profiles';

interface UserCardApi {
  /** Opens the profile card for a user (click handler for usernames / avatars). */
  openUserCard: (userId: string, fallbackName?: string) => void;
}

const UserCardContext = createContext<UserCardApi>({ openUserCard: () => undefined });

export function useUserCard(): UserCardApi {
  return useContext(UserCardContext);
}

export function UserCardProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<{ id: string; name?: string } | null>(null);
  const openUserCard = useCallback((id: string, name?: string) => setTarget({ id, name }), []);
  const api = useMemo(() => ({ openUserCard }), [openUserCard]);
  return (
    <UserCardContext.Provider value={api}>
      {children}
      {target && <UserCardDialog userId={target.id} fallbackName={target.name} onClose={() => setTarget(null)} />}
    </UserCardContext.Provider>
  );
}

function UserCardDialog({
  userId,
  fallbackName,
  onClose,
}: {
  userId: string;
  fallbackName?: string;
  onClose: () => void;
}) {
  const { session } = useSession();
  const { showToast } = useToast();
  const blocks = useBlocks();
  const [profile, setProfile] = useState<UserProfileDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  const token = session?.accessToken;
  const isSelf = session?.user.id === userId;
  const blocked = blocks.isBlocked(userId);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setProfile(null);
    setLoadError(null);
    fetchUserProfile(token, userId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        primeProfile({ id: p.id, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load this profile.');
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  async function toggleBlock() {
    setBusy(true);
    setActionError(null);
    try {
      if (blocked) {
        await blocks.unblock(userId);
        showToast('User unblocked.', 'success');
      } else {
        await blocks.block(userId);
        showToast('User blocked. Their messages are now hidden for you.', 'success');
      }
      setConfirmBlock(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    if (!token || !reason.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await reportUser(token, userId, reason.trim());
      showToast('Report sent. Thank you.', 'success');
      setReporting(false);
      setReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const name = profile?.displayName || fallbackName || 'User';

  return (
    <Modal title="Profile" onClose={onClose} size="sm">
      <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
        {!profile && !loadError && (
          <div className="py-6" role="status" aria-label="Loading profile">
            <Spinner />
          </div>
        )}
        {loadError && <ErrorBanner message={loadError} />}
        {profile && (
          <>
            <Avatar name={profile.username} src={profile.avatarUrl} size={88} />
            <div className="min-w-0 max-w-full">
              <p className="truncate text-lg font-semibold text-text-primary">{name}</p>
              <p className="truncate text-sm text-text-muted">@{profile.username}</p>
            </div>
            {profile.bio ? (
              <p className="max-w-full whitespace-pre-wrap break-words text-sm text-text-secondary">{profile.bio}</p>
            ) : (
              <p className="text-sm text-text-muted">No bio yet.</p>
            )}
            <p className="text-xs text-text-muted">Joined {new Date(profile.joinedAt).toLocaleDateString()}</p>
          </>
        )}

        {actionError && <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}

        {profile && !isSelf && !reporting && (
          <div className="mt-2 flex w-full flex-col gap-2">
            {blocked ? (
              <button
                onClick={() => void toggleBlock()}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-hover disabled:opacity-50"
              >
                <ShieldCheck size={16} /> Unblock
              </button>
            ) : confirmBlock ? (
              <div className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3">
                <p className="text-xs text-text-secondary">
                  Their messages and hub posts will be hidden for you. They will not be told.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void toggleBlock()}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Block
                  </button>
                  <button
                    onClick={() => setConfirmBlock(false)}
                    disabled={busy}
                    className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmBlock(true)}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-hover"
              >
                <Ban size={16} /> Block
              </button>
            )}
            <button
              onClick={() => setReporting(true)}
              className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-hover"
            >
              <Flag size={16} /> Report
            </button>
          </div>
        )}

        {profile && !isSelf && reporting && (
          <div className="mt-2 flex w-full flex-col gap-2 text-left">
            <label htmlFor="report-reason" className="text-xs font-medium text-text-secondary">
              Why are you reporting this user?
            </label>
            <textarea
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void submitReport()}
                disabled={busy || !reason.trim()}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Send report
              </button>
              <button
                onClick={() => setReporting(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-hover"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
