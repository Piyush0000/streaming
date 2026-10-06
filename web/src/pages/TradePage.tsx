import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, ShieldAlert } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { usePolled } from '../hooks/usePolled';
import { ApiError } from '../lib/api';
import { paperApi, REASON_LABEL, type PaperAccount } from '../lib/paper';
import { formatPnl, formatUsd } from '../lib/paperMath';
import { baseSymbol } from '../lib/marketMath';
import { cx } from '../lib/format';
import Modal from '../components/Modal';
import Skeleton from '../components/Skeleton';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import Flash, { FlashStyles } from '../components/trade/Flash';
import OrderTicket from '../components/trade/OrderTicket';
import PositionCard, { pnlColor } from '../components/trade/PositionCard';
import HistoryTab from '../components/trade/HistoryTab';
import LeaderboardTab from '../components/trade/LeaderboardTab';

type Tab = 'trade' | 'history' | 'leaderboard';
const TABS: { id: Tab; label: string }[] = [
  { id: 'trade', label: 'Trade' },
  { id: 'history', label: 'History' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

export default function TradePage() {
  const { session } = useSession();
  const { showToast } = useToast();
  const token = session?.accessToken ?? '';
  const [tab, setTab] = useState<Tab>('trade');
  const [historyKey, setHistoryKey] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);

  const { data: account, error, loading, reload } = usePolled((s) => paperApi.account(token, s), 4000, !!token);

  // Notify when a position disappears without the user closing it (SL / TP / liquidation by the engine).
  const prevIds = useRef<Map<string, string> | null>(null);
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!account) return;
    try {
      for (const c of account.closedByEngine ?? []) {
        if (notified.current.has(c.id)) continue;
        notified.current.add(c.id);
        showToast(`${baseSymbol(c.symbol)} ${c.side.toLowerCase()}: ${REASON_LABEL[c.reason]} ${formatPnl(c.realizedPnl)}`, c.realizedPnl >= 0 ? 'success' : 'warning', 8000);
        setHistoryKey((k) => k + 1);
      }
      const now = new Map(account.positions.map((p) => [p.id, p.symbol]));
      if (prevIds.current) {
        let gone = false;
        for (const [id, sym] of prevIds.current) {
          if (!now.has(id) && !notified.current.has(id)) {
            notified.current.add(id);
            showToast(`Your ${baseSymbol(sym)} position was closed. See History.`, 'info', 8000);
            gone = true;
          }
        }
        if (gone) setHistoryKey((k) => k + 1);
      }
      prevIds.current = now;
    } catch {
      /* notifications must never break the page */
    }
  }, [account, showToast]);

  const refresh = useCallback(() => {
    reload();
    setHistoryKey((k) => k + 1);
  }, [reload]);

  // Closing/opening locally should not trigger the "was closed" toast.
  const onChanged = useCallback(() => {
    if (prevIds.current) prevIds.current = null;
    refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto" data-tour="trade-page">
      <FlashStyles />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-xl font-bold text-text-primary">Paper trading</h1>
          <div
            role="note"
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              <strong>Paper trading — virtual funds, not real money.</strong> Prices are real Binance prices; no real orders are placed.
            </span>
          </div>
        </header>

        <AccountBar account={account} loading={loading && !account} onReset={() => setResetOpen(true)} />

        {error && !account && <ErrorBanner message={error} />}
        {error && account && <p className="text-xs text-warning">Connection trouble — showing the last known data. {error}</p>}
        {account && !account.pricesOk && (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Live prices are unavailable. Positions are shown without live PnL, and SL/TP/liquidation checks are paused until prices return.
          </p>
        )}

        <div role="tablist" aria-label="Paper trading sections" className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                tab === t.id ? 'bg-accent-soft text-text-primary' : 'text-text-secondary hover:bg-hover'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'trade' && (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
            <OrderTicket token={token} account={account} onPlaced={onChanged} />
            <section aria-label="Open positions" className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                Open positions{account ? ` (${account.positions.length}/${account.limits.maxPositions})` : ''}
              </h2>
              {loading && !account ? (
                <div role="status" aria-busy="true" aria-label="Loading positions" className="flex flex-col gap-2">
                  <Skeleton className="h-28 w-full rounded-xl" />
                  <Skeleton className="h-28 w-full rounded-xl" />
                </div>
              ) : account && account.positions.length === 0 ? (
                <EmptyState character="bull" title="No open positions" body="Place a paper order to get started. SL and TP are checked server-side." size={96} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {account?.positions.map((p) => (
                    <PositionCard key={p.id} token={token} p={p} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {tab === 'history' && <HistoryTab token={token} refreshKey={historyKey} />}
        {tab === 'leaderboard' && <LeaderboardTab token={token} />}
      </div>

      {resetOpen && account && (
        <ResetModal
          account={account}
          token={token}
          onClose={() => setResetOpen(false)}
          onDone={() => {
            setResetOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AccountBar({ account, loading, onReset }: { account: PaperAccount | null; loading: boolean; onReset: () => void }) {
  if (loading || !account) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading account" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  const cooling = account.resetAvailableAt !== null && new Date(account.resetAvailableAt).getTime() > Date.now();
  return (
    <section aria-label="Account" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Available" value={account.balance} text={formatUsd(account.balance)} />
        <Stat label="Equity" value={account.equity} text={formatUsd(account.equity)} />
        <Stat label="Unrealized PnL" value={account.unrealizedPnl} text={formatPnl(account.unrealizedPnl)} tone={pnlColor(account.unrealizedPnl)} />
        <Stat label="Used margin" value={account.usedMargin} text={formatUsd(account.usedMargin)} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          Start balance {formatUsd(account.startingBalance)} · resets used: {account.resetCount}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={cooling}
          title={cooling ? 'You can reset once per hour' : 'Reset paper account'}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={12} /> Reset account
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, text, tone }: { label: string; value: number | null; text: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={cx('mt-0.5 truncate text-base font-bold sm:text-lg', tone ?? 'text-text-primary')}>
        <Flash value={value}>{text}</Flash>
      </p>
    </div>
  );
}

function ResetModal({
  account,
  token,
  onClose,
  onDone,
}: {
  account: PaperAccount;
  token: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = account.positions.length;

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await paperApi.reset(token, n > 0);
      showToast(`Account reset to ${formatUsd(r.balance)}${r.closedPositions ? ` (${r.closedPositions} closed at market)` : ''}`, 'success');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not reset the account.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Reset paper account?" onClose={onClose} size="sm" dismissible={!busy} tone="warning">
      <div className="flex flex-col gap-3 text-sm text-text-secondary">
        <p>
          Your virtual balance goes back to {formatUsd(account.startingBalance)}.
          {n > 0 ? ` Your ${n} open position${n === 1 ? '' : 's'} will be closed at the current market price first.` : ''} Trade history is kept.
          You can reset once per hour.
        </p>
        {err && <ErrorBanner message={err} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-hover">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void go()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-60"
          >
            {busy && <Spinner size={14} className="text-white" />}
            Reset
          </button>
        </div>
      </div>
    </Modal>
  );
}
