import { FormEvent, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { STREAM_MAX_WARNINGS } from '../lib/streamLimits';
import Modal from './Modal';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { cx } from '../lib/format';
import type { ModerationTarget, ParticipantAction } from './ModerationMenu';

interface ActionCopy {
  title: string;
  body: string;
  confirm: string;
  destructive: boolean;
  takesReason: boolean;
}

function copyFor(action: ParticipantAction, name: string, warnings: number): ActionCopy {
  switch (action) {
    case 'warn':
      return {
        title: `Warn ${name}`,
        body:
          warnings >= STREAM_MAX_WARNINGS
            ? `${name} already has ${warnings}/${STREAM_MAX_WARNINGS} warnings. Warning them again will automatically ban them.`
            : `${name} has ${warnings}/${STREAM_MAX_WARNINGS} warnings. This will be warning ${warnings + 1}. After ${STREAM_MAX_WARNINGS}, a further warning bans them.`,
        confirm: 'Send warning',
        destructive: warnings >= STREAM_MAX_WARNINGS,
        takesReason: true,
      };
    case 'mute':
      return { title: `Mute ${name}`, body: `${name} won't be able to send chat messages until you unmute them.`, confirm: 'Mute chat', destructive: false, takesReason: true };
    case 'unmute':
      return { title: `Unmute ${name}`, body: `${name} will be able to chat again.`, confirm: 'Unmute chat', destructive: false, takesReason: false };
    case 'kick':
      return { title: `Kick ${name}`, body: `${name} is removed from the stream right now. This is recorded; they may rejoin unless banned.`, confirm: 'Kick', destructive: true, takesReason: true };
    case 'ban':
      return { title: `Ban ${name}`, body: `${name} is removed and cannot rejoin this stream until you unban them.`, confirm: 'Ban', destructive: true, takesReason: true };
    case 'unban':
      return { title: `Unban ${name}`, body: `${name} will be allowed back into this stream.`, confirm: 'Unban', destructive: false, takesReason: false };
    case 'demote':
      return { title: `Move ${name} to listeners`, body: `${name} will stop speaking and their mic closes. They can request to speak again.`, confirm: 'Move to listeners', destructive: false, takesReason: false };
    case 'remove':
      return { title: `Remove ${name} from the room`, body: `${name} is disconnected from the audio room. This is not recorded as a moderation action and they can rejoin. Use Kick or Ban for that.`, confirm: 'Remove', destructive: true, takesReason: false };
  }
}

/**
 * Confirmation step for every host/admin action. `onConfirm` resolves to an
 * optional result message; when present it replaces the form with a clear
 * outcome panel (used for warn, incl. the automatic-ban escalation).
 */
export default function ModerationDialog({
  action,
  target,
  warnings,
  onClose,
  onConfirm,
}: {
  action: ParticipantAction;
  target: ModerationTarget;
  warnings: number;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | void>;
}) {
  const copy = copyFor(action, target.username, warnings);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await onConfirm(reason.trim());
      if (typeof outcome === 'string') setResult(outcome);
      else onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={copy.title} onClose={onClose} size="sm" dismissible={!submitting} tone={copy.destructive ? 'danger' : 'default'}>
      {result ? (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-text-primary">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
            <span>{result}</span>
          </div>
          <button onClick={onClose} className="self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          <p className="flex items-start gap-2 text-sm text-text-secondary">
            {copy.destructive && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />}
            <span>{copy.body}</span>
          </p>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          {copy.takesReason && (
            <div>
              <label htmlFor="mod-reason" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Reason <span className="font-normal normal-case text-text-muted">(optional, shown to them)</span>
              </label>
              <textarea
                id="mod-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                autoFocus
                className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="e.g. Spamming links"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover disabled:opacity-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={cx(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                copy.destructive ? 'bg-danger hover:opacity-90' : 'bg-accent hover:bg-accent-hover'
              )}
            >
              {submitting && <Spinner size={14} className="text-white" />}
              {copy.confirm}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
