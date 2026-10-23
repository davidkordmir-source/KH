import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { validatePublicUrl, isPublicAddress } from '../server/network.mjs';
import { parseFeed, normalizeArticleUrl, discoverFeedUrl } from '../server/feeds.mjs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';

const feed = (url = 'https://news.example/story') => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>News</title><item><title>هوش مصنوعی در علم</title><description><![CDATA[<p>خبر <strong>تازه</strong> &amp; معتبر</p><script>bad()</script>]]></description><link>${url}?utm_source=test&amp;id=3</link><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><media:thumbnail url="https://images.example/photo.jpg" /></item></channel></rss>`;
const fixtureSource = { id: 'fixture', name: 'منبع آزمون', platform: 'rss' };

test('RSS parsing retains attribution and publication date, removes markup, and deduplicates tracking URLs', () => {
  const [article] = parseFeed(feed(), fixtureSource);
  assert.equal(article.title, 'هوش مصنوعی در علم');
  assert.equal(article.summary, 'خبر تازه & معتبر');
  assert.equal(article.url, 'https://news.example/story?id=3');
  assert.equal(article.sourceName, 'منبع آزمون');
  assert.equal(article.publishedAt, '2026-10-23T10:00:00.000Z');
  assert.equal(article.publishedAtKnown, true);
  assert.equal(article.category, 'technology');
  assert.equal(article.language, 'fa');
  assert.equal(article.imageUrl, 'https://images.example/photo.jpg');
  const duplicated = feed().replace('</channel>', `${feed().match(/<item>[\s\S]*<\/item>/)[0]}</channel>`);
  assert.equal(parseFeed(duplicated, fixtureSource).length, 1);
});

test('Missing or invalid RSS publication dates remain explicitly unknown despite storage ordering fallback', () => {
  const collectedAt = new Date('2026-10-23T12:00:00.000Z');
  for (const xml of [feed().replace(/<pubDate>.*?<\/pubDate>/, ''), feed().replace(/<pubDate>.*?<\/pubDate>/, '<pubDate>invalid date</pubDate>')]) {
    const [article] = parseFeed(xml, fixtureSource, collectedAt);
    assert.equal(article.publishedAtKnown, false);
    assert.equal(article.publishedAt, collectedAt.toISOString());
  }
});

test('Atom alternate links and XML safety restrictions are enforced', () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>World news</title><link rel="alternate" href="https://news.example/atom"/><updated>2026-10-22T12:00:00Z</updated><summary>Report</summary></entry></feed>';
  assert.equal(parseFeed(atom, fixtureSource)[0].url, 'https://news.example/atom');
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>', fixtureSource), /مجاز/);
  assert.throws(() => parseFeed('<html><body>Not RSS</body></html>', fixtureSource), /RSS/);
  assert.throws(() => parseFeed('<rss><channel>', fixtureSource), /معتبر/);
  assert.equal(normalizeArticleUrl('javascript:alert(1)'), null);
  assert.equal(normalizeArticleUrl('https://user:secret@example.com/'), null);
});

test('Website RSS autodiscovery handles relative URLs and attribute order', () => {
  const html = `<html><head><link href='/feed?language=fa&amp;type=all' type="application/rss+xml" rel="alternate"></head></html>`;
  assert.equal(discoverFeedUrl(html, 'https://example.com/news'), 'https://example.com/feed?language=fa&type=all');
  assert.equal(discoverFeedUrl('<link href="/style.css" rel="stylesheet">', 'https://example.com'), null);
});

test('SSRF validation rejects private addresses, credentials, insecure URLs and mixed DNS answers', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const blocked = ['https://127.0.0.1', 'https://127.1', 'https://10.0.0.1', 'https://169.254.169.254', 'https://172.16.0.1', 'https://192.168.1.1', 'https://100.64.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'http://example.com', 'https://user:password@example.com', 'https://localhost', 'https://metadata.internal', 'https://example.com:444'];
  for (const url of blocked) await assert.rejects(() => validatePublicUrl(url, publicLookup), undefined, url);
  await assert.rejects(() => validatePublicUrl('https://example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]));
  assert.equal((await validatePublicUrl('https://example.com/rss', publicLookup)).url.pathname, '/rss');
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('fc00::1'), false);
});

test('Restricted local DNS can defer only fixed publisher/API names to a configured trusted proxy', async () => {
  const failedLookup = async () => { const error = new Error('DNS unavailable'); error.code = 'EAI_AGAIN'; throw error; };
  const allowed = await validatePublicUrl('https://feeds.bbci.co.uk/persian/rss.xml', failedLookup, { proxyAvailable: true });
  assert.equal(allowed.resolvedByTrustedProxy, true);
  assert.deepEqual(allowed.addresses, []);
  assert.equal((await validatePublicUrl('https://api.telegram.org/bot123/getMe', failedLookup, { proxyAvailable: true })).resolvedByTrustedProxy, true);
  await assert.rejects(() => validatePublicUrl('https://feeds.bbci.co.uk/persian/rss.xml', failedLookup, { proxyAvailable: false }));
  await assert.rejects(() => validatePublicUrl('https://attacker.example/rss', failedLookup, { proxyAvailable: true }));
  await assert.rejects(() => validatePublicUrl('https://feeds.bbci.co.uk.attacker.example/rss', failedLookup, { proxyAvailable: true }));
  await assert.rejects(() => validatePublicUrl('https://feeds.bbci.co.uk/rss', async () => [{ address: '127.0.0.1', family: 4 }], { proxyAvailable: true }));
  const invalidLookup = async () => { const error = new Error('Other error'); error.code = 'EACCES'; throw error; };
  await assert.rejects(() => validatePublicUrl('https://feeds.bbci.co.uk/rss', invalidLookup, { proxyAvailable: true }));
});

test('SQLite persists saved articles across re-ingestion/restart and encrypts secrets at rest', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'didban-store-'));
  let store = new Store(directory);
  try {
    const articles = parseFeed(feed(), fixtureSource);
    store.addArticles(articles);
    store.saveArticle(articles[0].id, true);
    store.addArticles([{ ...articles[0], title: 'عنوان به‌روزشده' }]);
    assert.equal(store.articles().length, 1);
    assert.equal(store.articles()[0].saved, true);
    store.setConnection('x', 'My API', { token: 'dummy-credential-for-unit-testing' });
    const ciphertext = store.db.prepare('SELECT secret FROM connections WHERE platform=?').get('x').secret;
    assert.ok(!ciphertext.includes('dummy-credential'));
    assert.equal(store.getConnection('x').token, 'dummy-credential-for-unit-testing');
    assert.ok(!JSON.stringify(store.dashboard()).includes('dummy-credential'));
    assert.equal(statSync(path.join(directory, 'credentials.key')).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(directory, 'news.sqlite')).mode & 0o777, 0o600);
    store.close();
    store = new Store(directory);
    assert.equal(store.articles()[0].saved, true);
    assert.equal(store.articles()[0].title, 'عنوان به‌روزشده');
    assert.equal(store.getConnection('x').token, 'dummy-credential-for-unit-testing');
    assert.ok(!readFileSync(path.join(directory, 'news.sqlite')).includes(Buffer.from('dummy-credential')));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function withServer(t, { fetcher, urlValidator } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'didban-api-'));
  const instance = createApp({ directory, fetcher, urlValidator });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); instance.store.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (endpoint, method = 'GET', body, headers = {}) => fetch(`${base}${endpoint}`, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { ...instance, request, base };
}

test('API ingestion saves real parsed feed records, reports partial failures, and preserves bookmarks', async t => {
  const { request } = await withServer(t, { fetcher: async url => {
    if (url.includes('aljazeera')) throw new Error('پاسخ سرویس: HTTP 403. دسترسی شبکه را بررسی کنید.');
    return feed(`https://${new URL(url).hostname}/article`);
  } });
  const initial = await (await request('/api/dashboard')).json();
  assert.equal(initial.articles.length, 0);
  const first = await (await request('/api/sync', 'POST')).json();
  // BBC feeds share the same fixture article URL, exercising cross-source dedup.
  assert.equal(first.articles.length, 2);
  assert.equal(first.syncErrors.length, 1);
  assert.equal(first.syncErrors[0].sourceId, 'aljazeera');
  assert.ok(first.lastSyncAt);
  const article = first.articles[0];
  assert.equal((await request(`/api/articles/${article.id}/save`, 'POST', { saved: true })).status, 200);
  const second = await (await request('/api/sync', 'POST')).json();
  assert.equal(second.articles.find(item => item.id === article.id).saved, true);
  assert.equal(second.sources.find(source => source.id === 'aljazeera').lastFetchedAt, null);
  assert.ok(second.sources.find(source => source.id === 'bbc-world').lastFetchedAt);
});

