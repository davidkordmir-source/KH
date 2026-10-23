import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowUpLeft, Bookmark, Check, CheckCheck,
  ChevronDown, ChevronLeft, CircleHelp, ExternalLink, Eye, Globe2, Hash,
  Instagram, Layers3, Link2, LoaderCircle, Menu, Newspaper, Plus, Radio,
  RefreshCw, Rss, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2,
  TrendingUp, Wifi, X, Zap, AlertCircle, Linkedin, Facebook,
} from 'lucide-react';

type Page = 'news' | 'saved' | 'sources' | 'connections' | 'keywords';
type Platform = 'telegram' | 'x' | 'instagram' | 'facebook' | 'linkedin';
type Article = {
  id: string; title: string; summary: string; url: string; imageUrl: string | null;
  sourceId: string; sourceName: string; platform: string; publishedAt: string; publishedAtKnown?: boolean;
  category: string; language: string; saved: boolean;
};
type Source = { id: string; name: string; url: string; platform: string; enabled: boolean; lastFetchedAt: string | null; lastError: string | null };
type Connection = { platform: Platform; connected: boolean; label: string | null; capability: string };
type Dashboard = { articles: Article[]; sources: Source[]; connections: Connection[]; keywords: string[]; lastSyncAt: string | null; syncErrors: {sourceId: string; sourceName: string; message: string}[] };
type Toast = { text: string; error?: boolean };

const emptyDashboard: Dashboard = { articles: [], sources: [], connections: [], keywords: [], lastSyncAt: null, syncErrors: [] };
const number = (value: number) => value.toLocaleString('fa-IR');
const categoryLabels: Record<string, string> = { all: 'همه خبرها', world: 'جهان', politics: 'سیاست', technology: 'فناوری', economy: 'اقتصاد', science: 'دانش', sports: 'ورزش', general: 'عمومی' };
const platformMeta: Record<Platform, { name: string; english: string; color: string; description: string; supported: boolean }> = {
  telegram: { name: 'تلگرام', english: 'Telegram', color: '#299ed8', supported: true, description: 'دریافت پیام‌های جدید کانال‌ها و گروه‌هایی که ربات شما به آن‌ها دسترسی دارد.' },
  x: { name: 'ایکس / توییتر', english: 'X / Twitter', color: '#18242c', supported: true, description: 'جست‌وجوی خبرها و هشتگ‌ها با Bearer Token و سطح دسترسی مجاز API ایکس.' },
  instagram: { name: 'اینستاگرام', english: 'Instagram', color: '#c64a81', supported: true, description: 'رسانه‌های حساب حرفه‌ای و هشتگ‌های مجاز، با توکن Meta و مجوزهای رسمی.' },
  facebook: { name: 'فیسبوک', english: 'Facebook', color: '#3678d9', supported: true, description: 'دریافت پست‌های صفحهٔ مجاز، با توکن صفحه و مجوزهای تأییدشدهٔ Meta.' },
  linkedin: { name: 'لینکدین', english: 'LinkedIn', color: '#1877a9', supported: true, description: 'پست‌های سازمانی با توکن و مجوزهای تأییدشدهٔ Community Management.' },
};

