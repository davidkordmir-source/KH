import { safeFetch } from './network.mjs';

export const MARKET_HOSTS = Object.freeze(['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'stooq.com', 'raw.githubusercontent.com', 'api.gold-api.com']);
export const MARKET_INSTRUMENTS = Object.freeze([
  { symbol: 'BZ=F', nameFa: 'نفت برنت ـ قرارداد آتی', unit: 'دلار / بشکه', currency: 'USD', kind: 'futures', provider: 'Yahoo Finance', providerUrl: 'https://finance.yahoo.com/quote/BZ%3DF/' },
  { symbol: 'XAUUSD', nameFa: 'طلای جهانی ـ نقدی', unit: 'دلار / اونس تروا', currency: 'USD', kind: 'spot', provider: 'Stooq', providerUrl: 'https://stooq.com/q/?s=xauusd' },
  { symbol: '^GSPC', nameFa: 'بورس آمریکا ـ S&P 500', unit: 'واحد شاخص', currency: null, kind: 'index', provider: 'Yahoo Finance', providerUrl: 'https://finance.yahoo.com/quote/%5EGSPC/' },
  { symbol: '^IXIC', nameFa: 'شاخص نزدک', unit: 'واحد شاخص', currency: null, kind: 'index', provider: 'Yahoo Finance', providerUrl: 'https://finance.yahoo.com/quote/%5EIXIC/' },
  { symbol: '^DJI', nameFa: 'شاخص داوجونز', unit: 'واحد شاخص', currency: null, kind: 'index', provider: 'Yahoo Finance', providerUrl: 'https://finance.yahoo.com/quote/%5EDJI/' },
]);

const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 253402300800;
const unavailable = instrument => ({ ...instrument, value: null, change: null, changePercent: null, asOf: null, delayed: true, stale: false, series: [] });
const OPEN_DATA_FALLBACKS = Object.freeze({
  'BZ=F': { url: 'https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-daily.csv', column: 'Price', symbol: 'BRENT-SPOT', nameFa: 'نفت برنت ـ نقدی روزانه', provider: 'EIA / DataHub', providerUrl: 'https://github.com/datasets/oil-prices', kind: 'spot', frequency: 'daily-close', precision: 'day' },
  XAUUSD: { url: 'https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv', column: 'Price', nameFa: 'طلای جهانی ـ میانگین ماهانه', provider: 'World Bank / DataHub', providerUrl: 'https://github.com/datasets/gold-prices', kind: 'spot', frequency: 'monthly-average', precision: 'month' },
  '^GSPC': { url: 'https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv', column: 'SP500', nameFa: 'S&P 500 ـ دادهٔ ماهانه', provider: 'Shiller / FRED / DataHub', providerUrl: 'https://github.com/datasets/s-and-p-500', kind: 'index', frequency: 'monthly', precision: 'month' },
});

function changes(value, previous) {
  return validPrice(previous) ? { change: value - previous, changePercent: ((value - previous) / previous) * 100 } : { change: null, changePercent: null };
}

export function parseYahooChart(payload, instrument) {
  const document = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const result = document?.chart?.result?.[0];
  if (document?.chart?.error || !result || !Array.isArray(result.timestamp)) throw new Error('پاسخ دادهٔ بازار معتبر نیست.');
  const close = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(close)) throw new Error('سری قیمت در پاسخ منبع وجود ندارد.');
  const series = result.timestamp.flatMap((time, index) => validTime(time) && validPrice(close[index]) ? [{ time: new Date(time * 1000).toISOString(), value: close[index] }] : []);
  if (!series.length) throw new Error('منبع، قیمت معتبر برای این نماد برنگرداند.');
  const meta = result.meta || {};
  if (meta.symbol && meta.symbol !== instrument.symbol) throw new Error('نماد پاسخ بازار با نماد درخواستی یکسان نیست.');
  const last = series.at(-1);
  const value = validPrice(meta.regularMarketPrice) ? meta.regularMarketPrice : last.value;
  const asOf = validTime(meta.regularMarketTime) && validPrice(meta.regularMarketPrice) ? new Date(meta.regularMarketTime * 1000).toISOString() : last.time;
  const previous = validPrice(meta.previousClose) ? meta.previousClose : validPrice(meta.regularMarketPreviousClose) ? meta.regularMarketPreviousClose : series.at(-2)?.value;
  if (Date.parse(asOf) >= Date.parse(last.time)) {
    if (asOf.slice(0, 10) === last.time.slice(0, 10)) series[series.length - 1] = { time: asOf, value };
    else series.push({ time: asOf, value });
  }
  const unique = [...new Map(series.map(point => [point.time, point])).values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-100);
  return { ...instrument, value, ...changes(value, previous), asOf, delayed: true, stale: false, series: unique, frequency: 'daily', timestampPrecision: 'second', provider: 'Yahoo Finance' };
}

export function parseStooqGold(csv, instrument = MARKET_INSTRUMENTS[1]) {
  const lines = String(csv).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const columns = lines.shift()?.split(',').map(value => value.trim().toLowerCase());
  const dateColumn = columns?.indexOf('date') ?? -1;
  const closeColumn = columns?.indexOf('close') ?? -1;
  if (dateColumn < 0 || closeColumn < 0) throw new Error('منبع، تاریخچهٔ معتبر طلای نقدی برنگرداند.');
  const series = lines.flatMap(line => {
    const row = line.split(',');
    const day = row[dateColumn]?.trim();
    const value = Number(row[closeColumn]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !validPrice(value)) return [];
    const time = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== day) return [];
    return [{ time: time.toISOString(), value }];
  });
  const unique = [...new Map(series.map(point => [point.time, point])).values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-100);
  if (!unique.length) throw new Error('قیمت پایانی معتبر طلا در منبع پیدا نشد.');
  const last = unique.at(-1);
  return { ...instrument, value: last.value, ...changes(last.value, unique.at(-2)?.value), asOf: last.time, delayed: true, stale: false, series: unique, frequency: 'daily-close', timestampPrecision: 'day', provider: 'Stooq' };
}

