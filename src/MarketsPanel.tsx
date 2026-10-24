import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import './markets.css';

type Point = { time: string; value: number };
type Quote = {
  symbol: string; nameFa: string; unit: string; currency: string | null; kind: string;
  value: number | null; change: number | null; changePercent: number | null;
  asOf: string | null; delayed: boolean; stale: boolean; provider: string; providerUrl: string;
  frequency?: string; series: Point[]; fallback?: boolean; noteFa?: string; requestedSymbol?: string;
  historyFrequency?: string | null; historyProvider?: string | null; historyProviderUrl?: string | null; historyAsOf?: string | null;
};
type Markets = { updatedAt: string; quotes: Quote[]; errors: { symbol: string; message: string }[]; cached: boolean };
const number = (value: number, digits = 2) => value.toLocaleString('fa-IR', { maximumFractionDigits: digits });
const date = (value: string, full = false) => new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: full ? 'numeric' : undefined, month: 'short', day: 'numeric', hour: full ? '2-digit' : undefined, minute: full ? '2-digit' : undefined }).format(new Date(value));
const month = (value: string) => `${new Intl.DateTimeFormat('fa-IR-u-ca-gregory', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(new Date(value))} میلادی`;
const isMonthly = (quote: Quote) => quote.frequency?.startsWith('monthly');
const monthlyHistory = (quote: Quote) => (quote.historyFrequency || quote.frequency)?.startsWith('monthly');
const periodDate = (quote: Quote, value: string) => monthlyHistory(quote) ? month(value) : date(value);

