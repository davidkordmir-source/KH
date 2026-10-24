import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';

const EMPTY_FEED = '<rss version="2.0"><channel><title>Isolated test source</title></channel></rss>';
const HEADLINE = 'خبرگزاری‌ها درباره وضعیت اقتصاد ایران گزارش تازه دادند';
const record = (id, publishedAt = '2024-03-20T10:00:00.000Z', extra = {}) => ({
  id, url: `https://news.example/${id}`, title: HEADLINE, summary: 'متن آزمایشی درباره اقتصاد ایران و تهران. این داده فقط در آزمون وجود دارد.',
  sourceId: `source-${id}`, sourceName: `Test ${id}`, platform: 'rss', category: 'economy', language: 'fa',
  publishedAt, publishedAtKnown: true, imageUrl: null, saved: false, ...extra,
});

async function fixture(t, { fetcher = async () => EMPTY_FEED } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dideban-api-v2-'));
  const instance = createApp({ directory, fetcher, urlValidator: async value => ({ url: new URL(value) }) });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    instance.store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (endpoint, method = 'GET', body) => fetch(`${base}${endpoint}`, {
    method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...instance, request };
}

test('official website references cannot be misreported as active feed connections', async t => {
  let reads=0;
  const {request}=await fixture(t,{fetcher:async()=>{reads++;throw new Error('Unexpected fetch');}});
  const catalog=await(await request('/api/catalog')).json();
  for (const code of ['US','GB','IL','RU','CN']) assert.ok(catalog.sources.some(item=>item.kind==='official'&&item.countryCode===code));
  assert.equal(catalog.sources.find(item=>item.id==='kremlin').websiteUrl,'https://en.kremlin.ru/events/president/news');
  const response=await request('/api/catalog/israel-prime-minister/add','POST',{});
  assert.equal(response.status,422);assert.equal(reads,0);
  assert.match((await response.json()).error,/وب‌سایت رسمی/);
});

test('saved API returns authoritative canonical records and honors unsaving after ingestion', async t => {
  const { store, request } = await fixture(t);
  store.addArticles([record('canonical-old', '2020-01-01T00:00:00.000Z'), record('newer', '2026-10-23T10:00:00.000Z')]);
  assert.equal((await request('/api/articles/canonical-old/save', 'POST', { saved: true })).status, 200);
  // A subsequent publisher response can carry another payload ID for the same URL.
  store.addArticles([record('replacement-payload-id', '2020-01-01T00:00:00.000Z', { url: 'https://news.example/canonical-old', title: 'عنوان به‌روز برای خبر قدیمی ذخیره‌شده' })]);
  const saved = await (await request('/api/saved')).json();
  assert.equal(saved.articles.length, 1);
  assert.equal(saved.articles[0].id, 'canonical-old');
  assert.equal(saved.articles[0].saved, true);
  assert.match(saved.articles[0].title, /به‌روز/);
  assert.equal((await request('/api/articles/canonical-old/save', 'POST', { saved: false })).status, 200);
  assert.deepEqual((await (await request('/api/saved')).json()).articles, []);
});

test('archive API uses inclusive Tehran days and excludes unknown dates rather than fabricating history', async t => {
  const { store, request } = await fixture(t);
  store.addArticles([
    record('before', '2024-03-19T20:29:59.999Z'),
    record('start', '2024-03-19T20:30:00.000Z'),
    record('previous-utc-evening', '2024-03-19T21:00:00.000Z'),
    record('end', '2024-03-20T20:29:59.999Z'),
    record('after', '2024-03-20T20:30:00.000Z'),
    record('unknown', '2024-03-20T10:00:00.000Z', { publishedAtKnown: false }),
  ]);
  const response = await request('/api/articles?dateFrom=2024-03-20&dateTo=2024-03-20&country=IR&city=تهران&limit=2');
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.total, 3);
  assert.equal(page.articles.length, 2);
  assert.equal(page.coverage.articleCount, 6);
  const final = await (await request('/api/articles?dateFrom=2024-03-20&dateTo=2024-03-20&offset=2&limit=2')).json();
  assert.deepEqual(new Set([...page.articles, ...final.articles].map(item => item.id)), new Set(['start', 'previous-utc-evening', 'end']));
  for (const suffix of ['dateFrom=2024-02-30', 'dateFrom=2024-03-21&dateTo=2024-03-20', 'limit=0', 'country=invalid', 'offset=-1']) {
    assert.equal((await request(`/api/articles?${suffix}`)).status, 400, suffix);
  }
});

test('read markers cover same-day copies while manual priority and saved state survive full sync', async t => {
  const article = record('seed-original');
  const feed = `<rss version="2.0"><channel><title>Isolated source</title><item><title>${HEADLINE}</title><description>خبر بازنشرشده درباره ایران</description><link>${article.url}</link><pubDate>Wed, 20 Mar 2024 10:00:00 GMT</pubDate></item></channel></rss>`;
  const { store, request } = await fixture(t, { fetcher: async () => feed });
  store.addArticles([article, record('same-day-copy'), record('different-day', '2024-03-21T10:00:00.000Z')]);
  assert.equal((await request('/api/articles/seed-original/priority', 'POST', { priority: 3 })).status, 200);
  assert.equal((await request('/api/articles/seed-original/save', 'POST', { saved: true })).status, 200);
  const read = await (await request('/api/articles/seed-original/read', 'POST', { read: true })).json();
  assert.equal(read.updated, 2);
  const synced = await (await request('/api/sync', 'POST', {})).json();
  const original = synced.articles.find(item => item.id === 'seed-original');
  const duplicate = synced.articles.find(item => item.id === 'same-day-copy');
  assert.equal(original.priority, 3);
  assert.equal(original.saved, true);
  assert.equal(original.read, true);
  assert.equal(duplicate.read, true);
  assert.equal(duplicate.readInherited, true);
  assert.equal(synced.articles.find(item => item.id === 'different-day').read, false);
  assert.equal((await request('/api/articles/seed-original/priority', 'POST', { priority: 4 })).status, 400);
  assert.equal((await request('/api/articles/missing/read', 'POST', { read: true })).status, 404);
});

