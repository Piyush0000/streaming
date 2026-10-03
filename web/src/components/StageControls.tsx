import type { PeerRole } from '@streaming/shared-types';
import { Hand, Mic, MicOff, Monitor, MonitorOff, RotateCw, Timer } from 'lucide-react';
import { useCountdown } from '../hooks/useCountdown';
import type { MicState, SpeakRequestState } from '../hooks/useStreamMedia';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { cx } from '../lib/format';

const screenShareSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** Role-aware controls under the stage: mic/screen for the host, request-to-speak for listeners. */
export default function StageControls({
  role,
  micState,
  micError,
  muted,
  onToggleMute,
  onRetryMic,
  isSharingScreen,
  onStartScreenShare,
  onStopScreenShare,
  speakRequest,
  onRequestSpeak,
  onCancelSpeakRequest,
  speakCooldownUntil,
}: {
  role: PeerRole;
  micState: MicState;
  micError: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onRetryMic: () => void;
  isSharingScreen: boolean;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  speakRequest: SpeakRequestState;
  onRequestSpeak: () => void;
  onCancelSpeakRequest: () => void;
  /** Epoch ms until which asking to speak again is blocked (after a denial). */
  speakCooldownUntil?: number | null;
}) {
  const cooldownSecs = useCountdown(speakCooldownUntil);
  if (role === 'listener') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3">
        {speakRequest === 'pending' ? (
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner size={14} /> Request pending - waiting for the host
            </span>
            <button
              onClick={onCancelSpeakRequest}
              className="ml-auto rounded-lg bg-hover px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-border"
            >
              Cancel request
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-text-secondary">
              {cooldownSecs > 0
                ? 'Your last request was declined. You can ask again shortly.'
                : "You're listening. Want to join the conversation?"}
            </span>
            <button
              onClick={onRequestSpeak}
              disabled={cooldownSecs > 0}
              aria-live="polite"
              className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-hover disabled:text-text-secondary disabled:hover:bg-hover"
            >
              {cooldownSecs > 0 ? <Timer size={15} /> : <Hand size={15} />}
              {cooldownSecs > 0 ? `Ask again in ${cooldownSecs}s` : 'Request to speak'}
            </button>
          </>
        )}
      </div>
    );
  }

  const isHost = role === 'host';
  return (
    <div className="flex flex-col gap-2">
      {micState === 'error' && micError && (
        <div className="flex flex-col gap-2">
          <ErrorBanner message={micError} />
          <button
            onClick={onRetryMic}
            className="flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            <RotateCw size={14} /> Retry microphone
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel px-4 py-3">
        <button
          onClick={onToggleMute}
          disabled={micState !== 'live'}
          aria-pressed={muted}
          className={cx(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            muted ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-hover text-text-primary hover:bg-border'
          )}
        >
          {micState === 'starting' ? <Spinner size={15} /> : muted ? <MicOff size={16} /> : <Mic size={16} />}
          {micState === 'starting' ? 'Starting mic…' : muted ? 'Unmute' : 'Mute'}
        </button>

        {isHost && screenShareSupported && (
          <button
            onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
            className={cx(
              'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              isSharingScreen ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-hover text-text-primary hover:bg-border'
            )}
          >
            {isSharingScreen ? <MonitorOff size={16} /> : <Monitor size={16} />}
            {isSharingScreen ? 'Stop sharing' : 'Share screen'}
          </button>
        )}

        {!isHost && <span className="text-xs text-text-muted">You're a speaker.</span>}
      </div>
    </div>
  );
}
