import { createHash } from 'node:crypto';
import { cleanText, categoryFor, safeMediaUrl } from './feeds.mjs';

/** Official/public APIs only. Other publishers/platforms can use public RSS. */
export const customCapabilities = Object.freeze({
  mastodon: 'پست‌های عمومی حساب منتخب روی نمونهٔ Mastodon؛ توکن اختیاری فقط برای همان سرور انتخاب‌شده ارسال می‌شود.',
  bluesky: 'پست‌های عمومی حساب یا شناسهٔ DID در Bluesky از Public AppView؛ ورود به حساب یا دسترسی خصوصی ایجاد نمی‌کند.',
  bale: 'ربات بله از Bot API رسمی؛ فقط پیام‌های تازهٔ کانال‌ها و گروه‌های در دسترس ربات، بدون تاریخچهٔ حساب شخصی.',
});

export class CustomAccessError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CustomAccessError'; this.status = status; }
}

function checked(type, credentials = {}) {
  if (!Object.hasOwn(customCapabilities, type)) throw new CustomAccessError('نوع اتصال سفارشی پشتیبانی نمی‌شود. برای شبکه‌های دیگر فید عمومی RSS اضافه کنید.');
  if (type === 'bluesky') {
    const actor = String(credentials.accountId || credentials.actor || '').trim();
    if (!/^[a-zA-Z0-9:._-]{3,255}$/.test(actor)) throw new CustomAccessError('نام حساب Bluesky یا شناسهٔ DID معتبر را وارد کنید.');
    return { actor, accountId: actor };
  }
  const token = String(credentials.token || '').trim();
  if (token.length > 4096 || /[\r\n\u0000]/.test(token)) throw new CustomAccessError('توکن معتبر نیست.');
  if (type === 'bale') {
    const normalized = token.replace(/^bot/, '');
    if (!/^[A-Za-z0-9:_-]{10,256}$/.test(normalized)) throw new CustomAccessError('توکن معتبر ربات بله لازم است.');
    const channels = credentials.channels || [];
    if (!Array.isArray(channels) || channels.length > 50 || channels.some(value => typeof value !== 'string' || !/^@?[\w-]{1,100}$/.test(value))) throw new CustomAccessError('فهرست شناسه‌های کانال بله معتبر نیست.');
    return { token: normalized, channels, offset: Number.isSafeInteger(credentials.offset) && credentials.offset >= 0 ? credentials.offset : 0 };
  }
  const value = safeMediaUrl(String(credentials.instanceUrl || ''));
  if (!value) throw new CustomAccessError('نشانی عمومی HTTPS سرور Mastodon لازم است.');
  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new CustomAccessError('فقط نشانی اصلی سرور Mastodon را وارد کنید؛ مثلاً https://mastodon.social');
  const accountId = String(credentials.accountId || '').trim();
  if (!/^\d{1,40}$/.test(accountId)) throw new CustomAccessError('شناسهٔ عددی حساب Mastodon را وارد کنید.');
  return { instanceUrl: parsed.origin, accountId, ...(token ? { token } : {}) };
}

