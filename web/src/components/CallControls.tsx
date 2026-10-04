import { Mic, MicOff, Monitor, MonitorOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { ReactNode } from 'react';
import Spinner from './Spinner';
import ErrorBanner from './ErrorBanner';
import { cx } from '../lib/format';

type Tone = 'neutral' | 'danger' | 'active';

function RoundButton({
  label,
  onClick,
  disabled,
  tone = 'neutral',
  pressed,
  children,
}: {
  /** Used as tooltip + accessible name (carries the reason when disabled). */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        'flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'danger' && 'bg-danger/20 text-danger hover:bg-danger/30',
        tone === 'active' && 'bg-accent text-white hover:bg-accent-hover',
        tone === 'neutral' && 'bg-hover text-text-primary hover:bg-border'
      )}
    >
      {children}
    </button>
  );
}

export type DeviceState = 'off' | 'starting' | 'live' | 'error';

/** Mic / camera / screen share / leave bar under the participant grid. */
export default function CallControls({
  micState,
  muted,
  onToggleMute,
  micDisabledReason,
  cameraState,
  cameraError,
  onToggleCamera,
  cameraDisabledReason,
  cameras,
  onSwitchCamera,
  screenSupported,
  isSharingScreen,
  onStartScreenShare,
  onStopScreenShare,
  screenDisabledReason,
  onLeave,
  onDismissCameraError,
}: {
  micState: DeviceState;
  muted: boolean;
  onToggleMute: () => void;
  micDisabledReason?: string;
  cameraState: DeviceState;
  cameraError?: string | null;
  onToggleCamera: () => void;
  cameraDisabledReason?: string;
  cameras?: { deviceId: string; label: string }[];
  onSwitchCamera?: (deviceId: string) => void;
  screenSupported: boolean;
  isSharingScreen: boolean;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  /** Why screen sharing is unavailable to this user (e.g. only the host can share). */
  screenDisabledReason?: string;
  onLeave?: () => void;
  onDismissCameraError?: () => void;
}) {
  const micDisabled = !!micDisabledReason || micState !== 'live';
  const camLive = cameraState === 'live';
  const camStarting = cameraState === 'starting';
  const screenDisabled = !screenSupported || !!screenDisabledReason;

  const micLabel =
    micDisabledReason ??
    (micState === 'starting'
      ? 'Starting microphone...'
      : micState !== 'live'
        ? 'Microphone is off'
        : muted
          ? 'Unmute microphone'
          : 'Mute microphone');
  const camLabel =
    cameraDisabledReason ??
    (camStarting
      ? 'Starting camera...'
      : camLive
        ? 'Turn off camera'
        : cameraState === 'error'
          ? 'Camera unavailable - try again'
          : 'Turn on camera');
  const screenLabel = !screenSupported
    ? 'Screen sharing is not supported in this browser'
    : screenDisabledReason ?? (isSharingScreen ? 'Stop sharing screen' : 'Share screen');

  return (
    <div className="flex flex-col items-center gap-2">
      {cameraState === 'error' && cameraError && (
        <div className="w-full max-w-xl">
          <ErrorBanner message={cameraError} onDismiss={onDismissCameraError} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-panel px-3 py-2">
        <RoundButton label={micLabel} onClick={onToggleMute} disabled={micDisabled} tone={muted ? 'danger' : 'neutral'} pressed={muted}>
          {micState === 'starting' ? <Spinner size={16} /> : muted ? <MicOff size={18} /> : <Mic size={18} />}
        </RoundButton>

        <RoundButton
          label={camLabel}
          onClick={onToggleCamera}
          disabled={!!cameraDisabledReason || camStarting}
          tone={cameraState === 'error' ? 'danger' : camLive ? 'active' : 'neutral'}
          pressed={camLive}
        >
          {camStarting ? <Spinner size={16} /> : camLive ? <Video size={18} /> : <VideoOff size={18} />}
        </RoundButton>

        {camLive && cameras && cameras.length > 1 && onSwitchCamera && (
          <select
            aria-label="Select camera"
            title="Select camera"
            defaultValue=""
            onChange={(e) => e.target.value && onSwitchCamera(e.target.value)}
            className="h-9 max-w-[9rem] rounded-lg border border-border bg-base px-2 text-xs text-text-primary"
          >
            <option value="" disabled>
              Switch camera
            </option>
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
        )}

        <RoundButton
          label={screenLabel}
          onClick={isSharingScreen ? onStopScreenShare : onStartScreenShare}
          disabled={screenDisabled}
          tone={isSharingScreen ? 'danger' : 'neutral'}
          pressed={isSharingScreen}
        >
          {isSharingScreen ? <MonitorOff size={18} /> : <Monitor size={18} />}
        </RoundButton>

        {onLeave && (
          <RoundButton label="Leave" onClick={onLeave} tone="danger">
            <PhoneOff size={18} />
          </RoundButton>
        )}
      </div>
    </div>
  );
}
