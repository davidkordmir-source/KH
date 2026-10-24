import { test, expect, type Request } from '@playwright/test';

test('a stale saved-news read cannot resurrect an article after it is unsaved', async ({ page }) => {
  await page.clock.install();
  let saved = true;
  let holdNextSavedRead = false;
  let pendingRead: (() => Promise<void>) | undefined;
  let heldRequest: Request | undefined;
  let markHeldSettled: (() => void) | undefined;
  const heldSettled = new Promise<void>(resolve => { markHeldSettled = resolve; });
  page.on('requestfailed', request => { if (request === heldRequest) markHeldSettled?.(); });
  page.on('requestfinished', request => { if (request === heldRequest) markHeldSettled?.(); });
  const article = {
    id: 'saved-race-test', title: 'خبر ذخیره‌شده برای آزمون پاسخ دیررس', summary: 'دادهٔ ساختگی فقط برای تست مرورگر',
    url: 'https://example.com/saved-race', imageUrl: null, sourceId: 'test-source', sourceName: 'منبع آزمون',
    platform: 'rss', publishedAt: '2026-10-23T10:00:00.000Z', category: 'world', language: 'fa',
  };
  await page.route('**/api/dashboard', route => route.fulfill({ json: {
    articles: [{ ...article, saved }], sources: [], connections: [], keywords: [], lastSyncAt: null, syncErrors: [],
  } }));
  await page.route('**/api/saved', async route => {
    const snapshot = { articles: saved ? [{ ...article, saved: true }] : [] };
    if (holdNextSavedRead) {
      holdNextSavedRead = false;
      heldRequest = route.request();
      await new Promise<void>(resolve => {
        pendingRead = async () => {
          await route.fulfill({ json: snapshot }).catch(() => {});
          resolve();
        };
      });
    } else await route.fulfill({ json: snapshot });
  });
  await page.route('**/api/articles/saved-race-test/save', route => {
    saved = route.request().postDataJSON().saved;
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /^ذخیره‌شده‌ها/ }).click();
  await expect(page.getByRole('heading', { name: article.title })).toBeVisible();
  holdNextSavedRead = true;
  await page.clock.fastForward(10_000);
  await expect.poll(() => Boolean(pendingRead)).toBe(true);

  await page.getByRole('button', { name: 'برداشتن خبر از ذخیره‌شده‌ها', exact: true }).click();
  await expect(page.locator('.article-card')).toHaveCount(0);
  expect(saved).toBe(false);
  await pendingRead!();
  await heldSettled;
  await page.clock.fastForward(100);
  await expect(page.locator('.article-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'خبرهای ارزشمند را نگه دارید' })).toBeVisible();
});