async function get(type, url, auth, requestJson, options = {}) {
  if (typeof requestJson !== 'function') throw new TypeError('A JSON requester is required.');
  const target = new URL(url);
  const permitted = type === 'mastodon' ? new URL(auth.instanceUrl).hostname : type === 'bluesky' ? 'public.api.bsky.app' : 'tapi.bale.ai';
  if (target.protocol !== 'https:' || target.hostname !== permitted || target.username || target.password) throw new CustomAccessError('مقصد اتصال مجاز نیست.');
  try {
    const result = await requestJson(url, {
      ...options,
      allowedHosts: [permitted],
      headers: { Accept: 'application/json', ...(type === 'mastodon' && auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...options.headers },
    });
    if (!result || typeof result !== 'object' || result.error || result.ok === false) throw new Error('Provider refused access');
    return result;
  } catch {
    // Never relay a transport message containing a token-bearing Bot API URL.
    throw new CustomAccessError(`دریافت از ${type === 'bale' ? 'بله' : type === 'bluesky' ? 'Bluesky' : 'Mastodon'} ممکن نشد؛ نشانی حساب، مجوز API، توکن و دسترسی شبکه را بررسی کنید.`, 502);
  }
}

const mastodonUrl = (auth, suffix) => `${auth.instanceUrl}/api/v1/accounts/${auth.accountId}${suffix}`;
const blueskyUrl = (method, auth, extra = {}) => `https://public.api.bsky.app/xrpc/${method}?${new URLSearchParams({ actor: auth.actor, ...extra })}`;
const baleUrl = (auth, method) => `https://tapi.bale.ai/bot${auth.token}/${method}`;

function sourceMedia(records) {
  const seen = new Set();
  return records.flatMap(record => {
    const url = safeMediaUrl(record.url);
    if (!url || !['image', 'video'].includes(record.type) || seen.has(url)) return [];
    seen.add(url);
    const poster = safeMediaUrl(record.poster);
    return [{ type: record.type, url, ...(poster ? { poster } : {}), ...(record.mimeType ? { mimeType: record.mimeType } : {}), source: 'platform' }];
  }).slice(0, 12);
}

function article(type, record) {
  const title = cleanText(record.text).slice(0, 180);
  const url = safeMediaUrl(record.url);
  const date = new Date(record.date);
  if (!title || !url || !Number.isFinite(date.getTime())) return null;
  const media = sourceMedia(record.media || []);
  const summary = cleanText(record.text).slice(0, 2400);
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 24),
    title, summary, url, platform: type,
    imageUrl: media.find(item => item.type === 'image')?.url || media.find(item => item.poster)?.poster || null,
    media,
    ...(record.mediaAvailable ? { mediaAvailable: true } : {}),
    sourceId: `${type}:${record.accountId}`, sourceName: cleanText(record.label).slice(0, 160),
    sourceIconUrl: safeMediaUrl(record.iconUrl), sourceProfileUrl: safeMediaUrl(record.profileUrl),
    publishedAt: date.toISOString(), publishedAtKnown: true,
    category: categoryFor(`${title} ${summary}`), language: /[\u0600-\u06ff]/.test(title) ? 'fa' : 'en', saved: false,
  };
}

export async function validateCustomConnection(type, credentials, requestJson) {
  const auth = checked(type, credentials);
  let label;
  if (type === 'mastodon') {
    const profile = await get(type, mastodonUrl(auth, ''), auth, requestJson);
    if (String(profile.id) !== auth.accountId) throw new CustomAccessError('شناسهٔ حساب Mastodon تأیید نشد.');
    const statuses = await get(type, mastodonUrl(auth, '/statuses?limit=1&exclude_replies=true'), auth, requestJson);
    if (!Array.isArray(statuses)) throw new CustomAccessError('API پست‌های Mastodon معتبر نیست.');
    label = cleanText(profile.display_name || profile.acct || profile.username || auth.accountId);
  } else if (type === 'bluesky') {
    const profile = await get(type, blueskyUrl('app.bsky.actor.getProfile', auth), auth, requestJson);
    if (!profile.did || !profile.handle) throw new CustomAccessError('حساب عمومی Bluesky تأیید نشد.');
    const feed = await get(type, blueskyUrl('app.bsky.feed.getAuthorFeed', auth, { limit: '1', filter: 'posts_no_replies' }), auth, requestJson);
    if (!Array.isArray(feed.feed)) throw new CustomAccessError('فید عمومی Bluesky معتبر نیست.');
    label = cleanText(profile.displayName || profile.handle);
  } else {
    const result = await get(type, baleUrl(auth, 'getMe'), auth, requestJson);
    if (!result.ok || !result.result?.is_bot) throw new CustomAccessError('توکن ربات بله تأیید نشد.');
    label = cleanText(result.result.username || result.result.first_name || 'ربات بله');
  }
  return { label: label.slice(0, 160), capability: customCapabilities[type], normalizedCredentials: auth };
}

