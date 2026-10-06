import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPnl,
  formatSignedPct,
  liquidationPrice,
  notionalForBalancePct,
  parsePositive,
  percentFromPrice,
  previewOrder,
  priceFromPercent,
  roePct,
  unrealizedPnl,
  validateSlTp,
} from './paperMath';

test('liquidation and pnl mirror the server', () => {
  assert.equal(liquidationPrice('LONG', 100, 10), 90.5);
  assert.equal(liquidationPrice('SHORT', 100, 10), 109.5);
  assert.equal(unrealizedPnl('SHORT', 100, 90, 2), 20);
  assert.equal(roePct(20, 100), 20);
  assert.equal(roePct(1, 0), 0);
});

test('notionalForBalancePct keeps margin + fee within the budget', () => {
  const n = notionalForBalancePct(10000, 100, 10);
  assert.ok(n > 0);
  assert.ok(n / 10 + n * 0.0004 <= 10000);
  assert.equal(notionalForBalancePct(0, 50, 10), 0);
  assert.equal(notionalForBalancePct(1000, 0, 10), 0);
  assert.ok(notionalForBalancePct(1000, 25, 5) < notionalForBalancePct(1000, 50, 5));
});

test('percent <-> price conversions respect side', () => {
  assert.equal(priceFromPercent('LONG', 100, 'sl', 5), 95);
  assert.equal(priceFromPercent('LONG', 100, 'tp', 10), 110);
  assert.equal(priceFromPercent('SHORT', 100, 'sl', 5), 105);
  assert.equal(priceFromPercent('SHORT', 100, 'tp', 10), 90);
  assert.equal(priceFromPercent('LONG', 100, 'sl', 0), null);
  assert.equal(priceFromPercent('LONG', 100, 'sl', 150), null);
  assert.equal(priceFromPercent('LONG', 100, 'sl', NaN), null);
  assert.equal(percentFromPrice('LONG', 100, 'sl', 95), 5);
  assert.equal(percentFromPrice('SHORT', 100, 'tp', 90), 10);
});

test('validateSlTp', () => {
  assert.equal(validateSlTp('LONG', 100, 95, 110), null);
  assert.ok(validateSlTp('LONG', 100, 105, null));
  assert.ok(validateSlTp('SHORT', 100, null, 105));
});

test('previewOrder basics', () => {
  const p = previewOrder({ side: 'LONG', price: 50000, notional: 1000, leverage: 10, available: 10000, sl: 49000, tp: 52000, openPositions: 0 });
  assert.equal(p.ok, true);
  assert.equal(p.margin, 100);
  assert.equal(p.openFee, 0.4);
  assert.equal(p.required, 100.4);
  assert.equal(p.liqPrice, 45250);
  // SL: gross -20, fees 0.4 + 0.392
  assert.equal(p.maxLoss, 20.792);
  // TP: gross +40, fees 0.4 + 0.416
  assert.equal(p.maxProfit, 39.184);
  assert.ok(p.riskReward !== null && p.riskReward > 1.8 && p.riskReward < 1.9);
});

test('previewOrder blocks bad orders and never throws', () => {
  const base = { side: 'LONG' as const, price: 100, notional: 1000, leverage: 10, available: 10000, sl: null, tp: null, openPositions: 0 };
  assert.ok(previewOrder({ ...base, price: null }).error);
  assert.ok(previewOrder({ ...base, notional: 0 }).error);
  assert.ok(previewOrder({ ...base, notional: NaN }).error);
  assert.ok(previewOrder({ ...base, notional: 5 }).error?.includes('Minimum'));
  assert.ok(previewOrder({ ...base, available: 10 }).error?.includes('balance'));
  assert.ok(previewOrder({ ...base, openPositions: 5 }).error?.includes('at most'));
  assert.ok(previewOrder({ ...base, sl: 110 }).error?.includes('Stop loss'));
  assert.equal(previewOrder({ ...base, sl: 90 }).riskReward, null);
});

test('formatters and parsers', () => {
  assert.equal(parsePositive(' 1,234.5 '), 1234.5);
  assert.equal(parsePositive(''), null);
  assert.equal(parsePositive('-3'), null);
  assert.equal(parsePositive('abc'), null);
  assert.equal(formatPnl(12.345), '+$12.35');
  assert.equal(formatPnl(-5), '-$5.00');
  assert.equal(formatPnl(null), '—');
  assert.equal(formatSignedPct(1.5), '+1.50%');
});
