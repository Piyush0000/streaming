import { DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { hubApi, HubPost, HubSide } from '../../lib/hub';
import { cx } from '../../lib/format';
import { useToast } from '../../context/ToastContext';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface Props {
  token: string;
  onClose: () => void;
  onCreated: (post: HubPost) => void;
  /** Optional prefill (e.g. from a paper trade). */
  initial?: { symbol?: string; side?: HubSide; pnlPercent?: number };
}

export default function Composer({ token, onClose, onCreated, initial }: Props) {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [caption, setCaption] = useState('');
  const [symbol, setSymbol] = useState(initial?.symbol?.slice(0, 20) ?? '');
  const [side, setSide] = useState<HubSide | ''>(initial?.side ?? '');
  const [pnl, setPnl] = useState(typeof initial?.pnlPercent === 'number' && Number.isFinite(initial.pnlPercent) ? String(initial.pnlPercent) : '');
  const [submitting, setSubmitting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, submitting]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('Unsupported file type. Use PNG, JPG, WebP or GIF.');
    if (f.size > MAX_BYTES) return setError('Image is too large. Max size is 5MB.');
    setError(null);
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  }

  const pnlNum = pnl.trim() === '' ? null : Number(pnl);
  const pnlInvalid = pnlNum !== null && (!Number.isFinite(pnlNum) || Math.abs(pnlNum) > 100000);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || submitting || pnlInvalid) return;
    setSubmitting(true);
    const form = new FormData();
    form.append('image', file);
    form.append('caption', caption.trim());
    if (symbol.trim()) form.append('symbol', symbol.trim().toUpperCase());
    if (side) form.append('side', side);
    if (pnlNum !== null) form.append('pnlPercent', String(pnlNum));
    try {
      const { post } = await hubApi.createPost(token, form);
      showToast('Trade shared', 'success');
      onCreated(post);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not share your trade.', 'error');
      setSubmitting(false);
    }
  }

  const field = 'w-full rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Share a trade"
        className="flex max-h-[95dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-panel sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold">Share a trade</h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className="rounded p-1 text-text-secondary hover:bg-hover">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          {preview ? (
            <div className="relative overflow-hidden rounded-xl border border-border bg-base">
              <img src={preview} alt="Preview" className="max-h-72 w-full object-contain" />
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label="Remove image"
                className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') input.current?.click();
              }}
              className={cx(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center',
                dragging ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
              )}
            >
              <ImagePlus className="text-accent" />
              <p className="text-sm font-semibold">Drop a screenshot or click to choose</p>
              <p className="text-xs text-text-muted">PNG, JPG, WebP or GIF, up to 5MB</p>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept={TYPES.join(',')}
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}

          <div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Caption (optional)"
              className={field}
            />
            <div className="text-right text-[11px] text-text-muted">{caption.length}/500</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.slice(0, 20))} placeholder="Symbol (BTCUSDT)" className={field} aria-label="Symbol" />
            <select value={side} onChange={(e) => setSide(e.target.value as HubSide | '')} className={field} aria-label="Side">
              <option value="">Side</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
              <option value="spot">Spot</option>
            </select>
            <input
              value={pnl}
              onChange={(e) => setPnl(e.target.value)}
              inputMode="decimal"
              placeholder="PnL %"
              aria-label="PnL percent"
              aria-invalid={pnlInvalid}
              className={cx(field, pnlInvalid && 'border-danger')}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || submitting || pnlInvalid}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Share
          </button>
        </div>
      </form>
    </div>
  );
}
