import BrowserReader from './BrowserReader';
import CategoryPulse from './CategoryPulse';
import PublicSocialConnections from './PublicSocialConnections';
import PersianTranslation from './PersianTranslation';
import NewsTicker from './NewsTicker';
import { useEffect, useMemo, useRef, useState, useDeferredValue, startTransition, lazy, Suspense, type FormEvent } from 'react';
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowUpLeft, Bookmark, Check, CheckCheck,
  ChevronDown, ChevronLeft, CircleHelp, ExternalLink, Eye, Globe2, Hash,
  Instagram, Layers3, Link2, LoaderCircle, Menu, Newspaper, Plus, Radio,
  RefreshCw, Rss, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2,
  TrendingUp, Wifi, X, Zap, AlertCircle, Linkedin, Facebook,
} from 'lucide-react';
const MarketsPanel=lazy(()=>import('./MarketsPanel'));
const AtlasPanel=lazy(()=>import('./AtlasPanel'));
const ArchivePanel=lazy(()=>import('./ArchivePanel'));
const NewsWorkbench=lazy(()=>import('./NewsWorkbench'));
import ArticleResearch from './ArticleResearch';
import { useNewsAlerts } from './newsroom-client';
const ResearchLab=lazy(()=>import('./ResearchLab'));
import { SessionControls } from './AccessGate';

import './refresh.css';

type Page = 'news' | 'saved' | 'sources' | 'connections' | 'keywords' | 'archive' | 'atlas' | 'markets' | 'officials' | 'workbench' | 'lab';
type Platform = 'telegram' | 'x' | 'instagram' | 'facebook' | 'linkedin';
export type Article = {
  id: string; title: string; summary: string; translatedTitle?: string; translatedSummary?: string; translationProvider?: string; fullText?: string; textScope?: string; url: string; imageUrl: string | null;
  sourceId: string; sourceName: string; platform: string; publishedAt: string; publishedAtKnown?: boolean;
  category: string; userCategory?: string | null; originalCategory?: string; language: string; saved: boolean; seen?: boolean; read?: boolean; readAt?: string | null; priority?: number; duplicateGroup?: string; duplicateCount?: number; readInherited?: boolean; summaryAuto?: string; summaryMethod?: string; sourceIconUrl?: string | null; media?: {type: 'image' | 'video'; url: string; mimeType?: string; poster?: string; source?: string}[]; locations?: {countryCode: string; countryName: string; city?: string; lat: number; lon: number}[];
};
type Source = { id: string; name: string; url: string; platform: string; enabled: boolean; lastFetchedAt: string | null; lastError: string | null; priority?: number; kind?: string; iconUrl?: string | null; countryCode?: string };
type CatalogSource = Source & {description?: string; websiteUrl?: string; collection?: 'website' | 'rss' | 'structured'};
type CustomConnection = {id: string; type: string; label: string; connected?: boolean; description?: string};
type Connection = { platform: Platform; connected: boolean; label: string | null; capability: string };
type Dashboard = { categories?: {id:string;name:string}[]; articles: Article[]; sources: Source[]; connections: Connection[]; keywords: string[]; lastSyncAt: string | null; customConnections?: CustomConnection[]; articleCount?: number; archiveCoverage?: {from?: string; to?: string}; syncErrors: {sourceId: string; sourceName: string; message: string}[] };
type Toast = { text: string; error?: boolean };

const emptyDashboard: Dashboard = { articles: [], sources: [], connections: [], keywords: [], lastSyncAt: null, syncErrors: [] };
const number = (value: number) => value.toLocaleString('fa-IR');
const categoryLabels: Record<string, string> = { all: 'همه خبرها', military:'نظامی',social:'اجتماعی', world: 'جهان', politics: 'سیاست', technology: 'فناوری', economy: 'اقتصاد', science: 'دانش', sports: 'ورزش', general: 'عمومی' };
const platformMeta: Record<Platform, { name: string; english: string; color: string; description: string; supported: boolean }> = {
  telegram: { name: 'تلگرام', english: 'Telegram', color: '#299ed8', supported: true, description: 'دریافت پیام‌های جدید کانال‌ها و گروه‌هایی که ربات شما به آن‌ها دسترسی دارد.' },
  x: { name: 'ایکس / توییتر', english: 'X / Twitter', color: '#18242c', supported: true, description: 'جست‌وجوی خبرها و هشتگ‌ها با Bearer Token و سطح دسترسی مجاز API ایکس.' },
  instagram: { name: 'اینستاگرام', english: 'Instagram', color: '#c64a81', supported: true, description: 'رسانه‌های حساب حرفه‌ای و هشتگ‌های مجاز، با توکن Meta و مجوزهای رسمی.' },
  facebook: { name: 'فیسبوک', english: 'Facebook', color: '#3678d9', supported: true, description: 'دریافت پست‌های صفحهٔ مجاز، با توکن صفحه و مجوزهای تأییدشدهٔ Meta.' },
  linkedin: { name: 'لینکدین', english: 'LinkedIn', color: '#1877a9', supported: true, description: 'پست‌های سازمانی با توکن و مجوزهای تأییدشدهٔ Community Management.' },
};

