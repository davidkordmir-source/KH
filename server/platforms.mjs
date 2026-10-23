/**
 * Official, permission-scoped social APIs. Tokens stay in the backend's encrypted
 * store. The injected JSON requester provides the application's proxy/timeouts.
 * These connectors never scrape private timelines or impersonate a browser.
 */
const META_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202601';
const SUPPORTED = new Set(['instagram', 'facebook', 'linkedin']);

export const platformCapabilities = Object.freeze({
  instagram: 'رسانه‌های حساب حرفه‌ای مجاز و هشتگ‌های در دسترس از Instagram Graph API؛ نیازمند تأیید اپ و مجوزهای Meta.',
  facebook: 'پست‌های صفحه‌ای که برای آن مجوز pages_read_engagement دارید؛ فید خصوصی و همهٔ صفحات قابل دریافت نیست.',
  linkedin: 'پست‌های سازمان مجاز با دسترسی Community Management و r_organization_social؛ فید شخصی قابل دریافت نیست.',
});

export class PlatformAccessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PlatformAccessError';
    this.status = status;
  }
}

function checkedCredentials(platform, credentials) {
  if (!SUPPORTED.has(platform)) throw new PlatformAccessError('پلتفرم پشتیبانی نمی‌شود.');
  if (typeof credentials?.token !== 'string' || !credentials.token.trim() || /[\r\n]/.test(credentials.token)) {
    throw new PlatformAccessError('توکن دسترسی معتبر لازم است.');
  }
  const accountId = String(credentials.accountId || '').trim();
  if (platform === 'linkedin') {
    const match = /^(?:urn:li:organization:)?([1-9][0-9]{0,39})$/.exec(accountId);
    if (!match) throw new PlatformAccessError('شناسهٔ عددی سازمان لینکدین یا urn:li:organization:ID را وارد کنید.');
    return { token: credentials.token.trim(), accountId: match[1], author: `urn:li:organization:${match[1]}` };
  }
  if (!/^[1-9][0-9]{0,39}$/.test(accountId)) {
    throw new PlatformAccessError(platform === 'instagram' ? 'شناسهٔ عددی حساب حرفه‌ای اینستاگرام لازم است.' : 'شناسهٔ عددی صفحهٔ فیسبوک لازم است.');
  }
  return { token: credentials.token.trim(), accountId };
}