test('Source creation discovers a website feed, validates it, and rejects duplicates', async t => {
  const { request } = await withServer(t, {
    fetcher: async url => url.endsWith('/home') ? '<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>' : feed(),
    urlValidator: async value => ({ url: new URL(value) }),
  });
  const response = await request('/api/sources', 'POST', { name: 'سایت جدید', url: 'https://example.com/home' });
  assert.equal(response.status, 201);
  const source = await response.json();
  assert.equal(source.url, 'https://example.com/rss.xml');
  assert.equal((await request('/api/sources', 'POST', { name: 'دوباره', url: 'https://example.com/home' })).status, 409);
  assert.equal((await request(`/api/sources/${source.id}`, 'PATCH', { enabled: false })).status, 200);
  assert.equal((await (await request('/api/dashboard')).json()).sources.find(item => item.id === source.id).enabled, false);
  assert.equal((await request(`/api/sources/${source.id}`, 'DELETE')).status, 200);
});

test('API rejects cross-origin mutations, DNS-rebinding hosts, non-JSON requests, and invalid payloads', async t => {
  const { request, base } = await withServer(t);
  assert.equal((await request('/api/keywords', 'PUT', { keywords: ['خبر'] }, { Origin: 'https://attacker.example' })).status, 403);
  const rebindStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/health`, { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject);
  });
  assert.equal(rebindStatus, 403);
  assert.equal((await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await request('/api/keywords', 'PUT', { keywords: Array(21).fill('خبر') })).status, 400);
  assert.equal((await request('/api/articles/missing/save', 'POST', { saved: true })).status, 404);
  assert.equal((await request('/api/connections/unknown', 'POST', { token: '1234567890' })).status, 400);
  const response = await request('/api/keywords', 'PUT', { keywords: ['#ایران', 'ایران', 'هوش مصنوعی'] });
  assert.deepEqual((await response.json()).keywords, ['ایران', 'هوش مصنوعی']);
});

test('Telegram validates bot identity, imports accessible channel messages once, and never exposes token', async t => {
  const token = '123456789:abcdefghijklmnopqrstuvwxyzABCDEF';
  let polls = 0;
  const { request } = await withServer(t, { fetcher: async (url, options = {}) => {
    if (url.endsWith('/getMe')) return JSON.stringify({ ok: true, result: { id: 123456789, is_bot: true, username: 'fixture_bot' } });
    if (url.endsWith('/getUpdates')) {
      const body = JSON.parse(options.body);
      polls++;
      return JSON.stringify({ ok: true, result: body.offset > 4 ? [] : [{ update_id: 4, channel_post: { message_id: 12, date: 1792749600, chat: { id: -10012345, type: 'channel', username: 'test_channel', title: 'کانال آزمون' }, text: 'خبر تازه دربارهٔ اقتصاد جهان' } }] });
    }
    return '<rss><channel/></rss>';
  } });
  const connected = await request('/api/connections/telegram', 'POST', { token, channels: ['@test_channel'] });
  assert.equal(connected.status, 200);
  const first = await (await request('/api/sync', 'POST')).json();
  assert.equal(first.articles.length, 1);
  assert.equal(first.articles[0].url, 'https://t.me/test_channel/12');
  assert.equal(first.connections.find(item => item.platform === 'telegram').connected, true);
  assert.ok(!JSON.stringify(first).includes(token));
  const second = await (await request('/api/sync', 'POST')).json();
  assert.equal(second.articles.length, 1);
  assert.equal(polls, 2);
  assert.equal((await request('/api/connections/telegram', 'DELETE')).status, 200);
});

test('X checks actual search permission, searches configured keywords, attributes and deduplicates posts', async t => {
  const requests = [];
  const { request } = await withServer(t, { fetcher: async (url, options = {}) => {
    if (new URL(url).hostname === 'api.x.com') {
      requests.push({ url: new URL(url), authorization: options.headers.Authorization });
      if (options.headers.Authorization === 'Bearer denied-test-token') throw new Error('پاسخ سرویس: HTTP 403. این طرح اجازهٔ جست‌وجو ندارد.');
      return JSON.stringify({ data: [{ id: '1234567890', text: 'گزارش تازه دربارهٔ ایران', author_id: '42', created_at: '2026-10-22T10:00:00Z', lang: 'fa' }], includes: { users: [{ id: '42', username: 'trusted_source', name: 'منبع معتبر' }] } });
    }
    return '<rss><channel/></rss>';
  } });
  const denied = await request('/api/connections/x', 'POST', { token: 'denied-test-token' });
  assert.equal(denied.status, 400);
  assert.equal((await (await request('/api/dashboard')).json()).connections.find(item => item.platform === 'x').connected, false);
  assert.equal((await request('/api/connections/x', 'POST', { token: 'approved-test-token', label: 'پایش ایکس' })).status, 200);
  assert.equal((await request('/api/keywords', 'PUT', { keywords: ['ایران', 'climate'] })).status, 200);
  const first = await (await request('/api/sync', 'POST')).json();
  assert.equal(first.articles.length, 1);
  assert.equal(first.articles[0].sourceName, 'منبع معتبر');
  assert.equal(first.articles[0].url, 'https://x.com/trusted_source/status/1234567890');
  assert.equal(first.articles[0].platform, 'x');
  assert.ok(requests.at(-1).url.searchParams.get('query').includes('"ایران" OR "climate"'));
  assert.ok(requests.at(-1).url.searchParams.get('query').includes('-is:retweet'));
  assert.ok(!requests.at(-1).url.href.includes('approved-test-token'));
  assert.ok(!JSON.stringify(first).includes('approved-test-token'));
  const second = await (await request('/api/sync', 'POST')).json();
  assert.equal(second.articles.length, 1);
});
