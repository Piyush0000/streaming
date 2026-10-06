import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '../Modal';
import { hubApi, type HubCommunity } from '../../lib/hub';
import { useToast } from '../../context/ToastContext';
import { cx } from '../../lib/format';

const SLUG_RE = /^[a-z0-9_]{3,21}$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 21);
}

export default function CreateCommunityModal({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: (c: HubCommunity) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugOk = SLUG_RE.test(effectiveSlug);
  const nameOk = name.trim().length >= 3;
  const field = 'w-full rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none focus:border-accent';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !slugOk || !nameOk) return;
    setBusy(true);
    setError(null);
    try {
      const c = await hubApi.createCommunity(token, { slug: effectiveSlug, name: name.trim(), description: description.trim() });
      showToast(`c/${c.slug || effectiveSlug} created`, 'success');
      onCreated({ ...c, slug: c.slug || effectiveSlug, name: c.name || name.trim(), joined: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the community.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Create a community" onClose={onClose} dismissible={!busy}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="cc-name" className="mb-1 block text-xs font-semibold text-text-secondary">
            Name
          </label>
          <input id="cc-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} className={field} placeholder="Swing Traders" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="cc-slug" className="mb-1 block text-xs font-semibold text-text-secondary">
            Address
          </label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-text-muted">c/</span>
            <input
              id="cc-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().slice(0, 21));
              }}
              className={cx(field, effectiveSlug && !slugOk && 'border-danger')}
              aria-invalid={!!effectiveSlug && !slugOk}
              autoComplete="off"
            />
          </div>
          <p className="mt-1 text-[11px] text-text-muted">3-21 characters: lowercase letters, numbers and underscores.</p>
        </div>
        <div>
          <label htmlFor="cc-desc" className="mb-1 block text-xs font-semibold text-text-secondary">
            Description
          </label>
          <textarea id="cc-desc" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 300))} rows={3} className={field} placeholder="What is this community about?" />
          <div className="text-right text-[11px] text-text-muted">{description.length}/300</div>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !slugOk || !nameOk}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
