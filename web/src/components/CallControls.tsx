import { Mic, MicOff, Monitor, MonitorOff, PhoneOff } from 'lucide-react';
import type { ReactNode } from 'react';
import Spinner from './Spinner';
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
        'react-btn flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40',
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

/** Mic / screen share / leave bar under the participant grid. */
export default function CallControls({
  micState,
  muted,
  onToggleMute,
  micDisabledReason,
  screenSupported,
  isSharingScreen,
  onStartScreenShare,
  onStopScreenShare,
  screenDisabledReason,
  onLeave,
}: {
  micState: DeviceState;
  muted: boolean;
  onToggleMute: () => void;
  micDisabledReason?: string;
  screenSupported: boolean;
  isSharingScreen: boolean;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  /** Why screen sharing is unavailable to this user (e.g. only the host can share). */
  screenDisabledReason?: string;
  onLeave?: () => void;
}) {
  const micDisabled = !!micDisabledReason || micState !== 'live';
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
  const screenLabel = !screenSupported
    ? 'Screen sharing is not supported in this browser'
    : screenDisabledReason ?? (isSharingScreen ? 'Stop sharing screen' : 'Share screen');

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2 glass rounded-full px-3 py-2 shadow-[0_8px_30px_-10px_rgba(59,130,246,0.35)]">
        <RoundButton label={micLabel} onClick={onToggleMute} disabled={micDisabled} tone={muted ? 'danger' : 'neutral'} pressed={muted}>
          {micState === 'starting' ? <Spinner size={16} /> : muted ? <MicOff size={18} /> : <Mic size={18} />}
        </RoundButton>

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
