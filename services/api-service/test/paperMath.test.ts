import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClose,
  computeOpen,
  equity,
  evaluateTrigger,
  fee,
  liquidationPrice,
  PositionLike,
  roePct,
  round8,
  unrealizedPnl,
  validateSlTp,
} from '../src/paperMath';

test('round8 is stable and normalises -0 / NaN', () => {
  assert.equal(round8(0.1 + 0.2), 0.3);
  assert.equal(round8(1.123456789), 1.12345679);
  assert.equal(Object.is(round8(-0.000000001), 0), true);
  assert.ok(Number.isNaN(round8(Infinity)));
});

test('unrealized PnL long/short', () => {
  assert.equal(unrealizedPnl('LONG', 100, 110, 2), 20);
  assert.equal(unrealizedPnl('LONG', 100, 90, 2), -20);
  assert.equal(unrealizedPnl('SHORT', 100, 90, 2), 20);
  assert.equal(unrealizedPnl('SHORT', 100, 110, 2), -20);
});

test('ROE = uPnL / margin * 100 (fees excluded)', () => {
  assert.equal(roePct(20, 100), 20);
  assert.equal(roePct(-50, 100), -50);
  assert.equal(roePct(5, 0), 0);
});

test('fee is 0.04% of notional', () => {
  assert.equal(fee(10000), 4);
  assert.equal(fee(10), 0.004);
});

test('liquidation price long/short', () => {
  // 10x long @100: 100 * (1 - 0.1 + 0.005) = 90.5
  assert.equal(liquidationPrice('LONG', 100, 10), 90.5);
  assert.equal(liquidationPrice('SHORT', 100, 10), 109.5);
  // 1x long: liquidation just above zero (never negative)
  assert.equal(liquidationPrice('LONG', 100, 1), 0.5);
  assert.ok(liquidationPrice('LONG', 100, 50) > 97 && liquidationPrice('LONG', 100, 50) < 100);
});

test('computeOpen sizes the order, rounds qty down, includes fee', () => {
  const r = computeOpen({ side: 'LONG', price: 50000, leverage: 10, notionalUsd: 1000 });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.qty, 0.02);
  assert.equal(r.notional, 1000);
  assert.equal(r.margin, 100);
  assert.equal(r.openFee, 0.4);
  assert.equal(r.requiredBalance, 100.4);
  assert.equal(r.liqPrice, liquidationPrice('LONG', 50000, 10));
});

test('computeOpen rejects bad input', () => {
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 10, notionalUsd: 9 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 0, notionalUsd: 100 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 51, notionalUsd: 100 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 2.5, notionalUsd: 100 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 0, leverage: 2, notionalUsd: 100 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 2 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 2, notionalUsd: 100, qty: 1 }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 2, notionalUsd: NaN }).ok, false);
  assert.equal(computeOpen({ side: 'LONG', price: 100, leverage: 2, notionalUsd: 1e12 }).ok, false);
});

test('SL/TP side validation', () => {
  assert.equal(validateSlTp('LONG', 100, 90, 110), null);
  assert.equal(validateSlTp('SHORT', 100, 110, 90), null);
  assert.equal(validateSlTp('LONG', 100, null, null), null);
  assert.equal(validateSlTp('LONG', 100, undefined, undefined), null);
  assert.ok(validateSlTp('LONG', 100, 100, null));
  assert.ok(validateSlTp('LONG', 100, 110, null));
  assert.ok(validateSlTp('LONG', 100, null, 90));
  assert.ok(validateSlTp('SHORT', 100, 90, null));
  assert.ok(validateSlTp('SHORT', 100, null, 110));
  assert.ok(validateSlTp('LONG', 100, -5, null));
  assert.ok(validateSlTp('LONG', 100, NaN, null));
});

