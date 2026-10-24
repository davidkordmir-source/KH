import { test, expect } from '@playwright/test';

const fixture = {
  id: 'atlas-ir', title: 'خبر آزمایشی تهران', summary: 'این متن فقط در آزمون مرورگر وجود دارد.',
  url: 'https://example.com/atlas-ir', imageUrl: null, sourceId: 'test', sourceName: 'منبع آزمون', platform: 'rss',
  publishedAt: '2024-03-20T08:00:00.000Z', publishedAtKnown: true, category: 'world', language: 'fa', saved: false, read: false,
  locations: [{ countryCode: 'IR', countryName: 'ایران', city: 'تهران', lat: 35.6892, lon: 51.389, confidence: 'mentioned' }],
};
const dashboard = {
  articles: [fixture, { ...fixture, id: 'atlas-us', title: 'خبر آزمایشی نیویورک', url: 'https://example.com/atlas-us', locations: [{ countryCode: 'US', countryName: 'آمریکا', city: 'نیویورک', lat: 40.7128, lon: -74.006, confidence: 'mentioned' }] }],
  sources: [], connections: [], customConnections: [], keywords: [], lastSyncAt: null, syncErrors: [],
};
const coverage = { oldestPublishedAt: fixture.publishedAt, newestPublishedAt: fixture.publishedAt, articleCount: 1, unknownDateCount: 0, scope: 'local' };

test('clicking the Iran country polygon filters the actual loaded news locations', async ({ page }) => {
  await page.route('**/api/dashboard', route => route.fulfill({ json: dashboard }));
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'نقشهٔ خبر', exact: true }).click();
  await expect(page.locator('.atlas-news-card')).toHaveCount(2);
  const iran = page.locator('.atlas-map [data-country="IR"]');
  await expect(iran).toBeAttached();
  await iran.click();
  await expect(page.getByRole('combobox', { name: 'کشور روی نقشه' })).toHaveValue('IR');
  await expect(page.locator('.atlas-news-card')).toHaveCount(1);
  await expect(page.locator('.atlas-news-card')).toContainText('خبر آزمایشی تهران');
  await page.getByRole('combobox', { name: 'شهر روی نقشه' }).selectOption('تهران');
  await expect(page.locator('.atlas-news-card')).toHaveCount(1);
  await expect(page.locator('.atlas-method')).toContainText('مکان دقیق رویداد');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
});

test('Persian 1403 archive day converts accurately and bookmarks use the persistent API', async ({ page }) => {
  let saved = false;
  let dayQuery = '';
  await page.route('**/api/dashboard', route => route.fulfill({ json: dashboard }));
  await page.route('**/api/archive/status', route => route.fulfill({ json: { guardianConfigured: false, coverage } }));
  await page.route('**/api/articles?*', route => {
    const url = new URL(route.request().url());
    dayQuery = url.searchParams.get('dateFrom') || '';
    const articles = dayQuery === '2024-03-20' ? [{ ...fixture, saved }] : [];
    return route.fulfill({ json: { articles, total: articles.length, offset: 0, limit: 50, coverage } });
  });
  await page.route('**/api/articles/atlas-ir/save', route => {
    saved = route.request().postDataJSON().saved;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'تاریخچهٔ خبر', exact: true }).click();
  await page.getByRole('textbox', { name: 'سال هجری شمسی' }).fill('۱۴۰۳');
  await page.getByRole('textbox', { name: 'ماه هجری شمسی' }).fill('۰۱');
  await page.getByRole('textbox', { name: 'روز هجری شمسی' }).fill('۰۱');
  await page.getByRole('button', { name: 'جست‌وجوی این روز', exact: true }).click();
  await expect(page.locator('.archive-news-card')).toHaveCount(1);
  expect(dayQuery).toBe('2024-03-20');
  await page.getByRole('button', { name: 'ذخیرهٔ خبر آرشیو', exact: true }).click();
  await expect(page.getByRole('button', { name: 'برداشتن خبر آرشیو از ذخیره‌شده‌ها', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(saved).toBe(true);
  await page.getByRole('button', { name: /دریافت خبرهای سال‌های گذشته از Guardian/ }).click();
  await expect(page.getByRole('button', { name: 'دریافت آرشیو این روز', exact: true })).toBeDisabled();
  await expect(page.getByLabel('کلید Guardian', { exact: true })).toHaveAttribute('type', 'password');
});
