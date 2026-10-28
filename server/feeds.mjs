import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isPublicAddress } from './network.mjs';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, trimValues: true });
const list = value => !value ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'object' && value !== null ? value['#text'] || '' : String(value ?? '');

export function cleanText(value) {
  return text(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return code <= 0x10ffff ? String.fromCodePoint(code) : ''; })
    .replace(/\s+/g, ' ').trim();
}

export function normalizeArticleUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|CMP$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export function extractReferences(html,articleUrl) {
  const found=[];
  for(const match of String(html||'').slice(0,200000).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes=attributesFor(match[1]),url=safeMediaUrl(attributes.href,articleUrl),label=cleanText(match[2]).slice(0,180);
    if(!url||url===articleUrl||!label||found.some(item=>item.url===url))continue;
    found.push({url,label,basis:'publisher-link'});if(found.length>=20)break;
  }
  return found;
}

export function discoverFeedUrl(html, websiteUrl) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    if (!attributes.rel?.toLowerCase().split(/\s+/).includes('alternate') || !/^(application\/(rss|atom)\+xml|text\/xml)$/i.test(attributes.type || '') || !attributes.href) continue;
    try { return new URL(attributes.href.replace(/&amp;/g, '&'), websiteUrl).href; } catch { /* Try the next advertised feed. */ }
  }
  return null;
}

export function categoryFor(value) {
  const input = value.toLowerCase();
  const groups = [
    ['military', /نظامی|ارتش|نیروهای مسلح|موشک|جنگنده|پهپاد|بمباران|رزمایش|military|missile|airstrike|armed forces|fighter jet|\barmy\b/i],
    ['social', /اجتماعی|آموزش|دانش‌آموز|بازنشست|بیکاری|رفاه|مهاجرت|حقوق بشر|human rights|education|unemployment|migration|social affairs/i],
    ['technology', /technology|artificial intelligence|\bai\b|cyber|تکنولوژی|فناوری|هوش مصنوعی|اینترنت|دیجیتال/],
    ['economy', /econom|financ|inflation|stock|oil price|اقتصاد|تورم|بورس|دلار|سرمایه|قیمت نفت/],
    ['sports', /sport|football|soccer|olympic|ورزش|فوتبال|المپیک|جام جهانی/],
    ['science', /science|space|nasa|health|climate|علم|فضا|ناسا|سلامت|اقلیم|پزشکی/],
    ['politics', /politic|election|president|parliament|war|minister|سیاس|انتخاب|رئیس|جنگ|وزیر|مجلس/],
  ];
  return groups.find(([, pattern]) => pattern.test(input))?.[0] || 'world';
}

/** Public source-supplied media only; never manufacture a decorative image. */
export function safeMediaUrl(value, base) {
  try {
    if (!value || typeof value !== 'string') return null;
    const url = new URL(value.replace(/&amp;/g, '&').trim(), base);
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) && !isPublicAddress(host))) return null;
    return url.href;
  } catch { return null; }
}

function attributesFor(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  return attributes;
}

function kindFor(url, mime = '', medium = '') {
  if (/^video\//i.test(mime) || medium === 'video') return 'video';
  if (/^image\//i.test(mime) || medium === 'image') return 'image';
  try {
    const path = new URL(url).pathname;
    if (/\.(mp4|webm|ogv|mov)$/i.test(path)) return 'video';
    if (/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(path)) return 'image';
  } catch { /* Unknown media types are omitted rather than guessed. */ }
  return null;
}

export function extractFeedMedia(item, articleUrl) {
  const found = [];
  const add = (type, value, mimeType, poster) => {
    const url = safeMediaUrl(value, articleUrl);
    if (!url || !['image', 'video'].includes(type)) return;
    if (type === 'video' && /^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(new URL(url).hostname)) return;
    if (found.some(media => media.url === url)) return;
    found.push({ type, url, ...(mimeType && /^(?:image|video)\/[a-z0-9.+-]+$/i.test(mimeType) ? { mimeType } : {}), ...(type === 'video' && safeMediaUrl(poster, articleUrl) ? { poster: safeMediaUrl(poster, articleUrl) } : {}), source: 'feed' });
  };
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    const thumbnail = list(node['media:thumbnail']).find(entry => entry?.['@_url'])?.['@_url'];
    for (const entry of [...list(node['media:content']), ...list(node.enclosure), ...list(node.link).filter(link => link?.['@_rel'] === 'enclosure')]) {
      const value = entry?.['@_url'] || entry?.['@_href'];
      const url = safeMediaUrl(value, articleUrl);
      const kind = url && kindFor(url, entry['@_type'], entry['@_medium']);
      add(kind, value, entry?.['@_type'], list(entry?.['media:thumbnail'])[0]?.['@_url'] || thumbnail);
    }
    for (const entry of list(node['media:thumbnail'])) add('image', entry?.['@_url']);
    for (const group of list(node['media:group'])) visit(group, depth + 1);
  };
  visit(item);
  // Images/videos embedded by the publisher in RSS content are real article media.
  const html = [item.description, item.summary, item['content:encoded'], item.content].map(text).join('\n').slice(0, 200_000);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attributesFor(match[0]);
    if ((a.width && Number(a.width) <= 2) || (a.height && Number(a.height) <= 2)) continue;
    add('image', safeMediaUrl(a.src, articleUrl) ? a.src : a['data-src'], undefined);
  }
  for (const match of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>|<video\b([^>]*)\/?>/gi)) {
    const a = attributesFor(match[1] || match[3] || '');
    if (a.src) add('video', a.src, a.type, a.poster);
    for (const tag of (match[2] || '').match(/<source\b[^>]*>/gi) || []) {
      const source = attributesFor(tag);
      if (source.src) add('video', source.src, source.type, a.poster);
    }
  }
  return found.slice(0, 12);
}