test('source metadata is validated and enabling an existing Iranian catalog feed does not duplicate it', async t => {
  let reads = 0;
  const { request } = await fixture(t, { fetcher: async () => { reads++; return EMPTY_FEED; } });
  const before = await (await request('/api/dashboard')).json();
  const iranian = before.sources.find(source => source.id === 'isna');
  assert.equal(iranian.enabled, false);
  const added = await request('/api/catalog/isna/add', 'POST', {});
  assert.equal(added.status, 200);
  const entry = await added.json();
  assert.equal(entry.alreadyExists, true);
  assert.equal(entry.source.id, iranian.id);
  assert.equal(entry.source.enabled, true);
  assert.equal(reads, 1);
  assert.equal((await request(`/api/sources/${iranian.id}`, 'PATCH', { priority: 2, kind: 'official', countryCode: 'ir' })).status, 200);
  const after = await (await request('/api/dashboard')).json();
  assert.equal(after.sources.length, before.sources.length);
  const updated = after.sources.find(source => source.id === iranian.id);
  assert.equal(updated.priority, 2);
  assert.equal(updated.kind, 'official');
  assert.equal(updated.countryCode, 'IR');
  for (const patch of [{ priority: 'high' }, { priority: 4 }, { kind: 'unknown' }, { enabled: 'yes' }]) {
    assert.equal((await request(`/api/sources/${iranian.id}`, 'PATCH', patch)).status, 400);
  }
});

test('custom Bluesky account validates, imports source media, and removes its connection without exposing credentials', async t => {
  const calls = [];
  const profile = { did: 'did:plc:testing', handle: 'public-test.bsky.social', displayName: 'Public Test' };
  const entry = { post: {
    uri: 'at://did:plc:testing/app.bsky.feed.post/3testing', author: profile,
    record: { text: 'Public test bulletin about Tehran and Iran', createdAt: '2026-10-23T12:00:00.000Z' },
    embed: { images: [{ fullsize: 'https://cdn.bsky.app/image/test.jpg', thumb: 'https://cdn.bsky.app/image/thumb.jpg' }] },
  } };
  const { store, request } = await fixture(t, { fetcher: async (url, options) => {
    if (url.startsWith('https://public.api.bsky.app/')) {
      calls.push({ url, allowedHosts: options.allowedHosts });
      return JSON.stringify(url.includes('getProfile') ? profile : { feed: [entry] });
    }
    return EMPTY_FEED;
  } });
  const response = await request('/api/custom-connections', 'POST', { type: 'bluesky', actor: profile.handle, token: 'unused-test-credential' });
  assert.equal(response.status, 201);
  const connection = await response.json();
  assert.equal(connection.connected, true);
  const synced = await (await request('/api/sync', 'POST', {})).json();
  assert.equal(synced.syncErrors.length, 0);
  assert.equal(synced.customConnections.length, 1);
  assert.equal(synced.customConnections[0].id, connection.id);
  assert.equal(synced.articles.length, 1);
  assert.equal(synced.articles[0].platform, 'bluesky');
  assert.equal(synced.articles[0].media[0].url, 'https://cdn.bsky.app/image/test.jpg');
  assert.ok(synced.articles[0].locations.some(location => location.countryCode === 'IR'));
  assert.ok(!JSON.stringify(synced).includes('unused-test-credential'));
  assert.ok(calls.every(call => JSON.stringify(call.allowedHosts) === '["public.api.bsky.app"]'));
  const secret = store.db.prepare('SELECT secret FROM connections WHERE platform=?').get(`custom:${connection.id}`).secret;
  assert.ok(!secret.includes(profile.handle));
  assert.equal((await request(`/api/custom-connections/${connection.id}`, 'DELETE')).status, 200);
  assert.equal((await (await request('/api/dashboard')).json()).customConnections.length, 0);
  assert.equal(store.getConnection(`custom:${connection.id}`), null);
});

test('historical import without a provider binding fails explicitly and leaves the local archive usable', async t => {
  const { store, request } = await fixture(t, { fetcher: async () => { throw new Error('External calls are not permitted in this test.'); } });
  store.addArticles([record('local-history')]);
  const status = await (await request('/api/archive/status')).json();
  if (status.guardianConfigured) return t.skip('A Guardian key is externally injected in this runner.');
  assert.equal(status.coverage.articleCount, 1);
  const imported = await request('/api/archive/import', 'POST', { date: '2024-03-20' });
  assert.equal(imported.status, 428);
  const message = await imported.json();
  assert.match(message.error, /Guardian|گاردین/);
  const local = await (await request('/api/articles?dateFrom=2024-03-20&dateTo=2024-03-20')).json();
  assert.equal(local.total, 1);
});
