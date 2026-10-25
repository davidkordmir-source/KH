import PersianTranslation from './PersianTranslation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as jalaali from 'jalaali-js';
import { AlertCircle, Archive, ArrowLeft, ArrowRight, ArrowUpLeft, Bookmark, CalendarDays, CheckCheck, ChevronDown, Download, KeyRound, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import './archive.css';
import HistoricalRange from './HistoricalRange';

type Coverage = {
  oldestPublishedAt?: string | null; newestPublishedAt?: string | null; articleCount?: number; unknownDateCount?: number;
  startedCollectingAt?: string | null; oldest?: string | null; newest?: string | null; count?: number; scope?: string;
};
type ArchiveArticle = {
  id: string; title: string; summary: string; summaryAuto?: string; summaryMethod?: string; url: string;
  sourceName: string; sourceIconUrl?: string | null; imageUrl?: string | null; publishedAt: string;
  language?: string; translatedTitle?: string; translatedSummary?: string; translationProvider?: string; publishedAtKnown?: boolean; saved: boolean; read?: boolean; duplicateCount?: number;
  media?: { type: string; url: string; mimeType?: string; poster?: string }[];
};
type Result = { articles: ArchiveArticle[]; total: number; limit: number; offset: number; coverage?: Coverage };
type ArchiveStatus = { guardianConfigured: boolean; coverage?: Coverage };
const number = (value: number) => value.toLocaleString('fa-IR');
const digits = (value: string) => value.replace(/[۰-۹]/g, character => String(character.charCodeAt(0) - 0x6f0)).replace(/[٠-٩]/g, character => String(character.charCodeAt(0) - 0x660));
const pad = (value: number) => String(value).padStart(2, '0');
const isoDay = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

function todayFields() {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tehran' }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const { jy, jm, jd } = jalaali.toJalaali(part('year'), part('month'), part('day'));
  return { year: String(jy), month: String(jm), day: String(jd), gregorian: isoDay(part('year'), part('month'), part('day')) };
}

function parseFields(year: string, month: string, day: string) {
  const values = [year, month, day].map(value => digits(value.trim()));
  if (values.some(value => !/^\d+$/.test(value))) return null;
  const [jy, jm, jd] = values.map(Number);
  if (jy < 1200 || jy > 1600 || !jalaali.isValidJalaaliDate(jy, jm, jd)) return null;
  const date = jalaali.toGregorian(jy, jm, jd);
  return isoDay(date.gy, date.gm, date.gd);
}

function persianDate(value?: string | null, full = false) {
  if (!value) return 'نامشخص';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+03:30` : value);
  if (!Number.isFinite(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', full ? { dateStyle: 'full', timeZone: 'Asia/Tehran' } : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tehran' }).format(date);
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method, signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'پاسخ آرشیو دریافت نشد. دوباره تلاش کنید.');
  return data as T;
}

export default function ArchivePanel() {
  const initial = useMemo(todayFields, []);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [selectedDate, setSelectedDate] = useState(initial.gregorian);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result>({ articles: [], total: 0, limit: 50, offset: 0 });
  const [coverage, setCoverage] = useState<Coverage>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [guardianConfigured, setGuardianConfigured] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [token, setToken] = useState('');
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [statusLoaded, setStatusLoaded] = useState(false);
  const requestVersion = useRef(0);
  const validDate = parseFields(year, month, day);
  const coverageCount = coverage.articleCount ?? coverage.count ?? 0;
  const coverageOldest = coverage.oldestPublishedAt || coverage.oldest;
  const coverageNewest = coverage.newestPublishedAt || coverage.newest;

  useEffect(() => {
    const controller = new AbortController();
    request<ArchiveStatus>('/archive/status', 'GET', undefined, controller.signal)
      .then(status => { setGuardianConfigured(status.guardianConfigured); if (status.coverage) setCoverage(status.coverage); setStatusLoaded(true); })
      .catch(failure => { if (!controller.signal.aborted) { setProviderError(failure.message); setStatusLoaded(true); } });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ dateFrom: selectedDate, dateTo: selectedDate, limit: '50', offset: String(offset), ...(appliedSearch ? { query: appliedSearch } : {}) });
    request<Result>(`/articles?${params}`, 'GET', undefined, controller.signal)
      .then(next => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setResult({ ...next, articles: next.articles || [] });
        if (next.coverage) setCoverage(next.coverage);
      })
      .catch(failure => { if (!controller.signal.aborted && version === requestVersion.current) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted && version === requestVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [selectedDate, appliedSearch, offset, revision]);

  function chooseDate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); setNotice('');
    if (!validDate) { setError('یک تاریخ هجری شمسی معتبر، مانند ۱۴۰۳/۰۱/۰۱، وارد کنید.'); return; }
    setSelectedDate(validDate); setAppliedSearch(search.trim()); setOffset(0); setRevision(value => value + 1);
  }

  function moveDate(days: number) {
    const current = new Date(`${selectedDate}T12:00:00Z`);
    current.setUTCDate(current.getUTCDate() + days);
    const date = jalaali.toJalaali(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate());
    setYear(String(date.jy)); setMonth(String(date.jm)); setDay(String(date.jd));
    setSelectedDate(isoDay(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate()));
    setOffset(0); setNotice('');
  }

  async function changeArticle(article: ArchiveArticle, field: 'saved' | 'read', value: boolean) {
    setBusy(`${article.id}:${field}`); setError('');
    try {
      await request(`/articles/${encodeURIComponent(article.id)}/${field === 'saved' ? 'save' : 'read'}`, 'POST', { [field]: value });
      setResult(previous => ({ ...previous, articles: previous.articles.map(item => item.id === article.id ? { ...item, [field]: value } : item) }));
      setRevision(value => value + 1);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProviderError(''); setNotice('');
    if (!token.trim()) { setProviderError('کلید رسمی Guardian Content API را وارد کنید.'); return; }
    setProviderLoading(true);
    try {
      await request('/archive/guardian/connect', 'POST', { token: token.trim() });
      setGuardianConfigured(true); setToken(''); setNotice('دسترسی Guardian تأیید و کلید به‌صورت رمزگذاری‌شده ذخیره شد.');
    } catch (failure) { setProviderError((failure as Error).message); }
    finally { setProviderLoading(false); }
  }

  async function importDay() {
    setProviderError(''); setNotice('');
    if (!validDate) { setProviderError('ابتدا یک تاریخ هجری شمسی معتبر انتخاب کنید.'); return; }
    if (!guardianConfigured) { setShowProvider(true); setProviderError('برای دریافت روزهای خارج از آرشیو محلی، ابتدا کلید رسمی Guardian را متصل کنید.'); return; }
    setProviderLoading(true);
    try {
      const imported = await request<{ imported: number; provider: string; truncated?: boolean; coverage?: Coverage }>('/archive/import', 'POST', { date: validDate, ...(search.trim() ? { query: search.trim() } : {}) });
      if (imported.coverage) setCoverage(imported.coverage);
      setSelectedDate(validDate); setAppliedSearch(search.trim()); setOffset(0); setRevision(value => value + 1);
      setNotice(`${number(imported.imported)} خبر از ${imported.provider || 'Guardian'} به آرشیو افزوده یا به‌روز شد.${imported.truncated ? ' نتیجه به سقف دریافت این نوبت رسیده است؛ پوشش این روز کامل نیست.' : ''}`);
    } catch (failure) { setProviderError((failure as Error).message); }
    finally { setProviderLoading(false); }
  }

  return <section className="archive-panel" aria-label="تاریخچهٔ خبری">
    <div className="archive-intro"><div><span className="archive-kicker"><Archive size={16} /> حافظهٔ اتاق خبر</span><h2>خبرها در گذر روزها.</h2><p>یک روز از تقویم هجری شمسی را انتخاب کنید؛ خبرهای دریافت‌شدهٔ همان روز را دوباره بخوانید.</p></div><span className="archive-total"><CalendarDays size={19} />{number(coverageCount)} خبر در آرشیو محلی</span></div>
    <div className="archive-coverage"><ShieldCheck size={19} /><div><strong>پوشش واقعی آرشیو شما</strong><p>{coverageCount > 0 && coverageOldest ? `از ${persianDate(coverageOldest)} تا ${persianDate(coverageNewest)}؛ شامل خبرهای جمع‌آوری‌شده و واردشده، با امکان وجود فاصله میان روزها.` : 'هنوز خبری در آرشیو محلی ثبت نشده است. دریافت منابع را از اتاق خبر شروع کنید یا آرشیو تاریخی Guardian را متصل کنید.'}</p>{(coverage.unknownDateCount || 0) > 0 && <small>{number(coverage.unknownDateCount!)} خبر تاریخ انتشار مشخص ندارند و در جست‌وجوی روزانه نمایش داده نمی‌شوند.</small>}</div></div>
    <form className="archive-search" onSubmit={chooseDate}>
      <div className="archive-date-fields"><label>سال<input aria-label="سال هجری شمسی" inputMode="numeric" maxLength={4} value={year} onChange={event => setYear(event.target.value)} placeholder="۱۴۰۳" /></label><span>/</span><label>ماه<input aria-label="ماه هجری شمسی" inputMode="numeric" maxLength={2} value={month} onChange={event => setMonth(event.target.value)} placeholder="۰۱" /></label><span>/</span><label>روز<input aria-label="روز هجری شمسی" inputMode="numeric" maxLength={2} value={day} onChange={event => setDay(event.target.value)} placeholder="۰۱" /></label></div>
      <label className="archive-query"><span>موضوع، عبارت یا منبع</span><div><Search size={17} /><input aria-label="جست‌وجوی آرشیو" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="اختیاری؛ مثلاً ایران" /></div></label>
      <button className="primary-button" disabled={loading}><Search size={16} />جست‌وجوی این روز</button>
    </form>
    <div className="archive-day-nav"><button onClick={() => moveDate(-1)} disabled={loading}><ArrowRight size={15} />روز قبل</button><div><strong>{persianDate(selectedDate, true)}</strong><small>روز تقویمی بر اساس ساعت تهران</small></div><button onClick={() => moveDate(1)} disabled={loading}>روز بعد<ArrowLeft size={15} /></button></div>
    {error && <div className="archive-error" role="alert"><AlertCircle size={17} /><p>{error}</p></div>}
    {notice && <div className="archive-notice" role="status"><CheckCheck size={18} /><p>{notice}</p></div>}
    <div className="archive-result-title"><h3>خبرهای {persianDate(selectedDate)}</h3><span>{number(result.total)} نتیجه{appliedSearch ? ` برای «${appliedSearch}»` : ''}</span></div>
    {loading ? <div className="archive-loading"><LoaderCircle className="spin" size={27} /><p>در حال خواندن آرشیو…</p></div> : result.articles.length ? <div className="archive-news-list">{result.articles.map(article => {
      const image = article.media?.find(media => media.type === 'image')?.url || article.imageUrl;
      const video = article.media?.find(media => media.type === 'video');
      return <article className={`archive-news-card ${article.read ? 'archive-read' : ''}`} key={article.id}>
        <div className="archive-news-body"><div className="archive-news-meta"><span>{article.sourceIconUrl && <img src={article.sourceIconUrl} alt="" referrerPolicy="no-referrer" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}{article.sourceName}</span><time dateTime={article.publishedAtKnown === false ? undefined : article.publishedAt}>{article.publishedAtKnown === false ? 'زمان انتشار نامشخص' : persianDate(article.publishedAt)}</time>{article.read && <span className="archive-read-label"><CheckCheck size={13} />خوانده‌شده</span>}</div>
          <a href={article.url} target="_blank" rel="noreferrer" onClick={() => { if (!article.read) void changeArticle(article, 'read', true); }}><h4 dir="auto">{article.title}</h4></a><p dir="auto">{article.summaryAuto || article.summary}</p><PersianTranslation article={article}/>{article.summaryAuto && <small className="archive-summary-label">خلاصهٔ استخراجی از متن موجود؛ بدون تحلیل هوش مصنوعی</small>}
          {(article.duplicateCount || 0) > 0 && <span className="archive-similar">عنوان مشابه در {number(article.duplicateCount! + 1)} خبر</span>}
          <div className="archive-news-actions"><a href={article.url} target="_blank" rel="noreferrer" onClick={() => { if (!article.read) void changeArticle(article, 'read', true); }}>خواندن منبع اصلی<ArrowUpLeft size={14} /></a><div><button className={article.read ? 'active' : ''} disabled={busy === `${article.id}:read`} onClick={() => void changeArticle(article, 'read', !article.read)} aria-label={article.read ? 'علامت‌گذاری خبر آرشیو به‌عنوان نخوانده' : 'علامت‌گذاری خبر آرشیو به‌عنوان خوانده'}><CheckCheck size={16} />{article.read ? 'خوانده‌شده' : 'نخوانده'}</button><button className={article.saved ? 'active' : ''} disabled={busy === `${article.id}:saved`} onClick={() => void changeArticle(article, 'saved', !article.saved)} aria-pressed={article.saved} aria-label={article.saved ? 'برداشتن خبر آرشیو از ذخیره‌شده‌ها' : 'ذخیرهٔ خبر آرشیو'}><Bookmark size={18} fill={article.saved ? 'currentColor' : 'none'} /></button></div></div>
        </div>
        {video ? <video className="archive-news-video" src={video.url} controls preload="none" poster={video.poster} aria-label={`ویدئوی منبع: ${article.title}`} /> : image ? <img className="archive-news-image" src={image} alt="تصویر منتشرشده همراه خبر در منبع اصلی" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} /> : null}
      </article>;
    })}</div> : <div className="archive-empty"><CalendarDays size={32} /><h3>برای این روز خبری در آرشیو محلی پیدا نشد.</h3><p>نداشتن نتیجه به معنی نبودن خبر در آن روز نیست. برنامه فقط خبرهایی را می‌شناسد که قبلاً جمع‌آوری یا از یک آرشیو معتبر وارد شده‌اند.</p><button className="secondary-button" onClick={() => { setYear('1403'); setMonth('1'); setDay('1'); }}>انتخاب نمونه: ۱ فروردین ۱۴۰۳</button></div>}
    {result.total > result.limit && <div className="archive-pagination"><button className="secondary-button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - result.limit))}>صفحهٔ قبل</button><span>{number(offset + 1)} تا {number(Math.min(offset + result.articles.length, result.total))} از {number(result.total)}</span><button className="secondary-button" disabled={loading || offset + result.limit >= result.total} onClick={() => setOffset(value => value + result.limit)}>صفحهٔ بعد</button></div>}
    <HistoricalRange configured={guardianConfigured}/><section className="archive-provider"><button className="archive-provider-toggle" onClick={() => setShowProvider(value => !value)} aria-expanded={showProvider}><span><Archive size={18} /><strong>دریافت خبرهای سال‌های گذشته از Guardian</strong><small>{guardianConfigured ? 'دسترسی متصل است' : 'نیازمند کلید رسمی API'}</small></span><ChevronDown size={18} className={showProvider ? 'rotated' : ''} /></button>
      {showProvider && <div className="archive-provider-body"><p>برای روزهایی مانند سال ۱۴۰۳ که در آرشیو محلی موجود نیستند، می‌توانید محتوای آرشیوی Guardian را با مجوز رسمی وارد کنید. این اتصال فقط پوشش Guardian را می‌آورد؛ آرشیو همهٔ خبرگزاری‌ها نیست.</p>
        {!guardianConfigured && <form className="archive-key-form" onSubmit={event => void connect(event)}><label><span><KeyRound size={15} />کلید Guardian Content API</span><input type="password" aria-label="کلید Guardian" autoComplete="new-password" dir="ltr" value={token} maxLength={4096} onChange={event => setToken(event.target.value)} placeholder="API key" required /></label><button className="secondary-button" disabled={providerLoading || !token.trim()}>{providerLoading ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}بررسی و اتصال</button><small>کلید را از <a href="https://open-platform.theguardian.com/access/" target="_blank" rel="noreferrer">Guardian Open Platform</a> بگیرید و همین‌جا وارد کنید. کلید به‌صورت رمزگذاری‌شده در دستگاه شما نگه‌داری می‌شود.</small></form>}
        {providerError && <div className="archive-error" role="alert"><AlertCircle size={17} /><p>{providerError}</p></div>}
        <div className="archive-import-row"><div><strong>{validDate ? persianDate(validDate, true) : 'تاریخ انتخاب‌شده معتبر نیست'}</strong><small>{guardianConfigured ? 'خبرهای دریافت‌شده به آرشیو محلی افزوده می‌شوند.' : statusLoaded ? 'پس از اتصال کلید، دریافت این روز فعال می‌شود.' : 'در حال بررسی وضعیت اتصال…'}</small></div><button className="primary-button" disabled={providerLoading || !guardianConfigured || !validDate} onClick={() => void importDay()}>{providerLoading ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}دریافت آرشیو این روز</button></div>
      </div>}
    </section>
  </section>;
}
