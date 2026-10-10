import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { paperApi, type PaperPosition } from '../../lib/paper';
import { formatPnl, formatSignedPct, formatUsd, parsePositive, validateSlTp } from '../../lib/paperMath';
import { baseSymbol, formatPrice } from '../../lib/marketMath';
import { cx } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import ConfirmButton from '../ConfirmButton';
import Spinner from '../Spinner';
import Flash from './Flash';

export function SideBadge({ side }: { side: 'LONG' | 'SHORT' }) {
  return (
    <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', side === 'LONG' ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger')}>
      {side}
    </span>
  );
}

export const pnlColor = (n: number | null | undefined) =>
  n === null || n === undefined || n === 0 ? 'text-text-primary' : n > 0 ? 'text-success' : 'text-danger';

export default function PositionCard({
  token,
  p,
  onChanged,
}: {
  token: string;
  p: PaperPosition;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [busy, setBusy] = useState<'save' | 'close' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setSl(p.slPrice !== null ? String(p.slPrice) : '');
    setTp(p.tpPrice !== null ? String(p.tpPrice) : '');
    setErr(null);
    setEditing(true);
  }

  async function save() {
    const slV = sl.trim() === '' ? null : parsePositive(sl);
    const tpV = tp.trim() === '' ? null : parsePositive(tp);
    if ((sl.trim() !== '' && slV === null) || (tp.trim() !== '' && tpV === null)) {
      setErr('Enter valid prices, or leave blank to clear.');
      return;
    }
    // Only validate the changed levels against the live price (the server does the same).
    const mark = p.markPrice;
    if (mark !== null) {
      const msg = validateSlTp(p.side, mark, slV !== p.slPrice ? slV : null, tpV !== p.tpPrice ? tpV : null);
      if (msg) {
        setErr(msg);
        return;
      }
    }
    setBusy('save');
    setErr(null);
    try {
      await paperApi.patch(token, p.id, { slPrice: slV, tpPrice: tpV });
      showToast('SL / TP updated', 'success');
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update.');
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    setBusy('close');
    try {
      const { trade } = await paperApi.close(token, p.id);
      showToast(`Closed ${baseSymbol(p.symbol)} ${formatPnl(trade.realizedPnl)}`, trade.realizedPnl >= 0 ? 'success' : 'warning');
      onChanged();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not close the position.', 'error');
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const field = 'min-h-[44px] w-full rounded-md border border-border bg-base px-2 py-1.5 text-sm tabular-nums text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent';

  return (
    <li className="animate-rise-in rounded-xl border border-border bg-panel p-3" data-testid="position-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{baseSymbol(p.symbol)}/USDT</span>
          <SideBadge side={p.side} />
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">{p.leverage}x</span>
        </div>
        <div className="text-right">
          <div className={cx('text-sm font-bold', pnlColor(p.uPnl))}>
            <Flash value={p.uPnl}>{formatPnl(p.uPnl)}</Flash>
          </div>
          <div className={cx('text-xs font-semibold', pnlColor(p.roePct))}>
            <Flash value={p.roePct}>{formatSignedPct(p.roePct)}</Flash> ROE
          </div>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
        <Cell k="Entry" v={formatPrice(p.entryPrice)} />
        <Cell k="Mark" v={p.markPrice !== null ? <Flash value={p.markPrice}>{formatPrice(p.markPrice)}</Flash> : '—'} />
        <Cell k="Liq." v={formatPrice(p.liqPrice)} warn />
        <Cell k="Margin" v={formatUsd(p.margin)} />
        <Cell k="Size" v={`${p.qty} ${baseSymbol(p.symbol)}`} />
        <Cell k="Stop loss" v={p.slPrice !== null ? formatPrice(p.slPrice) : '—'} />
        <Cell k="Take profit" v={p.tpPrice !== null ? formatPrice(p.tpPrice) : '—'} />
      </dl>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Stop loss price
              <input value={sl} onChange={(e) => setSl(e.target.value.slice(0, 14))} inputMode="decimal" placeholder="none" className={field} aria-label="Stop loss price" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Take profit price
              <input value={tp} onChange={(e) => setTp(e.target.value.slice(0, 14))} inputMode="decimal" placeholder="none" className={field} aria-label="Take profit price" />
            </label>
          </div>
          {err && (
            <p role="alert" className="text-xs text-danger">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null}
              className="tap inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {busy === 'save' && <Spinner size={12} className="text-white" />}
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy !== null} className="tap inline-flex items-center justify-center rounded-md px-4 py-1.5 text-sm text-text-secondary hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={startEdit}
            disabled={busy !== null}
            className="tap inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-60"
          >
            <Pencil size={12} /> Edit SL / TP
          </button>
          <ConfirmButton ariaLabel={`Close ${baseSymbol(p.symbol)} ${p.side} position`} confirmLabel="Close at market" onConfirm={close} busy={busy === 'close'}>
            Close
          </ConfirmButton>
        </div>
      )}
    </li>
  );
}

function Cell({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-text-muted">{k}</dt>
      <dd className={cx('truncate font-medium tabular-nums', warn ? 'text-warning' : 'text-text-primary')}>{v}</dd>
    </div>
  );
}