const long: PositionLike = { side: 'LONG', qty: 1, leverage: 10, entryPrice: 100, margin: 10, slPrice: 95, tpPrice: 120 };
const short: PositionLike = { side: 'SHORT', qty: 1, leverage: 10, entryPrice: 100, margin: 10, slPrice: 105, tpPrice: 80 };

test('triggers fill at the observed price, not the level', () => {
  assert.equal(evaluateTrigger(long, 100), null);
  assert.deepEqual(evaluateTrigger(long, 94), { reason: 'SL', exitPrice: 94 });
  assert.deepEqual(evaluateTrigger(long, 95), { reason: 'SL', exitPrice: 95 });
  assert.deepEqual(evaluateTrigger(long, 125), { reason: 'TP', exitPrice: 125 });
  assert.deepEqual(evaluateTrigger(short, 106), { reason: 'SL', exitPrice: 106 });
  assert.deepEqual(evaluateTrigger(short, 79), { reason: 'TP', exitPrice: 79 });
  assert.equal(evaluateTrigger(short, 100), null);
});

test('liquidation takes precedence over SL and fires at the liquidation threshold', () => {
  // liq long = 90.5: loss 9.5 == margin(10) - maintenance(0.5)
  assert.equal(evaluateTrigger({ ...long, slPrice: null }, 90.6), null);
  assert.deepEqual(evaluateTrigger(long, 90.6), { reason: 'SL', exitPrice: 90.6 });
  assert.deepEqual(evaluateTrigger(long, 90.5), { reason: 'LIQUIDATED', exitPrice: 90.5 });
  assert.deepEqual(evaluateTrigger(long, 80), { reason: 'LIQUIDATED', exitPrice: 80 });
  assert.deepEqual(evaluateTrigger(short, 109.5), { reason: 'LIQUIDATED', exitPrice: 109.5 });
});

test('invalid prices never trigger', () => {
  assert.equal(evaluateTrigger(long, 0), null);
  assert.equal(evaluateTrigger(long, NaN), null);
  assert.equal(evaluateTrigger(long, -1), null);
});

test('computeClose: long win nets both fees', () => {
  // qty 0.02 @50000 (notional 1000, margin 100, open fee 0.4); exit 55000 -> gross +100
  const p = { side: 'LONG' as const, qty: 0.02, leverage: 10, entryPrice: 50000, margin: 100, slPrice: null, tpPrice: null, openFee: 0.4 };
  const c = computeClose(p, 55000);
  assert.equal(c.grossPnl, 100);
  assert.equal(c.closeFee, 0.44);
  assert.equal(c.totalFee, 0.84);
  assert.equal(c.credit, 199.56);
  assert.equal(c.realizedPnl, 99.16); // 100 - 0.4 - 0.44
});

test('computeClose: short win and loss', () => {
  const p = { side: 'SHORT' as const, qty: 1, leverage: 10, entryPrice: 100, margin: 10, slPrice: null, tpPrice: null, openFee: 0.04 };
  const win = computeClose(p, 90);
  assert.equal(win.grossPnl, 10);
  assert.equal(win.closeFee, 0.036);
  assert.equal(win.realizedPnl, round8(10 - 0.04 - 0.036));
  const loss = computeClose(p, 104);
  assert.equal(loss.grossPnl, -4);
  assert.equal(loss.realizedPnl, round8(-4 - 0.04 - 0.0416));
});

test('computeClose: credit never negative (isolated margin), realized loss capped at margin + open fee', () => {
  const p = { side: 'LONG' as const, qty: 1, leverage: 10, entryPrice: 100, margin: 10, slPrice: null, tpPrice: null, openFee: 0.04 };
  const c = computeClose(p, 50); // gross -50, far beyond margin
  assert.equal(c.credit, 0);
  assert.equal(c.realizedPnl, -10.04);
});

test('equity = balance + margin + uPnL of open positions', () => {
  assert.equal(equity(9000, [{ margin: 500, uPnl: 25 }, { margin: 500, uPnl: -10 }]), 10015);
  assert.equal(equity(10000, []), 10000);
});
