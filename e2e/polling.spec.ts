import { test, expect } from '@playwright/test';

const article = {
  id: 'polling-test', title: 'خبر تازه به‌صورت خودکار دریافت شد', summary: 'دادهٔ ساختگی فقط برای آزمون مرورگر',
  url: 'https://example.com/polling-test', imageUrl: null, sourceId: 'polling-source', sourceName: 'منبع آزمون',
  platform: 'rss', publishedAt: '2026-10-23T10:00:00.000Z', category: 'world', language: 'fa', saved: false,
};
const initialDashboard = {
  articles: [] as typeof article[], sources: [], connections: [], keywords: [], lastSyncAt: null as string | null,
  syncErrors: [] as { sourceId: string; sourceName: string; message: string }[],
};

test('news and sync errors from the first background collection appear without manual refresh', async ({ page }) => {
  await page.clock.install();
  let collectionFinished = false;
  let syncRequests = 0;
  await page.route('**/api/dashboard', route => route.fulfill({ json: collectionFinished ? {
    ...initialDashboard, articles: [article], lastSyncAt: article.publishedAt,
    syncErrors: [{ sourceId: 'other-source', sourceName: 'منبع دوم', message: 'خطای دریافت پس‌زمینهٔ آزمایشی' }],
  } : initialDashboard }));
  await page.route('**/api/sync', route => { syncRequests += 1; return route.fulfill({ json: initialDashboard }); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'اولین خبر، یک کلیک فاصله دارد' })).toBeVisible();
  await expect(page.locator('.article-card')).toHaveCount(0);
  collectionFinished = true;
  await page.clock.fastForward(3_000);
  await expect(page.getByRole('heading', { name: article.title })).toBeVisible();
  await page.locator('.sync-errors-heading').click();
  await expect(page.locator('.sync-errors-content')).toContainText('خطای دریافت پس‌زمینهٔ آزمایشی');
  expect(syncRequests).toBe(0);
});

test('a late polling response cannot overwrite a bookmark mutation', async ({ page }) => {
  await page.clock.install();
  let saved = false;
  let holdNextRead = false;
  let pendingRead: (() => Promise<void>) | undefined;
  await page.route('**/api/dashboard', async route => {
    const payload = { ...initialDashboard, articles: [{ ...article, saved }] };
    if (holdNextRead) {
      holdNextRead = false;
      await new Promise<void>(resolve => {
        pendingRead = async () => { await route.fulfill({ json: payload }).catch(() => {}); resolve(); };
      });
    } else await route.fulfill({ json: payload });
  });
  await page.route('**/api/articles/polling-test/save', route => {
    saved = route.request().postDataJSON().saved;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: article.title })).toBeVisible();
  holdNextRead = true;
  await page.clock.fastForward(10_000);
  await expect.poll(() => Boolean(pendingRead)).toBe(true);
  await page.getByRole('button', { name: 'ذخیره خبر', exact: true }).click();
  await expect(page.getByRole('button', { name: 'برداشتن خبر از ذخیره‌شده‌ها', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await pendingRead!();
  await expect(page.getByRole('button', { name: 'برداشتن خبر از ذخیره‌شده‌ها', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
