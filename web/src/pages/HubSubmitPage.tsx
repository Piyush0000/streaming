import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, ImageIcon, LinkIcon, Loader2 } from 'lucide-react';
import { hubApi, hubPath, type HubSide } from '../lib/hub';
import { safeUrl } from '../lib/markdown';
import { canGoBackInApp } from '../lib/nav';
import { cx } from '../lib/format';
import { useHubAuth } from '../hooks/useHubAuth';
import { useToast } from '../context/ToastContext';
import HubShell from '../components/hub/HubShell';
import CommunityPicker from '../components/hub/CommunityPicker';
import ImageDrop from '../components/hub/Composer';
import Markdown from '../components/hub/Markdown';

type Tab = 'text' | 'image' | 'link';
const TITLE_MAX = 150;
const BODY_MAX = 10000;

interface SharePrefill {
  symbol?: string;
  side?: HubSide;
  pnlPercent?: number;
}

/** Router state from paper trading is validated, never trusted. */
function readShare(state: unknown): SharePrefill | undefined {
  const share = (state as { share?: unknown } | null)?.share as { symbol?: unknown; side?: unknown; pnlPercent?: unknown } | undefined;
  if (!share || typeof share !== 'object') return undefined;
  const symbol = typeof share.symbol === 'string' && /^[A-Z0-9]{2,20}$/.test(share.symbol) ? share.symbol : undefined;
  const side = share.side === 'long' || share.side === 'short' ? share.side : undefined;
  const pnlPercent =
    typeof share.pnlPercent === 'number' && Number.isFinite(share.pnlPercent) && Math.abs(share.pnlPercent) <= 100000 ? share.pnlPercent : undefined;
  return { symbol, side, pnlPercent };
}