function PriceChart({ quote }: { quote: Quote }) {
  const [selected, setSelected] = useState<number | null>(null);
  const points = quote.series;
  if (points.length < 2) return <div className="market-chart-empty">برای نمودار، دست‌کم دو قیمت معتبر از منبع لازم است.</div>;
  const width = 640, height = 220, left = 75, right = 20, top = 27, bottom = 35;
  const low = Math.min(...points.map(point => point.value));
  const high = Math.max(...points.map(point => point.value));
  const padding = (high - low) * 0.15 || Math.abs(high) * 0.005 || 1;
  const min = low - padding, max = high + padding;
  const x = (index: number) => left + index / (points.length - 1) * (width - left - right);
  const y = (value: number) => top + (1 - (value - min) / (max - min)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const active = selected === null ? null : points[Math.min(selected, points.length - 1)];
  const gain = points.at(-1)!.value >= points[0].value;
  return <figure className={`market-chart ${gain ? 'positive' : 'negative'}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`نمودار قیمت واقعی ${quote.nameFa} از ${date(points[0].time)} تا ${date(points.at(-1)!.time)}`} onPointerLeave={() => setSelected(null)} onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const coordinate = (event.clientX - bounds.left) / bounds.width * width;
      setSelected(Math.max(0, Math.min(points.length - 1, Math.round((coordinate - left) / (width - left - right) * (points.length - 1)))));
    }}>
      {[min, (min + max) / 2, max].map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="market-gridline" /><text x={left - 10} y={y(value) + 4} textAnchor="end" className="market-axis-label">{number(value)}</text></g>)}
      <path d={path} className="market-series-line" />
      {active && selected !== null && <g><line x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} className="market-crosshair" /><circle cx={x(selected)} cy={y(active.value)} r="5" className="market-point" /></g>}
      <text x={left} y={height - 10} textAnchor="start" className="market-axis-label">{periodDate(quote, points[0].time)}</text>
      <text x={width - right} y={height - 10} textAnchor="end" className="market-axis-label">{periodDate(quote, points.at(-1)!.time)}</text>
    </svg>
    <figcaption>{active ? <><strong>{number(active.value)} {quote.unit}</strong><span>{periodDate(quote, active.time)}</span></> : <><span>{monthlyHistory(quote) ? 'میانگین‌های ماهانه' : 'نقاط روزانه'} از {quote.historyProvider || quote.provider}</span><span>{number(points.length, 0)} نقطه</span></>}</figcaption>
  </figure>;
}

export default function MarketsPanel() {
  const [data, setData] = useState<Markets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/markets${request ? '?refresh=1' : ''}`, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'دریافت داده‌های بازار ممکن نشد.');
      if (!Array.isArray(result.quotes)) throw new Error('پاسخ بازار معتبر نیست.');
      setData(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);

  return <section className="markets-section" aria-label="بازارهای جهانی">
    <div className="markets-heading"><div><h2><ChartNoAxesCombined size={23} /> نبض بازارهای جهانی</h2><p>نمودار از قیمت‌های منبع ساخته می‌شود. داده‌ها ممکن است با تأخیر یا مربوط به پایان روز معاملاتی باشند.</p></div><button className="secondary-button" disabled={loading} onClick={() => setRequest(value => value + 1)}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'در حال دریافت…' : 'بررسی دوباره'}</button></div>
    <div className="market-disclosure"><AlertCircle size={18} /><p>نوع قیمت روی هر کارت مشخص است: آتی، نقدی یا میانگین ماهانه. اگر منبع روزانه در دسترس نباشد، دادهٔ تاریخی جایگزین با برچسب صریح نمایش داده می‌شود. شاخص‌های آمریکا قیمت یک سهم یا کل بورس نیستند.</p></div>
    {error && <div className="market-error" role="alert">{error}</div>}
    {loading && !data && <div className="market-loading"><LoaderCircle size={25} className="spin" /><span>دریافت قیمت و تاریخچه از منابع بازار…</span></div>}
    {data && <>
      <div className="market-updated">آخرین بررسی: {date(data.updatedAt, true)}{data.cached && <span> · دادهٔ ذخیره‌شدهٔ دریافت اخیر</span>}</div>
      <div className="market-cards">{data.quotes.map(quote => {
        const failure = data.errors.find(item => item.symbol === (quote.requestedSymbol || quote.symbol));
        return <article className="market-card" key={quote.symbol}>
          <div className="market-card-title"><div><h3>{quote.nameFa}</h3><span dir="ltr">{quote.symbol}</span></div><span className={`market-data-badge ${quote.stale || quote.fallback ? 'is-stale' : ''}`}>{quote.stale ? 'دادهٔ قبلی؛ دریافت تازه ناموفق' : quote.frequency === 'monthly-average' ? 'میانگین ماهانه' : quote.frequency === 'monthly' ? 'تاریخچهٔ ماهانه' : quote.frequency === 'daily-close' ? 'پایان روزانه' : 'با تأخیر'}</span></div>
          <div className="market-price"><strong>{quote.value === null ? 'در دسترس نیست' : number(quote.value)}</strong>{quote.value !== null && <span>{quote.unit}</span>}</div>
          {quote.changePercent !== null && <div className={`market-change ${quote.changePercent >= 0 ? 'positive' : 'negative'}`}>{quote.changePercent >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}<span dir="ltr">{quote.changePercent >= 0 ? '+' : '−'}{number(Math.abs(quote.changePercent))}%</span><small>نسبت به قیمت پیشین</small></div>}
          {quote.series.length ? <PriceChart quote={quote} /> : <div className="market-chart-empty"><ChartNoAxesCombined size={30} /><p>نمودار بدون دادهٔ واقعی نمایش داده نمی‌شود.</p></div>}
          {failure && <p className="market-source-error"><AlertCircle size={14} />{failure.message}</p>}
          {quote.noteFa && <p className="market-source-error"><AlertCircle size={14} />{quote.noteFa}</p>}
          {quote.historyProviderUrl && <p className="market-history-source"><a href={quote.historyProviderUrl} target="_blank" rel="noreferrer">منبع نمودار: {quote.historyProvider}<ExternalLink size={11} /></a>{quote.historyAsOf && <span>تا {periodDate(quote, quote.historyAsOf)}</span>}</p>}
          <footer><a href={quote.providerUrl} target="_blank" rel="noreferrer">{quote.provider}<ExternalLink size={12} /></a><time dateTime={quote.asOf || undefined}>{quote.asOf ? isMonthly(quote) ? `ماه داده: ${month(quote.asOf)}` : quote.frequency === 'daily-close' ? `تاریخ قیمت پایانی: ${date(quote.asOf)}` : `زمان داده: ${date(quote.asOf, true)}` : 'زمان داده در دسترس نیست'}</time></footer>
        </article>;
      })}</div>
    </>}
  </section>;
}
