import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeFetch, validatePublicUrl } from './network.mjs';
import { parseFeed, cleanText, categoryFor, discoverFeedUrl } from './feeds.mjs';
import { Store, CAPABILITIES } from './store.mjs';
import { validatePlatformConnection, collectPlatformArticles } from './platforms.mjs';

const API_HOSTS = ['api.telegram.org', 'api.x.com', 'api.twitter.com', 'graph.facebook.com', 'graph.instagram.com', 'api.linkedin.com'];
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const publicError = error => String(error.message || 'خطای غیرمنتظره رخ داد.').slice(0, 400);
const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function createApp({ directory = path.resolve('.data'), distDirectory = path.resolve('dist'), fetcher = safeFetch, urlValidator = validatePublicUrl, store = new Store(directory) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.APP_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)]);
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.hostname.toLowerCase())) return res.status(403).json({ error: 'نام میزبان برای این برنامه مجاز نیست.' });
    next();
  });
  app.use(express.json({ limit: '20kb' }));
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

  async function requestJson(url, options = {}) {
    const body = await fetcher(url, { ...options, allowedHosts: API_HOSTS, maxBytes: 3_000_000 });
    try { return JSON.parse(body); } catch { throw new Error('پاسخ API معتبر نیست.'); }
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
      articles.push({ id: idFor(url), title: body.slice(0, 180), summary: body.slice(0, 1600), url, imageUrl: null, sourceId: `telegram:${chat.id}`, sourceName: chat.title || chat.username || 'تلگرام', platform: 'telegram', publishedAt: new Date(message.date * 1000).toISOString(), category: categoryFor(body), language: /[\u0600-\u06ff]/.test(body) ? 'fa' : 'en', saved: false });
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
    url.search = new URLSearchParams({ query: `(${query}) -is:retweet`, max_results: '30', 'tweet.fields': 'created_at,lang,author_id', expansions: 'author_id', 'user.fields': 'name,username' });
    const result = await requestJson(url.href, { headers: { Authorization: `Bearer ${connection.token}` } });
    if (result.errors?.length && !result.data) throw new Error('طرح API حساب X اجازهٔ جست‌وجوی خبر را نمی‌دهد.');
    const users = new Map((result.includes?.users || []).map(user => [user.id, user]));
    store.addArticles((result.data || []).map(tweet => {
      const user = users.get(tweet.author_id);
      const url = `https://x.com/${user?.username || 'i/web'}/status/${tweet.id}`;
      const body = cleanText(tweet.text);
      return { id: idFor(url), title: body.slice(0, 180), summary: body.slice(0, 1600), url, imageUrl: null, sourceId: `x:${tweet.author_id}`, sourceName: user?.name || 'X', platform: 'x', publishedAt: tweet.created_at || new Date().toISOString(), category: categoryFor(body), language: tweet.lang === 'fa' ? 'fa' : 'en', saved: false };
    }));
  }

  let pendingSync;
  async function sync() {
    if (pendingSync) return pendingSync;
    pendingSync = (async () => {
      const errors = [];
      const sources = store.sources().filter(source => source.enabled);
      await Promise.all(sources.map(async source => {
        try {
          const xml = await fetcher(source.url);
          store.addArticles(parseFeed(xml, source));
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
      store.setSetting('lastSyncAt', new Date().toISOString());
      store.setSetting('syncErrors', errors);
      return store.dashboard();
    })().finally(() => { pendingSync = null; });
    return pendingSync;
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: 'sqlite' }));
  app.get('/api/dashboard', (_req, res) => res.json(store.dashboard()));
  app.post('/api/sync', route(async (_req, res) => res.json(await sync())));
  app.post('/api/sources', route(async (req, res) => {
    const { name, url } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof url !== 'string' || url.length > 2048) return res.status(400).json({ error: 'نام و نشانی RSS معتبر را وارد کنید.' });
    const { url: parsed } = await urlValidator(url);
    if (store.sources().length >= 50) return res.status(400).json({ error: 'حداکثر ۵۰ منبع قابل ثبت است.' });
    let feedUrl = parsed.href;
    let contents = await fetcher(feedUrl);
    if (/<!doctype\s+html|<html[\s>]/i.test(contents)) {
      const discovered = discoverFeedUrl(contents, feedUrl);
      if (!discovered) return res.status(400).json({ error: 'در این سایت فید RSS یا Atom پیدا نشد. نشانی مستقیم فید را وارد کنید.' });
      const validated = await urlValidator(discovered);
      feedUrl = validated.url.href;
      contents = await fetcher(feedUrl);
    }
    parseFeed(contents, { id: 'validation', name: name.trim() });
    if (store.sources().some(source => source.url === feedUrl)) return res.status(409).json({ error: 'این منبع قبلاً اضافه شده است.' });
    const source = store.addSource({ name: name.trim(), url: feedUrl });
    res.status(201).json(source);
  }));
  app.patch('/api/sources/:id', (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'وضعیت منبع معتبر نیست.' });
    if (!store.updateSource(req.params.id, req.body.enabled)) return res.status(404).json({ error: 'منبع پیدا نشد.' });
    res.json({ ok: true });
  });
  app.delete('/api/sources/:id', (req, res) => {
    if (!store.deleteSource(req.params.id)) return res.status(404).json({ error: 'منبع پیدا نشد.' });
    res.json({ ok: true });
  });
  app.post('/api/articles/:id/save', (req, res) => {
    if (typeof req.body?.saved !== 'boolean') return res.status(400).json({ error: 'وضعیت ذخیره‌سازی معتبر نیست.' });
    if (!store.saveArticle(req.params.id, req.body.saved)) return res.status(404).json({ error: 'خبر پیدا نشد.' });
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
  app.use('/api', (_req, res) => res.status(404).json({ error: 'مسیر API پیدا نشد.' }));
  app.use(express.static(distDirectory));
  app.get('/{*path}', (_req, res, next) => res.sendFile(path.join(distDirectory, 'index.html'), error => error && next(error)));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'ساختار درخواست JSON معتبر نیست.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
    res.status(error.status || 400).json({ error: publicError(error) });
  });
  return { app, store, sync };
}