async function api<T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, headers: ['POST', 'PUT', 'PATCH'].includes(method) ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? (['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined) : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(error => { if (signal?.aborted) throw error; return null; });
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

function readSortPreference() { try { return localStorage.getItem('dideban-news-sort') || 'latest'; } catch { return 'latest'; } }

function App() {
  const unreadAlerts = useNewsAlerts();
  const [researchId, setResearchId] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard>(emptyDashboard);
  const [page, setPage] = useState<Page>('news');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [categoryName,setCategoryName]=useState('');
  const [categoryForm,setCategoryForm]=useState(false);
  const [visibleCount,setVisibleCount]=useState(40);
  const deferredSearch=useDeferredValue(search);
  const categories=data.categories||Object.entries(categoryLabels).filter(([id])=>id!=='all').map(([id,name])=>({id,name}));
  function navigate(next:Page){startTransition(()=>setPage(next));}
  const [language, setLanguage] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [sort, setSort] = useState(() => readSortPreference());
  const [modal, setModal] = useState<'source' | Platform | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [savedArticles, setSavedArticles] = useState<Article[] | null>(null);
  const [readFilter, setReadFilter] = useState('all');
  useEffect(()=>setVisibleCount(40),[page,category,search,language,period,sourceFilter,readFilter,sort]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const dashboardRequest = useRef<AbortController | null>(null);
  const dashboardVersion = useRef(0);
  const savedRequest = useRef<AbortController | null>(null);
  const savedVersion = useRef(0);
  const activeMutations = useRef(0);
  const syncInProgress = useRef(false);
  const articleCount = useRef(data.articles.length);
  articleCount.current = data.articles.length;

  const notify = (text: string, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5500);
  };
  function cancelDashboardRead() {
    dashboardVersion.current += 1;
    dashboardRequest.current?.abort();
    dashboardRequest.current = null;
  }
  function cancelSavedRead() {
    savedVersion.current += 1;
    savedRequest.current?.abort();
    savedRequest.current = null;
  }
  async function load(background = false) {
    if (background && (document.visibilityState !== 'visible' || activeMutations.current > 0 || syncInProgress.current || dashboardRequest.current)) return;
    cancelDashboardRead();
    const version = dashboardVersion.current;
    const controller = new AbortController();
    dashboardRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const next = await api<Dashboard>('/dashboard', 'GET', undefined, controller.signal);
      if (mounted.current && version === dashboardVersion.current && (!background || document.visibilityState === 'visible')) {
        setData({ ...emptyDashboard, ...next }); setLoadError('');
        if (pageRef.current === 'saved' && background) void loadSaved(true);
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && version === dashboardVersion.current) setLoadError((error as Error).message);
    } finally {
      clearTimeout(timeout);
      if (version === dashboardVersion.current) {
        dashboardRequest.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; cancelDashboardRead(); cancelSavedRead(); clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!disposed && document.visibilityState === 'visible') timer = setTimeout(poll, articleCount.current === 0 ? 3_000 : 10_000);
    };
    async function poll() {
      if (disposed || polling) return;
      polling = true;
      clearTimeout(timer);
      try { await load(true); }
      finally { polling = false; schedule(); }
    }
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, []);
  useEffect(() => {
    setConfirmDelete(null); setMenuOpen(false);
    if (page === 'saved') void loadSaved();
    else { cancelSavedRead(); setSavedArticles(null); }
    return () => cancelSavedRead();
  }, [page]);
  async function loadSaved(background = false) {
    if (pageRef.current !== 'saved' || (background && (activeMutations.current > 0 || syncInProgress.current))) return;
    cancelSavedRead();
    const version = savedVersion.current;
    const controller = new AbortController();
    savedRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await api<{articles: Article[]}>('/saved', 'GET', undefined, controller.signal);
      if (mounted.current && !controller.signal.aborted && version === savedVersion.current && pageRef.current === 'saved') setSavedArticles(result.articles);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && version === savedVersion.current && pageRef.current === 'saved') notify(`دریافت مجموعهٔ ذخیره‌شده ممکن نشد: ${(error as Error).message}`, true);
    } finally {
      clearTimeout(timeout);
      if (version === savedVersion.current) savedRequest.current = null;
    }
  }
  useEffect(() => {
    if (!modal) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);

  useEffect(() => { try { localStorage.setItem('dideban-news-sort', sort); } catch { /* Optional browser preferences can be blocked. */ } }, [sort]);

  const connections = (Object.keys(platformMeta) as Platform[]).map(platform => data.connections.find(item => item.platform === platform) ?? { platform, connected: false, label: null, capability: '' });
  const savedCount = page === 'saved' && savedArticles ? savedArticles.length : data.articles.filter(article => article.saved).length;
  const sourceById = useMemo(()=>new Map(data.sources.map(source => [source.id, source])),[data.sources]);
  const activeSourceCount = data.sources.filter(source => source.enabled).length;
  const todayKey=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const todayStart=Date.parse(`${todayKey}T00:00:00+03:30`);
  const todayCount=data.articles.filter(article=>article.publishedAtKnown!==false&&Date.parse(article.publishedAt)>=todayStart&&Date.parse(article.publishedAt)<todayStart+86400000).length;
  const newsSources = [...new Map([
    ...data.sources.map(source => [source.id, source.name] as const),
    ...data.articles.map(article => [article.sourceId, article.sourceName] as const),
  ])];
  const filteredArticles = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    const relevance = (article: Article) => data.keywords.reduce((score, keyword) => score + (`${article.title} ${article.summary}`.toLowerCase().includes(keyword.toLowerCase().replace(/^#/, '')) ? 1 : 0), 0);
    const chronology = (a: Article, b: Article) => Number(a.publishedAtKnown === false) - Number(b.publishedAtKnown === false) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    const pool = page === 'saved' ? (savedArticles ?? data.articles.filter(article => article.saved)) : data.articles;
    return pool.filter(article =>
      (page !== 'saved' || article.saved) &&
      (readFilter === 'all' || Boolean(article.read) === (readFilter === 'read')) &&
      (category === 'all' || article.category === category) &&
      (language === 'all' || article.language === language) &&
      (sourceFilter === 'all' || article.sourceId === sourceFilter) &&
      (period === 'all' || (article.publishedAtKnown !== false && Date.parse(article.publishedAt) >= Date.now() - Number(period) * 86_400_000)) &&
      (!query || `${article.title} ${article.summary} ${article.sourceName}`.toLocaleLowerCase().includes(query)),
    ).sort((a, b) => sort === 'priority' ? (Number(b.priority || 0) - Number(a.priority || 0)) || Number(sourceById.get(b.sourceId)?.priority || 0) - Number(sourceById.get(a.sourceId)?.priority || 0) || chronology(a, b) : sort === 'relevant' ? relevance(b) - relevance(a) || chronology(a, b) : chronology(a, b));
  }, [data.articles, data.keywords, data.sources, savedArticles, page, category, language, sourceFilter, period, deferredSearch, sort, readFilter]);

  async function sync() {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    cancelDashboardRead();
    cancelSavedRead();
    const version = dashboardVersion.current;
    setSyncing(true);
    try {
      const next = await api<Dashboard>('/sync', 'POST');
      if (mounted.current && version === dashboardVersion.current) { setData(next); setLoadError(''); if (pageRef.current === 'saved') await loadSaved(); }
      if (next.syncErrors.length) notify(`جمع‌آوری تمام شد؛ ${number(next.syncErrors.length)} منبع با خطا روبه‌رو شد. جزئیات را در وضعیت منابع ببینید.`, true);
      else notify('منابع با موفقیت به‌روز شدند.');
    } catch (error) { notify((error as Error).message, true); }
    finally { syncInProgress.current = false; setSyncing(false); }
  }

  async function mutate(path: string, method: string, body: unknown, success: string, busyKey = path) {
    activeMutations.current += 1;
    cancelDashboardRead();
    cancelSavedRead();
    setBusy(busyKey);
    try { await api(path, method, body); await load(); if (pageRef.current === 'saved') await loadSaved(); if (success) notify(success); return true; }
    catch (error) { notify((error as Error).message, true); return false; }
    finally { activeMutations.current -= 1; setBusy(null); }
  }

  async function saveArticle(article: Article) {
    await mutate(`/articles/${article.id}/save`, 'POST', { saved: !article.saved }, article.saved ? 'خبر از ذخیره‌شده‌ها برداشته شد.' : 'خبر در مجموعهٔ شما ذخیره شد.', article.id);
  }
  async function markRead(article: Article, read = !article.read) {
    await mutate(`/articles/${article.id}/read`, 'POST', { read }, '', article.id);
  }
  async function prioritize(article: Article, priority: number) {
    await mutate(`/articles/${article.id}/priority`, 'POST', { priority }, 'اولویت خبر ثبت شد.', article.id);
  }

  async function addKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = keywordInput.trim().replace(/^#+/, '').slice(0, 60);
    if (!keyword) return;
    if (data.keywords.length >= 20) { notify('حداکثر ۲۰ موضوع را می‌توانید دنبال کنید.', true); return; }
    if (data.keywords.some(item => item.replace(/^#/, '').toLowerCase() === keyword.toLowerCase())) { notify('این موضوع را قبلاً اضافه کرده‌اید.', true); return; }
    if (await mutate('/keywords', 'PUT', { keywords: [...data.keywords, keyword] }, 'موضوع به فهرست پایش اضافه شد.')) setKeywordInput('');
  }

  function resetFilters() { setCategory('all'); setLanguage('all'); setSourceFilter('all'); setPeriod('all'); setReadFilter('all'); setSearch(''); }

  const navItems: { id: Page; label: string; icon: typeof Newspaper; count?: number }[] = [
    { id: 'news', label: 'اتاق خبر', icon: Newspaper },
    { id: 'workbench', label: 'بانک خبر پیشرفته', icon: ShieldCheck, count: unreadAlerts || undefined },
    { id: 'lab', label: 'دستیار و ابزارهای تازه', icon: Sparkles },
    { id: 'saved', label: 'ذخیره‌شده‌ها', icon: Bookmark, count: savedCount },
    { id: 'archive', label: 'تاریخچهٔ خبر', icon: Layers3 },
    { id: 'atlas', label: 'نقشهٔ خبر', icon: Globe2 },
    { id: 'markets', label: 'بازارهای جهانی', icon: TrendingUp },
    { id: 'officials', label: 'منابع رسمی مقامات', icon: Radio },
    { id: 'sources', label: 'منابع خبری', icon: Rss, count: data.sources.length },
    { id: 'connections', label: 'حساب‌های متصل', icon: Link2 },
    { id: 'keywords', label: 'موضوع‌ها و هشتگ‌ها', icon: Hash },
  ];

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="بستن فهرست" />}
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('news'); }} aria-label="خبرنما، اتاق خبر">
          <span className="brand-mark"><Radio size={27} strokeWidth={1.7} /></span>
          <span><strong>خبرنما<span className="brand-dot">.</span></strong><small>چشم شما به جهان</small></span>
        </a>
        <div className="workspace-switch"><span className="workspace-icon"><Layers3 size={18} /></span><span>فضای خبری من<small>داشبورد شخصی</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">فضای کاری</div>
        <nav className="main-nav" aria-label="فهرست اصلی">
          {navItems.map(item => <button key={item.id} onClick={() => { if (item.id === 'saved') resetFilters(); navigate(item.id); }} className={`nav-item ${page === item.id ? 'active' : ''}`}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.count !== undefined && <small>{number(item.count)}</small>}</button>)}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-caption sidebar-topics-label">موضوع‌های شما<button aria-label="افزودن موضوع" onClick={() => navigate('keywords')}><Plus size={15} /></button></div>
        <div className="sidebar-topics">{data.keywords.length ? data.keywords.slice(0, 5).map(keyword => <button key={keyword} onClick={() => { navigate('news'); setSearch(keyword.replace(/^#/, '')); }}><Hash size={15} /><span>{keyword.replace(/^#/, '')}</span></button>) : <p>موضوع‌های مهم را دنبال کنید<br />تا خبری را از دست ندهید.</p>}</div>
        <div className="sidebar-bottom"><div className="live-orbit"><Radio size={22} /><span className="orbit-dot" /></div><strong>جهان منتظر نمی‌ماند.</strong><p>منابع را وصل کنید، خبرها را<br />در یک جا دنبال کنید.</p><button onClick={() => navigate('sources')}>مدیریت منابع <ArrowUpLeft size={15} /></button></div>
        <div className="sidebar-profile"><span className="profile-avatar">م</span><span>اتاق خبر شخصی<small><span className="status-dot" /> ذخیره‌سازی محلی</small></span><button aria-label="تنظیمات منابع" onClick={() => navigate('sources')}><Settings2 size={18} /></button></div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="باز کردن فهرست"><Menu size={22} /></button><span>فضای کاری</span><ChevronLeft size={14} /><strong>{navItems.find(item => item.id === page)?.label}</strong></div>
          <div className="topbar-meta"><SessionControls/><span className="today-date">{new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' }).format(new Date())}</span><span className="topbar-separator" /><span className="private-badge"><ShieldCheck size={15} />فضای شخصی شما</span></div>
        </header>

        <NewsTicker articles={data.articles} onOpen={article => { if (!article.read) void markRead(article as Article, true); }} />
        <main className="main-content" data-page={page}><div className="ambient-grid" aria-hidden="true"/><div className="workspace-signal"><span className="signal-pulse"/><span>شبکهٔ خبر شخصی شما</span><strong>KHABARNAMA</strong></div><Suspense fallback={<div className="loading-state"><LoaderCircle className="spin" size={24}/><p>در حال بازکردن بخش…</p></div>}><div className="page-stage" key={page}>
          <section className="page-heading">
            <div><div className="eyebrow"><span /> یک نگاه، تمام خبرها</div><h1>{page === 'lab' ? <>دستیار آرشیو، <span>پژوهش و اجرای ویندوز</span></> : page === 'workbench' ? <>بانک خبر، <span>ابزارهای پژوهش و پایش</span></> : page === 'news' ? <>اتاق خبر شما، <span>همیشه بیدار</span></> : page === 'saved' ? <>خبرهایی برای <span>دوباره خواندن</span></> : page === 'sources' ? <>منابع بیشتر، <span>دید وسیع‌تر</span></> : page === 'connections' ? <>همهٔ شبکه‌ها، <span>یک اتاق خبر</span></> : page === 'archive' ? <>تاریخچهٔ خبر، <span>حافظهٔ اتاق خبر</span></> : page === 'atlas' ? <>خبرها، <span>روی نقشهٔ جهان</span></> : page === 'markets' ? <>بازارهای جهانی، <span>با دادهٔ واقعی</span></> : page === 'officials' ? <>صدای رسمی، <span>از منبع اصلی</span></> : <>موضوع‌های شما، <span>در مرکز توجه</span></>}</h1><p>{page === 'lab' ? 'پرسش از خبرها، ابزارهای رسانه، شرکت‌ها و نسخهٔ نصب‌شونده.' : page === 'workbench' ? 'جست‌وجو، مقایسهٔ روایت‌ها، هشدار و مدیریت آرشیو در یک فضا.' : page === 'news' ? 'از هیاهوی جهان، به خبرهایی برسید که برای شما مهم‌اند.' : page === 'saved' ? 'خبرهای منتخب شما، همیشه در دسترس و یک جا.' : page === 'sources' ? 'فیدهای خبری معتبر را اضافه کنید و وضعیت دریافت خبر را ببینید.' : page === 'connections' ? 'با دسترسی رسمی حساب‌ها، جریان خبر خود را کامل کنید.' : page === 'archive' ? 'خبرهای بایگانی‌شده را با تاریخ، منبع و موضوع پیدا کنید.' : page === 'atlas' ? 'خبرها بر اساس مکان‌های نام‌برده‌شده در متن نمایش داده می‌شوند.' : page === 'markets' ? 'قیمت، زمان داده، واحد و نمودار را کنار هم ببینید.' : page === 'officials' ? 'منابع رسمی و سخنرانی‌ها را جدا از گزارش خبرگزاری‌ها دنبال کنید.' : 'کلمات کلیدی و هشتگ‌ها را برای جست‌وجو و اولویت‌بندی خبرها مشخص کنید.'}</p></div>
            <button className="primary-button" onClick={() => void sync()} disabled={syncing || loading}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? 'در حال جمع‌آوری…' : 'جمع‌آوری خبرها'}</button>
          </section>

          {loadError && <div className="notice error-notice" role="alert"><AlertCircle size={19} /><div><strong>دریافت اطلاعات ممکن نشد</strong><p>{loadError}</p></div><button onClick={() => { setLoading(true); void load(); }}>تلاش دوباره</button></div>}

          <section className="stats-grid" aria-label="آمار اتاق خبر">
            {[{ label: 'خبرهای امروز', value: todayCount, icon: Newspaper, tone: 'orange', note: 'از منابع دریافت‌شده' }, { label: 'منابع فعال', value: activeSourceCount, icon: Rss, tone: 'teal', note: `${number(data.sources.length)} منبع در فهرست شما` }, { label: 'حساب‌های متصل', value: connections.filter(item => item.connected).length, icon: Link2, tone: 'violet', note: 'اتصال از طریق API رسمی' }, { label: 'موضوع‌های پایش', value: data.keywords.length, icon: Hash, tone: 'blue', note: 'خبرها حول علاقه‌های شما' }].map(stat => <div className="stat-card" key={stat.label}><div className={`stat-icon ${stat.tone}`}><stat.icon size={21} strokeWidth={1.7} /></div><div><span className="stat-label">{stat.label}</span><strong>{loading ? '—' : number(stat.value)}</strong><small>{stat.note}</small></div><span className="stat-decoration" /></div>)}
          </section>
          {(page==='news'||page==='saved')&&<CategoryPulse articles={page==='saved'?(savedArticles||[]):data.articles} selected={category} onSelect={setCategory}/>}

          {(page === 'news' || page === 'saved') && <>
            <div className="news-layout">
              <section className="news-column">
                <div className="section-title-row"><h2><span className="section-marker" />{page === 'saved' ? 'مجموعهٔ خبرهای شما' : 'جریان خبر'}</h2><div className="sync-timestamp"><span className={`status-dot ${syncing ? 'is-pulsing' : ''}`} />{syncing ? 'در حال بررسی منابع' : data.lastSyncAt ? `آخرین بررسی: ${relativeDate(data.lastSyncAt)}` : 'آمادهٔ اولین دریافت'}</div></div>
                <div className="news-toolbar"><label className="search-field"><Search size={18} /><input aria-label="جست‌وجو در خبرها" placeholder="جست‌وجو در میان خبرها…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="پاک کردن جست‌وجو" onClick={() => setSearch('')}><X size={14} /></button>}</label><div className="select-field"><ArrowDownWideNarrow size={16} /><select aria-label="ترتیب خبرها" value={sort} onChange={event => setSort(event.target.value)}><option value="latest">تازه‌ترین</option><option value="priority">اولویت دلخواه من</option><option value="relevant">مرتبط با موضوع‌ها</option></select></div></div>
                <div className="category-tabs" aria-label="دسته‌بندی خبرها">{['all',...categories.map(item=>item.id)].map(key => <button className={category === key ? 'active' : ''} key={key} onClick={() => setCategory(key)}>{key === 'all' && <Globe2 size={14} />}{key==='all'?categoryLabels.all:categories.find(item=>item.id===key)?.name}</button>)}<button className="add-category" onClick={()=>setCategoryForm(value=>!value)}><Plus size={14}/>دستهٔ تازه</button></div>{categoryForm&&<form className="category-builder" onSubmit={async event=>{event.preventDefault();if(await mutate('/categories','POST',{name:categoryName},'دسته ساخته شد.')){setCategoryName('');setCategoryForm(false);}}}><input aria-label="نام دستهٔ تازه" value={categoryName} maxLength={40} required onChange={event=>setCategoryName(event.target.value)} placeholder="مثلاً انرژی یا تحولات منطقه"/><button className="primary-button" disabled={!!busy}>ساخت دسته</button></form>}
                <div className="filter-row"><span>{number(filteredArticles.length)} خبر {page === 'saved' ? 'ذخیره‌شده' : 'در دسترس'}</span><div>
                  <select aria-label="بازهٔ زمانی خبر" value={period} onChange={event => setPeriod(event.target.value)}><option value="all">همهٔ زمان‌ها</option><option value="1">۲۴ ساعت اخیر</option><option value="7">هفت روز اخیر</option></select>
                  <select aria-label="وضعیت خواندن" value={readFilter} onChange={event => setReadFilter(event.target.value)}><option value="all">همهٔ خبرها</option><option value="unread">خوانده‌نشده</option><option value="read">خوانده‌شده</option></select>
                  <select aria-label="زبان خبر" value={language} onChange={event => setLanguage(event.target.value)}><option value="all">همهٔ زبان‌ها</option><option value="fa">فارسی</option><option value="en">انگلیسی</option></select>
                  <select aria-label="منبع خبر" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">همهٔ منابع</option>{newsSources.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                </div></div>

                {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><p>در حال آماده‌سازی اتاق خبر…</p></div> : filteredArticles.length > 0 ? <div className="article-list">{filteredArticles.slice(0,visibleCount).map((article, index) => <ArticleCard key={article.id} article={article} featured={index === 0 && page === 'news' && !search} busy={busy === article.id} onSave={() => void saveArticle(article)} onRead={() => void markRead(article)} onOpen={() => { if (!article.read) void markRead(article, true); }} onPriority={priority => void prioritize(article, priority)} iconUrl={article.sourceIconUrl || sourceById.get(article.sourceId)?.iconUrl} categories={categories} onCategory={value=>void mutate(`/articles/${article.id}/category`,'POST',{category:value||null},'دسته‌بندی ذخیره شد.',article.id)} onResearch={() => setResearchId(article.id)} />)}</div> : <div className="empty-news"><div className="empty-illustration"><div className="illustration-orbit orbit-one" /><div className="illustration-orbit orbit-two" /><span className="floating-chip chip-rss"><Rss size={19} /></span><span className="floating-chip chip-globe"><Globe2 size={18} /></span><span className="floating-chip chip-hash"><Hash size={18} /></span><div className="paper-illustration"><span className="paper-head"><span /><i /></span><span className="paper-line long" /><span className="paper-line" /><div className="paper-columns"><span /><div><i /><i /><i /></div></div><span className="paper-line long" /></div><span className="illustration-star"><Sparkles size={18} /></span></div><span className="empty-eyebrow">{page === 'saved' ? 'مجموعهٔ شخصی شما' : data.articles.length ? 'جست‌وجوی دقیق‌تر' : 'آغاز یک جریان تازه'}</span><h3>{page === 'saved' && !savedCount ? 'خبرهای ارزشمند را نگه دارید' : data.articles.length ? 'خبری با این فیلترها پیدا نشد' : 'اولین خبر، یک کلیک فاصله دارد'}</h3><p>{page === 'saved' && !savedCount ? 'روی نشان ذخیره در کنار هر خبر بزنید تا بعداً به آن برگردید.' : data.articles.length ? 'کلمهٔ دیگری را امتحان کنید یا فیلترها را تغییر دهید.' : 'منابع خبری آماده‌اند. جمع‌آوری را شروع کنید تا تازه‌ترین خبرها در اتاق خبر شما نمایش داده شوند.'}</p>{page === 'saved' && !savedCount ? <button className="primary-button" onClick={() => navigate('news')}>رفتن به اتاق خبر<ArrowLeft size={16} /></button> : data.articles.length ? <button className="secondary-button" onClick={resetFilters}>پاک کردن فیلترها</button> : <button className="primary-button" onClick={() => void sync()} disabled={syncing}><RefreshCw size={16} className={syncing ? 'spin' : ''} />{syncing ? 'در حال دریافت خبرها…' : 'شروع جمع‌آوری'}</button>}<div className="empty-trust"><ShieldCheck size={14} />خبرها با لینک مستقیم به منبع اصلی نمایش داده می‌شوند.</div></div>}{filteredArticles.length>visibleCount&&<button className="load-more-news secondary-button" onClick={()=>setVisibleCount(value=>value+40)}>نمایش ۴۰ خبر بعدی · {number(filteredArticles.length-visibleCount)} خبر دیگر</button>}
              </section>
              <aside className="news-rail">
                <section className="rail-panel sources-panel"><div className="rail-heading"><h3>رادار منابع</h3><span className="tiny-badge">{number(activeSourceCount)} فعال</span></div><p className="rail-description">پنجره‌های شما رو به جهان</p><div className="source-mini-list">{data.sources.slice(0, 5).map((source, index) => <div className="source-mini" key={source.id}><SourceAvatar source={source} index={index} /><div><strong>{source.name}</strong><small>{!source.enabled ? 'غیرفعال' : source.lastError ? 'نیاز به بررسی' : source.lastFetchedAt ? 'دریافت موفق' : 'آمادهٔ دریافت'}</small></div><span className={`status-dot ${!source.enabled ? 'muted' : source.lastError ? 'warning' : ''}`} /></div>)}{!data.sources.length && <div className="rail-empty">هنوز منبعی اضافه نشده است.</div>}</div><button className="rail-link" onClick={() => navigate('sources')}>همهٔ منابع<ArrowLeft size={15} /></button></section>
                <section className="rail-panel topics-panel"><div className="rail-heading"><h3>روی رادار شما</h3><Hash size={17} /></div><p className="rail-description">موضوع‌هایی که دنبال می‌کنید</p><div className="keyword-cloud">{data.keywords.length ? data.keywords.slice(0, 8).map(keyword => <button key={keyword} onClick={() => setSearch(keyword.replace(/^#/, ''))}><span>#</span>{keyword.replace(/^#/, '')}</button>) : <p>فناوری؟ اقتصاد؟ سیاست؟<br />اولین موضوع خود را اضافه کنید.</p>}</div><button className="rail-link" onClick={() => navigate('keywords')}><span><Plus size={14} /> مدیریت موضوع‌ها</span><ArrowLeft size={15} /></button></section>
                <section className="connect-promo"><span className="promo-icon"><Link2 size={21} /></span><h3>خبر فقط در سایت‌ها نیست.</h3><p>شبکه‌های اجتماعی را به جریان خبر خود اضافه کنید.</p><div className="platform-mini-icons">{(Object.keys(platformMeta) as Platform[]).map(platform => <span key={platform}><PlatformIcon platform={platform} size={16} /></span>)}</div><button onClick={() => navigate('connections')}>اتصال حساب‌ها<ArrowUpLeft size={16} /></button></section>
              </aside>
            </div>
          </>}

          {(page === 'sources' || page === 'officials') && <SourceManager sources={data.sources} articles={data.articles} officialOnly={page === 'officials'} busy={busy} onAdd={() => setModal('source')} onMutate={mutate} onChanged={async()=>{await load();}} />}
          {page === 'archive' && <ArchivePanel />}
          {page === 'atlas' && <AtlasPanel articles={data.articles} />}
          {page === 'markets' && <MarketsPanel />}
          {page === 'workbench' && <NewsWorkbench sources={data.sources} onChanged={() => void load()} />}
          {page === 'lab' && <ResearchLab onSelect={setResearchId} />}


          {page === 'connections' && <section className="management-section"><div className="section-title-row"><div><h2><span className="section-marker" />شبکه‌های اجتماعی</h2><p className="section-description">از لینک منابع عمومی بدون کلید استفاده کنید؛ اتصال‌های دارای مجوز نیز در پایین صفحه موجودند.</p></div><span className="outline-badge"><ShieldCheck size={15} />دسترسی مجاز</span></div><PublicSocialConnections sources={data.sources} onChanged={async()=>{await load();}}/><h3 style={{marginTop:28}}>اتصال‌های دارای توکن و مجوز رسمی</h3><div className="connection-cards">{connections.map(connection => { const meta = platformMeta[connection.platform]; return <article className="connection-card" key={connection.platform}><div className="connection-top"><span className="platform-logo" style={{ color: meta.color, backgroundColor: `${meta.color}10` }}><PlatformIcon platform={connection.platform} size={25} /></span><span className={`connection-status ${connection.connected ? 'connected' : ''}`}>{connection.connected ? <><span className="status-dot" />متصل</> : meta.supported ? 'متصل نشده' : 'نیازمند مجوز پلتفرم'}</span></div><h3>{meta.name}<small>{meta.english}</small></h3><p>{meta.description}</p>{connection.connected && <div className="connection-account"><CheckCheck size={15} />{connection.label || 'حساب تأییدشده'}</div>}<div className="connection-footer">{connection.connected ? <button className="disconnect-button" disabled={busy === connection.platform} onClick={() => void mutate(`/connections/${connection.platform}`, 'DELETE', undefined, 'اتصال حساب قطع شد.', connection.platform)}><Link2 size={15} />قطع اتصال</button> : <button className={meta.supported ? 'secondary-button' : 'muted-button'} onClick={() => setModal(connection.platform)}>{meta.supported ? <Plus size={15} /> : <CircleHelp size={15} />}{meta.supported ? 'اتصال حساب' : 'شرایط اتصال'}</button>}<span>{connection.platform === 'telegram' ? 'Bot API' : connection.platform === 'x' ? 'API v2' : 'API رسمی'}</span></div></article>; })}</div><CustomNetworks connections={data.customConnections || []} onChange={async () => { await load(); }} notify={notify} /><div className="info-strip"><ShieldCheck size={19} /><p>رمز عبور شبکه‌های اجتماعی را وارد نکنید. توکن‌های اتصال در سرور به‌صورت رمزگذاری‌شده نگه‌داری می‌شوند. این نسخه اتصال عمومی OAuth برای همهٔ پلتفرم‌ها ندارد.</p></div></section>}

          {page === 'keywords' && <section className="keywords-layout"><div className="management-section keyword-main"><div className="section-title-row"><div><h2><span className="section-marker" />فهرست پایش شما</h2><p className="section-description">یک کلمه، نام، عبارت یا هشتگ اضافه کنید.</p></div><span className="tiny-badge">{number(data.keywords.length)} موضوع</span></div><form className="keyword-form" onSubmit={event => void addKeyword(event)}><label><Hash size={20} /><input value={keywordInput} onChange={event => setKeywordInput(event.target.value)} maxLength={60} placeholder="مثلاً هوش مصنوعی یا climate" aria-label="موضوع جدید" /></label><button className="primary-button" disabled={busy === '/keywords' || !keywordInput.trim()}><Plus size={17} />افزودن موضوع</button></form>{data.keywords.length ? <div className="keyword-list">{data.keywords.map(keyword => { const count = data.articles.filter(article => `${article.title} ${article.summary}`.toLowerCase().includes(keyword.toLowerCase().replace(/^#/, ''))).length; return <div className="keyword-row" key={keyword}><span className="keyword-hash"><Hash size={19} /></span><div><strong>{keyword.replace(/^#/, '')}</strong><small>{number(count)} خبر مرتبط در داده‌های دریافت‌شده</small></div><button className="text-button" onClick={() => { navigate('news'); setSearch(keyword.replace(/^#/, '')); }}>دیدن خبرها<ChevronLeft size={14} /></button><button className="icon-button subtle-danger" disabled={busy === '/keywords'} aria-label={`حذف موضوع ${keyword}`} onClick={() => void mutate('/keywords', 'PUT', { keywords: data.keywords.filter(item => item !== keyword) }, 'موضوع حذف شد.')}><Trash2 size={16} /></button></div>; })}</div> : <div className="keyword-empty"><Hash size={34} /><h3>کنجکاوی شما از کجا شروع می‌شود؟</h3><p>اولین موضوع را اضافه کنید تا خبرهای مرتبط را راحت‌تر پیدا کنید.</p></div>}</div><aside className="keyword-help"><span className="help-icon"><Sparkles size={25} /></span><h3>خبرهای مهم را<br />نزدیک‌تر نگه دارید.</h3><p>موضوع‌ها برای پیدا کردن و اولویت‌بندی خبرهای دریافت‌شده استفاده می‌شوند.</p><div className="help-step"><span>۱</span><p>نام یک موضوع یا هشتگ را اضافه کنید.</p></div><div className="help-step"><span>۲</span><p>در اتاق خبر، ترتیب «مرتبط با موضوع‌ها» را انتخاب کنید.</p></div><div className="help-step"><span>۳</span><p>با اتصال ایکس، همین موضوع‌ها در جست‌وجوی API استفاده می‌شوند.</p></div><small>این نسخه ترجمه یا راستی‌آزمایی خودکار خبر انجام نمی‌دهد.</small></aside></section>}

          {data.syncErrors.length > 0 && <section className="sync-errors"><button className="sync-errors-heading" onClick={() => setShowAllErrors(!showAllErrors)} aria-expanded={showAllErrors}><AlertCircle size={16} /><span>{number(data.syncErrors.length)} منبع در آخرین جمع‌آوری به بررسی نیاز دارد</span><ChevronDown size={16} className={showAllErrors ? 'rotated' : ''} /></button>{showAllErrors && <div className="sync-errors-content">{data.syncErrors.map((error, index) => <p key={`${error.sourceId}-${index}`}><strong>{error.sourceName}</strong><span>{error.message}</span></p>)}</div>}</section>}

          <footer className="main-footer"><span><Eye size={16} /><strong>خبرنما</strong> خبرها را کنار هم می‌آورد.</span><small>محتوا متعلق به منابع اصلی است · دسترسی بر اساس مجوز هر پلتفرم</small><span className="footer-tag">با نگاهی باز به جهان<ArrowUpLeft size={13} /></span></footer>
        </div></Suspense></main>
      </div>

      {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={19} /> : <Check size={19} />}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="بستن پیام"><X size={15} /></button></div>}

      {researchId && <ArticleResearch id={researchId} onClose={() => setResearchId(null)} onChanged={() => void load()} />}
      {modal && <Modal kind={modal} sourceKind={page === 'officials' ? 'official' : 'news'} busy={busy !== null} onClose={() => setModal(null)} onSubmit={async values => {
        if (modal === 'source') {
          const ok = await mutate('/sources', 'POST', values, 'منبع ثبت شد. وضعیت دریافت یا پیوند سایت را در فهرست منابع ببینید.');
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

function SourceAvatar({ source, index = 0 }: { source: {name: string; iconUrl?: string | null}; index?: number }) {
  const [failed, setFailed] = useState(false);
  return <span className={`source-monogram source-color-${index % 4}`}>
    {source.iconUrl && !failed ? <img src={source.iconUrl} alt={`نشان ${source.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : source.name.slice(0, 1)}
  </span>;
}

function ArticleCard({ article, featured, busy, onSave, onRead, onOpen, onPriority, iconUrl, onResearch, categories, onCategory }: {
  article: Article; featured: boolean; busy: boolean; onSave: () => void; onRead: () => void; onOpen: () => void;
  categories:{id:string;name:string}[]; onCategory:(value:string)=>void; onPriority: (value: number) => void; iconUrl?: string | null; onResearch: () => void;
}) {
  const [seenLocally, setSeenLocally] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (article.seen || article.read || !cardRef.current) return;
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || document.visibilityState !== 'visible') return;
      observer.disconnect();
      void api('/articles/seen', 'POST', { ids: [article.id] }).then(() => { if (!disposed) setSeenLocally(true); }).catch(() => {});
    }, { threshold: 0.5 });
    observer.observe(cardRef.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [article.id, article.seen, article.read]);
  const [imageFailed, setImageFailed] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const media = article.media || [];
  const video = media.find(item => item.type === 'video');
  const image = media.find(item => item.type === 'image')?.url || article.imageUrl;
  return <article ref={cardRef} className={`article-card ${featured ? 'featured-article' : ''} ${article.read ? 'is-read' : ''} priority-${article.priority || 0}`}>
    {featured && <div className="featured-label"><span /><Zap size={13} />تازه روی رادار</div>}
    <div className="article-card-inner">
      <div className="article-text">
        <div className="article-meta">
          <span className="article-source"><SourceAvatar source={{name: article.sourceName, iconUrl}} />{article.sourceName}</span><span className="meta-dot">·</span>
          <time dateTime={article.publishedAtKnown === false ? undefined : article.publishedAt}>{article.publishedAtKnown === false ? 'زمان انتشار نامشخص' : relativeDate(article.publishedAt)}</time>
          <span className="article-category">{categories.find(item=>item.id===article.category)?.name || categoryLabels[article.category] || 'عمومی'}</span>
          {!article.read && (article.seen || seenLocally) && <span className="read-badge">دیده‌شده</span>}
          {article.read && <span className="read-badge"><CheckCheck size={13} />خوانده‌شده</span>}
        </div>
        <a className="article-title" href={article.url} target="_blank" rel="noreferrer" onClick={onOpen}><h3 dir="auto">{article.title}</h3></a>
        <p className="article-summary" dir="auto">{article.summary}</p><PersianTranslation article={article} />
        {(article.duplicateCount || 0) > 0 && <div className="duplicate-badge"><Layers3 size={13} />عنوان مشابه در {number((article.duplicateCount || 0) + 1)} گزارش{article.readInherited ? ' · از قبل خوانده‌شده' : ''}</div>}
        {!!article.locations?.length && <div className="article-places">{article.locations.slice(0, 3).map(location => <span key={`${location.countryCode}-${location.city || ''}`}><Globe2 size={11} />{location.city || location.countryName}</span>)}</div>}
        {article.summaryAuto && <div className="article-summary-tool"><button className="text-button" onClick={() => setSummaryOpen(!summaryOpen)} aria-expanded={summaryOpen}><Sparkles size={14} />{summaryOpen ? 'بستن خلاصه' : 'خلاصهٔ خودکار'}</button>{summaryOpen && <div className="generated-summary"><small>خلاصهٔ استخراجی از متن خبر؛ بدون افزودن تحلیل یا ادعای جدید</small><p dir="auto">{article.summaryAuto}</p></div>}</div>}
        <label className="manual-category">دسته‌بندی من<select aria-label={`دسته‌بندی خبر ${article.title}`} value={article.userCategory||''} disabled={busy} onChange={event=>onCategory(event.target.value)}><option value="">خودکار · {categoryLabels[article.originalCategory||article.category]||'عمومی'}</option>{categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{article.userCategory&&<small>انتخاب شما</small>}</label><button className="article-research-button" onClick={onResearch}><Search size={14} />پرونده، ترجمه و یادداشت خبر</button><div className="article-bottom"><a href={article.url} target="_blank" rel="noreferrer" onClick={onOpen}>خواندن در منبع اصلی<ArrowUpLeft size={14} /></a>
          <div className="article-actions"><label className="article-priority"><span>اولویت</span><select aria-label={`اولویت خبر ${article.title}`} value={article.priority || 0} disabled={busy} onChange={event => onPriority(Number(event.target.value))}><option value="0">عادی</option><option value="1">دلخواه</option><option value="2">مهم</option><option value="3">بسیار مهم</option></select></label><button className={`read-button ${article.read ? 'active' : ''}`} aria-label={article.read ? 'علامت خوانده‌نشده' : 'علامت خوانده‌شده'} onClick={onRead} disabled={busy}><CheckCheck size={18} /></button>
            <button onClick={onSave} disabled={busy} className={`save-button ${article.saved ? 'is-saved' : ''}`} aria-label={article.saved ? 'برداشتن خبر از ذخیره‌شده‌ها' : 'ذخیره خبر'} aria-pressed={article.saved}>{busy ? <LoaderCircle className="spin" size={18} /> : <Bookmark size={18} fill={article.saved ? 'currentColor' : 'none'} strokeWidth={1.7} />}</button>
          </div>
        </div>
      </div>
      {image && !imageFailed && <a className="article-image real-article-image" href={article.url} target="_blank" rel="noreferrer" onClick={onOpen}><img src={image} alt={`تصویر منتشرشده همراه خبر ${article.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /><span>تصویر منبع خبر</span></a>}
    </div>
    {video && <div className="article-video">{!mediaError ? <video controls preload="none" poster={video.poster} onError={() => setMediaError(true)}><source src={video.url} type={video.mimeType || undefined} />مرورگر از پخش این ویدیو پشتیبانی نمی‌کند.</video> : <p>پخش مستقیم این رسانه ممکن نشد.</p>}<a href={video.url} target="_blank" rel="noreferrer">ویدیوی اصلی منتشرشده توسط منبع<ExternalLink size={13} /></a></div>}
  </article>;
}

function SourceManager({ sources, articles, officialOnly, busy, onAdd, onMutate, onChanged }: {
  sources: Source[]; articles: Article[]; officialOnly: boolean; busy: string | null; onAdd: () => void;
  onChanged:()=>Promise<void>; onMutate: (path: string, method: string, body: unknown, success: string, busyKey?: string) => Promise<boolean>;
}) {
  const [catalog, setCatalog] = useState<CatalogSource[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [country, setCountry] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<{sources?: CatalogSource[]; officials?: CatalogSource[]}>('/catalog', 'GET', undefined, controller.signal).then(result => {
      const list = [...(result.sources || []), ...(result.officials || [])];
      setCatalog([...new Map(list.map(source => [source.id, source])).values()]);
    }).catch(error => { if (!controller.signal.aborted) setCatalogError(error.message); });
    return () => controller.abort();
  }, []);
  const countryName = (value?: string) => { try { return value ? new Intl.DisplayNames(['fa'], {type: 'region'}).of(value) || value : 'جهانی'; } catch { return value || 'جهانی'; } };
  const filtered = sources.filter(source => (!officialOnly || source.kind === 'official') && (country === 'all' || source.countryCode === country) && `${source.name} ${source.url}`.toLowerCase().includes(query.toLowerCase()));
  const available = catalog.filter(source => (!officialOnly || source.kind === 'official') && (country === 'all' || source.countryCode === country) && `${source.name} ${source.description || ''}`.toLowerCase().includes(query.toLowerCase()));
  const countrySources = [...sources, ...catalog].filter(source => !officialOnly || source.kind === 'official');
  const countries = [...new Set(countrySources.map(source => source.countryCode).filter(Boolean))] as string[];
  return <section className="management-section">
    <div className="section-title-row"><div><h2><span className="section-marker" />{officialOnly ? 'سخنرانی‌ها و پیام‌های رسمی' : 'منابع خبری شما'}</h2><p className="section-description">{officialOnly ? 'منابع رسمی مقامات و نهادها؛ عنوان «رسمی» از فهرست منبع می‌آید و تأیید صحت ادعا نیست.' : 'خبرگزاری‌های ایران، رسانه‌های محلی جهان و فیدهای عمومی دلخواه.'}</p></div><button className="secondary-button" onClick={onAdd}><Plus size={16} />افزودن منبع</button></div>
    {officialOnly && <div className="official-country-shortcuts" aria-label="کشورهای منابع رسمی" style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:16}}>{['US','GB','IL','RU','CN','UA','IR'].map(code => <button key={code} className="secondary-button" aria-pressed={country === code} onClick={() => setCountry(code)} style={country === code ? {borderColor:'#258775',background:'#edf6f2'} : undefined}>{countryName(code)}</button>)}<button className="secondary-button" onClick={() => setCountry('all')}>همهٔ منابع رسمی</button></div>}
    <div className="catalog-filters"><label className="search-field"><Search size={17} /><input aria-label="جست‌وجوی منابع" value={query} onChange={event => setQuery(event.target.value)} placeholder="نام خبرگزاری یا منبع رسمی…" /></label><select aria-label="کشور منبع" value={country} onChange={event => setCountry(event.target.value)}><option value="all">همهٔ کشورها</option>{countries.map(code => <option key={code} value={code}>{countryName(code)}</option>)}</select></div>
    <div className="source-cards">{filtered.map((source, index) => <article className="source-card" key={source.id}>
      <div className="source-card-top"><SourceAvatar source={source} index={index} /><span className="source-kind"><Rss size={12} />{source.kind === 'official' ? 'رسمی' : source.platform === 'rss' ? 'RSS' : source.platform === 'website' ? 'دریافت از سایت' : source.platform === 'website-link' ? 'پیوند سایت' : source.platform==='auto'?'در انتظار بررسی': source.platform.endsWith('-public') ? 'عمومی · بدون کلید' : source.platform}</span><button className={`toggle-switch ${source.enabled ? 'on' : ''}`} role="switch" aria-checked={source.enabled} aria-label={`${source.enabled ? 'غیرفعال‌کردن' : 'فعال‌کردن'} ${source.name}`} disabled={busy === source.id || source.platform === 'website-link'} onClick={() => void onMutate(`/sources/${source.id}`, 'PATCH', {enabled: !source.enabled}, 'وضعیت منبع تغییر کرد.', source.id)}><span /></button></div>
      <h3>{source.name}</h3><a className="source-url" href={source.url} target="_blank" rel="noreferrer">{safeHost(source.url)}<ExternalLink size={12} /></a><small className="source-country">{countryName(source.countryCode)}</small>
      <label className="source-priority">اولویت منبع<select aria-label={`اولویت منبع ${source.name}`} value={source.priority || 0} disabled={busy === source.id} onChange={event => void onMutate(`/sources/${source.id}`, 'PATCH', {priority: Number(event.target.value)}, 'اولویت منبع ثبت شد.', source.id)}><option value="0">عادی</option><option value="1">دلخواه</option><option value="2">مهم</option><option value="3">بسیار مهم</option></select></label>
      <div className={`source-status ${source.lastError ? 'failed' : ''}`}><span className={`status-dot ${!source.enabled ? 'muted' : source.lastError ? 'warning' : ''}`} />{source.platform === 'auto'&&!source.lastFetchedAt?'ثبت شده؛ دریافت تأیید نشده':source.platform === 'website-link' ? 'فقط پیوند سایت؛ دریافت خبر ندارد' : !source.enabled ? 'دریافت خبر متوقف است' : source.lastError ? 'خطا در دریافت' : source.lastFetchedAt ? `آخرین دریافت ${relativeDate(source.lastFetchedAt)}` : 'آماده برای اولین دریافت'}</div>{source.lastError && <p className="source-error">{source.lastError}</p>}<button className="secondary-button source-retry" disabled={!!busy} onClick={()=>void onMutate(`/sources/${source.id}/retry`,'POST',{},'بررسی دریافت انجام شد.',source.id)}><RefreshCw size={14}/>بررسی دریافت</button>
      <div className="source-card-footer"><span>{number(articles.filter(article => article.sourceId === source.id).length)} خبر در داشبورد</span>{confirmDelete === source.id ? <div className="delete-confirm"><button onClick={() => { void onMutate(`/sources/${source.id}`, 'DELETE', undefined, 'منبع حذف شد.', source.id); setConfirmDelete(null); }}>حذف شود</button><button onClick={() => setConfirmDelete(null)}>انصراف</button></div> : <button className="subtle-danger" aria-label={`حذف ${source.name}`} onClick={() => setConfirmDelete(source.id)}><Trash2 size={15} /></button>}</div>
    </article>)}<button className="add-source-card" onClick={onAdd}><span><Plus size={25} /></span><strong>افزودن سایت، کانال یا منبع رسمی</strong><small>RSS، دادهٔ خبری سایت یا ذخیرهٔ پیوند</small></button></div>
    {officialOnly&&country==='UA'&&<div className="info-strip"><Send size={18}/><p>برای دریافت خودکار پست‌ها و سخنرانی‌های زلنسکی، منبع تلگرام عمومی را از فهرست زیر اضافه کنید. دسترسی هر کانال هنگام افزودن بررسی می‌شود. برای متن سایت ریاست‌جمهوری، ورود دستی سخنرانی در پایین صفحه موجود است.</p></div>}<div className="source-catalog"><div className="section-title-row"><div><h3>فهرست پیشنهادی منابع</h3><p className="section-description">ثبت منبع، به معنای دریافت همهٔ تاریخچه یا تأیید محتوای آن نیست.</p></div><span className="tiny-badge">{number(available.length)} منبع</span></div>
      {catalogError && <p className="form-error" role="status">فهرست منابع در دسترس نیست: {catalogError}</p>}
      <div className="catalog-list">{available.map(source => {
        const existing = sources.find(item => item.url === source.url);
        return <div className="catalog-row" key={source.id}><SourceAvatar source={source} /><div><strong>{source.kind === 'official' ? <a href={source.websiteUrl || source.url} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={12} /></a> : source.name}</strong><small>{countryName(source.countryCode)} · {source.description || (source.kind === 'official' ? 'منبع رسمی' : 'خبر محلی و عمومی')}</small>{source.kind === 'official' && <small>{source.collection === 'website' ? 'پیوند رسمی · دریافت خودکار فعال نیست' : source.collection==='structured'?'سایت رسمی · دریافت پس از بررسی صفحه':'فید رسمی · دریافت پس از افزودن و پاسخ موفق منبع'}</small>}</div>{source.collection === 'website' ? <div className="catalog-source-actions"><a className="secondary-button" href={source.url} target="_blank" rel="noreferrer">مشاهدهٔ سایت رسمی<ExternalLink size={14} /></a>{existing?<span className="catalog-added">پیوند ثبت شده</span>:<button className="secondary-button" disabled={!!busy} onClick={()=>void onMutate(`/catalog/${source.id}/add`,'POST',{mode:'link'},'پیوند منبع رسمی ثبت شد؛ دریافت خودکار فعال نیست.',source.id)}>افزودن پیوند</button>}</div> : existing ? <span className="catalog-added"><Check size={14} />در فهرست شما</span> : <button className="secondary-button" disabled={busy === source.id} onClick={() => void onMutate(`/catalog/${source.id}/add`, 'POST', {}, 'منبع به فهرست شما اضافه شد.', source.id)}>{busy === source.id ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}افزودن</button>}{!existing&&source.collection!=='website'&&<button className="pending-source-button" disabled={!!busy} onClick={()=>void onMutate(`/catalog/${source.id}/add`,'POST',{mode:'pending'},'منبع ثبت شد؛ دریافت هنوز تأیید نشده است.',source.id)}>ثبت برای بررسی بعدی</button>}</div>;
      })}</div>
    </div>
    {officialOnly&&<BrowserReader initialType="official" onChanged={onChanged}/>}<div className="info-strip"><CircleHelp size={18} /><p>آدرس RSS یا سایت دارای دادهٔ ساختاریافتهٔ خبر را وارد کنید. اگر دریافت ممکن نبود، می‌توانید فقط پیوند سایت را ذخیره کنید. برای کانال‌ها و صفحه‌های اجتماعی، فقط محتوای عمومی یا محتوای مجاز API قابل دریافت است؛ دسترسی به همهٔ صفحه‌ها با یک حساب تضمین نمی‌شود.</p></div>
  </section>;
}

function CustomNetworks({ connections, onChange, notify }: {connections: CustomConnection[]; onChange: () => Promise<void>; notify: (text: string, error?: boolean) => void}) {
  const [catalog, setCatalog] = useState<{type: string; name: string; description: string; requirements?: string[]}[]>([]);
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState({label: '', instanceUrl: '', accountId: '', actor: '', token: ''});
  useEffect(() => { const controller = new AbortController(); void api<{connectors?: typeof catalog} | typeof catalog>('/connectors', 'GET', undefined, controller.signal).then(result => { const list = Array.isArray(result) ? result : result.connectors || []; setCatalog(list); setType(list[0]?.type || ''); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, []);
  const selected = catalog.find(item => item.type === type);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/custom-connections', 'POST', {type, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]))}); await onChange(); setActive(false); setValues({label: '', instanceUrl: '', accountId: '', actor: '', token: ''}); notify('اتصال سفارشی با دسترسی سرویس ثبت شد.'); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="custom-networks"><div className="section-title-row"><div><h3>شبکه‌های بیشتر و اتصال دلخواه</h3><p className="section-description">Mastodon، Bluesky و اتصال‌های ایرانی قابل پشتیبانی؛ برای هر شبکهٔ دارای RSS نیز می‌توانید منبع اضافه کنید.</p></div><button className="secondary-button" onClick={() => setActive(!active)}><Plus size={16} />افزودن شبکه</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="custom-connection-list">{connections.map(connection => <div className="catalog-row" key={connection.id}><span className="custom-platform-avatar"><Link2 size={18} /></span><div><strong>{connection.label || connection.type}</strong><small>{connection.description || connection.type}</small></div><button className="subtle-danger" aria-label={`قطع اتصال ${connection.label}`} disabled={busy} onClick={async () => { setBusy(true); try { await api(`/custom-connections/${connection.id}`, 'DELETE'); await onChange(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>قطع اتصال</button></div>)}</div>
    {active && <form className="custom-connection-form" onSubmit={event => void submit(event)}><label>نوع شبکه<select aria-label="نوع شبکهٔ سفارشی" value={type} onChange={event => {setType(event.target.value); setValues(previous => ({...previous, token: '', accountId: '', actor: '', instanceUrl: ''}));}} required><option value="" disabled>انتخاب کنید</option>{catalog.map(item => <option key={item.type} value={item.type}>{item.name}</option>)}</select></label><p className="custom-provider-description">{selected?.description}</p><label>نام دلخواه<input aria-label="نام اتصال سفارشی" value={values.label} onChange={event => setValues({...values, label: event.target.value})} maxLength={100} /></label>
      {type === 'mastodon' && <><label>نشانی سرور Mastodon<input aria-label="نشانی سرور Mastodon" dir="ltr" type="url" value={values.instanceUrl} placeholder="https://mastodon.social" onChange={event => setValues({...values, instanceUrl: event.target.value})} required /></label><label>شناسهٔ عددی حساب<input aria-label="شناسهٔ حساب Mastodon" dir="ltr" value={values.accountId} onChange={event => setValues({...values, accountId: event.target.value})} required /></label></>}
      {type === 'bluesky' && <label>شناسهٔ عمومی Bluesky<input aria-label="شناسهٔ Bluesky" dir="ltr" placeholder="handle.bsky.social" value={values.actor} onChange={event => setValues({...values, actor: event.target.value})} required /></label>}
      {type !== 'bluesky' && <label>{type === 'bale' ? 'توکن ربات بله' : 'توکن دسترسی — در صورت نیاز'}<input aria-label="توکن شبکهٔ سفارشی" dir="ltr" type="password" autoComplete="new-password" value={values.token} onChange={event => setValues({...values, token: event.target.value})} required={type === 'bale'} /></label>}
      {selected?.requirements?.length ? <ul className="custom-requirements">{selected.requirements.map(item => <li key={item}>{item}</li>)}</ul> : null}
      <div className="modal-actions"><button className="primary-button" disabled={busy || !type}>{busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}بررسی و اتصال شبکه</button><button className="secondary-button" type="button" onClick={() => setActive(false)} disabled={busy}>انصراف</button></div>
    </form>}
    <div className="info-strip"><Rss size={17} /><p>برای شبکه‌های دیگر یا شبکه‌های ایرانی که API رسمی در دسترس ندارند، نشانی فید عمومی را در «منابع خبری» اضافه کنید. رمز عبور حساب‌ها را در برنامه وارد نکنید.</p></div>
  </div>;
}

function Modal({ kind, sourceKind = 'news', busy, onClose, onSubmit }: { kind: 'source' | Platform; sourceKind?: string; busy: boolean; onClose: () => void; onSubmit: (values: unknown) => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState('auto');
  const [kindOfSource, setKindOfSource] = useState(sourceKind);
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
      await onSubmit({ name: name.trim(), url: url.trim(), kind: kindOfSource, mode:sourceMode });
    } else {
      if (!token.trim()) { setFormError('توکن دسترسی را وارد کنید.'); return; }
      if (['instagram', 'facebook', 'linkedin'].includes(kind) && !accountId.trim()) { setFormError('شناسهٔ حساب، صفحه یا سازمان را وارد کنید.'); return; }
      await onSubmit({ token: token.trim(), label: name.trim() || undefined, ...(kind === 'telegram' ? { channels: channels.split(/[،,\n]/).map(item => item.trim()).filter(Boolean) } : {}), ...(['instagram', 'facebook', 'linkedin'].includes(kind) ? { accountId: accountId.trim() } : {}) });
    }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialog} tabIndex={-1} onKeyDown={trapFocus}><button className="modal-close icon-button" onClick={onClose} aria-label="بستن پنجره" disabled={busy}><X size={20} /></button><div className="modal-symbol">{kind === 'source' ? <Rss size={26} /> : <PlatformIcon platform={kind} size={27} />}</div><h2 id="modal-title">{kind === 'source' ? 'افزودن منبع خبری' : meta?.supported ? `اتصال ${meta.name}` : `دربارهٔ اتصال ${meta?.name}`}</h2><p className="modal-description">{kind === 'source' ? 'سایت را برای دریافت خبر بررسی کنید یا فقط پیوند آن را در فهرست خود نگه دارید.' : meta?.description}</p>{kind !== 'source' && !meta?.supported ? <><div className="modal-info"><CircleHelp size={19} /><p>اتصال این پلتفرم در نسخهٔ فعلی پیاده‌سازی نشده است. برای فعال‌سازی، ابتدا باید برنامهٔ رسمی و مجوزهای لازم از {kind === 'linkedin' ? 'لینکدین' : 'Meta'} دریافت شود. وارد کردن نام کاربری یا رمز عبور به‌تنهایی این دسترسی را فراهم نمی‌کند.</p></div><button className="primary-button full-width" onClick={onClose}>متوجه شدم<Check size={16} /></button></> : <form onSubmit={event => void submit(event)} className="modal-form"><label><span>{kind === 'source' ? 'نام منبع' : 'نام دلخواه حساب'}{kind !== 'source' && <small>اختیاری</small>}</span><input ref={firstInput} value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder={kind === 'source' ? 'مثلاً خبرگزاری مورد علاقهٔ من' : 'مثلاً کانال خبر من'} required={kind === 'source'} /></label>{kind === 'source' ? <label><span>آدرس سایت یا فید RSS</span><input dir="ltr" type="url" placeholder="https://example.com/feed.xml" value={url} onChange={event => setUrl(event.target.value)} required /><small className="input-help">آدرس HTTPS سایت یا RSS را وارد کنید. فید یا دادهٔ ساختاریافتهٔ خبر بررسی می‌شود؛ همهٔ سایت‌ها قابل دریافت نیستند.</small><span className="source-kind-picker">روش افزودن<select aria-label="روش افزودن منبع" value={sourceMode} onChange={event=>setSourceMode(event.target.value)}><option value="auto">دریافت خودکار خبر (RSS یا صفحهٔ خبری)</option><option value="pending">ثبت برای بررسی بعدی (دریافت تأیید نشده)</option><option value="link">فقط ذخیرهٔ پیوند سایت (بدون دریافت خبر)</option></select></span>{sourceMode==='pending'&&<small className="input-help">منبع ثبت می‌شود، اما دریافت خبر تأیید نشده است. در فهرست منابع «بررسی دریافت» را بزنید.</small>}{sourceMode === 'link' && <small className="input-help">این روش فقط آدرس سایت را ذخیره می‌کند؛ هیچ خبری از آن جمع‌آوری نمی‌شود.</small>}<span className="source-kind-picker">نوع منبع<select aria-label="نوع منبع" value={kindOfSource} onChange={event => setKindOfSource(event.target.value)}><option value="news">خبرگزاری و رسانه</option><option value="official">منبع رسمی مقامات یا نهاد</option><option value="social">کانال و شبکهٔ اجتماعی دارای فید</option></select></span></label> : <><label><span>{kind === 'telegram' ? 'توکن ربات تلگرام' : kind === 'x' ? 'Bearer Token ایکس' : kind === 'facebook' ? 'توکن دسترسی صفحه' : 'توکن دسترسی API'}</span><input dir="ltr" type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} placeholder={kind === 'telegram' ? '123456:ABC…' : 'Access token…'} required /><small className="input-help">{kind === 'telegram' ? 'توکن ربات را از BotFather دریافت کنید. رمز حساب تلگرام را وارد نکنید.' : kind === 'x' ? 'توکن را از پنل توسعه‌دهندگان X دریافت کنید. دسترسی جست‌وجوی اخیر باید فعال باشد.' : kind === 'linkedin' ? 'توکن OAuth با مجوز Community Management سازمان خود را وارد کنید.' : 'توکن رسمی Meta با مجوز خواندن حساب حرفه‌ای یا صفحهٔ مورد نظر را وارد کنید.'}</small></label>{['instagram', 'facebook', 'linkedin'].includes(kind) && <label><span>{kind === 'instagram' ? 'شناسهٔ حساب حرفه‌ای اینستاگرام' : kind === 'facebook' ? 'شناسهٔ صفحهٔ فیسبوک' : 'شناسهٔ سازمان لینکدین'}</span><input dir="ltr" value={accountId} onChange={event => setAccountId(event.target.value)} placeholder={kind === 'linkedin' ? '12345678' : '123456789012345'} required /><small className="input-help">{kind === 'instagram' ? 'شناسهٔ عددی Instagram Professional User؛ نام کاربری نیست.' : kind === 'facebook' ? 'شناسهٔ عددی Page که توکن به آن دسترسی دارد.' : 'شناسهٔ عددی سازمان یا urn:li:organization:ID'}</small></label>}{kind === 'telegram' && <label><span>شناسهٔ کانال‌ها یا گروه‌ها<small>اختیاری</small></span><input dir="ltr" value={channels} onChange={event => setChannels(event.target.value)} placeholder="@channel, -1001234567890" /><small className="input-help">با ویرگول جدا کنید. ربات باید عضو و در کانال مدیر باشد؛ فقط پیام‌های جدید قابل دریافت‌اند.</small></label>}<div className="modal-info"><ShieldCheck size={18} /><p>{kind === 'telegram' ? 'این اتصال با ربات انجام می‌شود و به تاریخچهٔ کانال‌ها یا همهٔ چت‌های حساب شخصی شما دسترسی نمی‌دهد. برای دریافت پیام‌ها، ربات نباید webhook فعال یا مصرف‌کنندهٔ getUpdates دیگری داشته باشد.' : kind === 'x' ? 'API ایکس ممکن است هزینه یا محدودیت دسترسی داشته باشد. جست‌وجو بر اساس موضوع‌های ثبت‌شدهٔ شما انجام می‌شود.' : kind === 'instagram' ? 'اتصال به حساب حرفه‌ای تحت دسترسی شما محدود است. دسترسی به هشتگ‌ها نیز تابع مجوز API رسمی و محدودیت‌های Meta است؛ فید همهٔ پیج‌ها در دسترس نیست.' : kind === 'facebook' ? 'فقط پست‌های صفحه‌ای که مجوز خواندن آن را دارید دریافت می‌شوند. این اتصال فید شخصی یا محتوای همهٔ صفحات را نمی‌خواند.' : 'فقط پست‌های سازمان مجاز از API رسمی دریافت می‌شوند. دسترسی Community Management باید تأیید شده باشد؛ فید شخصی لینکدین در دسترس نیست.'}</p></div></>}{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : kind === 'source' ? <Plus size={16} /> : <Link2 size={16} />}{busy ? 'در حال بررسی…' : kind === 'source' ? 'افزودن منبع' : 'بررسی و اتصال'}</button><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>انصراف</button></div></form>}</div></div>;
}

export default App;
