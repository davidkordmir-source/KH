import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketsService, MARKET_INSTRUMENTS, parseYahooChart, parseStooqGold, MARKET_HOSTS } from '../server/markets.mjs';

const fixture = (values = [100, null, 110]) => ({ chart: { error: null, result: [{ meta: { regularMarketPrice: 112, regularMarketTime: 1761231600, previousClose: 100 }, timestamp: [1760972400, 1761058800, 1761145200], indicators: { quote: [{ close: values }] } }] } });
const gold = 'Date,Open,High,Low,Close\n2026-10-20,4350,4360,4320,4345.2\n2026-10-21,4345,4370,4330,4360.5\n2026-10-22,4360,4400,4350,4391.8\n';

test('Yahoo prices use source timestamps and skip missing values rather than inventing zeroes', () => {
  const result = parseYahooChart(fixture(), MARKET_INSTRUMENTS[0]);
  assert.equal(result.value, 112);
  assert.equal(result.change, 12);
  assert.equal(result.changePercent, 12);
  assert.equal(result.kind, 'futures');
  assert.equal(result.unit, 'دلار / بشکه');
  assert.equal(result.asOf, new Date(1761231600 * 1000).toISOString());
  assert.equal(result.series.length, 3);
  assert.ok(result.series.every(point => point.value > 0));
  assert.equal(result.series.at(-1).value, 112);
  assert.throws(() => parseYahooChart({ chart: { error: { code: 'Not Found' } } }, MARKET_INSTRUMENTS[0]));
  assert.throws(() => parseYahooChart(fixture([null, null, null]), MARKET_INSTRUMENTS[0]));
});

test('spot gold parses actual daily CSV closes and remains distinct from futures', () => {
  const result = parseStooqGold(gold);
  assert.equal(result.symbol, 'XAUUSD');
  assert.equal(result.kind, 'spot');
  assert.equal(result.frequency, 'daily-close');
  assert.equal(result.value, 4391.8);
  assert.equal(result.asOf, '2026-10-22T00:00:00.000Z');
  assert.equal(result.series.length, 3);
  assert.ok(Math.abs(result.change - 31.3) < 0.00001);
  assert.throws(() => parseStooqGold('No data'));
  assert.throws(() => parseStooqGold('Date,Close\n2026-02-31,100\n2026-10-23,NaN'));
});

test('service requests only fixed financial hosts and caches concurrent real provider reads', async () => {
  let calls = 0;
  let now = Date.parse('2026-10-23T12:00:00Z');
  const service = createMarketsService({ now: () => now, fetcher: async (url, options) => {
    calls++;
    assert.ok(MARKET_HOSTS.includes(new URL(url).hostname));
    assert.deepEqual(options.allowedHosts, MARKET_HOSTS);
    assert.equal(options.timeoutMs, 12_000);
    return new URL(url).hostname === 'stooq.com' ? gold : JSON.stringify(fixture());
  } });
  const [first, simultaneous] = await Promise.all([service.getMarkets(), service.getMarkets()]);
  assert.equal(calls, 6);
  assert.equal(first.quotes.length, 5);
  assert.equal(first.errors.length, 0);
  assert.equal(simultaneous.quotes[1].kind, 'spot');
  assert.equal((await service.getMarkets()).cached, true);
  assert.equal(calls, 6);
  now += 300_001;
  await service.getMarkets();
  assert.equal(calls, 12);
});

test('provider failure has no fabricated price or chart, and preserves prior data with a stale label', async () => {
  let failed = true;
  const service = createMarketsService({ fetcher: async url => {
    if (failed) throw new Error('Network unavailable');
    return new URL(url).hostname === 'stooq.com' ? gold : JSON.stringify(fixture());
  } });
  const missing = await service.getMarkets();
  assert.equal(missing.errors.length, 5);
  assert.ok(missing.quotes.every(quote => quote.value === null && quote.asOf === null && quote.series.length === 0));
  failed = false;
  const successful = await service.getMarkets({ force: true });
  assert.equal(successful.errors.length, 0);
  const oldTimestamp = successful.quotes[0].asOf;
  failed = true;
  const stale = await service.getMarkets({ force: true });
  assert.equal(stale.quotes[0].stale, true);
  assert.equal(stale.quotes[0].value, 112);
  assert.equal(stale.quotes[0].asOf, oldTimestamp);
  assert.equal(stale.errors.length, 5);
});

test('public historical fallbacks keep spot, futures and monthly average identities explicit', async () => {
  const service = createMarketsService({ fetcher: async url => {
    if (new URL(url).hostname !== 'raw.githubusercontent.com') throw new Error('Primary unavailable');
    if (url.includes('s-and-p-500')) return 'Date,SP500,Other\n2026-08-01,7711.32,0\n2026-09-01,7669.41,0';
    if (url.includes('gold-prices')) return 'Date,Price\n2026-08,4411\n2026-09,4319';
    return 'Date,Price\n2026-10-19,118.82\n2026-10-20,115.22';
  } });
  const result = await service.getMarkets();
  const [brent, spotGold, sp500, nasdaq] = result.quotes;
  assert.equal(brent.symbol, 'BRENT-SPOT');
  assert.equal(brent.requestedSymbol, 'BZ=F');
  assert.equal(brent.kind, 'spot');
  assert.equal(brent.value, 115.22);
  assert.equal(brent.frequency, 'daily-close');
  assert.equal(spotGold.frequency, 'monthly-average');
  assert.equal(spotGold.timestampPrecision, 'month');
  assert.equal(spotGold.asOf, '2026-09-01T00:00:00.000Z');
  assert.equal(spotGold.value, 4319);
  assert.equal(sp500.symbol, '^GSPC');
  assert.equal(sp500.frequency, 'monthly');
  assert.equal(nasdaq.value, null);
  assert.equal(result.errors.length, 2);
  assert.ok(brent.fallback && spotGold.fallback && sp500.fallback);
});

test('a current gold quote never turns monthly history into a daily gain or a current-price chart', async () => {
  const service = createMarketsService({ fetcher: async url => {
    const host = new URL(url).hostname;
    if (host === 'api.gold-api.com') return JSON.stringify({ symbol: 'XAU', price: 4567.89, updatedAt: '2026-10-23T15:30:00Z' });
    if (host === 'stooq.com') throw new Error('Daily history unavailable');
    if (host === 'raw.githubusercontent.com') return 'Date,Price\n2026-08,4411\n2026-09,4319';
    return JSON.stringify(fixture());
  } });
  const result = await service.getMarkets();
  const quote = result.quotes[1];
  assert.equal(quote.value, 4567.89);
  assert.equal(quote.provider, 'Gold API');
  assert.equal(quote.asOf, '2026-10-23T15:30:00.000Z');
  assert.equal(quote.change, null);
  assert.equal(quote.changePercent, null);
  assert.equal(quote.frequency, 'quote');
  assert.equal(quote.historyFrequency, 'monthly-average');
  assert.equal(quote.series.length, 2);
  assert.equal(quote.series.at(-1).value, 4319);
  assert.equal(quote.historyProvider, 'World Bank / DataHub');
  assert.equal(result.errors.length, 0);
});