async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, headers: ['POST', 'PUT', 'PATCH'].includes(method) ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? (['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined) : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : 'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
  return data as T;
}

function relativeDate(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'زمان نامشخص';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'همین حالا';
  if (minutes < 60) return `${number(minutes)} دقیقه پیش`;
  if (minutes < 1440) return `${number(Math.floor(minutes / 60))} ساعت پیش`;
  return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric', timeZone: 'Asia/Tehran' }).format(new Date(value));
}

function PlatformIcon({ platform, size = 21 }: { platform: Platform; size?: number }) {
  if (platform === 'telegram') return <Send size={size} />;
  if (platform === 'instagram') return <Instagram size={size} />;
  if (platform === 'facebook') return <Facebook size={size} />;
  if (platform === 'linkedin') return <Linkedin size={size} />;
  return <span className="x-brand" style={{ fontSize: size }}>𝕏</span>;
}

function App() {
  const [data, setData] = useState<Dashboard>(emptyDashboard);
  const [page, setPage] = useState<Page>('news');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [language, setLanguage] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [sort, setSort] = useState('latest');
  const [modal, setModal] = useState<'source' | Platform | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [showAllErrors, setShowAllErrors] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = (text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5500);
  };
  async function load() {
    try { const next = await api<Dashboard>('/dashboard'); setData(next); setLoadError(''); }
    catch (error) { setLoadError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); return () => clearTimeout(toastTimer.current); }, []);
  useEffect(() => { setConfirmDelete(null); setMenuOpen(false); }, [page]);
  useEffect(() => {
    if (!modal) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);

  const connections = (Object.keys(platformMeta) as Platform[]).map(platform => data.connections.find(item => item.platform === platform) ?? { platform, connected: false, label: null, capability: '' });
  const savedCount = data.articles.filter(article => article.saved).length;
  const activeSourceCount = data.sources.filter(source => source.enabled).length;
  const todayCount = data.articles.filter(article => article.publishedAtKnown !== false && new Date(article.publishedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }) === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' })).length;
  const newsSources = [...new Map([
    ...data.sources.map(source => [source.id, source.name] as const),
    ...data.articles.map(article => [article.sourceId, article.sourceName] as const),
  ])];
  const filteredArticles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const relevance = (article: Article) => data.keywords.reduce((score, keyword) => score + (`${article.title} ${article.summary}`.toLowerCase().includes(keyword.toLowerCase().replace(/^#/, '')) ? 1 : 0), 0);
    const chronology = (a: Article, b: Article) => Number(a.publishedAtKnown === false) - Number(b.publishedAtKnown === false) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    return data.articles.filter(article =>
      (page !== 'saved' || article.saved) &&
      (category === 'all' || article.category === category) &&
      (language === 'all' || article.language === language) &&
      (sourceFilter === 'all' || article.sourceId === sourceFilter) &&
      (period === 'all' || (article.publishedAtKnown !== false && Date.parse(article.publishedAt) >= Date.now() - Number(period) * 86_400_000)) &&
      (!query || `${article.title} ${article.summary} ${article.sourceName}`.toLocaleLowerCase().includes(query)),
    ).sort((a, b) => sort === 'relevant' ? relevance(b) - relevance(a) || chronology(a, b) : chronology(a, b));
  }, [data.articles, data.keywords, page, category, language, sourceFilter, period, search, sort]);

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const next = await api<Dashboard>('/sync', 'POST');
      setData(next); setLoadError('');
      if (next.syncErrors.length) notify(`جمع‌آوری تمام شد؛ ${number(next.syncErrors.length)} منبع با خطا روبه‌رو شد. جزئیات را در وضعیت منابع ببینید.`, true);
      else notify('منابع با موفقیت به‌روز شدند.');
    } catch (error) { notify((error as Error).message, true); }
    finally { setSyncing(false); }
  }

  async function mutate(path: string, method: string, body: unknown, success: string, busyKey = path) {
    setBusy(busyKey);
    try { await api(path, method, body); await load(); if (success) notify(success); return true; }
    catch (error) { notify((error as Error).message, true); return false; }
    finally { setBusy(null); }
  }

  async function saveArticle(article: Article) {
    const success = await mutate(`/articles/${article.id}/save`, 'POST', { saved: !article.saved }, article.saved ? 'خبر از ذخیره‌شده‌ها برداشته شد.' : 'خبر در مجموعهٔ شما ذخیره شد.', article.id);
    if (success) setData(previous => ({ ...previous, articles: previous.articles.map(item => item.id === article.id ? { ...item, saved: !article.saved } : item) }));
  }

  async function addKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = keywordInput.trim().replace(/^#+/, '').slice(0, 60);
    if (!keyword) return;
    if (data.keywords.length >= 20) { notify('حداکثر ۲۰ موضوع را می‌توانید دنبال کنید.', true); return; }
    if (data.keywords.some(item => item.replace(/^#/, '').toLowerCase() === keyword.toLowerCase())) { notify('این موضوع را قبلاً اضافه کرده‌اید.', true); return; }
    if (await mutate('/keywords', 'PUT', { keywords: [...data.keywords, keyword] }, 'موضوع به فهرست پایش اضافه شد.')) setKeywordInput('');
  }

  function resetFilters() { setCategory('all'); setLanguage('all'); setSourceFilter('all'); setPeriod('all'); setSearch(''); }

  const navItems: { id: Page; label: string; icon: typeof Newspaper; count?: number }[] = [
    { id: 'news', label: 'اتاق خبر', icon: Newspaper },
    { id: 'saved', label: 'ذخیره‌شده‌ها', icon: Bookmark, count: savedCount },
    { id: 'sources', label: 'منابع خبری', icon: Rss, count: data.sources.length },
    { id: 'connections', label: 'حساب‌های متصل', icon: Link2 },
    { id: 'keywords', label: 'موضوع‌ها و هشتگ‌ها', icon: Hash },
  ];

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="بستن فهرست" />}
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('news'); }} aria-label="دیدبان، اتاق خبر">
          <span className="brand-mark"><Eye size={29} strokeWidth={1.6} /></span>
          <span><strong>دیدبان<span className="brand-dot">.</span></strong><small>چشم شما به جهان</small></span>
        </a>
        <div className="workspace-switch"><span className="workspace-icon"><Layers3 size={18} /></span><span>فضای خبری من<small>داشبورد شخصی</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">فضای کاری</div>
        <nav className="main-nav" aria-label="فهرست اصلی">
          {navItems.map(item => <button key={item.id} onClick={() => setPage(item.id)} className={`nav-item ${page === item.id ? 'active' : ''}`}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.count !== undefined && <small>{number(item.count)}</small>}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-caption sidebar-topics-label">موضوع‌های شما<button aria-label="افزودن موضوع" onClick={() => setPage('keywords')}><Plus size={15} /></button></div>
        <div className="sidebar-topics">{data.keywords.length ? data.keywords.slice(0, 5).map(keyword => <button key={keyword} onClick={() => { setPage('news'); setSearch(keyword.replace(/^#/, '')); }}><Hash size={15} /><span>{keyword.replace(/^#/, '')}</span></button>) : <p>موضوع‌های مهم را دنبال کنید<br />تا خبری را از دست ندهید.</p>}</div>
        <div className="sidebar-bottom"><div className="live-orbit"><Radio size={22} /><span className="orbit-dot" /></div><strong>جهان منتظر نمی‌ماند.</strong><p>منابع را وصل کنید، خبرها را<br />در یک جا دنبال کنید.</p><button onClick={() => setPage('sources')}>مدیریت منابع <ArrowUpLeft size={15} /></button></div>
        <div className="sidebar-profile"><span className="profile-avatar">م</span><span>اتاق خبر شخصی<small><span className="status-dot" /> ذخیره‌سازی محلی</small></span><button aria-label="تنظیمات منابع" onClick={() => setPage('sources')}><Settings2 size={18} /></button></div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="باز کردن فهرست"><Menu size={22} /></button><span>فضای کاری</span><ChevronLeft size={14} /><strong>{navItems.find(item => item.id === page)?.label}</strong></div>
          <div className="topbar-meta"><span className="today-date">{new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' }).format(new Date())}</span><span className="topbar-separator" /><span className="private-badge"><ShieldCheck size={15} />فضای شخصی شما</span></div>
        </header>

        <main className="main-content">
          <section className="page-heading">
            <div><div className="eyebrow"><span /> یک نگاه، تمام خبرها</div><h1>{page === 'news' ? <>اتاق خبر شما، <span>همیشه بیدار</span></> : page === 'saved' ? <>خبرهایی برای <span>دوباره خواندن</span></> : page === 'sources' ? <>منابع بیشتر، <span>دید وسیع‌تر</span></> : page === 'connections' ? <>همهٔ شبکه‌ها، <span>یک اتاق خبر</span></> : <>موضوع‌های شما، <span>در مرکز توجه</span></>}</h1><p>{page === 'news' ? 'از هیاهوی جهان، به خبرهایی برسید که برای شما مهم‌اند.' : page === 'saved' ? 'خبرهای منتخب شما، همیشه در دسترس و یک جا.' : page === 'sources' ? 'فیدهای خبری معتبر را اضافه کنید و وضعیت دریافت خبر را ببینید.' : page === 'connections' ? 'با دسترسی رسمی حساب‌ها، جریان خبر خود را کامل کنید.' : 'کلمات کلیدی و هشتگ‌ها را برای جست‌وجو و اولویت‌بندی خبرها مشخص کنید.'}</p></div>
            <button className="primary-button" onClick={() => void sync()} disabled={syncing || loading}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? 'در حال جمع‌آوری…' : 'جمع‌آوری خبرها'}</button>
          </section>

          {loadError && <div className="notice error-notice" role="alert"><AlertCircle size={19} /><div><strong>دریافت اطلاعات ممکن نشد</strong><p>{loadError}</p></div><button onClick={() => { setLoading(true); void load(); }}>تلاش دوباره</button></div>}

          <section className="stats-grid" aria-label="آمار اتاق خبر">
            {[{ label: 'خبرهای امروز', value: todayCount, icon: Newspaper, tone: 'orange', note: 'از منابع دریافت‌شده' }, { label: 'منابع فعال', value: activeSourceCount, icon: Rss, tone: 'teal', note: `${number(data.sources.length)} منبع در فهرست شما` }, { label: 'حساب‌های متصل', value: connections.filter(item => item.connected).length, icon: Link2, tone: 'violet', note: 'اتصال از طریق API رسمی' }, { label: 'موضوع‌های پایش', value: data.keywords.length, icon: Hash, tone: 'blue', note: 'خبرها حول علاقه‌های شما' }].map(stat => <div className="stat-card" key={stat.label}><div className={`stat-icon ${stat.tone}`}><stat.icon size={21} strokeWidth={1.7} /></div><div><span className="stat-label">{stat.label}</span><strong>{loading ? '—' : number(stat.value)}</strong><small>{stat.note}</small></div><span className="stat-decoration" /></div>)}
          </section>

          {(page === 'news' || page === 'saved') && <>
            <div className="news-layout">
              <section className="news-column">
                <div className="section-title-row"><h2><span className="section-marker" />{page === 'saved' ? 'مجموعهٔ خبرهای شما' : 'جریان خبر'}</h2><div className="sync-timestamp"><span className={`status-dot ${syncing ? 'is-pulsing' : ''}`} />{syncing ? 'در حال بررسی منابع' : data.lastSyncAt ? `آخرین بررسی: ${relativeDate(data.lastSyncAt)}` : 'آمادهٔ اولین دریافت'}</div></div>
                <div className="news-toolbar"><label className="search-field"><Search size={18} /><input aria-label="جست‌وجو در خبرها" placeholder="جست‌وجو در میان خبرها…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="پاک کردن جست‌وجو" onClick={() => setSearch('')}><X size={14} /></button>}</label><div className="select-field"><ArrowDownWideNarrow size={16} /><select aria-label="ترتیب خبرها" value={sort} onChange={event => setSort(event.target.value)}><option value="latest">تازه‌ترین</option><option value="relevant">مرتبط با موضوع‌ها</option></select></div></div>
                <div className="category-tabs" aria-label="دسته‌بندی خبرها">{['all', 'world', 'politics', 'technology', 'economy', 'science', 'sports', 'general'].map(key => <button className={category === key ? 'active' : ''} key={key} onClick={() => setCategory(key)}>{key === 'all' && <Globe2 size={14} />}{categoryLabels[key]}</button>)}</div>
                <div className="filter-row"><span>{number(filteredArticles.length)} خبر {page === 'saved' ? 'ذخیره‌شده' : 'در دسترس'}</span><div>
                  <select aria-label="بازهٔ زمانی خبر" value={period} onChange={event => setPeriod(event.target.value)}><option value="all">همهٔ زمان‌ها</option><option value="1">۲۴ ساعت اخیر</option><option value="7">هفت روز اخیر</option></select>
                  <select aria-label="زبان خبر" value={language} onChange={event => setLanguage(event.target.value)}><option value="all">همهٔ زبان‌ها</option><option value="fa">فارسی</option><option value="en">انگلیسی</option></select>
                  <select aria-label="منبع خبر" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">همهٔ منابع</option>{newsSources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                </div></div>

                {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><p>در حال آماده‌سازی اتاق خبر…</p></div> : filteredArticles.length > 0 ? <div className="article-list">{filteredArticles.map((article, index) => <ArticleCard key={article.id} article={article} featured={index === 0 && page === 'news' && !search} busy={busy === article.id} onSave={() => void saveArticle(article)} />)}</div> : <div className="empty-news"><div className="empty-illustration"><div className="illustration-orbit orbit-one" /><div className="illustration-orbit orbit-two" /><span className="floating-chip chip-rss"><Rss size={19} /></span><span className="floating-chip chip-globe"><Globe2 size={18} /></span><span className="floating-chip chip-hash"><Hash size={18} /></span><div className="paper-illustration"><span className="paper-head"><span /><i /></span><span className="paper-line long" /><span className="paper-line" /><div className="paper-columns"><span /><div><i /><i /><i /></div></div><span className="paper-line long" /></div><span className="illustration-star"><Sparkles size={18} /></span></div><span className="empty-eyebrow">{page === 'saved' ? 'مجموعهٔ شخصی شما' : data.articles.length ? 'جست‌وجوی دقیق‌تر' : 'آغاز یک جریان تازه'}</span><h3>{page === 'saved' && !savedCount ? 'خبرهای ارزشمند را نگه دارید' : data.articles.length ? 'خبری با این فیلترها پیدا نشد' : 'اولین خبر، یک کلیک فاصله دارد'}</h3><p>{page === 'saved' && !savedCount ? 'روی نشان ذخیره در کنار هر خبر بزنید تا بعداً به آن برگردید.' : data.articles.length ? 'کلمهٔ دیگری را امتحان کنید یا فیلترها را تغییر دهید.' : 'منابع خبری آماده‌اند. جمع‌آوری را شروع کنید تا تازه‌ترین خبرها در اتاق خبر شما نمایش داده شوند.'}</p>{page === 'saved' && !savedCount ? <button className="primary-button" onClick={() => setPage('news')}>رفتن به اتاق خبر<ArrowLeft size={16} /></button> : data.articles.length ? <button className="secondary-button" onClick={resetFilters}>پاک کردن فیلترها</button> : <button className="primary-button" onClick={() => void sync()} disabled={syncing}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? 'در حال دریافت خبرها…' : 'شروع جمع‌آوری'}</button>}<div className="empty-trust"><ShieldCheck size={14} />خبرها با لینک مستقیم به منبع اصلی نمایش داده می‌شوند.</div></div>}
              </section>
              <aside className="news-rail">
                <section className="rail-panel sources-panel"><div className="rail-heading"><h3>رادار منابع</h3><span className="tiny-badge">{number(activeSourceCount)} فعال</span></div><p className="rail-description">پنجره‌های شما رو به جهان</p><div className="source-mini-list">{data.sources.slice(0, 5).map((source, index) => <div className="source-mini" key={source.id}><span className={`source-monogram source-color-${index % 4}`}>{source.name.slice(0, 1)}</span><div><strong>{source.name}</strong><small>{!source.enabled ? 'غیرفعال' : source.lastError ? 'نیاز به بررسی' : source.lastFetchedAt ? 'دریافت موفق' : 'آمادهٔ دریافت'}</small></div><span className={`status-dot ${!source.enabled ? 'muted' : source.lastError ? 'warning' : ''}`} /></div>)}{!data.sources.length && <div className="rail-empty">هنوز منبعی اضافه نشده است.</div>}</div><button className="rail-link" onClick={() => setPage('sources')}>همهٔ منابع<ArrowLeft size={15} /></button></section>
                <section className="rail-panel topics-panel"><div className="rail-heading"><h3>روی رادار شما</h3><Hash size={17} /></div><p className="rail-description">موضوع‌هایی که دنبال می‌کنید</p><div className="keyword-cloud">{data.keywords.length ? data.keywords.slice(0, 8).map(keyword => <button key={keyword} onClick={() => setSearch(keyword.replace(/^#/, ''))}><span>#</span>{keyword.replace(/^#/, '')}</button>) : <p>فناوری؟ اقتصاد؟ سیاست؟<br />اولین موضوع خود را اضافه کنید.</p>}</div><button className="rail-link" onClick={() => setPage('keywords')}><span><Plus size={14} /> مدیریت موضوع‌ها</span><ArrowLeft size={15} /></button></section>
                <section className="connect-promo"><span className="promo-icon"><Link2 size={21} /></span><h3>خبر فقط در سایت‌ها نیست.</h3><p>شبکه‌های اجتماعی را به جریان خبر خود اضافه کنید.</p><div className="platform-mini-icons">{(Object.keys(platformMeta) as Platform[]).map(platform => <span key={platform}><PlatformIcon platform={platform} size={16} /></span>)}</div><button onClick={() => setPage('connections')}>اتصال حساب‌ها<ArrowUpLeft size={16} /></button></section>
              </aside>
            </div>
          </>}

          {page === 'sources' && <section className="management-section"><div className="section-title-row"><div><h2><span className="section-marker" />منابع خبری شما</h2><p className="section-description">فید RSS یا سایت خبری دارای فید عمومی؛ بدون نیاز به رمز عبور.</p></div><button className="secondary-button" onClick={() => setModal('source')}><Plus size={16} />افزودن منبع</button></div><div className="source-cards">{data.sources.map((source, index) => <article className="source-card" key={source.id}><div className="source-card-top"><span className={`source-monogram source-color-${index % 4}`}>{source.name.slice(0, 1)}</span><span className="source-kind"><Rss size={12} /> RSS</span><button className={`toggle-switch ${source.enabled ? 'on' : ''}`} role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? 'غیرفعال‌کردن' : 'فعال‌کردن'} ${source.name}`} disabled={busy === source.id} onClick={() => void mutate(`/sources/${source.id}`, 'PATCH', { enabled: !source.enabled }, 'وضعیت منبع تغییر کرد.', source.id)}><span /></button></div><h3>{source.name}</h3><a className="source-url" href={source.url} target="_blank" rel="noreferrer">{safeHost(source.url)}<ExternalLink size={12} /></a><div className={`source-status ${source.lastError ? 'failed' : ''}`}><span className={`status-dot ${!source.enabled ? 'muted' : source.lastError ? 'warning' : ''}`} />{!source.enabled ? 'دریافت خبر متوقف است' : source.lastError ? 'خطا در دریافت' : source.lastFetchedAt ? `آخرین دریافت ${relativeDate(source.lastFetchedAt)}` : 'آماده برای اولین دریافت'}</div>{source.lastError && <p className="source-error">{source.lastError}</p>}<div className="source-card-footer"><span>{number(data.articles.filter(article => article.sourceId === source.id).length)} خبر دریافت‌شده</span>{confirmDelete === source.id ? <div className="delete-confirm"><button onClick={() => { void mutate(`/sources/${source.id}`, 'DELETE', undefined, 'منبع حذف شد.', source.id); setConfirmDelete(null); }}>حذف شود</button><button onClick={() => setConfirmDelete(null)}>انصراف</button></div> : <button className="subtle-danger" aria-label={`حذف ${source.name}`} onClick={() => setConfirmDelete(source.id)}><Trash2 size={15} /></button>}</div></article>)}<button className="add-source-card" onClick={() => setModal('source')}><span><Plus size={25} /></span><strong>یک پنجرهٔ تازه به جهان</strong><small>افزودن سایت یا فید RSS</small></button></div><div className="info-strip"><CircleHelp size={18} /><p>آدرس فید RSS یا سایت خبری را وارد کنید؛ فیدهایی که سایت در صفحه معرفی کرده باشد، خودکار شناسایی می‌شوند. فعال بودن منبع به معنی تأیید صحت محتوای آن نیست.</p></div></section>}

          {page === 'connections' && <section className="management-section"><div className="section-title-row"><div><h2><span className="section-marker" />شبکه‌های اجتماعی</h2><p className="section-description">اتصال‌ها فقط محتوایی را می‌خوانند که API رسمی در اختیار حساب شما قرار می‌دهد.</p></div><span className="outline-badge"><ShieldCheck size={15} />دسترسی مجاز</span></div><div className="connection-cards">{connections.map(connection => { const meta = platformMeta[connection.platform]; return <article className="connection-card" key={connection.platform}><div className="connection-top"><span className="platform-logo" style={{ color: meta.color, backgroundColor: `${meta.color}10` }}><PlatformIcon platform={connection.platform} size={25} /></span><span className={`connection-status ${connection.connected ? 'connected' : ''}`}>{connection.connected ? <><span className="status-dot" />متصل</> : meta.supported ? 'متصل نشده' : 'نیازمند مجوز پلتفرم'}</span></div><h3>{meta.name}<small>{meta.english}</small></h3><p>{meta.description}</p>{connection.connected && <div className="connection-account"><CheckCheck size={15} />{connection.label || 'حساب تأییدشده'}</div>}<div className="connection-footer">{connection.connected ? <button className="disconnect-button" disabled={busy === connection.platform} onClick={() => void mutate(`/connections/${connection.platform}`, 'DELETE', undefined, 'اتصال حساب قطع شد.', connection.platform)}><Link2 size={15} />قطع اتصال</button> : <button className={meta.supported ? 'secondary-button' : 'muted-button'} onClick={() => setModal(connection.platform)}>{meta.supported ? <Plus size={15} /> : <CircleHelp size={15} />}{meta.supported ? 'اتصال حساب' : 'شرایط اتصال'}</button>}<span>{connection.platform === 'telegram' ? 'Bot API' : connection.platform === 'x' ? 'API v2' : 'API رسمی'}</span></div></article>; })}</div><div className="info-strip"><ShieldCheck size={19} /><p>رمز عبور شبکه‌های اجتماعی را وارد نکنید. توکن‌های اتصال در سرور به‌صورت رمزگذاری‌شده نگه‌داری می‌شوند. این نسخه اتصال عمومی OAuth برای همهٔ پلتفرم‌ها ندارد.</p></div></section>}

          {page === 'keywords' && <section className="keywords-layout"><div className="management-section keyword-main"><div className="section-title-row"><div><h2><span className="section-marker" />فهرست پایش شما</h2><p className="section-description">یک کلمه، نام، عبارت یا هشتگ اضافه کنید.</p></div><span className="tiny-badge">{number(data.keywords.length)} موضوع</span></div><form className="keyword-form" onSubmit={event => void addKeyword(event)}><label><Hash size={20} /><input value={keywordInput} onChange={event => setKeywordInput(event.target.value)} maxLength={60} placeholder="مثلاً هوش مصنوعی یا climate" aria-label="موضوع جدید" /></label><button className="primary-button" disabled={busy === '/keywords' || !keywordInput.trim()}><Plus size={17} />افزودن موضوع</button></form>{data.keywords.length ? <div className="keyword-list">{data.keywords.map(keyword => { const count = data.articles.filter(article => `${article.title} ${article.summary}`.toLowerCase().includes(keyword.toLowerCase().replace(/^#/, ''))).length; return <div className="keyword-row" key={keyword}><span className="keyword-hash"><Hash size={19} /></span><div><strong>{keyword.replace(/^#/, '')}</strong><small>{number(count)} خبر مرتبط در داده‌های دریافت‌شده</small></div><button className="text-button" onClick={() => { setPage('news'); setSearch(keyword.replace(/^#/, '')); }}>دیدن خبرها<ChevronLeft size={14} /></button><button className="icon-button subtle-danger" disabled={busy === '/keywords'} aria-label={`حذف موضوع ${keyword}`} onClick={() => void mutate('/keywords', 'PUT', { keywords: data.keywords.filter(item => item !== keyword) }, 'موضوع حذف شد.')}><Trash2 size={16} /></button></div>; })}</div> : <div className="keyword-empty"><Hash size={34} /><h3>کنجکاوی شما از کجا شروع می‌شود؟</h3><p>اولین موضوع را اضافه کنید تا خبرهای مرتبط را راحت‌تر پیدا کنید.</p></div>}</div><aside className="keyword-help"><span className="help-icon"><Sparkles size={25} /></span><h3>خبرهای مهم را<br />نزدیک‌تر نگه دارید.</h3><p>موضوع‌ها برای پیدا کردن و اولویت‌بندی خبرهای دریافت‌شده استفاده می‌شوند.</p><div className="help-step"><span>۱</span><p>نام یک موضوع یا هشتگ را اضافه کنید.</p></div><div className="help-step"><span>۲</span><p>در اتاق خبر، ترتیب «مرتبط با موضوع‌ها» را انتخاب کنید.</p></div><div className="help-step"><span>۳</span><p>با اتصال ایکس، همین موضوع‌ها در جست‌وجوی API استفاده می‌شوند.</p></div><small>این نسخه ترجمه یا راستی‌آزمایی خودکار خبر انجام نمی‌دهد.</small></aside></section>}

          {data.syncErrors.length > 0 && <section className="sync-errors"><button className="sync-errors-heading" onClick={() => setShowAllErrors(!showAllErrors)} aria-expanded={showAllErrors}><AlertCircle size={16} /><span>{number(data.syncErrors.length)} منبع در آخرین جمع‌آوری به بررسی نیاز دارد</span><ChevronDown size={16} className={showAllErrors ? 'rotated' : ''} /></button>{showAllErrors && <div className="sync-errors-content">{data.syncErrors.map((error, index) => <p key={`${error.sourceId}-${index}`}><strong>{error.sourceName}</strong><span>{error.message}</span></p>)}</div>}</section>}

          <footer className="main-footer"><span><Eye size={16} /><strong>دیدبان</strong> خبرها را کنار هم می‌آورد.</span><small>محتوا متعلق به منابع اصلی است · دسترسی بر اساس مجوز هر پلتفرم</small><span className="footer-tag">با نگاهی باز به جهان<ArrowUpLeft size={13} /></span></footer>
        </main>
      </div>

      {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={19} /> : <Check size={19} />}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="بستن پیام"><X size={15} /></button></div>}

      {modal && <Modal kind={modal} busy={busy !== null} onClose={() => setModal(null)} onSubmit={async values => {
        if (modal === 'source') {
          const ok = await mutate('/sources', 'POST', values, 'منبع خبری اضافه شد. برای دریافت خبرها، جمع‌آوری را اجرا کنید.');
          if (ok) setModal(null);
        } else {
          const ok = await mutate(`/connections/${modal}`, 'POST', values, 'اتصال حساب با موفقیت تأیید شد.', modal);
          if (ok) setModal(null);
        }
      }} />}
    </div>
  );
}

function safeHost(url: string) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

function ArticleCard({ article, featured, busy, onSave }: { article: Article; featured: boolean; busy: boolean; onSave: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <article className={`article-card ${featured ? 'featured-article' : ''}`}>
    {featured && <div className="featured-label"><span /><Zap size={13} />تازه روی رادار</div>}
    <div className="article-card-inner">
      <div className="article-text"><div className="article-meta"><span className="article-source"><span />{article.sourceName}</span><span className="meta-dot">·</span><time dateTime={article.publishedAtKnown === false ? undefined : article.publishedAt}>{article.publishedAtKnown === false ? 'زمان انتشار نامشخص' : relativeDate(article.publishedAt)}</time><span className="article-category">{categoryLabels[article.category] || 'عمومی'}</span></div><a className="article-title" href={article.url} target="_blank" rel="noreferrer"><h3 dir="auto">{article.title}</h3></a><p className="article-summary" dir="auto">{article.summary}</p><div className="article-bottom"><a href={article.url} target="_blank" rel="noreferrer">خواندن در منبع اصلی<ArrowUpLeft size={14} /></a><div><span className="article-language">{article.language === 'fa' ? 'فارسی' : 'EN'}</span><button onClick={onSave} disabled={busy} className={`save-button ${article.saved ? 'is-saved' : ''}`} aria-label={article.saved ? 'برداشتن خبر از ذخیره‌شده‌ها' : 'ذخیره خبر'} aria-pressed={article.saved}>{busy ? <LoaderCircle className="spin" size={18} /> : <Bookmark size={18} fill={article.saved ? 'currentColor' : 'none'} strokeWidth={1.7} />}</button></div></div></div>
      {article.imageUrl && !imageFailed ? <a className="article-image" href={article.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true"><img src={article.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /></a> : featured ? <div className="article-art" aria-hidden="true"><Globe2 size={94} strokeWidth={0.65} /><span /><i /></div> : null}
    </div>
  </article>;
}

function Modal({ kind, busy, onClose, onSubmit }: { kind: 'source' | Platform; busy: boolean; onClose: () => void; onSubmit: (values: unknown) => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [channels, setChannels] = useState('');
  const [accountId, setAccountId] = useState('');
  const [formError, setFormError] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const meta = kind === 'source' ? null : platformMeta[kind];
  const previousActive = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousActive.current = document.activeElement as HTMLElement;
    firstInput.current?.focus();
    if (!firstInput.current) dialog.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; previousActive.current?.focus(); };
  }, []);
  function trapFocus(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !dialog.current) return;
    const elements = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]');
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError('');
    if (kind === 'source') {
      if (!name.trim()) { setFormError('نام منبع را وارد کنید.'); return; }
      try { const parsed = new URL(url); if (parsed.protocol !== 'https:') throw new Error(); }
      catch { setFormError('آدرس معتبر HTTPS سایت یا فید RSS را وارد کنید.'); return; }
      await onSubmit({ name: name.trim(), url: url.trim() });
    } else {
      if (!token.trim()) { setFormError('توکن دسترسی را وارد کنید.'); return; }
      if (['instagram', 'facebook', 'linkedin'].includes(kind) && !accountId.trim()) { setFormError('شناسهٔ حساب، صفحه یا سازمان را وارد کنید.'); return; }
      await onSubmit({ token: token.trim(), label: name.trim() || undefined, ...(kind === 'telegram' ? { channels: channels.split(/[،,\n]/).map(item => item.trim()).filter(Boolean) } : {}), ...(['instagram', 'facebook', 'linkedin'].includes(kind) ? { accountId: accountId.trim() } : {}) });
    }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialog} tabIndex={-1} onKeyDown={trapFocus}><button className="modal-close icon-button" onClick={onClose} aria-label="بستن پنجره" disabled={busy}><X size={20} /></button><div className="modal-symbol">{kind === 'source' ? <Rss size={26} /> : <PlatformIcon platform={kind} size={27} />}</div><h2 id="modal-title">{kind === 'source' ? 'افزودن منبع خبری' : meta?.supported ? `اتصال ${meta.name}` : `دربارهٔ اتصال ${meta?.name}`}</h2><p className="modal-description">{kind === 'source' ? 'آدرس سایت خبری یا فید عمومی آن را اضافه کنید تا خبرهایش وارد اتاق خبر شما شوند.' : meta?.description}</p>{kind !== 'source' && !meta?.supported ? <><div className="modal-info"><CircleHelp size={19} /><p>اتصال این پلتفرم در نسخهٔ فعلی پیاده‌سازی نشده است. برای فعال‌سازی، ابتدا باید برنامهٔ رسمی و مجوزهای لازم از {kind === 'linkedin' ? 'لینکدین' : 'Meta'} دریافت شود. وارد کردن نام کاربری یا رمز عبور به‌تنهایی این دسترسی را فراهم نمی‌کند.</p></div><button className="primary-button full-width" onClick={onClose}>متوجه شدم<Check size={16} /></button></> : <form onSubmit={event => void submit(event)} className="modal-form"><label><span>{kind === 'source' ? 'نام منبع' : 'نام دلخواه حساب'}{kind !== 'source' && <small>اختیاری</small>}</span><input ref={firstInput} value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder={kind === 'source' ? 'مثلاً خبرگزاری مورد علاقهٔ من' : 'مثلاً کانال خبر من'} required={kind === 'source'} /></label>{kind === 'source' ? <label><span>آدرس سایت یا فید RSS</span><input dir="ltr" type="url" placeholder="https://example.com/feed.xml" value={url} onChange={event => setUrl(event.target.value)} required /><small className="input-help">آدرس HTTPS فید را وارد کنید؛ برای آدرس سایت، فید معرفی‌شده در صفحه شناسایی می‌شود.</small></label> : <><label><span>{kind === 'telegram' ? 'توکن ربات تلگرام' : kind === 'x' ? 'Bearer Token ایکس' : kind === 'facebook' ? 'توکن دسترسی صفحه' : 'توکن دسترسی API'}</span><input dir="ltr" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} placeholder={kind === 'telegram' ? '123456:ABC…' : 'Access token…'} required /><small className="input-help">{kind === 'telegram' ? 'توکن ربات را از BotFather دریافت کنید. رمز حساب تلگرام را وارد نکنید.' : kind === 'x' ? 'توکن را از پنل توسعه‌دهندگان X دریافت کنید. دسترسی جست‌وجوی اخیر باید فعال باشد.' : kind === 'linkedin' ? 'توکن OAuth با مجوز Community Management سازمان خود را وارد کنید.' : 'توکن رسمی Meta با مجوز خواندن حساب حرفه‌ای یا صفحهٔ مورد نظر را وارد کنید.'}</small></label>{['instagram', 'facebook', 'linkedin'].includes(kind) && <label><span>{kind === 'instagram' ? 'شناسهٔ حساب حرفه‌ای اینستاگرام' : kind === 'facebook' ? 'شناسهٔ صفحهٔ فیسبوک' : 'شناسهٔ سازمان لینکدین'}</span><input dir="ltr" value={accountId} onChange={event => setAccountId(event.target.value)} placeholder={kind === 'linkedin' ? '12345678' : '123456789012345'} required /><small className="input-help">{kind === 'instagram' ? 'شناسهٔ عددی Instagram Professional User؛ نام کاربری نیست.' : kind === 'facebook' ? 'شناسهٔ عددی Page که توکن به آن دسترسی دارد.' : 'شناسهٔ عددی سازمان یا urn:li:organization:ID'}</small></label>}{kind === 'telegram' && <label><span>شناسهٔ کانال‌ها یا گروه‌ها<small>اختیاری</small></span><input dir="ltr" value={channels} onChange={event => setChannels(event.target.value)} placeholder="@channel, -1001234567890" /><small className="input-help">با ویرگول جدا کنید. ربات باید عضو و در کانال مدیر باشد؛ فقط پیام‌های جدید قابل دریافت‌اند.</small></label>}<div className="modal-info"><ShieldCheck size={18} /><p>{kind === 'telegram' ? 'این اتصال با ربات انجام می‌شود و به تاریخچهٔ کانال‌ها یا همهٔ چت‌های حساب شخصی شما دسترسی نمی‌دهد. برای دریافت پیام‌ها، ربات نباید webhook فعال یا مصرف‌کنندهٔ getUpdates دیگری داشته باشد.' : kind === 'x' ? 'API ایکس ممکن است هزینه یا محدودیت دسترسی داشته باشد. جست‌وجو بر اساس موضوع‌های ثبت‌شدهٔ شما انجام می‌شود.' : kind === 'instagram' ? 'اتصال به حساب حرفه‌ای تحت دسترسی شما محدود است. دسترسی به هشتگ‌ها نیز تابع مجوز API رسمی و محدودیت‌های Meta است؛ فید همهٔ پیج‌ها در دسترس نیست.' : kind === 'facebook' ? 'فقط پست‌های صفحه‌ای که مجوز خواندن آن را دارید دریافت می‌شوند. این اتصال فید شخصی یا محتوای همهٔ صفحات را نمی‌خواند.' : 'فقط پست‌های سازمان مجاز از API رسمی دریافت می‌شوند. دسترسی Community Management باید تأیید شده باشد؛ فید شخصی لینکدین در دسترس نیست.'}</p></div></>}{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : kind === 'source' ? <Plus size={16} /> : <Link2 size={16} />}{busy ? 'در حال بررسی…' : kind === 'source' ? 'افزودن منبع' : 'بررسی و اتصال'}</button><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>انصراف</button></div></form>}</div></div>;
}

export default App;
