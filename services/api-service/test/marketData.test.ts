import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSignals, parseBinanceTickers, toNum } from '../src/marketData';

test('toNum rejects junk', () => {
  assert.equal(toNum('1.5'), 1.5);
  assert.equal(toNum(''), null);
  assert.equal(toNum('abc'), null);
  assert.equal(toNum(NaN), null);
  assert.equal(toNum(null), null);
});

test('parseBinanceTickers parses strings, drops invalid rows, keeps requested order', () => {
  const rows = [
    { symbol: 'ETHUSDT', lastPrice: '2000.5', priceChangePercent: '-1.2', highPrice: '2100', lowPrice: '1900', volume: '10' },
    { symbol: 'BTCUSDT', lastPrice: '85000', priceChangePercent: '0.5', highPrice: '86000', lowPrice: '84000', volume: '5' },
    { symbol: 'SOLUSDT', lastPrice: 'nope', priceChangePercent: '1', highPrice: '1', lowPrice: '1', volume: '1' },
    { symbol: 'FOOUSDT', lastPrice: '1', priceChangePercent: '1', highPrice: '1', lowPrice: '1', volume: '1' },
  ];
  const t = parseBinanceTickers(rows);
  assert.deepEqual(t.map((x) => x.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.equal(t[1].changePct, -1.2);
  assert.deepEqual(parseBinanceTickers({ code: -1 }), []);
});

test('mapSignals computes age/stale and normalizes actions', () => {
  const now = Date.parse('2026-01-06T08:00:00Z');
  const s = mapSignals(
    {
      signals: [
        { _id: 'a', symbol: 'btc', action: 'sell', price: 1, timestamp: '2026-01-05T06:00:00Z', confidence: 50 },
        { _id: 'b', symbol: 'ETH', action: 'weird', timestamp: '2026-01-06T07:00:00Z' },
        { _id: 'c', symbol: 'X', action: 'BUY' },
      ],
    },
    now
  );
  assert.equal(s.length, 2);
  assert.equal(s[0].id, 'b');
  assert.equal(s[0].action, 'NEUTRAL');
  assert.equal(s[0].ageSeconds, 3600);
  assert.equal(s[0].stale, false);
  assert.equal(s[1].action, 'SELL');
  assert.equal(s[1].symbol, 'BTC');
  assert.equal(s[1].stale, true);
  assert.deepEqual(mapSignals(null, now), []);
});
