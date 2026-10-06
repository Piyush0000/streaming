import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { paperApi, type PaperAccount } from '../../lib/paper';
import {
  formatUsd,
  MAX_LEVERAGE,
  notionalForBalancePct,
  parsePositive,
  percentFromPrice,
  previewOrder,
  priceFromPercent,
  type Side,
} from '../../lib/paperMath';
import { baseSymbol, formatPrice } from '../../lib/marketMath';
import { cx } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import Spinner from '../Spinner';

type Mode = 'price' | 'pct';

const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const field =
  'w-full rounded-lg border border-border bg-base px-3 py-2 text-sm tabular-nums outline-none focus:border-accent disabled:opacity-50';

export default function OrderTicket({
  token,
  account,
  onPlaced,
}: {
  token: string;
  account: PaperAccount | null;
  onPlaced: () => void;
}) {
  const { showToast } = useToast();
  const symbols = account?.limits.symbols?.length ? account.limits.symbols : FALLBACK_SYMBOLS;
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<Side>('LONG');
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState(5);
  const [slMode, setSlMode] = useState<Mode>('pct');
  const [tpMode, setTpMode] = useState<Mode>('pct');
  const [slRaw, setSlRaw] = useState('');
  const [tpRaw, setTpRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const price = account?.prices?.[symbol] ?? null;
  const available = account?.balance ?? 0;
  const openCount = account?.positions.length ?? 0;
  const priceUsable = !!account?.pricesOk && price !== null;

  const notional = parsePositive(size) ?? 0;

  const sl = useMemo(() => resolveLevel(side, price, 'sl', slMode, slRaw), [side, price, slMode, slRaw]);
  const tp = useMemo(() => resolveLevel(side, price, 'tp', tpMode, tpRaw), [side, price, tpMode, tpRaw]);

  const preview = useMemo(
    () =>
      previewOrder({
        side,
        price: priceUsable ? price : null,
        notional,
        leverage,
        available,
        sl: sl.value,
        tp: tp.value,
        openPositions: openCount,
      }),
    [side, price, priceUsable, notional, leverage, available, sl.value, tp.value, openCount]
  );

  const inputError = sl.error ?? tp.error;
  const blocking = inputError ?? preview.error;
  const canSubmit = !busy && !!account && !blocking && preview.ok;

  function setPct(pct: number) {
    const n = notionalForBalancePct(available, pct, leverage);
    setSize(n > 0 ? String(n) : '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    try {
      await paperApi.order(token, {
        symbol,
        side,
        notionalUsd: notional,
        leverage,
        ...(sl.value !== null ? { slPrice: sl.value } : {}),
        ...(tp.value !== null ? { tpPrice: tp.value } : {}),
      });
      showToast(`${side === 'LONG' ? 'Long' : 'Short'} ${baseSymbol(symbol)} opened (paper)`, 'success');
      setSize('');
      setSlRaw('');
      setTpRaw('');
      onPlaced();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not place the order.';
      setServerError(msg);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border bg-panel p-4" aria-label="Paper order ticket" data-testid="order-ticket">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">New order</h2>
        <span className="text-xs text-text-muted">Market · taker fee 0.04%</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Symbol
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={field} aria-label="Symbol">
            {symbols.map((s) => (
              <option key={s} value={s}>
                {baseSymbol(s)}/USDT
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-text-secondary">
          Live price
          <div className="flex h-[38px] items-center rounded-lg border border-border bg-base px-3 text-sm font-semibold tabular-nums text-text-primary">
            {priceUsable ? formatPrice(price as number) : '—'}
          </div>
        </div>
      </div>

      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
        {(['LONG', 'SHORT'] as const).map((s) => {
          const on = side === s;
          const long = s === 'LONG';
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSide(s)}
              className={cx(
                'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-bold transition-colors',
                on
                  ? long
                    ? 'border-success bg-success/20 text-success'
                    : 'border-danger bg-danger/20 text-danger'
                  : 'border-border bg-base text-text-secondary hover:bg-hover'
              )}
            >
              {long ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              {long ? 'Long' : 'Short'}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Size (USD notional)
          <input
            value={size}
            onChange={(e) => setSize(e.target.value.slice(0, 14))}
            inputMode="decimal"
            placeholder={`min $${account?.limits.minNotionalUsd ?? 10}`}
            className={cx(field, size.trim() !== '' && parsePositive(size) === null && 'border-danger')}
            aria-label="Order size in USD"
          />
        </label>
        <div className="grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPct(p)}
              disabled={available <= 0}
              className="rounded-md border border-border bg-base py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:opacity-40"
            >
              {p}%
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted">Percent buttons use your available balance ({formatUsd(available)}) at the chosen leverage.</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <label htmlFor="paper-leverage">Leverage</label>
          <span className="rounded bg-accent-soft px-2 py-0.5 font-bold tabular-nums text-text-primary">{leverage}x</span>
        </div>
        <input
          id="paper-leverage"
          type="range"
          min={1}
          max={account?.limits.maxLeverage ?? MAX_LEVERAGE}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Math.min(MAX_LEVERAGE, Math.max(1, Number(e.target.value) || 1)))}
          className="w-full accent-[#3b82f6]"
        />
        <div className="flex justify-between text-[10px] text-text-muted">
          <span>1x</span>
          <span>25x</span>
          <span>50x</span>
        </div>
      </div>

      <LevelInput
        label="Stop loss"
        mode={slMode}
        onMode={setSlMode}
        raw={slRaw}
        onRaw={setSlRaw}
        resolved={sl}
        side={side}
        kind="sl"
        entry={price}
      />
      <LevelInput
        label="Take profit"
        mode={tpMode}
        onMode={setTpMode}
        raw={tpRaw}
        onRaw={setTpRaw}
        resolved={tp}
        side={side}
        kind="tp"
        entry={price}
      />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-base p-3 text-xs" aria-label="Order preview">
        <Row k="Margin" v={preview.margin > 0 ? formatUsd(preview.margin) : '—'} />
        <Row k="Fees (open)" v={preview.openFee > 0 ? `$${preview.openFee.toFixed(4)}` : '—'} />
        <Row k="Liquidation" v={preview.liqPrice !== null && notional > 0 ? formatPrice(preview.liqPrice) : '—'} warn />
        <Row k="Quantity" v={preview.qty > 0 ? String(preview.qty) : '—'} />
        <Row k="Max loss at SL" v={preview.maxLoss !== null ? `-${formatUsd(preview.maxLoss)}` : '—'} />
        <Row k="Profit at TP" v={preview.maxProfit !== null ? `+${formatUsd(preview.maxProfit)}` : '—'} />
        <Row k="Risk / reward" v={preview.riskReward !== null ? `1 : ${preview.riskReward.toFixed(2)}` : '—'} />
        <Row k="Available" v={formatUsd(available)} />
      </dl>

      {(blocking || serverError) && notional > 0 && (
        <p role="alert" className="text-xs text-danger">
          {serverError ?? blocking}
        </p>
      )}
      {!account?.pricesOk && account && (
        <p role="status" className="text-xs text-warning">
          Live prices are unavailable right now, so orders are paused.
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          side === 'LONG' ? 'bg-success hover:bg-success/90' : 'bg-danger hover:bg-danger/90'
        )}
      >
        {busy && <Spinner size={14} className="text-white" />}
        {side === 'LONG' ? 'Buy / Long' : 'Sell / Short'} {baseSymbol(symbol)} (paper)
      </button>
    </form>
  );
}

function resolveLevel(
  side: Side,
  entry: number | null,
  kind: 'sl' | 'tp',
  mode: Mode,
  raw: string
): { value: number | null; error: string | null } {
  if (raw.trim() === '') return { value: null, error: null };
  const n = parsePositive(raw);
  const name = kind === 'sl' ? 'stop loss' : 'take profit';
  if (n === null) return { value: null, error: `Enter a valid ${name}.` };
  if (mode === 'price') return { value: n, error: null };
  if (entry === null) return { value: null, error: null };
  const p = priceFromPercent(side, entry, kind, n);
  return p === null ? { value: null, error: `That ${name} percent is out of range.` } : { value: p, error: null };
}

function LevelInput({
  label,
  mode,
  onMode,
  raw,
  onRaw,
  resolved,
  side,
  kind,
  entry,
}: {
  label: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  raw: string;
  onRaw: (v: string) => void;
  resolved: { value: number | null; error: string | null };
  side: Side;
  kind: 'sl' | 'tp';
  entry: number | null;
}) {
  const hint =
    resolved.value === null
      ? 'Optional'
      : mode === 'pct'
        ? `= ${formatPrice(resolved.value)}`
        : entry !== null
          ? `${percentFromPrice(side, entry, kind, resolved.value)?.toFixed(2) ?? '—'}% from entry`
          : '';
  function switchMode(next: Mode) {
    if (next === mode) return;
    // convert the typed value so the toggle doesn't silently change meaning
    if (resolved.value !== null && entry !== null) {
      if (next === 'price') onRaw(String(resolved.value));
      else {
        const pct = percentFromPrice(side, entry, kind, resolved.value);
        onRaw(pct !== null && pct > 0 ? String(Number(pct.toFixed(2))) : '');
      }
    } else if (raw.trim() !== '') onRaw('');
    onMode(next);
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>{label}</span>
        <div role="radiogroup" aria-label={`${label} input type`} className="flex overflow-hidden rounded-md border border-border text-[11px]">
          {(['pct', 'price'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => switchMode(m)}
              className={cx('px-2 py-0.5 font-semibold', mode === m ? 'bg-accent-soft text-text-primary' : 'text-text-muted hover:bg-hover')}
            >
              {m === 'pct' ? '%' : '$'}
            </button>
          ))}
        </div>
      </div>
      <input
        value={raw}
        onChange={(e) => onRaw(e.target.value.slice(0, 14))}
        inputMode="decimal"
        placeholder={mode === 'pct' ? 'e.g. 2 (percent from entry)' : 'price'}
        aria-label={label}
        aria-invalid={!!resolved.error}
        className={cx(field, resolved.error && 'border-danger')}
      />
      <span className="text-[11px] text-text-muted">{resolved.error ?? hint}</span>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <>
      <dt className="text-text-muted">{k}</dt>
      <dd className={cx('text-right font-medium tabular-nums', warn ? 'text-warning' : 'text-text-primary')}>{v}</dd>
    </>
  );
}
