import { FormEvent, useState } from 'react';
import { Globe, Hash, Lock, Volume2 } from 'lucide-react';
import type { ChannelVisibility, CreateChannelRequest } from '@streaming/shared-types';
import { ApiError } from '../lib/api';
import Modal from './Modal';
import SegmentedControl from './SegmentedControl';
import ErrorBanner from './ErrorBanner';

export const VOICE_MIN_PEOPLE = 2;
export const VOICE_MAX_PEOPLE = 25;
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

const inputCls =
  'w-full rounded-lg border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1';
const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary';

export default function CreateChannelModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (request: CreateChannelRequest) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [visibility, setVisibility] = useState<ChannelVisibility>('public');
  const [maxPeople, setMaxPeople] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [maxError, setMaxError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): CreateChannelRequest | null {
    const trimmed = name.trim();
    let ok = true;
    setNameError(null);
    setMaxError(null);
    if (trimmed.length < 2 || trimmed.length > 64 || !NAME_RE.test(trimmed)) {
      setNameError('Use 2–64 letters, numbers, underscores or hyphens (no spaces).');
      ok = false;
    }
    let maxParticipants: number | undefined;
    if (kind === 'voice' && maxPeople.trim() !== '') {
      const n = Number(maxPeople);
      if (!Number.isInteger(n) || n < VOICE_MIN_PEOPLE || n > VOICE_MAX_PEOPLE) {
        setMaxError(`Enter a whole number from ${VOICE_MIN_PEOPLE} to ${VOICE_MAX_PEOPLE}, or leave it empty for the default.`);
        ok = false;
      } else {
        maxParticipants = n;
      }
    }
    if (!ok) return null;
    return {
      name: trimmed,
      topic: topic.trim() || undefined,
      kind,
      visibility,
      ...(maxParticipants !== undefined ? { maxParticipants } : {}),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const request = validate();
    if (!request) return;
    setSubmitting(true);
    try {
      await onCreate(request);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'channel_name_taken') {
        setNameError('A channel with that name already exists. Pick another name.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create channel" onClose={onClose} size="sm" dismissible={!submitting}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 px-5 py-4">
        <div>
          <span className={labelCls}>Channel type</span>
          <SegmentedControl
            label="Channel type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'text', label: (<><Hash size={16} aria-hidden /> Text</>) },
              { value: 'voice', label: (<><Volume2 size={16} aria-hidden /> Voice</>) },
            ]}
          />
        </div>

        <div>
          <span className={labelCls}>Who can join</span>
          <SegmentedControl
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'public', label: (<><Globe size={16} aria-hidden /> Public</>) },
              { value: 'private', label: (<><Lock size={16} aria-hidden /> Private</>) },
            ]}
          />
          <p className="mt-1.5 text-xs text-text-muted" aria-live="polite">
            {visibility === 'private'
              ? 'Private: only invited members can see and join.'
              : 'Public: everyone on Elonix can see and join.'}
          </p>
        </div>

        <div>
          <label htmlFor="channel-name" className={labelCls}>
            Name
          </label>
          <input
            id="channel-name"
            autoFocus
            placeholder="general"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            required
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'channel-name-error' : undefined}
            className={`${inputCls} ${nameError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-border focus:border-accent focus:ring-accent'}`}
          />
          {nameError && (
            <p id="channel-name-error" role="alert" className="mt-1 text-xs text-danger">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="channel-topic" className={labelCls}>
            Topic <span className="normal-case text-text-muted">(optional)</span>
          </label>
          <input
            id="channel-topic"
            placeholder="What's this channel about?"
            maxLength={256}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={`${inputCls} border-border focus:border-accent focus:ring-accent`}
          />
        </div>

        {kind === 'voice' && (
          <div>
            <label htmlFor="channel-max" className={labelCls}>
              Max people <span className="normal-case text-text-muted">(optional)</span>
            </label>
            <input
              id="channel-max"
              type="number"
              inputMode="numeric"
              min={VOICE_MIN_PEOPLE}
              max={VOICE_MAX_PEOPLE}
              step={1}
              placeholder={`Default (up to ${VOICE_MAX_PEOPLE})`}
              value={maxPeople}
              onChange={(e) => {
                setMaxPeople(e.target.value);
                setMaxError(null);
              }}
              aria-invalid={!!maxError}
              aria-describedby="channel-max-help"
              className={`${inputCls} ${maxError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-border focus:border-accent focus:ring-accent'}`}
            />
            <p
              id="channel-max-help"
              className={`mt-1 text-xs ${maxError ? 'text-danger' : 'text-text-muted'}`}
              role={maxError ? 'alert' : undefined}
            >
              {maxError ?? `${VOICE_MIN_PEOPLE}–${VOICE_MAX_PEOPLE} people can be in the voice room at once.`}
            </p>
          </div>
        )}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
