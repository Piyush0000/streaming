import { MicOff, Monitor, MonitorOff, PhoneOff, Radio, Volume2 } from 'lucide-react';
import type { RemotePeerAudio } from '../lib/media';
import Avatar from './Avatar';
import Spinner from './Spinner';
import Dots from './Dots';
import MicIcon from './MicIcon';
import { useLeavingList } from '../hooks/useLeavingList';
import { useSpeaking } from '../lib/speaking';
import ErrorBanner from './ErrorBanner';
import { cx } from '../lib/format';

export type VoiceState = 'idle' | 'connecting' | 'connected' | 'error';

export default function VoicePanel({
  voiceState,
  voiceError,
  onDismissError,
  remotePeers,
  selfUsername,
  selfStream,
  muted,
  onJoin,
  onLeave,
  onToggleMute,
  screenShareSupported,
  isSharingScreen,
  onStartScreenShare,
  onStopScreenShare,
  maxParticipants,
}: {
  voiceState: VoiceState;
  voiceError: string | null;
  onDismissError: () => void;
  remotePeers: RemotePeerAudio[];
  selfUsername: string;
  /** Our own mic stream, used for the local speaking ring. */
  selfStream?: MediaStream | null;
  muted: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  screenShareSupported: boolean;
  isSharingScreen: boolean;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  /** The channel's effective room limit (effectiveMaxParticipants), when known. */
  maxParticipants?: number | null;
}) {
  const connected = voiceState === 'connected';
  const connecting = voiceState === 'connecting';
  // The server counts unique users, so a second tab of the same person is one seat.
  const inRoom = new Set(remotePeers.map((p) => p.username)).size + (connected ? 1 : 0);
  const full = !!maxParticipants && connected && inRoom >= maxParticipants;
  const peerRows = useLeavingList(remotePeers, (p) => p.peerId, 180);

  return (
    <div className="flex w-full flex-col border-b border-border bg-panel md:w-72 md:shrink-0 md:border-b-0 md:border-l">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Volume2 size={16} className="text-text-muted" />
        <h2 className="text-sm font-semibold text-text-primary">Voice</h2>
        {!!maxParticipants && (
          <span
            className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', full ? 'bg-warning/15 text-warning' : 'bg-hover text-text-secondary')}
            title="People in the room / room limit"
            aria-label={connected ? `${inRoom} of ${maxParticipants} people in the room` : `Room limit: ${maxParticipants} people`}
          >
            {connected ? `${inRoom} / ${maxParticipants}` : `Max ${maxParticipants}`}
          </span>
        )}
        {connected && (
          <span className="ml-auto flex animate-pop-in items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            <Radio size={11} /> Live
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3">
        {voiceError && <ErrorBanner message={voiceError} onDismiss={onDismissError} />}

        {!connected ? (
          <button
            onClick={onJoin}
            disabled={connecting}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? (
              <>
                <Spinner size={15} className="text-white" /> Connecting <Dots />
              </>
            ) : (
              <>
                <Volume2 size={16} /> Join voice
              </>
            )}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={onToggleMute}
                className={cx(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors',
                  muted
                    ? 'bg-danger/15 text-danger hover:bg-danger/25'
                    : 'bg-hover text-text-primary hover:bg-border'
                )}
              >
                <MicIcon muted={muted} size={16} />
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={onLeave}
                className="flex items-center justify-center gap-2 rounded-lg bg-danger/15 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/25"
                aria-label="Leave voice"
                title="Leave voice"
              >
                <PhoneOff size={16} />
              </button>
            </div>
            {screenShareSupported && (
              <button
                onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
                className={cx(
                  'flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors',
                  isSharingScreen
                    ? 'bg-danger/15 text-danger hover:bg-danger/25'
                    : 'bg-hover text-text-primary hover:bg-border'
                )}
              >
                {isSharingScreen ? <MonitorOff size={16} /> : <Monitor size={16} />}
                {isSharingScreen ? 'Stop sharing' : 'Share screen'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!connected && remotePeers.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">Nobody's in voice right now.</p>
        )}

        {(connected || peerRows.length > 0) && (
          <ul className="flex flex-col gap-2">
            {connected && (
              <SelfRow username={selfUsername} stream={selfStream ?? null} muted={muted} />
            )}
            {peerRows.map(({ item: peer, leaving }) => (
              <PeerRow key={peer.peerId} peer={peer} leaving={leaving} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SelfRow({ username, stream, muted }: { username: string; stream: MediaStream | null; muted: boolean }) {
  const speaking = useSpeaking(muted ? null : stream);
  return (
    <li className="flex animate-pop-in items-center gap-2 rounded-lg bg-hover/60 px-2 py-1.5">
      <Avatar name={username} size={28} speaking={speaking} online />
      <span className="truncate text-sm text-text-primary">{username}</span>
      <span className="ml-auto text-xs text-text-muted">(you)</span>
      {muted && <MicOff size={13} className="animate-pop-in text-danger" />}
    </li>
  );
}

function PeerRow({ peer, leaving }: { peer: RemotePeerAudio; leaving: boolean }) {
  const speaking = useSpeaking(leaving ? null : peer.stream);
  return (
    <li
      aria-hidden={leaving || undefined}
      className={cx(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover/60',
        leaving ? 'pointer-events-none animate-pop-out' : 'animate-pop-in'
      )}
    >
      <Avatar name={peer.username} size={28} speaking={speaking} online />
      <span className="truncate text-sm text-text-primary">{peer.username}</span>
      <audio
        ref={(el) => {
          if (el && el.srcObject !== peer.stream) {
            el.srcObject = peer.stream;
            el.autoplay = true;
          }
        }}
        hidden
      />
    </li>
  );
}
