import { test, expect } from '@playwright/test';

test('Persian dashboard loads real empty storage without fabricated articles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('اتاق خبر شما');
  await expect(page.getByRole('heading', { name: 'اولین خبر، یک کلیک فاصله دارد' })).toBeVisible();
  await expect(page.locator('.source-mini')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('dashboard-desktop.png'), fullPage: true });
});

test('keywords persist in the API and across page reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'موضوع‌ها و هشتگ‌ها', exact: true }).click();
  await page.getByRole('textbox', { name: 'موضوع جدید' }).fill('آزمون پایش');
  await page.locator('.keyword-form').getByRole('button', { name: 'افزودن موضوع', exact: true }).click();
  await expect(page.locator('.keyword-row').filter({ hasText: 'آزمون پایش' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'موضوع‌ها و هشتگ‌ها', exact: true }).click();
  await expect(page.locator('.keyword-row').filter({ hasText: 'آزمون پایش' })).toBeVisible();
  await page.getByRole('button', { name: 'حذف موضوع آزمون پایش', exact: true }).click();
  await expect(page.locator('.keyword-row').filter({ hasText: 'آزمون پایش' })).toHaveCount(0);
});

test('sources can be paused and private URLs are refused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^منابع خبری/ }).click();
  const first = page.locator('.source-card').first();
  await first.getByRole('switch').click();
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await page.getByRole('button', { name: /^منابع خبری/ }).click();
  await expect(first.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await first.getByRole('switch').click();
  await page.getByRole('button', { name: 'افزودن منبع', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'نام منبع', exact: true }).fill('منبع ممنوع آزمایشی');
  await dialog.locator('input[type=url]').fill('https://127.0.0.1/feed');
  await dialog.getByRole('button', { name: 'افزودن منبع', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('محلی');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('all five platform forms expose accurate credential requirements', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'حساب‌های متصل', exact: true }).click();
  await expect(page.locator('.connection-card')).toHaveCount(5);
  for (const card of await page.locator('.connection-card').all()) {
    await card.getByRole('button', { name: 'اتصال حساب', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('input[type=password]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
  const telegram = page.locator('.connection-card').filter({ has: page.getByRole('heading', { name: /تلگرام/ }) });
  await telegram.getByRole('button', { name: 'اتصال حساب', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=password]').fill('invalid-test-token');
  await page.getByRole('button', { name: 'بررسی و اتصال', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('قالب توکن');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('article filtering, bookmark and sync error rendering work with isolated test responses', async ({ page }) => {
  // Synthetic articles exist only in this intercepted test, never in application storage.
  const payload = {
    articles: [
      { id: 'test-fa', title: 'خبر آزمایشی فناوری', summary: 'نمونهٔ آزمایشی درباره هوش مصنوعی', url: 'https://example.com/test-fa', imageUrl: null, sourceId: 'test-source', sourceName: 'منبع آزمون', platform: 'rss', publishedAt: new Date().toISOString(), category: 'technology', language: 'fa', saved: false },
      { id: 'test-en', title: 'Test world headline', summary: 'A synthetic browser test only', url: 'https://example.com/test-en', imageUrl: null, sourceId: 'test-source', sourceName: 'منبع آزمون', platform: 'rss', publishedAt: new Date(Date.now() - 1000).toISOString(), publishedAtKnown: false, category: 'world', language: 'en', saved: false },
    ],
    sources: [{ id: 'test-source', name: 'منبع آزمون', url: 'https://example.com/feed', platform: 'rss', enabled: true, lastFetchedAt: null, lastError: null }],
    connections: [], keywords: ['هوش مصنوعی'], lastSyncAt: null as string | null,
    syncErrors: [] as { sourceId: string; sourceName: string; message: string }[],
  };
  await page.route('**/api/dashboard', route => route.fulfill({ json: payload }));
  await page.route('**/api/articles/test-fa/save', async route => {
    payload.articles[0].saved = route.request().postDataJSON().saved;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/sync', async route => {
    expect(route.request().headers()['content-type']).toContain('application/json');
    payload.syncErrors = [{ sourceId: 'test-source', sourceName: 'منبع آزمون', message: 'خطای شبکهٔ آزمایشی' }];
    payload.lastSyncAt = new Date().toISOString();
    await route.fulfill({ json: payload });
  });
  await page.goto('/');
  await expect(page.locator('.article-card')).toHaveCount(2);
  await expect(page.getByText('زمان انتشار نامشخص', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'بازهٔ زمانی خبر' }).selectOption('1');
  await expect(page.locator('.article-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'بازهٔ زمانی خبر' }).selectOption('all');
  await page.getByRole('combobox', { name: 'زبان خبر' }).selectOption('fa');
  await expect(page.locator('.article-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'ذخیره خبر', exact: true }).click();
  await expect(page.getByRole('button', { name: 'برداشتن خبر از ذخیره‌شده‌ها', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^ذخیره‌شده‌ها/ }).click();
  await expect(page.locator('.article-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'جمع‌آوری خبرها', exact: true }).click();
  await page.locator('.sync-errors-heading').click();
  await expect(page.locator('.sync-errors-content')).toContainText('خطای شبکهٔ آزمایشی');
});

test('mobile navigation and dialogs fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dashboard-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'باز کردن فهرست', exact: true }).click();
  await page.getByRole('button', { name: /^منابع خبری/ }).click();
  await page.getByRole('button', { name: 'افزودن منبع', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
