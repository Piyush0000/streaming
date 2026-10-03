import { FormEvent, useState } from 'react';
import type { Channel, ChannelVisibility, UpdateChannelRequest } from '@streaming/shared-types';
import { AlertTriangle, Globe, Lock, Trash2 } from 'lucide-react';
import { ApiError } from '../lib/api';
import { deleteChannel, updateChannel } from '../lib/channels';
import { useSession } from '../context/SessionContext';
import SegmentedControl from './SegmentedControl';
import ErrorBanner from './ErrorBanner';
import Spinner from './Spinner';
import { VOICE_MAX_PEOPLE, VOICE_MIN_PEOPLE } from './CreateChannelModal';

const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary';
const inputCls =
  'w-full rounded-lg border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1';

export default function ChannelSettingsTab({
  channel,
  onUpdated,
  onDeleted,
}: {
  channel: Channel;
  onUpdated: (channel: Channel) => void;
  onDeleted: () => void;
}) {
  const { session } = useSession();
  const token = session?.accessToken ?? '';
  const isVoice = channel.kind === 'voice';

  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [visibility, setVisibility] = useState<ChannelVisibility>(channel.visibility);
  const [maxPeople, setMaxPeople] = useState(channel.maxParticipants != null ? String(channel.maxParticipants) : '');
  const [ack, setAck] = useState(false);

  const [nameError, setNameError] = useState<string | null>(null);
  const [maxError, setMaxError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const visibilityChanged = visibility !== channel.visibility;

  function buildPatch(): UpdateChannelRequest | null {
    const patch: UpdateChannelRequest = {};
    const trimmedName = name.trim();
    setNameError(null);
    setMaxError(null);
    let ok = true;
    if (trimmedName !== channel.name) {
      if (trimmedName.length < 2 || trimmedName.length > 64 || !NAME_RE.test(trimmedName)) {
        setNameError('Use 2–64 letters, numbers, underscores or hyphens (no spaces).');
        ok = false;
      } else {
        patch.name = trimmedName;
      }
    }
    const newTopic = topic.trim();
    if (newTopic !== (channel.topic ?? '')) patch.topic = newTopic === '' ? null : newTopic;
    if (visibilityChanged) patch.visibility = visibility;
    if (isVoice) {
      let desired: number | null = null;
      if (maxPeople.trim() !== '') {
        const n = Number(maxPeople);
        if (!Number.isInteger(n) || n < VOICE_MIN_PEOPLE || n > VOICE_MAX_PEOPLE) {
          setMaxError(`Enter a whole number from ${VOICE_MIN_PEOPLE} to ${VOICE_MAX_PEOPLE}, or leave empty for the default.`);
          ok = false;
        } else {
          desired = n;
        }
      }
      if (ok && desired !== channel.maxParticipants) patch.maxParticipants = desired;
    }
    return ok ? patch : null;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const patch = buildPatch();
    if (!patch) return;
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateChannel(token, channel.id, patch);
      onUpdated(updated);
      setName(updated.name);
      setTopic(updated.topic ?? '');
      setVisibility(updated.visibility);
      setMaxPeople(updated.maxParticipants != null ? String(updated.maxParticipants) : '');
      setAck(false);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'channel_name_taken') {
        setNameError('A channel with that name already exists. Pick another name.');
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  // --- danger zone ---
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (confirmName !== channel.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteChannel(token, channel.id);
      onDeleted();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

  const saveBlocked = saving || (visibilityChanged && !ack);

  return (
    <div className="flex flex-col gap-6 px-5 py-4">
      <form onSubmit={handleSave} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="settings-name" className={labelCls}>
            Name
          </label>
          <input
            id="settings-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
              setSaved(false);
            }}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'settings-name-error' : undefined}
            className={`${inputCls} ${nameError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-border focus:border-accent focus:ring-accent'}`}
          />
          {nameError && (
            <p id="settings-name-error" role="alert" className="mt-1 text-xs text-danger">
              {nameError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="settings-topic" className={labelCls}>
            Topic
          </label>
          <input
            id="settings-topic"
            value={topic}
            maxLength={256}
            onChange={(e) => {
              setTopic(e.target.value);
              setSaved(false);
            }}
            placeholder="What's this channel about?"
            className={`${inputCls} border-border focus:border-accent focus:ring-accent`}
          />
        </div>

        <div>
          <span className={labelCls}>Who can join</span>
          <SegmentedControl
            label="Visibility"
            value={visibility}
            onChange={(v) => {
              setVisibility(v);
              setAck(false);
              setSaved(false);
            }}
            options={[
              { value: 'public', label: (<><Globe size={16} aria-hidden /> Public</>) },
              { value: 'private', label: (<><Lock size={16} aria-hidden /> Private</>) },
            ]}
          />
          {!visibilityChanged && (
            <p className="mt-1.5 text-xs text-text-muted">
              {channel.visibility === 'private'
                ? 'Private: only invited members can see and join.'
                : 'Public: everyone on Elonix can see and join.'}
            </p>
          )}
          {visibilityChanged && (
            <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-text-primary" role="group" aria-label="Visibility change warning">
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <span>
                  {visibility === 'private'
                    ? 'Making this channel private hides it from everyone who is not a member. Anyone who is not a member will be removed from live chat and voice sessions right away.'
                    : 'Making this channel public makes it visible to everyone on Elonix, and anyone can read and join it.'}
                </span>
              </p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                I understand
              </label>
            </div>
          )}
        </div>

        {isVoice && (
          <div>
            <label htmlFor="settings-max" className={labelCls}>
              Max people
            </label>
            <input
              id="settings-max"
              type="number"
              inputMode="numeric"
              min={VOICE_MIN_PEOPLE}
              max={VOICE_MAX_PEOPLE}
              value={maxPeople}
              onChange={(e) => {
                setMaxPeople(e.target.value);
                setMaxError(null);
                setSaved(false);
              }}
              placeholder="Default"
              aria-invalid={!!maxError}
              aria-describedby="settings-max-help"
              className={`${inputCls} ${maxError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-border focus:border-accent focus:ring-accent'}`}
            />
            <p id="settings-max-help" role={maxError ? 'alert' : undefined} className={`mt-1 text-xs ${maxError ? 'text-danger' : 'text-text-muted'}`}>
              {maxError ??
                `${VOICE_MIN_PEOPLE}–${VOICE_MAX_PEOPLE}, or empty for the platform default${
                  channel.effectiveMaxParticipants ? ` (currently ${channel.effectiveMaxParticipants})` : ''
                }.`}
            </p>
          </div>
        )}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveBlocked}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Spinner size={14} className="text-white" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span role="status" className="text-xs text-success">
            {saved ? 'Saved.' : ''}
          </span>
        </div>
      </form>

      <section aria-labelledby="danger-heading" className="rounded-lg border border-danger/40 p-4">
        <h3 id="danger-heading" className="flex items-center gap-2 text-sm font-semibold text-danger">
          <Trash2 size={15} aria-hidden /> Delete channel
        </h3>
        <p className="mt-1 text-xs text-text-secondary">
          This permanently deletes #{channel.name}, its messages and its invites for everyone. This can't be undone.
        </p>
        <form onSubmit={handleDelete} className="mt-3 flex flex-col gap-2">
          <label htmlFor="delete-confirm" className="text-xs text-text-secondary">
            Type <span className="font-semibold text-text-primary">{channel.name}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`${inputCls} border-border focus:border-danger focus:ring-danger`}
          />
          {deleteError && <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} />}
          <button
            type="submit"
            disabled={deleting || confirmName !== channel.name}
            className="flex w-fit items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deleting && <Spinner size={14} className="text-white" />}
            {deleting ? 'Deleting…' : 'Delete this channel'}
          </button>
        </form>
      </section>
    </div>
  );
}
