import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseSymbol, calcPosition, formatAge, formatChangePct, nextPollDelay, parseInputNumber } from './marketMath';

test('calcPosition long: 1% of 10000 risk, entry 100 stop 95 -> 20 units', () => {
  const r = calcPosition({ balance: 10000, riskPct: 1, entry: 100, stop: 95 });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.side, 'long');
  assert.equal(r.riskAmount, 100);
  assert.equal(r.positionSize, 20);
  assert.equal(r.notional, 2000);
  assert.equal(r.leverage, 0.2);
  assert.equal(r.stopDistancePct, 5);
});

test('calcPosition short when stop above entry', () => {
  const r = calcPosition({ balance: 1000, riskPct: 2, entry: 50, stop: 55 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.side, 'short');
    assert.equal(r.positionSize, 4);
  }
});

test('calcPosition rejects entry === stop (division by zero) and bad inputs', () => {
  const same = calcPosition({ balance: 1000, riskPct: 1, entry: 10, stop: 10 });
  assert.equal(same.ok, false);
  if (!same.ok) assert.ok(same.errors.stop);
  const bad = calcPosition({ balance: -1, riskPct: 0, entry: NaN, stop: 0 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['balance', 'entry', 'riskPct', 'stop']);
  assert.equal(calcPosition({ balance: 1, riskPct: 101, entry: 1, stop: 2 }).ok, false);
  assert.equal(calcPosition({ balance: 1, riskPct: 1, entry: Infinity, stop: 2 }).ok, false);
});

test('parseInputNumber', () => {
  assert.equal(parseInputNumber('1,5'), 1.5);
  assert.equal(parseInputNumber(' 10 '), 10);
  assert.ok(Number.isNaN(parseInputNumber('')));
  assert.ok(Number.isNaN(parseInputNumber('12abc')));
  assert.ok(Number.isNaN(parseInputNumber('Infinity')));
});

test('formatters', () => {
  assert.equal(formatAge(10), 'just now');
  assert.equal(formatAge(300), '5m ago');
  assert.equal(formatAge(7200), '2h ago');
  assert.equal(formatAge(86400 * 12), '12d ago');
  assert.equal(formatAge(NaN), 'unknown');
  assert.equal(formatChangePct(1.234), '+1.23%');
  assert.equal(formatChangePct(-0.5), '-0.50%');
  assert.equal(baseSymbol('BTCUSDT'), 'BTC');
});

test('nextPollDelay backs off and caps', () => {
  assert.equal(nextPollDelay(10000, 0), 10000);
  assert.equal(nextPollDelay(10000, 1), 20000);
  assert.equal(nextPollDelay(10000, 2), 40000);
  assert.equal(nextPollDelay(10000, 20), 120000);
});
