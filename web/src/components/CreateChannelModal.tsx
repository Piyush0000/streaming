import { FormEvent, useState } from 'react';
import { Hash, Volume2, X } from 'lucide-react';
import { cx } from '../lib/format';

export default function CreateChannelModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, topic: string, kind: 'text' | 'voice') => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate(name.trim(), topic.trim(), kind);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">Create channel</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-hover hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Channel type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('text')}
                className={cx(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  kind === 'text'
                    ? 'border-accent bg-accent-soft text-text-primary'
                    : 'border-border bg-base text-text-secondary hover:bg-hover'
                )}
              >
                <Hash size={16} /> Text
              </button>
              <button
                type="button"
                onClick={() => setKind('voice')}
                className={cx(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  kind === 'voice'
                    ? 'border-accent bg-accent-soft text-text-primary'
                    : 'border-border bg-base text-text-secondary hover:bg-hover'
                )}
              >
                <Volume2 size={16} /> Voice
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="channel-name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Name
            </label>
            <input
              id="channel-name"
              autoFocus
              placeholder="general"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="channel-topic" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Topic <span className="normal-case text-text-muted">(optional)</span>
            </label>
            <input
              id="channel-topic"
              placeholder="What's this channel about?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
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
      </div>
    </div>
  );
}
