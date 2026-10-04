import type { PeerRole } from '@streaming/shared-types';
import { Hand, RotateCw, Timer } from 'lucide-react';
import { useCountdown } from '../hooks/useCountdown';
import type { CameraState, MicState, SpeakRequestState } from '../hooks/useStreamMedia';
import { cameraSupported } from '../lib/media';
import ErrorBanner from './ErrorBanner';
import CallControls from './CallControls';
import Dots from './Dots';

const screenShareSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** Role-aware controls under the stage: mic/camera/screen for the host, mic/camera for speakers, request-to-speak for listeners. */
export default function StageControls({
  role,
  micState,
  micError,
  muted,
  onToggleMute,
  onRetryMic,
  cameraState,
  cameraError,
  onToggleCamera,
  cameras,
  onSwitchCamera,
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
  cameraState: CameraState;
  cameraError: string | null;
  onToggleCamera: () => void;
  cameras: { deviceId: string; label: string }[];
  onSwitchCamera: (deviceId: string) => void;
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
      <div className="flex animate-slide-down flex-wrap items-center gap-3 rounded-xl border border-border bg-panel px-4 py-3">
        {speakRequest === 'pending' ? (
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-text-secondary">
              <Hand size={14} className="origin-bottom animate-wiggle text-accent" /> Request pending - waiting for the host <Dots />
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
              className="btn-shine group/hand ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-hover disabled:text-text-secondary disabled:hover:bg-hover"
            >
              {cooldownSecs > 0 ? <Timer size={15} /> : <Hand size={15} className="origin-bottom group-hover/hand:animate-wiggle" />}
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
      <CallControls
        micState={micState}
        muted={muted}
        onToggleMute={onToggleMute}
        cameraState={cameraState}
        cameraError={cameraError}
        onToggleCamera={onToggleCamera}
        cameraDisabledReason={cameraSupported ? undefined : 'Camera is not supported in this browser'}
        cameras={cameras}
        onSwitchCamera={onSwitchCamera}
        screenSupported={screenShareSupported}
        isSharingScreen={isSharingScreen}
        onStartScreenShare={onStartScreenShare}
        onStopScreenShare={onStopScreenShare}
        screenDisabledReason={isHost ? undefined : 'Only the host can share their screen'}
      />
      {!isHost && <p className="text-center text-xs text-text-muted">You're a speaker.</p>}
    </div>
  );
}
