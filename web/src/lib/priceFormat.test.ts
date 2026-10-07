import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompactNumber, formatPct, formatPriceSmart, rangePosition } from './priceFormat';

test('formatPriceSmart handles large, mid, small and tiny prices', () => {
  assert.equal(formatPriceSmart(67234.5), '67,234.50');
  assert.equal(formatPriceSmart(12.3456789), '12.3457');
  assert.equal(formatPriceSmart(1), '1.00');
  assert.equal(formatPriceSmart(0.0512), '0.0512');
  assert.equal(formatPriceSmart(0.00001234), '0.00001234');
  assert.equal(formatPriceSmart(0.000000123456), '0.0000001235');
  assert.equal(formatPriceSmart(0), '0.00');
});

test('formatPriceSmart is safe on bad input', () => {
  assert.equal(formatPriceSmart(NaN), '—');
  assert.equal(formatPriceSmart(undefined), '—');
  assert.equal(formatPriceSmart(Infinity), '—');
});

test('formatCompactNumber uses K/M/B/T', () => {
  assert.equal(formatCompactNumber(999), '999.00');
  assert.equal(formatCompactNumber(1234), '1.23K');
  assert.equal(formatCompactNumber(5_500_000), '5.50M');
  assert.equal(formatCompactNumber(2_340_000_000), '2.34B');
  assert.equal(formatCompactNumber(3.1e12), '3.10T');
  assert.equal(formatCompactNumber(null), '—');
});

test('formatPct signs and missing values', () => {
  assert.equal(formatPct(1.234), '+1.23%');
  assert.equal(formatPct(-0.4), '-0.40%');
  assert.equal(formatPct(0), '0.00%');
  assert.equal(formatPct(undefined), '—');
});

test('rangePosition clamps and handles degenerate ranges', () => {
  assert.equal(rangePosition(5, 0, 10), 0.5);
  assert.equal(rangePosition(-1, 0, 10), 0);
  assert.equal(rangePosition(20, 0, 10), 1);
  assert.equal(rangePosition(5, 10, 10), 0.5);
  assert.equal(rangePosition(NaN, 0, 10), 0.5);
});
