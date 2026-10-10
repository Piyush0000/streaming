import { useMemo, useState } from 'react';
import Modal from './Modal';
import { calcPosition, formatPrice, parseInputNumber } from '../lib/marketMath';

function Field({
  label,
  value,
  onChange,
  error,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  suffix?: string;
}) {
  return (
    <label className="block text-xs font-medium text-text-secondary">
      {label}
      <div className="relative mt-1">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className="min-h-[44px] w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">{suffix}</span>
        )}
      </div>
      {error && <span className="mt-1 block text-[11px] text-danger">{error}</span>}
    </label>
  );
}

export default function RiskCalculatorModal({ onClose }: { onClose: () => void }) {
  const [balance, setBalance] = useState('');
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [touched, setTouched] = useState(false);

  const anyInput = balance !== '' || entry !== '' || stop !== '';
  const result = useMemo(
    () =>
      calcPosition({
        balance: parseInputNumber(balance),
        riskPct: parseInputNumber(riskPct),
        entry: parseInputNumber(entry),
        stop: parseInputNumber(stop),
      }),
    [balance, riskPct, entry, stop]
  );
  // Only show field errors for fields the user has started filling in.
  const errs = !result.ok && (touched || anyInput) ? result.errors : {};
  const show = (k: 'balance' | 'riskPct' | 'entry' | 'stop', v: string) => (v !== '' || touched ? errs[k] : undefined);

  return (
    <Modal title="Position size calculator" onClose={onClose} size="sm">
      <div className="space-y-3 px-5 py-4">
        <Field label="Account balance" value={balance} onChange={(v) => { setTouched(true); setBalance(v); }} error={show('balance', balance)} suffix="USD" />
        <Field label="Risk per trade" value={riskPct} onChange={setRiskPct} error={show('riskPct', riskPct)} suffix="%" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entry price" value={entry} onChange={(v) => { setTouched(true); setEntry(v); }} error={show('entry', entry)} />
          <Field label="Stop price" value={stop} onChange={(v) => { setTouched(true); setStop(v); }} error={show('stop', stop)} />
        </div>

        <div className="rounded-lg border border-border bg-base px-3 py-3 text-sm" aria-live="polite">
          {result.ok ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt className="text-text-muted">Direction</dt>
              <dd className="text-right font-medium text-text-primary">{result.side === 'long' ? 'Long' : 'Short'}</dd>
              <dt className="text-text-muted">Risk amount</dt>
              <dd className="text-right font-medium tabular-nums text-text-primary">${formatPrice(result.riskAmount)}</dd>
              <dt className="text-text-muted">Position size</dt>
              <dd className="text-right font-semibold tabular-nums text-accent">{result.positionSize.toLocaleString('en-US', { maximumFractionDigits: 6 })} units</dd>
              <dt className="text-text-muted">Position value</dt>
              <dd className="text-right tabular-nums text-text-secondary">${formatPrice(result.notional)}</dd>
              <dt className="text-text-muted">Stop distance</dt>
              <dd className="text-right tabular-nums text-text-secondary">{result.stopDistancePct.toFixed(2)}%</dd>
              {result.leverage > 1 && (
                <>
                  <dt className="text-warning">Leverage needed</dt>
                  <dd className="text-right tabular-nums text-warning">{result.leverage.toFixed(2)}x</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-text-muted">Enter balance, entry and stop to see your position size.</p>
          )}
        </div>
        <p className="text-[11px] text-text-muted">
          Size = (balance × risk %) ÷ |entry − stop|. Ignores fees and slippage. Not financial advice.
        </p>
      </div>
    </Modal>
  );
}
