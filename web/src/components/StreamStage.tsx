import { ReactNode } from 'react';
import { Crown, MonitorUp } from 'lucide-react';
import MicIcon from './MicIcon';
import Avatar from './Avatar';
import type { Participant, ScreenTile } from '../hooks/useStreamMedia';
import { useSpeaking } from '../lib/speaking';
import { cx } from '../lib/format';

/** Host + speakers as large tiles, plus the host's screen-share when active. */
export default function StreamStage({
  hostId,
  hostUsername,
  participants,
  audioByUserId,
  micStream,
  selfMuted,
  screens,
  renderActions,
}: {
  hostId: string;
  hostUsername: string;
  participants: Participant[];
  audioByUserId: Map<string, MediaStream>;
  /** Our own mic stream, for the local speaking ring. */
  micStream: MediaStream | null;
  selfMuted: boolean;
  screens: ScreenTile[];
  renderActions?: (p: Participant) => ReactNode;
}) {
  const onStage = participants
    .filter((p) => p.role === 'host' || p.role === 'speaker')
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'host' ? -1 : 1));
  const hostPresent = onStage.some((p) => p.role === 'host');

  return (
    <section aria-label="Stage" className="flex flex-col gap-4">
      {screens.length > 0 && (
        <div className="flex flex-col gap-3">
          {screens.map((tile) => (
            <ScreenShare key={tile.key} tile={tile} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {!hostPresent && (
          <Tile
            username={hostUsername}
            role="host"
            isSelf={false}
            stream={null}
            muted={false}
            offline
            actions={null}
          />
        )}
        {onStage.map((p) => (
          <Tile
            key={p.userId}
            username={p.username || (p.userId === hostId ? hostUsername : 'Guest')}
            role={p.role === 'host' ? 'host' : 'speaker'}
            isSelf={p.isSelf}
            stream={p.isSelf ? micStream : audioByUserId.get(p.userId) ?? null}
            muted={p.isSelf && selfMuted}
            actions={p.isSelf || p.role === 'host' ? null : renderActions?.(p)}
          />
        ))}
      </div>
    </section>
  );
}

function Tile({
  username,
  role,
  isSelf,
  stream,
  muted,
  offline,
  actions,
}: {
  username: string;
  role: 'host' | 'speaker';
  isSelf: boolean;
  stream: MediaStream | null;
  muted: boolean;
  offline?: boolean;
  actions: ReactNode;
}) {
  const speaking = useSpeaking(muted ? null : stream);

  return (
    <div
      className={cx(
        'relative flex animate-pop-in flex-col items-center gap-2 rounded-2xl border bg-panel px-3 py-4 transition-colors duration-base',
        speaking ? 'border-success/70' : 'border-border',
        offline && 'opacity-60'
      )}
    >
      {actions && <div className="absolute right-1.5 top-1.5">{actions}</div>}
      <Avatar name={username} size={72} speaking={speaking} glow={role === 'host' && !offline} />
      <div className="flex max-w-full flex-col items-center gap-1">
        <p className="max-w-full truncate text-sm font-medium text-text-primary">
          {username}
          {isSelf && <span className="ml-1 text-xs font-normal text-text-muted">(you)</span>}
        </p>
        <div className="flex items-center gap-1.5">
          {role === 'host' ? (
            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              <Crown size={10} /> Host
            </span>
          ) : (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
              Speaker
            </span>
          )}
          {offline ? (
            <span className="text-[11px] text-text-muted">away</span>
          ) : (
            <span
              className={cx('inline-flex transition-colors duration-fast', muted ? 'text-danger' : speaking ? 'text-success' : 'text-text-muted')}
              role="img"
              aria-label={muted ? 'Muted' : speaking ? 'Speaking' : 'Mic on'}
            >
              <MicIcon muted={muted} size={13} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenShare({ tile }: { tile: ScreenTile }) {
  return (
    <div className="relative animate-pop-in overflow-hidden rounded-xl border border-border bg-black">
      <video
        ref={(el) => {
          if (el && el.srcObject !== tile.stream) el.srcObject = tile.stream;
        }}
        autoPlay
        muted={tile.isLocal}
        playsInline
        className="mx-auto max-h-[50vh] w-full object-contain"
      />
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
        <MonitorUp size={11} /> {tile.isLocal ? 'You are sharing' : `${tile.username} is sharing`}
      </span>
    </div>
  );
}