export default function HubSubmitPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { showToast } = useToast();
  const { token, initializing, requireAuth } = useHubAuth();

  // Read once: the one-shot router state is consumed below so a refresh does not re-prefill.
  const share = useMemo(() => readShare(location.state), []); // eslint-disable-line react-hooks/exhaustive-deps
  const wantedTab = (location.state as { tab?: unknown } | null)?.tab;
  const [tab, setTab] = useState<Tab>(share ? 'image' : wantedTab === 'image' || wantedTab === 'link' ? wantedTab : 'text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [community, setCommunity] = useState(() => (params.get('community') ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40));
  const [flair, setFlair] = useState('');
  const [symbol, setSymbol] = useState(share?.symbol ?? '');
  const [side, setSide] = useState<HubSide | ''>(share?.side ?? '');
  const [pnl, setPnl] = useState(typeof share?.pnlPercent === 'number' ? String(share.pnlPercent) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current || !location.state) return;
    consumed.current = true;
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!initializing && !token) requireAuth();
  }, [initializing, token, requireAuth]);

  const pnlNum = pnl.trim() === '' ? null : Number(pnl);
  const pnlInvalid = pnlNum !== null && (!Number.isFinite(pnlNum) || Math.abs(pnlNum) > 100000);
  const safeLink = tab === 'link' ? safeUrl(url) : null;
  const titleOk = title.trim().length > 0;
  const contentOk = tab === 'text' ? true : tab === 'image' ? !!file && !pnlInvalid : !!safeLink;
  const canSubmit = !!token && !busy && titleOk && contentOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setBusy(true);
    setError(null);
    try {
      let post;
      if (tab === 'image' && file) {
        const form = new FormData();
        form.append('image', file);
        form.append('title', title.trim());
        if (community) form.append('community', community);
        if (symbol.trim()) form.append('symbol', symbol.trim().toUpperCase());
        if (side) form.append('side', side);
        if (pnlNum !== null) form.append('pnlPercent', String(pnlNum));
        if (flair.trim()) form.append('flair', flair.trim());
        post = await hubApi.createPost(token, form);
      } else {
        const payload: Record<string, unknown> = { type: tab, title: title.trim() };
        if (tab === 'text') payload.body = body.trim();
        if (tab === 'link') payload.linkUrl = safeLink;
        if (community) payload.community = community;
        if (flair.trim()) payload.flair = flair.trim();
        post = await hubApi.createPost(token, payload);
      }
      showToast('Posted', 'success');
      navigate(post.id ? hubPath.post(post.id) : hubPath.home);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not create your post.';
      setError(m);
      showToast(m, 'error');
      setBusy(false);
    }
  }

  const field = 'min-h-[44px] w-full rounded-lg border border-border bg-base px-3 py-2 text-sm outline-none transition-colors focus:border-accent sm:min-h-0';
  const tabs: { id: Tab; label: string; Icon: typeof FileText }[] = [
    { id: 'text', label: 'Post', Icon: FileText },
    { id: 'image', label: 'Image', Icon: ImageIcon },
    { id: 'link', label: 'Link', Icon: LinkIcon },
  ];

  return (
    <HubShell sidebar={false}>
      <h1 className="text-gradient-anim text-xl font-extrabold sm:text-2xl">Create a post</h1>
      <form onSubmit={submit} className="glass animate-rise-in space-y-4 rounded-2xl p-4 sm:p-5">
        <CommunityPicker value={community} onChange={setCommunity} />

        <div role="tablist" aria-label="Post type" className="grid grid-cols-3 gap-1 rounded-xl bg-base/60 p-1">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                'tap inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                tab === id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-hover'
              )}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder="Title"
            aria-label="Title"
            maxLength={TITLE_MAX}
            className={field}
          />
          <div className={cx('mt-1 text-right text-[11px]', title.length >= TITLE_MAX ? 'text-danger' : 'text-text-muted')}>
            {title.length}/{TITLE_MAX}
          </div>
        </div>

        {tab === 'text' && (
          <div>
            {preview ? (
              <div className="min-h-[9rem] rounded-lg border border-border bg-base/60 p-3">
                {body.trim() ? <Markdown text={body} /> : <p className="text-sm text-text-muted">Nothing to preview.</p>}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                rows={8}
                aria-label="Body"
                placeholder="Text (optional). Markdown supported: **bold**, *italic*, `code`, lists, > quotes, links."
                className={cx(field, 'resize-y')}
              />
            )}
            <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
              <button type="button" onClick={() => setPreview((p) => !p)} className="tap inline-flex items-center font-semibold text-accent hover:underline">
                {preview ? 'Edit' : 'Preview'}
              </button>
              <span>
                {body.length}/{BODY_MAX}
              </span>
            </div>
          </div>
        )}

        {tab === 'image' && (
          <div className="space-y-3">
            <ImageDrop file={file} onFile={setFile} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value.slice(0, 20))} placeholder="Symbol (BTCUSDT)" aria-label="Symbol" className={field} />
              <select value={side} onChange={(e) => setSide(e.target.value as HubSide | '')} aria-label="Side" className={field}>
                <option value="">Side</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
                <option value="spot">Spot</option>
              </select>
              <input
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
                inputMode="text"
                autoComplete="off"
                placeholder="PnL % (e.g. -3.5)"
                aria-label="PnL percent"
                aria-invalid={pnlInvalid}
                className={cx(field, pnlInvalid && 'border-danger')}
              />
            </div>
            <p className="text-[11px] text-text-muted">Trade details are optional.</p>
          </div>
        )}

        {tab === 'link' && (
          <div>
            <input value={url} onChange={(e) => setUrl(e.target.value.slice(0, 2000))} placeholder="https://" aria-label="Link URL" inputMode="url" aria-invalid={!!url && !safeLink} className={cx(field, !!url && !safeLink && 'border-danger')} />
            {!!url && !safeLink && <p className="mt-1 text-xs text-danger">Enter a full http:// or https:// link.</p>}
          </div>
        )}

        <input value={flair} onChange={(e) => setFlair(e.target.value.slice(0, 30))} placeholder="Flair (optional)" aria-label="Flair" className={field} />

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {!canSubmit && !busy && token && (
          <p className="text-right text-xs text-text-muted" aria-live="polite">
            {!titleOk ? 'Add a title to post.' : tab === 'image' && !file ? 'Choose an image to post.' : tab === 'image' && pnlInvalid ? 'PnL must be a number.' : tab === 'link' && !safeLink ? 'Enter a full https:// link to post.' : ''}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => (canGoBackInApp() ? navigate(-1) : navigate(hubPath.home))} disabled={busy} className="tap rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="cta-border tap inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Post
          </button>
        </div>
      </form>
    </HubShell>
  );
}