function metaUrl(path, params = {}) {
  if (!/^v\d+\.\d+$/.test(META_VERSION)) throw new PlatformAccessError('نسخهٔ Meta Graph API در تنظیمات سرور معتبر نیست.', 500);
  const url = new URL(`https://graph.facebook.com/${META_VERSION}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.href;
}

function linkedinUrl(author) {
  const url = new URL('https://api.linkedin.com/rest/posts');
  url.searchParams.set('q', 'author');
  url.searchParams.set('author', author);
  url.searchParams.set('count', '25');
  url.searchParams.set('sortBy', 'LAST_MODIFIED');
  return url.href;
}

function headers(platform, token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(platform === 'linkedin' ? {
      'LinkedIn-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    } : {}),
  };
}

async function apiGet(platform, url, token, requestJson) {
  if (typeof requestJson !== 'function') throw new TypeError('A JSON requester is required.');
  const expectedHost = platform === 'linkedin' ? 'api.linkedin.com' : 'graph.facebook.com';
  if (new URL(url).hostname !== expectedHost) throw new PlatformAccessError('مقصد اتصال مجاز نیست.');
  let data;
  try {
    data = await requestJson(url, { headers: headers(platform, token) });
  } catch {
    throw new PlatformAccessError(`دریافت از ${platform === 'instagram' ? 'اینستاگرام' : platform === 'facebook' ? 'فیسبوک' : 'لینکدین'} ممکن نشد. اعتبار توکن، مجوز حساب، نسخهٔ API و دسترسی شبکه را بررسی کنید.`, 502);
  }
  if (!data || typeof data !== 'object' || data.error || (typeof data.status === 'number' && data.status >= 400)) {
    throw new PlatformAccessError('API دسترسی را تأیید نکرد. توکن، مجوزهای اپ و دسترسی به حساب/سازمان را بررسی کنید.', 403);
  }
  return data;
}

function cleanText(value, max = 12000) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function article(platform, record, label, accountId) {
  const text = cleanText(record.text);
  const url = safeUrl(record.url);
  if (!text || !url) return null;
  const date = new Date(record.date);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    title: cleanText(text.split(/\n/)[0], 180),
    summary: text,
    url,
    imageUrl: safeUrl(record.imageUrl),
    publishedAt: date.toISOString(),
    platform,
    sourceId: `${platform}:${accountId}`,
    sourceName: label,
    language: /[\u0600-\u06ff]/.test(text) ? 'fa' : 'en',
    category: 'general',
  };
}

export async function validatePlatformConnection(platform, credentials, requestJson) {
  const auth = checkedCredentials(platform, credentials);
  let label;
  if (platform === 'linkedin') {
    const data = await apiGet(platform, linkedinUrl(auth.author), auth.token, requestJson);
    if (!Array.isArray(data.elements)) throw new PlatformAccessError('پاسخ لینکدین با Posts API سازگار نیست.', 502);
    label = `LinkedIn · ${auth.author}`;
  } else {
    const fields = platform === 'instagram' ? 'id,username' : 'id,name';
    const data = await apiGet(platform, metaUrl(auth.accountId, { fields }), auth.token, requestJson);
    if (String(data.id) !== auth.accountId) throw new PlatformAccessError('شناسهٔ حساب توسط API تأیید نشد.', 403);
    label = cleanText(data.username || data.name || auth.accountId, 160);
    // Identity alone doesn't prove feed permissions; validate the required read.
    const path = platform === 'instagram' ? `${auth.accountId}/media` : `${auth.accountId}/posts`;
    const feed = await apiGet(platform, metaUrl(path, { fields: 'id', limit: 1 }), auth.token, requestJson);
    if (!Array.isArray(feed.data)) throw new PlatformAccessError('مجوز خواندن پست‌های این حساب تأیید نشد.', 403);
  }
  return { label, capability: platformCapabilities[platform] };
}

export async function collectPlatformArticles(platform, credentials, keywords, requestJson) {
  const auth = checkedCredentials(platform, credentials);
  const label = cleanText(credentials.label || (platform === 'instagram' ? 'Instagram' : platform === 'facebook' ? 'Facebook' : 'LinkedIn'), 160);
  let records;
  const warnings = [];
  if (platform === 'instagram') {
    const fields = 'id,caption,media_type,media_url,permalink,timestamp';
    const data = await apiGet(platform, metaUrl(`${auth.accountId}/media`, { fields, limit: 25 }), auth.token, requestJson);
    if (!Array.isArray(data.data)) throw new PlatformAccessError('پاسخ رسانه‌های اینستاگرام معتبر نیست.', 502);
    records = [...data.data];
    const hashtags = [...new Set((Array.isArray(keywords) ? keywords : []).map(word => String(word).trim().replace(/^#/, '')).filter(word => /^[\p{L}\p{N}_]{1,100}$/u.test(word)))].slice(0, 3);
    for (const hashtag of hashtags) {
      try {
        const found = await apiGet(platform, metaUrl('ig_hashtag_search', { user_id: auth.accountId, q: hashtag }), auth.token, requestJson);
        const id = String(found.data?.[0]?.id || '');
        if (!/^[1-9][0-9]{0,39}$/.test(id)) continue;
        const recent = await apiGet(platform, metaUrl(`${id}/recent_media`, { user_id: auth.accountId, fields, limit: 25 }), auth.token, requestJson);
        if (Array.isArray(recent.data)) records.push(...recent.data);
      } catch {
        warnings.push('دریافت هشتگ اینستاگرام ممکن نشد؛ این قابلیت به مجوز Instagram Public Content Access و محدودیت‌های Meta وابسته است.');
      }
    }
    records = records.map(item => ({ text: item.caption, url: item.permalink, date: item.timestamp, imageUrl: item.media_type === 'VIDEO' ? null : item.media_url }));
  } else if (platform === 'facebook') {
    const data = await apiGet(platform, metaUrl(`${auth.accountId}/posts`, { fields: 'id,message,created_time,permalink_url,full_picture', limit: 25 }), auth.token, requestJson);
    if (!Array.isArray(data.data)) throw new PlatformAccessError('پاسخ پست‌های فیسبوک معتبر نیست.', 502);
    records = data.data.map(item => ({ text: item.message, url: item.permalink_url, date: item.created_time, imageUrl: item.full_picture }));
  } else {
    const data = await apiGet(platform, linkedinUrl(auth.author), auth.token, requestJson);
    if (!Array.isArray(data.elements)) throw new PlatformAccessError('پاسخ پست‌های لینکدین معتبر نیست.', 502);
    records = data.elements.map(item => ({
      text: item.commentary,
      url: /^urn:li:(share|ugcPost):[0-9]+$/.test(String(item.id)) ? `https://www.linkedin.com/feed/update/${item.id}/` : null,
      date: item.publishedAt || item.createdAt,
      imageUrl: null,
    }));
  }
  const articles = records.map(record => article(platform, record, label, auth.accountId)).filter(Boolean);
  const seen = new Set();
  const unique = articles.filter(item => !seen.has(item.url) && seen.add(item.url));
  // Backends may display these as partial-sync errors while preserving own media.
  Object.defineProperty(unique, 'warnings', { value: [...new Set(warnings)], enumerable: false });
  return unique;
}
