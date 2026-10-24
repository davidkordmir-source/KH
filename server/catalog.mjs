/** Suggested publisher feeds. Every feed is fetched and validated when added. */
const news = (id, name, url, countryCode, description) => ({
  id, name, url, countryCode, kind: 'news', platform: 'rss',
  iconUrl: `${new URL(url).origin}/favicon.ico`,
  description,
  availability: 'check-on-add',
});
const official = (id, name, url, countryCode, description) => ({
  ...news(id, name, url, countryCode, description), kind: 'official',
});

export const SOURCE_CATALOG = Object.freeze([
  news('isna', 'ایسنا', 'https://www.isna.ir/rss', 'IR', 'خبرگزاری دانشجویان ایران؛ خوراک عمومی خبرها.'),
  news('irna', 'ایرنا', 'https://www.irna.ir/rss', 'IR', 'خبرگزاری جمهوری اسلامی ایران؛ خبرها و گزارش‌های منتشرشده در خوراک عمومی.'),
  news('mehr', 'مهر', 'https://www.mehrnews.com/rss', 'IR', 'خبرگزاری مهر؛ فید عمومی خبرهای ایران و جهان.'),
  news('tasnim', 'تسنیم', 'https://www.tasnimnews.com/fa/rss/feed/0/8/0', 'IR', 'خبرگزاری تسنیم؛ خوراک عمومی فارسی.'),
  news('france24', 'France 24', 'https://www.france24.com/en/rss', 'FR', 'اخبار بین‌المللی و فرانسه به انگلیسی از France 24.'),
  news('dw', 'Deutsche Welle', 'https://rss.dw.com/rdf/rss-en-all', 'DE', 'خوراک انگلیسی دویچه‌وله؛ خبرهای آلمان و جهان.'),
  news('dawn', 'Dawn', 'https://www.dawn.com/feeds/home', 'PK', 'خبرهای پاکستان و منطقه از روزنامهٔ Dawn.'),
  news('cbc', 'CBC Canada', 'https://www.cbc.ca/webfeed/rss/rss-topstories', 'CA', 'برگزیدهٔ خبرهای شبکهٔ عمومی CBC کانادا.'),
  news('abc-au', 'ABC Australia', 'https://www.abc.net.au/news/feed/51120/rss.xml', 'AU', 'خبرهای استرالیا و جهان از ABC؛ دسترسی فید به سیاست ناشر بستگی دارد.'),
  news('the-hindu', 'The Hindu', 'https://www.thehindu.com/news/national/feeder/default.rss', 'IN', 'اخبار هند از روزنامهٔ The Hindu؛ بعضی مطالب ممکن است اشتراکی باشند.'),
  news('bbc-persian', 'بی‌بی‌سی فارسی', 'https://feeds.bbci.co.uk/persian/rss.xml', 'GB', 'خبرهای فارسی بی‌بی‌سی؛ کشور ناشر، مکان رخداد خبر را تعیین نمی‌کند.'),
  news('bbc-world', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'GB', 'خوراک انگلیسی خبرهای جهان بی‌بی‌سی.'),
  news('guardian', 'The Guardian', 'https://www.theguardian.com/world/rss', 'GB', 'خبرهای جهان گاردین؛ آرشیو تاریخی جداگانه به API رسمی نیاز دارد.'),
  news('aljazeera', 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'QA', 'خبرهای انگلیسی الجزیره از خوراک عمومی ناشر.'),
  official('white-house', 'کاخ سفید — اطلاعیه‌ها', 'https://www.whitehouse.gov/feed/', 'US', 'مطالب منتشرشده در وب‌سایت رسمی کاخ سفید؛ روایت رسمی منتشرکننده است و تأیید مستقل خبر محسوب نمی‌شود.'),
  official('uk-prime-minister', 'دفتر نخست‌وزیر بریتانیا', 'https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom', 'GB', 'خوراک رسمی GOV.UK از اطلاعیه‌ها و سخنرانی‌های دفتر نخست‌وزیر؛ ممکن است ناشر دسترسی خودکار را محدود کند.'),
  official('kremlin', 'ریاست‌جمهوری روسیه — کرملین', 'https://en.kremlin.ru/events/president/news/feed', 'RU', 'اطلاعیه‌ها و سخنرانی‌های منتشرشده در وب‌سایت رسمی ریاست‌جمهوری روسیه؛ بدون دسترسی خصوصی به حساب‌ها.'),
  official('un-news', 'اخبار سازمان ملل', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', '', 'منبع رسمی سازمان ملل، نهادی بین‌المللی و نه دولت یک کشور؛ مطالب عمومی انگلیسی.'),
]);

export const CATALOG_HOSTS = Object.freeze([...new Set(SOURCE_CATALOG.map(source => new URL(source.url).hostname))]);

export function findCatalogSource(id) {
  return SOURCE_CATALOG.find(source => source.id === id) || null;
}