export function parseGoldApi(payload, instrument = MARKET_INSTRUMENTS[1]) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const timestamp = new Date(data?.updatedAt);
  if (data?.symbol !== 'XAU' || !validPrice(data?.price) || !Number.isFinite(timestamp.getTime())) throw new Error('پاسخ منبع طلای نقدی معتبر نیست.');
  return {
    ...instrument, value: data.price, change: null, changePercent: null,
    asOf: timestamp.toISOString(), delayed: true, stale: false, series: [],
    frequency: 'quote', timestampPrecision: 'second', provider: 'Gold API', providerUrl: 'https://gold-api.com/',
  };
}

export function parseOpenDataset(csv, instrument, configuration) {
  const rows = String(csv).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = rows.shift()?.split(',').map(value => value.trim());
  const dateIndex = header?.indexOf('Date') ?? -1;
  const valueIndex = header?.indexOf(configuration.column) ?? -1;
  if (dateIndex < 0 || valueIndex < 0) throw new Error('ستون‌های دادهٔ تاریخی بازار معتبر نیست.');
  const points = rows.flatMap(row => {
    const columns = row.split(',');
    let day = columns[dateIndex]?.trim();
    if (/^\d{4}-\d{2}$/.test(day || '')) day += '-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return [];
    const time = new Date(`${day}T00:00:00.000Z`);
    const value = Number(columns[valueIndex]);
    if (!validPrice(value) || !Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== day) return [];
    return [{ time: time.toISOString(), value }];
  });
  const series = [...new Map(points.map(point => [point.time, point])).values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(configuration.precision === 'month' ? -36 : -100);
  if (!series.length) throw new Error('دادهٔ معتبر تاریخی برای این بازار پیدا نشد.');
  const last = series.at(-1);
  return {
    ...instrument, requestedSymbol: instrument.symbol, symbol: configuration.symbol || instrument.symbol, nameFa: configuration.nameFa,
    kind: configuration.kind, provider: configuration.provider, providerUrl: configuration.providerUrl,
    frequency: configuration.frequency, timestampPrecision: configuration.precision,
    value: last.value, ...changes(last.value, series.at(-2)?.value), asOf: last.time,
    series, delayed: true, stale: false, fallback: true,
    noteFa: 'منبع معمول در دسترس نبود؛ دادهٔ تاریخی جایگزین با بسامد مشخص‌شده نمایش داده می‌شود و قیمت لحظه‌ای نیست.',
  };
}

export function createMarketsService({ fetcher = safeFetch, now = () => Date.now(), cacheMs = 300_000 } = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  const previousQuotes = new Map();

  async function fetchPrimaryQuote(instrument) {
    const options = { allowedHosts: MARKET_HOSTS, maxBytes: 1_000_000, timeoutMs: 12_000 };
    if (instrument.symbol === 'XAUUSD') {
      let spot;
      try { spot = parseGoldApi(await fetcher('https://api.gold-api.com/price/XAU', { ...options, headers: { Accept: 'application/json' } }), instrument); }
      catch { /* A public spot quote is optional; daily/historical sources remain available. */ }
      const end = new Date(now());
      const start = new Date(now() - 100 * 86_400_000);
      const day = value => value.toISOString().slice(0, 10).replaceAll('-', '');
      const url = new URL('https://stooq.com/q/d/l/');
      url.search = new URLSearchParams({ s: 'xauusd', i: 'd', d1: day(start), d2: day(end) });
      let history;
      try { history = parseStooqGold(await fetcher(url.href, { ...options, headers: { Accept: 'text/csv' } }), instrument); }
      catch (error) {
        if (!spot) throw error;
        try {
          const fallback = OPEN_DATA_FALLBACKS.XAUUSD;
          history = parseOpenDataset(await fetcher(fallback.url, { ...options, headers: { Accept: 'text/csv' } }), instrument, fallback);
        } catch { /* A valid current quote must not be replaced by fabricated history. */ }
      }
      if (!spot) return history;
      return {
        ...spot, series: history?.series || [], historyFrequency: history?.frequency || null,
        historyProvider: history?.provider || null, historyProviderUrl: history?.providerUrl || null,
        historyAsOf: history?.asOf || null,
        noteFa: history?.frequency?.startsWith('monthly')
          ? 'قیمت نقدی از Gold API است؛ نمودار، میانگین ماهانهٔ بانک جهانی را نشان می‌دهد و نمودار لحظه‌ای نیست.'
          : history ? 'قیمت نقدی و تاریخچهٔ روزانه از دو منبع جدا هستند؛ زمان و منبع هرکدام نوشته شده است.' : 'قیمت نقدی معتبر دریافت شد؛ تاریخچهٔ معتبر برای رسم نمودار در دسترس نیست.',
      };
    }
    let lastError;
    for (const hostname of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const url = new URL(`https://${hostname}/v8/finance/chart/${encodeURIComponent(instrument.symbol)}`);
        url.search = new URLSearchParams({ interval: '1d', range: '3mo', events: 'history' });
        return parseYahooChart(await fetcher(url.href, { ...options, headers: { Accept: 'application/json' } }), instrument);
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }

  async function fetchQuote(instrument) {
    try { return await fetchPrimaryQuote(instrument); }
    catch (error) {
      const fallback = OPEN_DATA_FALLBACKS[instrument.symbol];
      if (!fallback) throw error;
      const csv = await fetcher(fallback.url, { allowedHosts: MARKET_HOSTS, maxBytes: 1_000_000, timeoutMs: 12_000, headers: { Accept: 'text/csv' } });
      return parseOpenDataset(csv, instrument, fallback);
    }
  }

  async function getMarkets({ force = false } = {}) {
    if (!force && cached && now() < expiresAt) return { ...structuredClone(cached), cached: true };
    if (pending) return pending;
    pending = (async () => {
      const errors = [];
      const quotes = await Promise.all(MARKET_INSTRUMENTS.map(async instrument => {
        try {
          const quote = await fetchQuote(instrument);
          previousQuotes.set(instrument.symbol, quote);
          return quote;
        } catch {
          errors.push({ symbol: instrument.symbol, message: 'دریافت از منبع بازار ممکن نشد؛ دسترسی شبکه، محدودیت منبع و زمان بازار را بررسی کنید.' });
          const previous = previousQuotes.get(instrument.symbol);
          return previous ? { ...structuredClone(previous), stale: true } : unavailable(instrument);
        }
      }));
      cached = { updatedAt: new Date(now()).toISOString(), quotes, errors, cached: false };
      expiresAt = now() + (errors.length === MARKET_INSTRUMENTS.length ? Math.min(cacheMs, 30_000) : cacheMs);
      return structuredClone(cached);
    })().finally(() => { pending = null; });
    return pending;
  }
  return { getMarkets };
}

const service = createMarketsService();
export const getMarkets = options => service.getMarkets(options);