function sourceIconFor(root, source) {
  const explicit = source.iconUrl || text(root.image?.url) || text(root.logo) || text(root.icon);
  const supplied = safeMediaUrl(explicit, source.url);
  if (supplied) return supplied;
  const link = list(root.link).find(entry => typeof entry === 'string') || list(root.link).find(entry => entry?.['@_rel'] === 'alternate');
  const site = safeMediaUrl(typeof link === 'string' ? link : link?.['@_href'], source.url) || safeMediaUrl(source.url);
  return site ? new URL('/favicon.ico', site).href : null;
}

export function parseFeed(xml, source, now = new Date()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('ساختار XML این منبع مجاز نیست.');
  if (XMLValidator.validate(xml) !== true) throw new Error('پاسخ منبع یک فایل RSS یا Atom معتبر نیست.');
  const document = parser.parse(xml);
  const root = document.rss?.channel || document.feed || document['rdf:RDF'];
  if (!root) throw new Error('منبع باید نشانی RSS یا Atom باشد، نه صفحهٔ وب.');
  const items = list(root.item || root.entry || document['rdf:RDF']?.item);
  const sourceIconUrl = sourceIconFor(root, source);
  const seen = new Set();
  return items.slice(0, 150).flatMap(item => {
    const links = list(item.link);
    const candidate = links.find(link => typeof link === 'string') || links.find(link => !link['@_rel'] || link['@_rel'] === 'alternate');
    const rawUrl = typeof candidate === 'object' ? candidate?.['@_href'] || candidate?.['#text'] : candidate;
    const url = normalizeArticleUrl(rawUrl);
    const title = cleanText(item.title).slice(0, 500);
    if (!url || !title || seen.has(url)) return [];
    seen.add(url);
    const summary = cleanText(item.description || item.summary || item['content:encoded'] || item.content).slice(0, 1600);
    const fullText = cleanText(item['content:encoded'] || item.content || item.description || item.summary).slice(0, 60000);
    const references=extractReferences([item.description,item.summary,item['content:encoded'],item.content].map(text).join('\n'),url);
    const rawDate = text(item.pubDate || item.published || item.updated || item['dc:date']);
    const date = new Date(rawDate);
    const publishedAtKnown = !Number.isNaN(date.getTime());
    const media = extractFeedMedia(item, url);
    const imageUrl = media.find(entry => entry.type === 'image')?.url || media.find(entry => entry.poster)?.poster || null;
    return [{
      id: createHash('sha256').update(url).digest('hex').slice(0, 24), title, summary, fullText, references, textScope: 'publisher-feed', url, imageUrl, media, sourceIconUrl,
      sourceId: source.id, sourceName: source.name, platform: source.platform || 'rss',
      publishedAt: publishedAtKnown ? date.toISOString() : now.toISOString(), publishedAtKnown,
      category: categoryFor(`${title} ${summary} ${list(item.category).map(text).join(' ')}`),
      language: (source.language || text(item['@_xml:lang'] || root['@_xml:lang'] || root.language)).toLowerCase().split(/[-_]/)[0] || (/[\u0400-\u04ff]/.test(title) ? 'ru' : /[\u4e00-\u9fff]/.test(title) ? 'zh' : /[\u0600-\u06ff]/.test(title) ? 'fa' : 'en'), saved: false,
    }];
  });
}
