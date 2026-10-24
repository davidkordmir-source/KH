import { createHash } from 'node:crypto';
import { safeFetch } from './network.mjs';
import { cleanText, normalizeArticleUrl, categoryFor } from './feeds.mjs';

const HOST = 'content.guardianapis.com';
const CONNECTION = 'guardianArchive';
const MAX_PAGES = 2;
const PAGE_SIZE = 50;

export class ArchiveAccessError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ArchiveAccessError'; this.status = status; }
}

export function validateArchiveDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ArchiveAccessError('تاریخ میلادی معتبر با قالب YYYY-MM-DD لازم است.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1900) {
    throw new ArchiveAccessError('روز انتخاب‌شده در تقویم معتبر نیست.');
  }
  return value;
}

function previousDay(value) {
  return new Date(new Date(`${value}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

function tehranDay(timestamp) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

function validImage(value) {
  const normalized = normalizeArticleUrl(value);
  if (!normalized?.startsWith('https://')) return null;
  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname === 'i.guim.co.uk' || hostname.endsWith('.theguardian.com') ? normalized : null;
}

export function guardianArticle(item, targetDay) {
  const url = normalizeArticleUrl(item?.webUrl);
  if (!url || !['www.theguardian.com', 'theguardian.com'].includes(new URL(url).hostname)) return null;
  const date = new Date(item.webPublicationDate);
  if (!Number.isFinite(date.getTime()) || tehranDay(date.toISOString()) !== targetDay) return null;
  const title = cleanText(item.webTitle).slice(0, 500);
  if (!title) return null;
  const summary = cleanText(item.fields?.trailText || item.fields?.bodyText || '').replace(/\s+([.,!?؛،؟])/g, '$1').slice(0, 1600);
  const imageUrl = validImage(item.fields?.thumbnail);
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 24),
    title, summary, url, imageUrl,
    media: imageUrl ? [{ type: 'image', url: imageUrl, source: 'provider' }] : [],
    sourceId: 'guardian-archive', sourceName: 'The Guardian',
    sourceIconUrl: 'https://www.theguardian.com/favicon.ico',
    platform: 'rss', publishedAt: date.toISOString(), publishedAtKnown: true,
    category: categoryFor(`${title} ${summary}`), language: 'en', saved: false,
    archiveProvider: 'Guardian Content API',
  };
}

export function createArchiveService({ store, fetcher = safeFetch, environment = process.env } = {}) {
  if (!store) throw new TypeError('Archive service requires a store.');
  const coverage = () => typeof store.archiveCoverage === 'function' ? store.archiveCoverage() : store.dashboard().archiveCoverage || null;
  const configuredToken = () => store.getConnection(CONNECTION)?.token || environment.GUARDIAN_API_KEY || null;
  function status() {
    return {
      guardianConfigured: Boolean(configuredToken()), coverage: coverage(),
      provider: 'Guardian Content API',
      scope: 'داده‌های محلی جمع‌آوری‌شده؛ دریافت تاریخی گاردین فقط با مجوز API و در محدودهٔ پاسخ ناشر.',
    };
  }
  async function guardianRequest(token, params) {
    const url = new URL(`https://${HOST}/search`);
    for (const [key, value] of Object.entries({ ...params, 'api-key': token })) url.searchParams.set(key, String(value));
    let document;
    try {
      const body = await fetcher(url.href, { allowedHosts: [HOST], maxBytes: 6_000_000, timeoutMs: 20_000 });
      document = typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
      // The request URL contains an API key. Never reflect a transport error or URL.
      throw new ArchiveAccessError('دریافت آرشیو گاردین ممکن نشد. کلید API، مجوز آن و دسترسی شبکه به content.guardianapis.com را بررسی کنید.', 502);
    }
    if (document?.response?.status !== 'ok' || !Array.isArray(document.response.results)) {
      throw new ArchiveAccessError('API گاردین دسترسی را تأیید نکرد. اعتبار و سطح دسترسی کلید را بررسی کنید.', 403);
    }
    return document.response;
  }
  async function connectGuardian(token) {
    if (typeof token !== 'string' || token.length < 8 || token.length > 512 || /[\s\u0000-\u001f]/.test(token)) {
      throw new ArchiveAccessError('کلید API معتبر گاردین را وارد کنید.');
    }
    await guardianRequest(token, { 'page-size': 1, page: 1 });
    store.setConnection(CONNECTION, 'Guardian archive', { token });
    return status();
  }
  async function importDay({ date, query = '' } = {}) {
    validateArchiveDate(date);
    if (typeof query !== 'string' || query.length > 200 || /[\u0000-\u001f]/.test(query)) throw new ArchiveAccessError('عبارت جست‌وجو باید حداکثر ۲۰۰ نویسه باشد.');
    const token = configuredToken();
    if (!token) throw new ArchiveAccessError('برای دریافت خبرهای قدیمی خارج از آرشیو محلی، ابتدا کلید API رسمی گاردین را در بخش اتصال آرشیو وارد کنید.', 428);
    const collected = [];
    let pages = 1;
    let lastPage = 0;
    for (let page = 1; page <= Math.min(MAX_PAGES, pages); page++) {
      const result = await guardianRequest(token, {
        'from-date': previousDay(date), 'to-date': date,
        'use-date': 'published', 'order-by': 'newest', 'page-size': PAGE_SIZE, page,
        'show-fields': 'trailText,thumbnail,bodyText', ...(query.trim() ? { q: query.trim() } : {}),
      });
      pages = Math.max(1, Number.isFinite(Number(result.pages)) ? Number(result.pages) : 1);
      lastPage = page;
      for (const item of result.results) {
        const article = guardianArticle(item, date);
        if (article) collected.push(article);
      }
    }
    const unique = [...new Map(collected.map(article => [article.url, article])).values()];
    store.addArticles(unique);
    return {
      imported: unique.length, provider: 'Guardian Content API', date, timeZone: 'Asia/Tehran',
      truncated: pages > lastPage, pagesFetched: lastPage, coverage: coverage(),
      scope: 'فقط پاسخ‌های قابل دسترس این ناشر؛ نمایندهٔ تمام خبرهای جهان در آن روز نیست.',
    };
  }
  async function importRange({dateFrom,dateTo,query='',page=1}={}) {
    validateArchiveDate(dateFrom);validateArchiveDate(dateTo);
    if(dateFrom>dateTo||typeof query!=='string'||query.length>200||!Number.isInteger(page)||page<1||page>100000)throw new ArchiveAccessError('بازه، عبارت یا صفحهٔ آرشیو معتبر نیست.');
    const token=configuredToken();if(!token)throw new ArchiveAccessError('برای دریافت تاریخچهٔ ناشر، ابتدا کلید رسمی Guardian را متصل کنید.',428);
    const result=await guardianRequest(token,{'from-date':previousDay(dateFrom),'to-date':dateTo,'use-date':'published','order-by':'newest','page-size':PAGE_SIZE,page,'show-fields':'trailText,thumbnail,bodyText',...(query.trim()?{q:query.trim()}:{})});
    const articles=result.results.flatMap(item=>{const time=new Date(item.webPublicationDate);if(!Number.isFinite(time.getTime()))return [];const day=tehranDay(time.toISOString());if(day<dateFrom||day>dateTo)return [];const article=guardianArticle(item,day);return article?[article]:[];});
    store.addArticles(articles);const pages=Math.max(1,Number(result.pages)||1);
    return {imported:articles.length,dateFrom,dateTo,page,pages,nextPage:page<pages?page+1:null,totalAvailable:Number(result.total)||0,coverage:coverage(),provider:'Guardian Content API',scope:'فقط آرشیو قابل دسترسی گاردین؛ شمارش ناشر ممکن است شامل بخش خارج از مرز روز تهران باشد.'};
  }
  return { status, connectGuardian, importDay,importRange };
}
