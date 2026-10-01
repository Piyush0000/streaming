import { Mic, MicOff, PhoneOff, Radio, Volume2 } from 'lucide-react';
import type { RemotePeerAudio } from '../lib/media';
import Avatar from './Avatar';
import Spinner from './Spinner';
import ErrorBanner from './ErrorBanner';
import { cx } from '../lib/format';

export type VoiceState = 'idle' | 'connecting' | 'connected' | 'error';

export default function VoicePanel({
  voiceState,
  voiceError,
  onDismissError,
  remotePeers,
  selfUsername,
  muted,
  onJoin,
  onLeave,
  onToggleMute,
}: {
  voiceState: VoiceState;
  voiceError: string | null;
  onDismissError: () => void;
  remotePeers: RemotePeerAudio[];
  selfUsername: string;
  muted: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
}) {
  const connected = voiceState === 'connected';
  const connecting = voiceState === 'connecting';

  return (
    <div className="flex w-full flex-col border-b border-border bg-panel md:w-72 md:shrink-0 md:border-b-0 md:border-l">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Volume2 size={16} className="text-text-muted" />
        <h2 className="text-sm font-semibold text-text-primary">Voice</h2>
        {connected && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
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
                <Spinner size={15} className="text-white" /> Connecting…
              </>
            ) : (
              <>
                <Volume2 size={16} /> Join voice
              </>
            )}
          </button>
        ) : (
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
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
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
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!connected && remotePeers.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">Nobody's in voice right now.</p>
        )}

        {(connected || remotePeers.length > 0) && (
          <ul className="flex flex-col gap-2">
            {connected && (
              <li className="flex items-center gap-2 rounded-lg bg-hover/60 px-2 py-1.5">
                <Avatar name={selfUsername} size={28} ring />
                <span className="truncate text-sm text-text-primary">{selfUsername}</span>
                <span className="ml-auto text-xs text-text-muted">(you)</span>
                {muted && <MicOff size={13} className="text-danger" />}
              </li>
            )}
            {remotePeers.map((peer) => (
              <li key={peer.peerId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover/60">
                <Avatar name={peer.username} size={28} ring />
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
