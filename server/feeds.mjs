import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

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
    ['technology', /technology|artificial intelligence|\bai\b|cyber|تکنولوژی|فناوری|هوش مصنوعی|اینترنت|دیجیتال/],
    ['economy', /econom|financ|inflation|stock|oil price|اقتصاد|تورم|بورس|دلار|سرمایه|قیمت نفت/],
    ['sports', /sport|football|soccer|olympic|ورزش|فوتبال|المپیک|جام جهانی/],
    ['science', /science|space|nasa|health|climate|علم|فضا|ناسا|سلامت|اقلیم|پزشکی/],
    ['politics', /politic|election|president|parliament|war|minister|سیاس|انتخاب|رئیس|جنگ|وزیر|مجلس/],
  ];
  return groups.find(([, pattern]) => pattern.test(input))?.[0] || 'world';
}

function imageFor(item) {
  const media = [...list(item['media:content']), ...list(item['media:thumbnail']), ...list(item.enclosure)];
  for (const entry of media) {
    const value = entry?.['@_url'];
    if (value && (!entry['@_type'] || entry['@_type'].startsWith('image/'))) {
      const url = normalizeArticleUrl(value);
      if (url?.startsWith('https://')) return url;
    }
  }
  return null;
}

export function parseFeed(xml, source, now = new Date()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('ساختار XML این منبع مجاز نیست.');
  if (XMLValidator.validate(xml) !== true) throw new Error('پاسخ منبع یک فایل RSS یا Atom معتبر نیست.');
  const document = parser.parse(xml);
  const root = document.rss?.channel || document.feed || document['rdf:RDF'];
  if (!root) throw new Error('منبع باید نشانی RSS یا Atom باشد، نه صفحهٔ وب.');
  const items = list(root.item || root.entry || document['rdf:RDF']?.item);
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
    const rawDate = text(item.pubDate || item.published || item.updated || item['dc:date']);
    const date = new Date(rawDate);
    const publishedAtKnown = !Number.isNaN(date.getTime());
    return [{
      id: createHash('sha256').update(url).digest('hex').slice(0, 24), title, summary, url, imageUrl: imageFor(item),
      sourceId: source.id, sourceName: source.name, platform: source.platform || 'rss',
      publishedAt: publishedAtKnown ? date.toISOString() : now.toISOString(), publishedAtKnown,
      category: categoryFor(`${title} ${summary} ${list(item.category).map(text).join(' ')}`),
      language: /[\u0600-\u06ff]/.test(title) ? 'fa' : 'en', saved: false,
    }];
  });
}
