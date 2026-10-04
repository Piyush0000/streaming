import { ReactNode } from 'react';
import { Crown, MicOff, MonitorUp, Pin, PinOff, VideoOff } from 'lucide-react';
import Avatar from './Avatar';
import { useSpeaking } from '../lib/speaking';
import { cx } from '../lib/format';

/** Everything a tile needs to render one participant (or one screen share). */
export interface TileModel {
  /** Stable id: userId / peerId for people, `screen:<key>` for screen shares. */
  id: string;
  name: string;
  avatarUrl?: string | null;
  /** Camera (or screen) video. When absent/null the tile shows the avatar. */
  videoStream?: MediaStream | null;
  /** Mic audio, only used for the speaking indicator (playback happens elsewhere). */
  audioStream?: MediaStream | null;
  isSelf?: boolean;
  micMuted?: boolean;
  badge?: 'host' | 'speaker' | null;
  /** Host who has not (re)joined the media room. */
  offline?: boolean;
  isScreen?: boolean;
  /** Self tile only: the camera was blocked / not found. */
  cameraBlocked?: boolean;
  actions?: ReactNode;
}

export default function ParticipantTile({
  tile,
  pinned,
  spotlight,
  compact,
  onTogglePin,
}: {
  tile: TileModel;
  pinned: boolean;
  /** Rendered as the large spotlight tile. */
  spotlight?: boolean;
  /** Rendered in the side/bottom strip. */
  compact?: boolean;
  onTogglePin: (id: string) => void;
}) {
  const speaking = useSpeaking(tile.micMuted || tile.isScreen || tile.offline ? null : tile.audioStream);
  const hasVideo = !!tile.videoStream;
  const label = tile.isScreen ? (tile.isSelf ? 'You are sharing' : `${tile.name} is sharing`) : tile.name;
  const avatarSize = spotlight ? 112 : compact ? 40 : 76;

  return (
    <div
      role="group"
      aria-label={`${label}${speaking ? ', speaking' : ''}${tile.micMuted ? ', muted' : ''}`}
      onClick={() => onTogglePin(tile.id)}
      className={cx(
        'group/tile relative aspect-video w-full cursor-pointer select-none overflow-hidden rounded-xl border-2 border-border bg-panel transition-colors duration-base',
        speaking && 'tile-speaking',
        tile.offline && 'opacity-60'
      )}
    >
      {hasVideo ? (
        <video
          ref={(el) => {
            if (el && el.srcObject !== tile.videoStream) el.srcObject = tile.videoStream ?? null;
          }}
          autoPlay
          muted
          playsInline
          className={cx(
            'absolute inset-0 h-full w-full bg-black',
            tile.isScreen ? 'object-contain' : 'object-cover',
            tile.isSelf && !tile.isScreen && '-scale-x-100'
          )}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-panel to-base">
          <Avatar name={tile.name} src={tile.avatarUrl ?? null} size={avatarSize} />
          {tile.cameraBlocked && !compact && (
            <span className="mt-1 inline-flex items-center gap-1 rounded bg-danger/15 px-2 py-0.5 text-[11px] text-danger">
              <VideoOff size={11} /> Camera blocked
            </span>
          )}
        </div>
      )}

      {/* top-right: per-participant actions + pin */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {tile.actions}
        <button
          type="button"
          onClick={() => onTogglePin(tile.id)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
          title={pinned ? 'Unpin' : 'Pin'}
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 focus-visible:opacity-100',
            pinned ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100'
          )}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>

      {/* bottom label bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-white">
        {tile.isScreen && <MonitorUp size={12} className="shrink-0" />}
        <span className={cx('truncate font-medium', compact ? 'text-[11px]' : 'text-xs sm:text-sm')}>
          {label}
          {tile.isSelf && !tile.isScreen && <span className="ml-1 font-normal opacity-80">(you)</span>}
        </span>
        {tile.badge === 'host' && !compact && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-warning/80 px-1 py-px text-[9px] font-bold uppercase text-black">
            <Crown size={9} /> Host
          </span>
        )}
        {tile.offline && <span className="shrink-0 text-[11px] opacity-80">away</span>}
        {tile.micMuted && (
          <span className="ml-auto inline-flex shrink-0 items-center justify-center rounded-full bg-danger p-1" role="img" aria-label="Muted">
            <MicOff size={compact ? 10 : 12} />
          </span>
        )}
      </div>
    </div>
  );
}