export async function collectCustomArticles(type, credentials, _keywords, requestJson) {
  const auth = checked(type, credentials);
  let records = [];
  let nextCredentials;
  if (type === 'mastodon') {
    const statuses = await get(type, mastodonUrl(auth, '/statuses?limit=30&exclude_replies=true'), auth, requestJson);
    if (!Array.isArray(statuses)) throw new CustomAccessError('پاسخ پست‌های Mastodon معتبر نیست.');
    records = statuses.slice(0, 30).filter(status => ['public', 'unlisted'].includes(status.visibility || 'public')).map(status => ({
      text: status.content, url: status.url, date: status.created_at,
      accountId: auth.accountId, label: status.account?.display_name || status.account?.acct || credentials.label || 'Mastodon',
      iconUrl: status.account?.avatar_static || status.account?.avatar,
      profileUrl: status.account?.url,
      media: (Array.isArray(status.media_attachments) ? status.media_attachments : []).map(item => ({
        type: item.type === 'image' ? 'image' : ['video', 'gifv'].includes(item.type) ? 'video' : null,
        url: item.url || item.remote_url, poster: item.preview_url,
      })),
    }));
  } else if (type === 'bluesky') {
    const result = await get(type, blueskyUrl('app.bsky.feed.getAuthorFeed', auth, { limit: '30', filter: 'posts_no_replies' }), auth, requestJson);
    if (!Array.isArray(result.feed)) throw new CustomAccessError('پاسخ فید Bluesky معتبر نیست.');
    records = result.feed.slice(0, 30).map(entry => {
      const post = entry.post || {};
      const id = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([a-zA-Z0-9._:-]+)$/.exec(post.uri || '')?.[1];
      const actor = post.author?.did || post.author?.handle;
      const embed = post.embed || {};
      const media = (embed.images || []).map(item => ({ type: 'image', url: item.fullsize || item.thumb }));
      if (embed.$type === 'app.bsky.embed.video#view' && embed.playlist) media.push({ type: 'video', url: embed.playlist, poster: embed.thumbnail, mimeType: 'application/vnd.apple.mpegurl' });
      return {
        text: post.record?.text, date: post.record?.createdAt || post.indexedAt,
        url: actor && id ? `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(id)}` : null,
        accountId: auth.actor, label: post.author?.displayName || post.author?.handle || credentials.label || 'Bluesky',
        iconUrl: post.author?.avatar, profileUrl: actor ? `https://bsky.app/profile/${encodeURIComponent(actor)}` : null, media,
      };
    });
  } else {
    const result = await get(type, baleUrl(auth, 'getUpdates'), auth, requestJson, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: auth.offset, limit: 100, timeout: 0 }),
    });
    if (!Array.isArray(result.result)) throw new CustomAccessError('پاسخ پیام‌های بله معتبر نیست.');
    const updates = result.result.slice(0, 100);
    for (const update of updates) {
      const message = update.channel_post || update.message;
      if (!message || !['channel', 'supergroup', 'group'].includes(message.chat?.type)) continue;
      const chat = message.chat;
      if (!chat.username || !/^[\w-]{1,100}$/.test(chat.username)) continue;
      if (auth.channels.length && !auth.channels.some(value => value.replace(/^@/, '').toLowerCase() === chat.username.toLowerCase() || value === String(chat.id))) continue;
      if (!Number.isSafeInteger(message.message_id) || !Number.isFinite(message.date)) continue;
      records.push({ text: message.text || message.caption, date: message.date * 1000,
        url: `https://ble.ir/${chat.username}/${message.message_id}`, profileUrl: `https://ble.ir/${chat.username}`,
        accountId: String(chat.id), label: chat.title || chat.username, media: [], mediaAvailable: Boolean(message.photo || message.video),
      });
    }
    const ids = updates.map(update => update.update_id).filter(Number.isSafeInteger);
    if (ids.length) nextCredentials = { ...auth, offset: Math.max(...ids) + 1 };
  }
  const seen = new Set();
  const articles = records.map(record => article(type, record)).filter(item => item && !seen.has(item.url) && seen.add(item.url));
  if (nextCredentials) Object.defineProperty(articles, 'nextCredentials', { value: nextCredentials, enumerable: false });
  return articles;
}
