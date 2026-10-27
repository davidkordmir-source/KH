import express from 'express';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeFetch, validatePublicUrl } from './network.mjs';
import { parseFeed, cleanText, categoryFor, discoverFeedUrl } from './feeds.mjs';
import { publicSourceSpec, collectPublicSource } from './public-social.mjs';
import { collectWebsite } from './websites.mjs';
import { Store, CAPABILITIES } from './store.mjs';
import { validatePlatformConnection, collectPlatformArticles } from './platforms.mjs';
import { createMarketsService } from './markets.mjs';
import { SOURCE_CATALOG, OFFICIAL_WEBSITES } from './catalog.mjs';
import { createArchiveService } from './archive-provider.mjs';
import { customCapabilities, validateCustomConnection, collectCustomArticles } from './custom-connectors.mjs';
import { createTelegramMediaService } from './telegram-media.mjs';
import { createNewsroom } from './newsroom.mjs';
import { createBackupService } from './backups.mjs';
import { archiveFilters, registerNewsroomRoutes } from './newsroom-routes.mjs';
import { createAccess } from './access.mjs';
import { createLab } from './lab-routes.mjs';
import { createDesktop } from './desktop.mjs';

const API_HOSTS = ['api.telegram.org', 'api.x.com', 'api.twitter.com', 'graph.facebook.com', 'graph.instagram.com', 'api.linkedin.com'];
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const publicError = error => String(error.message || 'خطای غیرمنتظره رخ داد.').slice(0, 400);
const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function createApp({ directory = path.resolve('.data'), distDirectory = path.resolve('dist'), fetcher = safeFetch, urlValidator = validatePublicUrl, store = new Store(directory),accessOptions={} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.APP_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)]);
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.hostname.toLowerCase())) return res.status(403).json({ error: 'نام میزبان برای این برنامه مجاز نیست.' });
    next();
  });
  app.use('/api/newsroom/backups/restore', express.json({ limit: '96mb' }));
  app.use('/api/lab/media',express.json({limit:'36mb'}));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'درخواست باید با قالب application/json ارسال شود.' });
    const origin = req.headers.origin;
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let permitted = false;
      try {
        const parsed = new URL(origin);
        permitted = parsed.host === req.headers.host || (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && ['3001', '5173', '4173'].includes(parsed.port));
      } catch { /* malformed origin is refused */ }
      if (!permitted) return res.status(403).json({ error: 'این درخواست باید از خود برنامه ارسال شود.' });
    }
    next();
  });
  const access=createAccess({store,...accessOptions});access.register(app);

  async function requestJson(url, options = {}) {
    const body = await fetcher(url, { ...options, allowedHosts: options.allowedHosts || API_HOSTS, maxBytes: 3_000_000 });
    try { return JSON.parse(body); } catch { throw new Error('پاسخ API معتبر نیست.'); }
  }

  const markets = createMarketsService({ fetcher });
  const newsroom = createNewsroom({store,markets,fetcher});
  const lab=createLab({store,fetcher,newsroom});
  const backups = createBackupService(store);
  const desktop=createDesktop({store,fetcher,backups,isBusy:()=>Boolean(pendingSync)||lab.isBusy()});
  const archive = createArchiveService({ store, fetcher });
  const telegramMedia = createTelegramMediaService({ store, requestJson, fetchBinary: (url, options = {}) => fetcher(url, { ...options, responseType: 'buffer', allowedHosts: ['api.telegram.org'] }) });
  const customConnections = () => store.getSetting('customConnections', []);
  const dashboard = () => {const data=store.dashboard();return { ...data,articles:newsroom.decorate(data.articles), customConnections: customConnections().map(({ id, type, label, description }) => ({ id, type, label, description, connected: true })) };};

  function dateBound(value, end = false) {
    if (!value) return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('تاریخ باید به قالب YYYY-MM-DD باشد.');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('تاریخ معتبر نیست.');
    return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+03:30`).toISOString();
  }

  function sourceMetadata(input = {}) {
    const metadata = {};
    if (input.kind !== undefined) {
      if (!['news', 'official', 'social'].includes(input.kind)) throw new Error('نوع منبع معتبر نیست.');
      metadata.kind = input.kind;
    }
    if (input.priority !== undefined) {
      if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 3) throw new Error('اولویت باید بین صفر و سه باشد.');
      metadata.priority = input.priority;
    }
    if (input.countryCode !== undefined) {
      if (typeof input.countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(input.countryCode)) throw new Error('کد کشور معتبر نیست.');
      metadata.countryCode = input.countryCode.toUpperCase();
    }
    if (input.platform !== undefined) {
      if (typeof input.platform !== 'string' || !/^[a-z0-9_-]{1,30}$/i.test(input.platform)) throw new Error('نام پلتفرم معتبر نیست.');
      metadata.platform = input.platform;
    }
    for (const field of ['language','topics','publisher']) if(input[field]!==undefined) {
      if(typeof input[field]!=='string'||input[field].length>(field==='topics'?200:100))throw new Error('مشخصات منبع معتبر نیست.');
      metadata[field]=input[field].trim();
    }
    return metadata;
  }

  async function checkedSource(rawUrl, name, mode = 'auto') {
    const { url } = await urlValidator(rawUrl);
    if (mode === 'link') return {url:url.href,platform:'website-link',articles:[]};
    if(url.hostname==='t.me') {const spec=await publicSourceSpec('telegram',url.href,fetcher);return {...spec,articles:await collectPublicSource({...spec,id:'validation',name},fetcher)};}
    const socialType=['instagram.com','www.instagram.com'].includes(url.hostname)?'instagram':['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)?'x':null;
    if(socialType){const spec=await publicSourceSpec(socialType,url.href,fetcher);return {...spec,articles:await collectPublicSource({...spec,id:'validation',name},fetcher)};}
    let feedUrl = url.href;
    let contents = await fetcher(feedUrl);
    if (/<!doctype\s+html|<html[\s>]/i.test(contents)) {
      const discovered = discoverFeedUrl(contents, feedUrl);
      if (!discovered) {
        const result = await collectWebsite({id:'validation',name,url:feedUrl}, {fetcher,urlValidator}, contents);
        return {url:feedUrl,platform:'website',articles:result.articles};
      }
      feedUrl = (await urlValidator(discovered)).url.href;
      contents = await fetcher(feedUrl);
    }
    return {url:feedUrl,platform:'rss',articles:parseFeed(contents,{id:'validation',name,url:feedUrl})};
  }
  function saveInitialArticles(source, articles) {
    store.addArticles(articles.map(article=>({...article,sourceId:source.id,sourceName:source.name,platform:source.platform.replace(/-public$/,''),sourceKind:source.kind,sourcePriority:source.priority||0})));
    if (source.platform !== 'website-link') store.markSource(source.id);
  }

  function normalizeCollected(items, platform) {
    return items.map(item => ({ ...item, id: item.id || idFor(item.url), platform, saved: false }));
  }

  async function collectTelegram(connection) {
    const result = await requestJson(`https://api.telegram.org/bot${connection.token}/getUpdates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: connection.offset || 0, limit: 100, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post', 'message'] }),
    });
    if (!result.ok || !Array.isArray(result.result)) throw new Error('دریافت پیام از ربات تلگرام ممکن نشد.');
    const articles = [];
    for (const update of result.result) {
      const message = update.channel_post || update.edited_channel_post || update.message;
      if (!message || !['channel', 'supergroup'].includes(message.chat?.type)) continue;
      const channels = connection.channels || [];
      const chat = message.chat;
      if (channels.length && !channels.some(channel => String(channel).replace(/^@/, '').toLowerCase() === String(chat.username || chat.id).toLowerCase() || String(channel) === String(chat.id))) continue;
      const body = cleanText(message.text || message.caption || '');
      if (!body) continue;
      const channelPath = chat.username || (String(chat.id).startsWith('-100') ? `c/${String(chat.id).slice(4)}` : null);
      if (!channelPath) continue;
      const url = `https://t.me/${channelPath}/${message.message_id}`;
      const media = telegramMedia.mediaForMessage(message);
      articles.push({ id: idFor(url), title: body.slice(0, 180), summary: body.slice(0, 1600), url, media, imageUrl: media.find(item => item.type === 'image')?.url || null, sourceId: `telegram:${chat.id}`, sourceName: chat.title || chat.username || 'تلگرام', platform: 'telegram', publishedAt: new Date(message.date * 1000).toISOString(), category: categoryFor(body), language: /[\u0600-\u06ff]/.test(body) ? 'fa' : 'en', saved: false });
    }
    store.addArticles(articles);
    if (result.result.length) store.setConnection('telegram', connection.label, { token: connection.token, channels: connection.channels || [], offset: Math.max(...result.result.map(update => update.update_id)) + 1 });
  }

  async function collectX(connection) {
    const keywords = store.getSetting('keywords', []).slice(0, 10);
    if (!keywords.length) throw new Error('برای جست‌وجوی X دست‌کم یک کلیدواژه اضافه کنید.');
    const terms = [];
    for (const keyword of keywords) {
      const term = `"${keyword.replace(/["\\]/g, '').slice(0, 60)}"`;
      if ([...terms, term].join(' OR ').length <= 470) terms.push(term);
    }
    const query = terms.join(' OR ');
    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.search = new URLSearchParams({ query: `(${query}) -is:retweet`, max_results: '30', 'tweet.fields': 'created_at,lang,author_id,attachments', expansions: 'author_id,attachments.media_keys', 'user.fields': 'name,username', 'media.fields': 'type,url,preview_image_url,variants' });
    const result = await requestJson(url.href, { headers: { Authorization: `Bearer ${connection.token}` } });
    if (result.errors?.length && !result.data) throw new Error('طرح API حساب X اجازهٔ جست‌وجوی خبر را نمی‌دهد.');
    const users = new Map((result.includes?.users || []).map(user => [user.id, user]));
    const mediaById = new Map((result.includes?.media || []).map(item => [item.media_key, item]));
    store.addArticles((result.data || []).map(tweet => {
      const user = users.get(tweet.author_id);
      const url = `https://x.com/${user?.username || 'i/web'}/status/${tweet.id}`;
      const body = cleanText(tweet.text);
      const media = (tweet.attachments?.media_keys || []).flatMap(key => {
        const item = mediaById.get(key);
        const candidate = item?.type === 'photo' ? item.url : item?.variants?.filter(variant => variant.content_type === 'video/mp4').sort((a, b) => (a.bit_rate || 0) - (b.bit_rate || 0))[0]?.url;
        if (!candidate?.startsWith('https://')) return [];
        return [{ type: item.type === 'photo' ? 'image' : 'video', url: candidate, poster: item.preview_image_url || undefined, source: 'official-api' }];
      });
      return { id: idFor(url), title: body.slice(0, 180), summary: body.slice(0, 1600), url, media, imageUrl: media.find(item => item.type === 'image')?.url || null, sourceId: `x:${tweet.author_id}`, sourceName: user?.name || 'X', platform: 'x', publishedAt: tweet.created_at || new Date().toISOString(), category: categoryFor(body), language: tweet.lang === 'fa' ? 'fa' : 'en', saved: false };
    }));
  }

  let pendingSync;
  async function sync() {
    if (pendingSync) return pendingSync;
    pendingSync = (async () => {
      const errors = [];
      const sources = store.sources().filter(source => source.enabled && source.platform !== 'website-link');
      await Promise.all(sources.map(async source => {
        try {
          const items = ['telegram-public','youtube-public','mastodon-public','instagram-public','x-public'].includes(source.platform) ? await collectPublicSource(source,fetcher) : source.platform === 'website' ? (await collectWebsite(source,{fetcher,urlValidator})).articles : parseFeed(await fetcher(source.url),source);
          store.addArticles(items.map(article => ({ ...article, sourceKind: source.kind, sourceIconUrl: article.sourceIconUrl || source.iconUrl, sourcePriority: source.priority || 0 })));
          store.markSource(source.id);
        } catch (error) {
          const message = publicError(error);
          store.markSource(source.id, message);
          errors.push({ sourceId: source.id, sourceName: source.name, message });
        }
      }));
      for (const connectionInfo of store.connections().filter(connection => connection.connected)) {
        try {
          const connection = store.getConnection(connectionInfo.platform);
          if (connectionInfo.platform === 'telegram') await collectTelegram(connection);
          else if (connectionInfo.platform === 'x') await collectX(connection);
          else {
            const articles = await collectPlatformArticles(connectionInfo.platform, connection, store.getSetting('keywords', []), requestJson);
            store.addArticles(normalizeCollected(articles, connectionInfo.platform));
            for (const message of articles.warnings || []) errors.push({ sourceId: connectionInfo.platform, sourceName: connectionInfo.label || connectionInfo.platform, message });
          }
        } catch (error) { errors.push({ sourceId: connectionInfo.platform, sourceName: connectionInfo.label || connectionInfo.platform, message: publicError(error) }); }
      }
      for (const item of customConnections()) {
        try {
          const connection = store.getConnection(`custom:${item.id}`);
          const articles = await collectCustomArticles(item.type, connection, store.getSetting('keywords', []), requestJson);
          store.addArticles(normalizeCollected(articles, item.type));
          if (articles.nextCredentials) store.setConnection(`custom:${item.id}`, item.label, articles.nextCredentials);
          for (const message of articles.warnings || []) errors.push({ sourceId: item.id, sourceName: item.label, message });
        } catch (error) { errors.push({ sourceId: item.id, sourceName: item.label, message: publicError(error) }); }
      }
      store.setSetting('lastSyncAt', new Date().toISOString());
      for(const feed of await newsroom.calendarService.sync())if(feed.lastError)errors.push({sourceId:feed.id,sourceName:feed.name,message:feed.lastError});
      store.setSetting('syncErrors', errors);
      if(store.getSetting('autoTranslateForeignNews',true))try{await newsroom.translateRecent();}catch{errors.push({sourceId:'translation',sourceName:'ترجمهٔ فارسی',message:'ترجمهٔ بخشی از خبرها انجام نشد؛ کلید، سهمیه یا اتصال سرویس ترجمه را بررسی کنید.'});store.setSetting('syncErrors',errors);}
      if(store.getSetting('autoSemanticIndex',false)&&store.getConnection('intelligence'))try{await lab.intelligence.index();}catch{errors.push({sourceId:'semantic-index',sourceName:'نمایهٔ معنایی',message:'نمایه‌سازی خبرهای تازه انجام نشد؛ اتصال هوش مصنوعی را بررسی کنید.'});store.setSetting('syncErrors',errors);}
      await newsroom.evaluate();
      try { backups.snapshot(); } catch { store.setSetting('backupError','پشتیبان خودکار انجام نشد؛ فضای دیسک و دسترسی پوشه را بررسی کنید.'); }
      return dashboard();
    })().finally(() => { pendingSync = null; });
    return pendingSync;
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: 'sqlite' }));
  app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
  app.get('/api/saved', (_req, res) => res.json({ articles: store.savedArticles() }));
  app.get('/api/articles', route(async (req, res) => {
    const { dateFrom, dateTo, country, city, query, savedOnly, read, limit = '50', offset = '0' } = req.query;
    if (!/^\d{1,4}$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 1000 || !/^\d{1,9}$/.test(String(offset))) return res.status(400).json({ error: 'بازهٔ صفحه‌بندی معتبر نیست.' });
    if ((country && (typeof country !== 'string' || !/^[a-z]{2}$/i.test(country))) || (city && (typeof city !== 'string' || city.length > 100)) || (query && (typeof query !== 'string' || query.length > 250))) return res.status(400).json({ error: 'فیلتر جست‌وجو معتبر نیست.' });
    const from = dateBound(dateFrom), to = dateBound(dateTo, true);
    if (from && to && from > to) return res.status(400).json({ error: 'ابتدای بازه باید پیش از انتهای آن باشد.' });
    const result=store.searchArchive({ ...archiveFilters(req.query,dateBound), limit: Number(limit), offset: Number(offset) });
    res.json({...result,articles:newsroom.decorate(result.articles.map(({fullText,...article})=>article))});
  }));
  app.get('/api/markets', route(async (req, res) => res.json(await markets.getMarkets({ force: req.query.refresh === '1' }))));
  app.get('/api/archive/status', (_req, res) => res.json(archive.status()));
  app.post('/api/archive/guardian/connect', route(async (req, res) => {
    if (typeof req.body?.token !== 'string' || req.body.token.length < 5 || req.body.token.length > 500) return res.status(400).json({ error: 'کلید دسترسی Guardian معتبر نیست.' });
    res.json(await archive.connectGuardian(req.body.token));
  }));
  app.post('/api/archive/import', route(async (req, res) => res.json(await archive.importDay(req.body || {}))));
  app.post('/api/archive/import-range',route(async(req,res)=>res.json(await archive.importRange(req.body||{}))));
  app.get('/api/catalog', (_req, res) => res.json({ sources: SOURCE_CATALOG.map(source => ({ ...source, websiteUrl: OFFICIAL_WEBSITES[source.id] || source.url })) }));
  app.post('/api/catalog/:id/add', route(async (req, res) => {
    const entry = SOURCE_CATALOG.find(item => item.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'منبع در فهرست وجود ندارد.' });
    if (entry.collection === 'website') return res.status(422).json({ error: 'این مورد پیوند وب‌سایت رسمی است و اتصال خودکار فید برای آن فعال نیست. از «مشاهدهٔ سایت رسمی» استفاده کنید.' });
    const checked = await checkedSource(entry.url, entry.name);
    const feedUrl = checked.url;
    const existing = store.sources().find(item => item.url === feedUrl || item.url === entry.url);
    if (existing) {
      store.updateSource(existing.id, { enabled: true, kind: entry.kind, iconUrl: entry.iconUrl, countryCode: entry.countryCode });
      return res.json({ source: store.sources().find(item => item.id === existing.id), alreadyExists: true });
    }
    if (store.sources().length >= 100) return res.status(400).json({ error: 'حداکثر صد منبع قابل ثبت است.' });
    const source=store.addSource({...entry,url:feedUrl,platform:checked.platform});
    saveInitialArticles(source,checked.articles);
    res.status(201).json({source});
  }));
  app.get('/api/connectors', (_req, res) => res.json({ connectors: Object.entries(customCapabilities).map(([type, value]) => typeof value === 'string' ? { type, name: type, description: value } : { type, ...value }) }));
  app.post('/api/custom-connections', route(async (req, res) => {
    const { type, label, token, instanceUrl, accountId, actor } = req.body || {};
    if (!Object.hasOwn(customCapabilities, type)) return res.status(400).json({ error: 'نوع اتصال پشتیبانی نمی‌شود.' });
    if ((label !== undefined && (typeof label !== 'string' || label.length > 100)) || (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /[\r\n]/.test(token))) || [instanceUrl, accountId, actor].some(value => value !== undefined && (typeof value !== 'string' || value.length > 1000))) return res.status(400).json({ error: 'مشخصات اتصال معتبر نیست.' });
    const registry = customConnections();
    if (registry.length >= 25) return res.status(400).json({ error: 'حداکثر ۲۵ اتصال سفارشی قابل ثبت است.' });
    if (instanceUrl) await urlValidator(instanceUrl);
    const credentials = { token, instanceUrl, accountId: accountId || actor, actor };
    const validated = await validateCustomConnection(type, credentials, requestJson);
    const id = randomUUID();
    const name = label?.trim() || validated.label || type;
    store.setConnection(`custom:${id}`, name, validated.normalizedCredentials || credentials);
    store.setSetting('customConnections', [...registry, { id, type, label: name, description: validated.capability || '' }]);
    res.status(201).json({ id, type, label: name, connected: true });
  }));
  app.delete('/api/custom-connections/:id', (req, res) => {
    store.deleteConnection(`custom:${req.params.id}`);
    store.setSetting('customConnections', customConnections().filter(item => item.id !== req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/media/telegram/:id', route(async (req, res) => {
    const media = await telegramMedia.fetchMedia(req.params.id);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(media.contentType).send(media.data);
  }));
  app.post('/api/sync', route(async (_req, res) => res.json(await sync())));
  app.post('/api/public-connections',route(async(req,res)=>{
    const {type,input,label}=req.body||{};
    if(typeof label!=='undefined'&&(typeof label!=='string'||label.length>100))return res.status(400).json({error:'نام منبع معتبر نیست.'});
    if(store.sources().length>=100)return res.status(400).json({error:'حداکثر صد منبع قابل ثبت است.'});
    const spec=await publicSourceSpec(type,input,fetcher);
    await urlValidator(spec.url);
    if(store.sources().some(source=>source.url===spec.url))return res.status(409).json({error:'این منبع عمومی قبلاً اضافه شده است.'});
    const validated={...spec,id:'validation',name:label?.trim()||spec.name};
    const articles=await collectPublicSource(validated,fetcher);
    if(!articles.length)return res.status(422).json({error:'این منبع هنوز پست عمومی قابل دریافت ندارد؛ اتصال ثبت نشد.'});
    const source=store.addSource({...spec,name:validated.name,kind:'social',iconUrl:articles[0].sourceIconUrl||new URL('/favicon.ico',spec.url).href});
    saveInitialArticles(source,articles);
    res.status(201).json({source,imported:articles.length,scope:'public-only'});
  }));
  app.post('/api/sources', route(async (req, res) => {
    const { name, url, mode = 'auto' } = req.body || {};
    if (!['auto','link'].includes(mode)) return res.status(400).json({error:'روش افزودن منبع معتبر نیست.'});
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof url !== 'string' || url.length > 2048) return res.status(400).json({ error: 'نام و نشانی سایت یا RSS معتبر را وارد کنید.' });
    const metadata = sourceMetadata(req.body);
    if (store.sources().length >= 100) return res.status(400).json({ error: 'حداکثر صد منبع قابل ثبت است.' });
    const checked = await checkedSource(url, name.trim(), mode);
    const feedUrl = checked.url;
    if (store.sources().some(source => source.url === feedUrl)) return res.status(409).json({ error: 'این منبع قبلاً اضافه شده است.' });
    const source = store.addSource({ name: name.trim(), url: feedUrl, ...metadata, platform:checked.platform, enabled:mode !== 'link', iconUrl: `${new URL(feedUrl).origin}/favicon.ico` });
    saveInitialArticles(source,checked.articles);
    res.status(201).json(source);
  }));
  app.patch('/api/sources/:id', route(async (req, res) => {
    const metadata = sourceMetadata(req.body);
    if (req.body?.enabled !== undefined && typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'وضعیت منبع معتبر نیست.' });
    if (typeof req.body?.enabled === 'boolean') metadata.enabled = req.body.enabled;
    if (!Object.keys(metadata).length) return res.status(400).json({ error: 'تغییری برای منبع ارسال نشده است.' });
    if (!store.updateSource(req.params.id, metadata)) return res.status(404).json({ error: 'منبع پیدا نشد.' });
    res.json({ ok: true });
  }));
  app.delete('/api/sources/:id', (req, res) => {
    if (!store.deleteSource(req.params.id)) return res.status(404).json({ error: 'منبع پیدا نشد.' });
    res.json({ ok: true });
  });
  app.post('/api/articles/:id/save', (req, res) => {
    if (typeof req.body?.saved !== 'boolean') return res.status(400).json({ error: 'وضعیت ذخیره‌سازی معتبر نیست.' });
    if (!store.saveArticle(req.params.id, req.body.saved)) return res.status(404).json({ error: 'خبر پیدا نشد.' });
    res.json({ ok: true });
  });
  app.post('/api/articles/:id/read', (req, res) => {
    if (typeof req.body?.read !== 'boolean') return res.status(400).json({ error: 'وضعیت خواندن معتبر نیست.' });
    const updated = store.markRead(req.params.id, req.body.read);
    if (!updated) return res.status(404).json({ error: 'خبر پیدا نشد.' });
    res.json({ ok: true, updated });
  });
  app.post('/api/articles/seen', (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.length > 256)) return res.status(400).json({ error: 'شناسه‌های خبر معتبر نیستند.' });
    res.json({ ok: true, updated: store.markSeen(ids) });
  });
  app.post('/api/articles/:id/priority', (req, res) => {
    const priority = req.body?.priority;
    if (!Number.isInteger(priority) || priority < 0 || priority > 3) return res.status(400).json({ error: 'اولویت باید بین صفر و سه باشد.' });
    if (!store.setArticlePriority(req.params.id, priority)) return res.status(404).json({ error: 'خبر پیدا نشد.' });
    res.json({ ok: true });
  });
  app.put('/api/keywords', (req, res) => {
    const keywords = req.body?.keywords;
    if (!Array.isArray(keywords) || keywords.length > 20 || keywords.some(keyword => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 60 || /[\r\n]/.test(keyword))) return res.status(400).json({ error: 'حداکثر ۲۰ کلیدواژه، هرکدام تا ۶۰ نویسه مجاز است.' });
    const sanitized = [...new Set(keywords.map(keyword => keyword.trim().replace(/^#/, '')))];
    store.setSetting('keywords', sanitized);
    res.json({ keywords: sanitized });
  });
  app.post('/api/connections/:platform', route(async (req, res) => {
    const { platform } = req.params;
    if (!Object.hasOwn(CAPABILITIES, platform)) return res.status(400).json({ error: 'پلتفرم شناخته‌شده نیست.' });
    const { token, label, channels = [], accountId } = req.body || {};
    if (typeof token !== 'string' || token.length < 10 || token.length > 4096 || /[\r\n]/.test(token)) return res.status(400).json({ error: 'توکن معتبر را وارد کنید.' });
    if (label !== undefined && (typeof label !== 'string' || label.length > 100)) return res.status(400).json({ error: 'نام اتصال باید کمتر از ۱۰۰ نویسه باشد.' });
    if (!Array.isArray(channels) || channels.length > 50 || channels.some(channel => typeof channel !== 'string' || !/^@?[a-zA-Z0-9_-]{1,100}$/.test(channel))) return res.status(400).json({ error: 'شناسهٔ کانال‌ها معتبر نیست.' });
    if (accountId !== undefined && (typeof accountId !== 'string' || accountId.length > 150)) return res.status(400).json({ error: 'شناسهٔ حساب معتبر نیست.' });
    const secret = { token: token.trim(), channels, ...(accountId ? { accountId: accountId.trim() } : {}) };
    let resolvedLabel = label?.trim();
    if (platform === 'telegram') {
      if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(secret.token)) return res.status(400).json({ error: 'قالب توکن ربات تلگرام معتبر نیست.' });
      const result = await requestJson(`https://api.telegram.org/bot${secret.token}/getMe`);
      if (!result.ok || !result.result?.is_bot) throw new Error('توکن ربات تلگرام تأیید نشد.');
      resolvedLabel ||= result.result.username || 'ربات تلگرام';
    } else if (platform === 'x') {
      // This endpoint accepts app-only bearer tokens; /users/me incorrectly requires user OAuth.
      const url = 'https://api.x.com/2/tweets/search/recent?query=news&max_results=10&tweet.fields=created_at';
      const result = await requestJson(url, { headers: { Authorization: `Bearer ${secret.token}` } });
      if (result.errors?.length && !result.data) throw new Error('توکن یا طرح API حساب X اجازهٔ جست‌وجو نمی‌دهد.');
      resolvedLabel ||= 'X API';
    } else {
      const result = await validatePlatformConnection(platform, secret, requestJson);
      resolvedLabel ||= result.label;
    }
    store.setConnection(platform, resolvedLabel || platform, secret);
    res.json({ platform, connected: true, label: resolvedLabel, capability: CAPABILITIES[platform] });
  }));
  app.delete('/api/connections/:platform', (req, res) => {
    if (!Object.hasOwn(CAPABILITIES, req.params.platform)) return res.status(400).json({ error: 'پلتفرم شناخته‌شده نیست.' });
    store.deleteConnection(req.params.platform);
    res.json({ ok: true });
  });
  registerNewsroomRoutes({app,store,newsroom,backups,dateBound,fetcher,isSyncing:()=>Boolean(pendingSync)||lab.isBusy()});
  lab.register(app,dateBound);
  desktop.register(app);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'مسیر API پیدا نشد.' }));
  // ZIP releases can preserve identical size/mtime while their asset hashes change.
  // Never validate the entry document using a size/mtime-based weak ETag.
  const sendEntry = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(distDirectory, 'index.html'), { etag: false, lastModified: false, cacheControl: false }, error => error && next(error));
  };
  app.get(['/', '/index.html'], sendEntry);
  app.use(express.static(distDirectory, { etag: false, lastModified: false, setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } }));
  app.use('/assets', (_req, res) => res.status(404).type('text').send('Application asset missing. Refresh the page or extract the complete download.'));
  app.get('/{*path}', sendEntry);
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'ساختار درخواست JSON معتبر نیست.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
    res.status(error.status || 400).json({ error: publicError(error) });
  });
  return { app, store, sync, newsroom, backups,lab,access,desktop };
}
