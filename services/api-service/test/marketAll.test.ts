import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllUsdtTickers, querySymbols, computeMovers, parseFearGreed, parseGlobal, SymbolRow } from '../src/marketAllParse';

const row = (symbol: string, over: Record<string, string> = {}) => ({
  symbol,
  lastPrice: '10',
  priceChangePercent: '1.5',
  highPrice: '11',
  lowPrice: '9',
  volume: '100',
  quoteVolume: '1000',
  ...over,
});

test('parseAllUsdtTickers filters pairs/leveraged/stables/zero volume/invalid', () => {
  const rows = parseAllUsdtTickers([
    row('BTCUSDT'), row('ETHUSDT'), row('BTCUPUSDT'), row('BTCDOWNUSDT'), row('ETHBULLUSDT'),
    row('JUPUSDT'), row('SYRUPUSDT'), row('USDCUSDT'), row('FDUSDUSDT'), row('BTCEUR'), row('ETHBTC'),
    row('ZEROUSDT', { volume: '0' }), row('NOQVUSDT', { quoteVolume: '0' }), row('BADUSDT', { lastPrice: 'x' }),
    row('NEGUSDT', { lastPrice: '-1' }), null, { symbol: 5 },
  ]);
  assert.deepEqual(rows.map((r) => r.symbol).sort(), ['BTCUSDT', 'ETHUSDT', 'JUPUSDT', 'SYRUPUSDT']);
  assert.equal(rows[0].quote, 'USDT');
  assert.equal(rows[0].base, 'BTC');
  assert.deepEqual(parseAllUsdtTickers({}), []);
});

const mk = (base: string, changePct: number, quoteVolume: number): SymbolRow => ({
  symbol: base + 'USDT', base, quote: 'USDT', price: 1, changePct, high: 1, low: 1, volume: 1, quoteVolume,
});

test('querySymbols sorts, searches, limits', () => {
  const rows = [mk('AAA', 5, 100), mk('BBB', -7, 300), mk('CCC', 1, 200)];
  assert.deepEqual(querySymbols(rows, { sort: 'volume', limit: 10 }).symbols.map((r) => r.base), ['BBB', 'CCC', 'AAA']);
  assert.deepEqual(querySymbols(rows, { sort: 'gainers', limit: 1 }).symbols.map((r) => r.base), ['AAA']);
  assert.deepEqual(querySymbols(rows, { sort: 'losers', limit: 1 }).symbols.map((r) => r.base), ['BBB']);
  assert.deepEqual(querySymbols(rows, { sort: 'name', limit: 10 }).symbols.map((r) => r.base), ['AAA', 'BBB', 'CCC']);
  assert.equal(querySymbols(rows, { sort: 'name', q: 'cc', limit: 10 }).count, 1);
});

test('computeMovers applies $5M liquidity floor for gainers/losers', () => {
  const rows = [mk('HOT', 90, 1_000), mk('UP', 10, 6_000_000), mk('DN', -8, 9_000_000), mk('BIG', 0, 99_000_000)];
  const m = computeMovers(rows);
  assert.deepEqual(m.gainers.map((r) => r.base), ['UP', 'BIG', 'DN']);
  assert.deepEqual(m.losers.map((r) => r.base), ['DN', 'BIG', 'UP']);
  assert.equal(m.volume[0].base, 'BIG');
});

test('parseFearGreed / parseGlobal', () => {
  const fg = parseFearGreed({ data: [{ value: '23', value_classification: 'Extreme Fear', timestamp: '1760000000' }] });
  assert.equal(fg?.value, 23);
  assert.equal(fg?.label, 'Extreme Fear');
  assert.equal(fg?.updatedAt, new Date(1760000000 * 1000).toISOString());
  assert.equal(parseFearGreed({ data: [] }), null);
  assert.equal(parseFearGreed({ data: [{ value: '150', value_classification: 'x', timestamp: '1' }] }), null);
  const g = parseGlobal({
    data: { total_market_cap: { usd: 3.5e12 }, market_cap_percentage: { btc: 57.1 }, market_cap_change_percentage_24h_usd: -1.2, active_cryptocurrencies: 17000 },
  });
  assert.deepEqual(g, { totalMarketCapUsd: 3.5e12, btcDominancePct: 57.1, marketCapChangePct24h: -1.2, activeCryptos: 17000 });
  assert.equal(parseGlobal({ status: { error_code: 429 } }), null);
  assert.equal(parseGlobal(null), null);
});
