import { createHash } from 'node:crypto';
import worldCountries from './world-countries.mjs';

// A small, explicit gazetteer. These are text mentions, not geolocation of a reporter
// or proof that the event happened at the centre of a country/city.
export const COUNTRY_GAZETTEER = [
  { countryCode: 'IR', countryName: 'ایران', lat: 32.43, lon: 53.69, terms: ['ایران', 'Iran', 'Iranian'], cities: [ ['تهران', 'Tehran', 35.69, 51.39], ['مشهد', 'Mashhad', 36.30, 59.61], ['اصفهان', 'Isfahan', 32.65, 51.67], ['تبریز', 'Tabriz', 38.08, 46.29], ['شیراز', 'Shiraz', 29.59, 52.58], ['اهواز', 'Ahvaz', 31.32, 48.67] ] },
  { countryCode: 'US', countryName: 'آمریکا', lat: 39.83, lon: -98.58, terms: ['آمریکا', 'ایالات متحده', 'United States', 'U.S.', 'USA', 'American'], cities: [ ['واشنگتن', 'Washington DC', 38.91, -77.04], ['نیویورک', 'New York', 40.71, -74.01], ['لس آنجلس', 'Los Angeles', 34.05, -118.24] ] },
  { countryCode: 'GB', countryName: 'بریتانیا', lat: 55.38, lon: -3.44, terms: ['بریتانیا', 'انگلیس', 'United Kingdom', 'Britain', 'British'], cities: [ ['لندن', 'London', 51.51, -0.13], ['منچستر', 'Manchester', 53.48, -2.24] ] },
  { countryCode: 'FR', countryName: 'فرانسه', lat: 46.60, lon: 1.89, terms: ['فرانسه', 'France', 'French'], cities: [ ['پاریس', 'Paris', 48.86, 2.35] ] },
  { countryCode: 'DE', countryName: 'آلمان', lat: 51.17, lon: 10.45, terms: ['آلمان', 'Germany', 'German'], cities: [ ['برلین', 'Berlin', 52.52, 13.40] ] },
  { countryCode: 'RU', countryName: 'روسیه', lat: 61.52, lon: 105.32, terms: ['روسیه', 'Russia', 'Russian'], cities: [ ['مسکو', 'Moscow', 55.75, 37.62], ['سن پترزبورگ', 'Saint Petersburg', 59.93, 30.34] ] },
  { countryCode: 'UA', countryName: 'اوکراین', lat: 48.38, lon: 31.17, terms: ['اوکراین', 'Ukraine', 'Ukrainian'], cities: [ ['کی‌یف', 'Kyiv', 50.45, 30.52], ['خارکیف', 'Kharkiv', 49.99, 36.23] ] },
  { countryCode: 'CN', countryName: 'چین', lat: 35.86, lon: 104.20, terms: ['چین', 'China', 'Chinese'], cities: [ ['پکن', 'Beijing', 39.90, 116.40], ['شانگهای', 'Shanghai', 31.23, 121.47] ] },
  { countryCode: 'JP', countryName: 'ژاپن', lat: 36.20, lon: 138.25, terms: ['ژاپن', 'Japan', 'Japanese'], cities: [ ['توکیو', 'Tokyo', 35.68, 139.65] ] },
  { countryCode: 'IN', countryName: 'هند', lat: 20.59, lon: 78.96, terms: ['هند', 'هندوستان', 'India', 'Indian'], cities: [ ['دهلی', 'New Delhi', 28.61, 77.21], ['بمبئی', 'Mumbai', 19.08, 72.88] ] },
  { countryCode: 'PK', countryName: 'پاکستان', lat: 30.38, lon: 69.35, terms: ['پاکستان', 'Pakistan', 'Pakistani'], cities: [ ['اسلام‌آباد', 'Islamabad', 33.69, 73.05] ] },
  { countryCode: 'AF', countryName: 'افغانستان', lat: 33.94, lon: 67.71, terms: ['افغانستان', 'Afghanistan', 'Afghan'], cities: [ ['کابل', 'Kabul', 34.56, 69.21] ] },
  { countryCode: 'IQ', countryName: 'عراق', lat: 33.22, lon: 43.68, terms: ['عراق', 'Iraq', 'Iraqi'], cities: [ ['بغداد', 'Baghdad', 33.32, 44.37], ['بصره', 'Basra', 30.51, 47.78] ] },
  { countryCode: 'TR', countryName: 'ترکیه', lat: 38.96, lon: 35.24, terms: ['ترکیه', 'Turkey', 'Türkiye', 'Turkish'], cities: [ ['آنکارا', 'Ankara', 39.93, 32.86], ['استانبول', 'Istanbul', 41.01, 28.98] ] },
  { countryCode: 'SA', countryName: 'عربستان', lat: 23.89, lon: 45.08, terms: ['عربستان', 'Saudi Arabia', 'Saudi'], cities: [ ['ریاض', 'Riyadh', 24.71, 46.68] ] },
  { countryCode: 'AE', countryName: 'امارات', lat: 23.42, lon: 53.85, terms: ['امارات', 'United Arab Emirates', 'UAE'], cities: [ ['دبی', 'Dubai', 25.20, 55.27], ['ابوظبی', 'Abu Dhabi', 24.45, 54.38] ] },
  { countryCode: 'QA', countryName: 'قطر', lat: 25.35, lon: 51.18, terms: ['قطر', 'Qatar', 'Qatari'], cities: [ ['دوحه', 'Doha', 25.29, 51.53] ] },
  { countryCode: 'IL', countryName: 'اسرائیل', lat: 31.05, lon: 34.85, terms: ['اسرائیل', 'Israel', 'Israeli'], cities: [ ['تل‌آویو', 'Tel Aviv', 32.09, 34.78] ] },
  { countryCode: 'PS', countryName: 'فلسطین', lat: 31.95, lon: 35.23, terms: ['فلسطین', 'Palestine', 'Palestinian'], cities: [ ['غزه', 'Gaza', 31.50, 34.47], ['رام‌الله', 'Ramallah', 31.90, 35.20] ] },
  { countryCode: 'LB', countryName: 'لبنان', lat: 33.85, lon: 35.86, terms: ['لبنان', 'Lebanon', 'Lebanese'], cities: [ ['بیروت', 'Beirut', 33.89, 35.50] ] },
  { countryCode: 'SY', countryName: 'سوریه', lat: 34.80, lon: 38.99, terms: ['سوریه', 'Syria', 'Syrian'], cities: [ ['دمشق', 'Damascus', 33.51, 36.28] ] },
  { countryCode: 'YE', countryName: 'یمن', lat: 15.55, lon: 48.52, terms: ['یمن', 'Yemen', 'Yemeni'], cities: [ ['صنعا', 'Sanaa', 15.37, 44.19] ] },
  { countryCode: 'EG', countryName: 'مصر', lat: 26.82, lon: 30.80, terms: ['مصر', 'Egypt', 'Egyptian'], cities: [ ['قاهره', 'Cairo', 30.04, 31.24] ] },
  { countryCode: 'SD', countryName: 'سودان', lat: 12.86, lon: 30.22, terms: ['سودان', 'Sudan', 'Sudanese'], cities: [ ['خارطوم', 'Khartoum', 15.50, 32.56] ] },
  { countryCode: 'ZA', countryName: 'آفریقای جنوبی', lat: -30.56, lon: 22.94, terms: ['آفریقای جنوبی', 'South Africa'], cities: [ ['ژوهانسبورگ', 'Johannesburg', -26.20, 28.05] ] },
  { countryCode: 'BR', countryName: 'برزیل', lat: -14.24, lon: -51.93, terms: ['برزیل', 'Brazil', 'Brazilian'], cities: [ ['برازیلیا', 'Brasilia', -15.79, -47.88] ] },
  { countryCode: 'CA', countryName: 'کانادا', lat: 56.13, lon: -106.35, terms: ['کانادا', 'Canada', 'Canadian'], cities: [ ['اتاوا', 'Ottawa', 45.42, -75.70], ['تورنتو', 'Toronto', 43.65, -79.38] ] },
  { countryCode: 'AU', countryName: 'استرالیا', lat: -25.27, lon: 133.78, terms: ['استرالیا', 'Australia', 'Australian'], cities: [ ['کانبرا', 'Canberra', -35.28, 149.13], ['سیدنی', 'Sydney', -33.87, 151.21] ] },
  { countryCode: 'ES', countryName: 'اسپانیا', lat: 40.46, lon: -3.75, terms: ['اسپانیا', 'Spain', 'Spanish'], cities: [ ['مادرید', 'Madrid', 40.42, -3.70] ] },
  { countryCode: 'IT', countryName: 'ایتالیا', lat: 41.87, lon: 12.57, terms: ['ایتالیا', 'Italy', 'Italian'], cities: [ ['رم', 'Rome', 41.90, 12.50] ] },
  { countryCode: 'KR', countryName: 'کره جنوبی', lat: 35.91, lon: 127.77, terms: ['کره جنوبی', 'South Korea'], cities: [ ['سئول', 'Seoul', 37.57, 126.98] ] },
  { countryCode: 'KP', countryName: 'کره شمالی', lat: 40.34, lon: 127.51, terms: ['کره شمالی', 'North Korea'], cities: [ ['پیونگ‌یانگ', 'Pyongyang', 39.04, 125.76] ] },
];

