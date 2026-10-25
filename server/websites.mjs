import { createHash } from 'node:crypto';
import { categoryFor, cleanText, normalizeArticleUrl, safeMediaUrl } from './feeds.mjs';

const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]));
}
function localUrl(value, base) {
  const url = safeMediaUrl(typeof value === 'object' ? value?.url || value?.['@id'] : value, base);
  if (!url || new URL(url).hostname.replace(/^www\./, '') !== new URL(base).hostname.replace(/^www\./, '')) return null;
  return normalizeArticleUrl(url);
}
function nodes(html) {
  const found = [];
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || found.length >= 1500) return;
    if (Array.isArray(node)) { for (const value of node.slice(0, 200)) visit(value, depth + 1); return; }
    found.push(node);
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value, depth + 1);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try { visit(JSON.parse(match[2])); } catch { /* Broken structured data must never execute JavaScript. */ }
  }
  return found;
}
const isArticle = node => array(node['@type']).some(type => /^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting)$/i.test(String(type).replace(/^https?:\/\/schema.org\//, '')));

export function parseWebsite(html, source, now = new Date()) {
  const data = nodes(html), seen = new Set();
  return data.filter(isArticle).slice(0, 100).flatMap(node => {
    const url = localUrl(node.url || node.mainEntityOfPage || node['@id'], source.url);
    const title = cleanText(node.headline || node.name).slice(0, 500);
    if (!url || !title || seen.has(url) || node.isAccessibleForFree === false || node.isAccessibleForFree === 'False') return [];
    seen.add(url);
    const summary = cleanText(node.description).slice(0, 1600), fullText = cleanText(node.articleBody).slice(0, 60000);
    const date = new Date(node.datePublished || ''), known = Number.isFinite(date.getTime());
    const media = [];
    for (const image of array(node.image)) {
      const imageUrl = safeMediaUrl(typeof image === 'string' ? image : image?.url || image?.contentUrl, url);
      if (imageUrl && !media.some(item => item.url === imageUrl)) media.push({type:'image', url:imageUrl, source:'publisher-website'});
    }
    for (const video of array(node.video)) {
      const videoUrl = safeMediaUrl(video?.contentUrl, url);
      if (videoUrl && /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(videoUrl)) media.push({type:'video',url:videoUrl,source:'publisher-website'});
    }
    const language = (typeof node.inLanguage === 'string' ? node.inLanguage : source.language || '').toLowerCase().split(/[-_]/)[0];
    return [{id:createHash('sha256').update(url).digest('hex').slice(0,24),url,title,summary,fullText,
      sourceId:source.id,sourceName:source.name,platform:'website',textScope:'publisher-website',sourceIconUrl:source.iconUrl || new URL('/favicon.ico', source.url).href,
      publishedAt:known ? date.toISOString() : now.toISOString(),publishedAtKnown:known,
      category:categoryFor(`${title} ${summary}`),language:language || (/[\u0600-\u06ff]/.test(title)?'fa':/[\u4e00-\u9fff]/.test(title)?'zh':/[\u0400-\u04ff]/.test(title)?'ru':'en'),
      media:media.slice(0,12),imageUrl:media.find(item=>item.type==='image')?.url || null,saved:false}];
  });
}

export function discoverArticleLinks(html, websiteUrl) {
  const found = new Set();
  const add = value => { const url = localUrl(value, websiteUrl); if (url && url !== normalizeArticleUrl(websiteUrl)) found.add(url); };
  for (const node of nodes(html)) {
    if (isArticle(node)) add(node.url || node.mainEntityOfPage || node['@id']);
    if (array(node['@type']).includes('ListItem')) add(node.url || node.item);
  }
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attributes(match[1]).href;
    if (!href || !cleanText(match[2])) continue;
    // Restrict discovery to article-shaped links, not every navigation/social link.
    if (/<h[1-4]\b/i.test(match[2]) || /\/(?:\d{8,16}|\d{4}\/\d{2}\/\d{2}\/[^/?#]+)(?:[/?#]|$)/.test(href)) add(href);
    if (found.size >= 30) break;
  }
  return [...found].slice(0, 6);
}

export async function collectWebsite(source, {fetcher, urlValidator}, initialHtml) {
  const html = initialHtml ?? await fetcher(source.url);
  const articles = parseWebsite(html, source), urls = new Set(articles.map(item=>item.url));
  let successfulPages = 0;
  for (const url of discoverArticleLinks(html, source.url).filter(url=>!urls.has(url))) {
    try {
      await urlValidator(url);
      const page = await fetcher(url, {allowedHosts:[new URL(url).hostname],maxBytes:3_000_000,timeoutMs:8000});
      const incoming = parseWebsite(page, {...source,url});
      for (const item of incoming) if (!urls.has(item.url)) {urls.add(item.url);articles.push(item);}
      if (incoming.length) successfulPages++;
    } catch { /* Other public article pages may still be available. */ }
  }
  if (!articles.length) throw Object.assign(new Error('فید عمومی یا دادهٔ خبری قابل خواندن پیدا نشد. نشانی مستقیم RSS را وارد کنید یا روش «فقط ذخیرهٔ پیوند سایت» را انتخاب کنید؛ ذخیرهٔ پیوند، خبر دریافت نمی‌کند.'),{status:422});
  return {articles,successfulPages};
}
