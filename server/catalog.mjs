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
const officialWebsite = (id, name, url, countryCode, description) => ({
  ...official(id, name, url, countryCode, description), collection: 'website', platform: 'website', availability: 'reference-only',
});

export const SOURCE_CATALOG = Object.freeze([
  {...news('iran-international','ایران اینترنشنال','https://www.iranintl.com/','GB','دریافت از فید یا دادهٔ خبری عمومی سایت، پس از بررسی دسترسی روی دستگاه شما؛ دسترسی زنده در محیط ساخت تأیید نشده است.'),collection:'structured',platform:'website'},
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
  officialWebsite('white-house', 'کاخ سفید — ریاست‌جمهوری آمریکا', 'https://www.whitehouse.gov/briefings-statements/', 'US', 'اطلاعیه‌ها و اظهارات ریاست‌جمهوری آمریکا؛ پیوند وب‌سایت رسمی، بدون ادعای اتصال خودکار RSS.'),
  official('uk-prime-minister', 'دفتر نخست‌وزیر بریتانیا', 'https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom', 'GB', 'خوراک رسمی GOV.UK از اطلاعیه‌ها و سخنرانی‌های دفتر نخست‌وزیر؛ ممکن است ناشر دسترسی خودکار را محدود کند.'),
  official('kremlin', 'ریاست‌جمهوری روسیه — کرملین', 'https://en.kremlin.ru/events/president/news/feed', 'RU', 'اطلاعیه‌ها و سخنرانی‌های منتشرشده در وب‌سایت رسمی ریاست‌جمهوری روسیه؛ بدون دسترسی خصوصی به حساب‌ها.'),
  officialWebsite('israel-prime-minister', 'دفتر نخست‌وزیر اسرائیل', 'https://www.gov.il/en/departments/prime_ministers_office/govil-landing-page', 'IL', 'صفحهٔ رسمی دفتر نخست‌وزیر در درگاه دولت اسرائیل؛ مشاهدهٔ مستقیم اطلاعیه‌ها در سایت منبع.'),
  officialWebsite('israel-foreign-ministry', 'وزارت امور خارجهٔ اسرائیل', 'https://www.gov.il/en/departments/ministry_of_foreign_affairs/govil-landing-page', 'IL', 'صفحهٔ رسمی وزارت امور خارجه در درگاه دولت؛ دریافت خودکار فید برای این پیوند تأیید نشده است.'),
  officialWebsite('china-foreign-ministry', 'وزارت امور خارجهٔ چین — نشست‌های خبری', 'https://www.fmprc.gov.cn/eng/xw/fyrbt/', 'CN', 'نشست‌ها و اظهارات سخنگوی وزارت امور خارجهٔ چین؛ پیوند مستقیم وب‌سایت رسمی، بدون ادعای اتصال خودکار.'),
  officialWebsite('china-state-council', 'دولت چین — شورای دولتی', 'https://english.www.gov.cn/news/', 'CN', 'درگاه انگلیسی دولت و شورای دولتی چین؛ خبرها و اطلاعیه‌های منتشرکنندهٔ رسمی.'),
  {...official('zelensky-public-telegram','ولودیمیر زلنسکی — پست‌ها و سخنرانی‌ها در تلگرام','https://t.me/s/v_zelenskiy_official','UA','کانال عمومی V_Zelenskiy_official؛ دریافت پست‌های قابل نمایش در وب تلگرام بدون کلید، پس از بررسی دسترسی. پوشش کامل سایت ریاست‌جمهوری یا تاریخچه نیست.'),collection:'structured',platform:'telegram-public'},
  {...official('us-state','وزارت خارجهٔ آمریکا — سخنرانی‌ها','https://www.state.gov/remarks-and-releases/','US','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('us-defense','وزارت دفاع آمریکا — سخنرانی‌ها','https://www.defense.gov/News/Speeches/','US','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('us-treasury','خزانه‌داری آمریکا — اظهارات و اطلاعیه‌ها','https://home.treasury.gov/news/press-releases','US','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('uk-foreign','وزارت خارجهٔ بریتانیا','https://www.gov.uk/government/organisations/foreign-commonwealth-development-office','GB','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('uk-defence','وزارت دفاع بریتانیا','https://www.gov.uk/government/organisations/ministry-of-defence','GB','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('ru-foreign','وزارت خارجهٔ روسیه — اظهارات','https://mid.ru/en/press_service/','RU','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('china-president','چین — اخبار ریاست‌جمهوری','https://english.www.gov.cn/news/topnews/','CN','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('iran-president','ریاست‌جمهوری ایران','https://president.ir/','IR','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('iran-foreign','وزارت امور خارجهٔ ایران','https://mfa.gov.ir/','IR','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('france-elysee','ریاست‌جمهوری فرانسه — الیزه','https://www.elysee.fr/en/','FR','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('germany-chancellor','صدراعظم آلمان — اظهارات','https://www.bundesregierung.de/breg-en/news','DE','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('india-pm','نخست‌وزیر هند — سخنرانی‌ها','https://www.pmindia.gov.in/en/tag/speeches/','IN','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('turkey-president','ریاست‌جمهوری ترکیه','https://www.tccb.gov.tr/en/','TR','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('japan-pm','نخست‌وزیر ژاپن — اظهارات','https://japan.kantei.go.jp/','JP','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('ukraine-president','ریاست‌جمهوری اوکراین — سخنرانی‌ها','https://www.president.gov.ua/en/news/speeches','UA','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('nato-speeches','ناتو — سخنرانی‌ها و متن نشست‌ها','https://www.nato.int/cps/en/natohq/opinions.htm','','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('un-secretary','دبیرکل سازمان ملل — سخنرانی‌ها','https://www.un.org/sg/en/content/sg/speeches','','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  {...official('eu-council','شورای اروپا — سخنرانی‌ها و اطلاعیه‌ها','https://www.consilium.europa.eu/en/press/press-releases/','','صفحهٔ رسمی سخنرانی‌ها و اظهارات؛ دریافت خودکار پس از بررسی دسترسی و دادهٔ عمومی روی دستگاه شما.'),collection:'structured',platform:'website'},
  official('un-news', 'اخبار سازمان ملل', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', '', 'منبع رسمی سازمان ملل، نهادی بین‌المللی و نه دولت یک کشور؛ مطالب عمومی انگلیسی.'),
]);

export const OFFICIAL_WEBSITES = Object.freeze({
  'uk-prime-minister': 'https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street',
  kremlin: 'https://en.kremlin.ru/events/president/news',
});

export const CATALOG_HOSTS = Object.freeze([...new Set(SOURCE_CATALOG.map(source => new URL(source.url).hostname))]);

export function findCatalogSource(id) {
  return SOURCE_CATALOG.find(source => source.id === id) || null;
}
