import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Channel } from '@streaming/shared-types';
import { Hash, LogOut, Plus, Radio, Volume2, X } from 'lucide-react';
import { useLiveStreams } from '../context/LiveStreamsContext';
import { createChannel, listChannels } from '../lib/api';
import { useSession } from '../context/SessionContext';
import Avatar from './Avatar';
import CreateChannelModal from './CreateChannelModal';
import Spinner from './Spinner';
import ErrorBanner from './ErrorBanner';
import { cx } from '../lib/format';

export default function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const { channelId, streamId } = useParams();
  const live = useLiveStreams();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function refresh() {
    if (!session) return;
    try {
      setError(null);
      const list = await listChannels(session.accessToken);
      setChannels(list);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (message.toLowerCase().includes('token')) logout();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  async function handleCreate(name: string, topic: string, kind: 'text' | 'voice') {
    if (!session) return;
    const channel = await createChannel(session.accessToken, name, topic, kind);
    await refresh();
    navigate(`/channels/${channel.id}`);
  }

  const textChannels = channels.filter((c) => c.kind !== 'voice');
  const voiceChannels = channels.filter((c) => c.kind === 'voice');

  return (
    <>
      {/* mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-border bg-panel transition-transform duration-200 md:static md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <span className="truncate text-sm font-bold tracking-wide text-text-primary">
            ELON<span className="text-accent">IX</span>
          </span>
          <button
            onClick={onCloseMobile}
            className="rounded p-1 text-text-secondary hover:bg-hover md:hidden"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-3">
            <div className="flex items-center justify-between px-2 pb-1">
              <button
                onClick={() => {
                  navigate('/live');
                  onCloseMobile();
                }}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-primary"
              >
                <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
                Live
                {live.streams.length > 0 && <span className="text-text-secondary">({live.streams.length})</span>}
              </button>
              <button
                onClick={() => {
                  live.openGoLive();
                  onCloseMobile();
                }}
                className="flex items-center gap-1 rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/25"
              >
                <Radio size={12} /> Go live
              </button>
            </div>
            {live.streams.length === 0 ? (
              <p className="px-2 py-1 text-xs text-text-muted">
                {live.loading ? 'Checking for live streams…' : 'No one is live right now.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {live.streams.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        navigate(`/live/${s.id}`);
                        onCloseMobile();
                      }}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        s.id === streamId
                          ? 'bg-accent-soft text-text-primary'
                          : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                      )}
                    >
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-danger" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{s.title}</span>
                        <span className="block truncate text-[11px] text-text-muted">{s.hostUsername}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner size={18} />
            </div>
          )}

          {!loading && error && (
            <div className="mb-3 px-1">
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </div>
          )}

          {!loading && !error && channels.length === 0 && (
            <div className="px-2 py-6 text-center">
              <p className="text-sm text-text-secondary">No channels yet.</p>
              <button
                onClick={() => setModalOpen(true)}
                className="mt-2 text-sm font-medium text-accent hover:underline"
              >
                Create the first one
              </button>
            </div>
          )}

          {textChannels.length > 0 && (
            <ChannelGroup
              label="Text channels"
              channels={textChannels}
              activeId={channelId}
              onSelect={(id) => {
                navigate(`/channels/${id}`);
                onCloseMobile();
              }}
            />
          )}

          {voiceChannels.length > 0 && (
            <ChannelGroup
              label="Voice channels"
              channels={voiceChannels}
              activeId={channelId}
              onSelect={(id) => {
                navigate(`/channels/${id}`);
                onCloseMobile();
              }}
            />
          )}
        </div>

        <div className="px-2 pb-2">
          <button
            onClick={() => setModalOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
          >
            <Plus size={16} />
            Create channel
          </button>
        </div>

        {session && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-3">
            <Avatar name={session.user.username} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary">
                {session.user.username}
              </p>
              <p className="truncate text-xs text-text-muted">{session.user.email}</p>
            </div>
            <button
              onClick={logout}
              className="shrink-0 rounded-md p-2 text-text-secondary hover:bg-hover hover:text-danger"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>

      {modalOpen && (
        <CreateChannelModal onClose={() => setModalOpen(false)} onCreate={handleCreate} />
      )}
    </>
  );
}

function ChannelGroup({
  label,
  channels,
  activeId,
  onSelect,
}: {
  label: string;
  channels: Channel[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {channels.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  active
                    ? 'bg-accent-soft text-text-primary'
                    : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                )}
              >
                {c.kind === 'voice' ? (
                  <Volume2 size={16} className="shrink-0 text-text-muted" />
                ) : (
                  <Hash size={16} className="shrink-0 text-text-muted" />
                )}
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