export function normalizeStoryTitle(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u200c\u200d]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function storyFingerprint(title, fallbackId, publishedAt) {
  const normalized = normalizeStoryTitle(title);
  // Generic short headlines cannot safely establish that two stories are alike.
  if (normalized.length < 20 || normalized.split(' ').length < 4) return `single:${fallbackId}`;
  const date = new Date(publishedAt);
  if (!publishedAt || !Number.isFinite(date.getTime())) return `single:${fallbackId}`;
  // Reused headlines on different days do not establish duplicate reporting.
  return createHash('sha256').update(`${normalized}|${date.toISOString().slice(0, 10)}`).digest('hex').slice(0, 32);
}

const termPatterns = new Map();
const knownCountries = new Set(COUNTRY_GAZETTEER.map(country => country.countryCode));
const ambiguousAliases = new Set(['georgia', 'jordan', 'chad']);
const allCountries = [...COUNTRY_GAZETTEER, ...worldCountries.filter(country => !knownCountries.has(country.countryCode)).map(country => ({ ...country, terms: country.terms.filter(term => !ambiguousAliases.has(term.toLowerCase())) }))];
function containsTerm(text, term) {
  if (!termPatterns.has(term)) {
    const escaped = normalizeStoryTitle(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    termPatterns.set(term, new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u'));
  }
  return termPatterns.get(term).test(text);
}

export function detectLocations(value) {
  const text = normalizeStoryTitle(value);
  const found = [];
  for (const country of allCountries) {
    const term = country.terms.find(word => containsTerm(text, word));
    const cities = country.cities.filter(([fa, en]) => containsTerm(text, fa) || containsTerm(text, en));
    if (term) found.push({ countryCode: country.countryCode, countryName: country.countryName, lat: country.lat, lon: country.lon, matchedTerm: term, confidence: 'mentioned' });
    for (const [city, englishName, lat, lon] of cities) found.push({ countryCode: country.countryCode, countryName: country.countryName, city, lat, lon, matchedTerm: containsTerm(text, city) ? city : englishName, confidence: 'mentioned' });
  }
  return found;
}

export function extractiveSummary(title, description) {
  const text = String(description || title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?؟]+[.!?؟]+|[^.!?؟]+$/g) || [text];
  const selected = sentences.slice(0, 2).map(sentence => sentence.trim()).join(' ').trim();
  // Truncate an extract, never generate a causal claim or unsupported analysis.
  return selected.length <= 450 ? selected : `${selected.slice(0, 447).replace(/\s+\S*$/, '')}…`;
}

export function breakingScore(title, description = '') {
  const text = normalizeStoryTitle(`${title} ${description}`);
  if (/(?:^| )(?:خبر فوری|فوری|breaking|urgent)(?: |$)/u.test(text)) return 80;
  return /(?:زلزله|tsunami|earthquake|وضعیت اضطراری|state of emergency)/u.test(text) ? 55 : 0;
}

export function enrichArticle(article) {
  return {
    ...article,
    summaryAuto: extractiveSummary(article.title, article.fullText || article.summary),
    summaryMethod: 'extractive',
    summaryInput: article.summary ? 'feed-description' : 'headline',
    locations: detectLocations(`${article.title || ''} ${article.summary || ''}`),
    breakingScore: breakingScore(article.title, article.summary),
  };
}
