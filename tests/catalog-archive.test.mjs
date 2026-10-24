import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveService, guardianArticle, validateArchiveDate } from '../server/archive-provider.mjs';
import { SOURCE_CATALOG, CATALOG_HOSTS, findCatalogSource } from '../server/catalog.mjs';

const DAY = '2024-03-20';
const TOKEN = 'synthetic-archive-test-key';
const item = (id = 'one', date = '2024-03-20T12:00:00Z') => ({
  webUrl: `https://www.theguardian.com/world/2024/mar/20/${id}`,
  webTitle: 'World report &amp; context', webPublicationDate: date,
  fields: { trailText: '<p>Reported facts <strong>from the source</strong>.</p>', thumbnail: 'https://i.guim.co.uk/img/media/test.jpg' },
});
function fakeStore() {
  const connections = new Map();
  let articles = [];
  return {
    getConnection: name => connections.get(name) || null,
    setConnection: (name, label, credentials) => connections.set(name, { label, ...credentials }),
    addArticles: incoming => { articles = [...new Map([...articles, ...incoming].map(article => [article.url, article])).values()]; },
    archiveCoverage: () => ({ articleCount: articles.length, scope: 'local' }),
    readArticles: () => articles,
  };
}
const ok = (results = [], pages = 1) => JSON.stringify({ response: { status: 'ok', results, pages } });

test('catalog distinguishes publisher country from story location and exposes real publisher-owned icon origins', () => {
  assert.equal(new Set(SOURCE_CATALOG.map(source => source.id)).size, SOURCE_CATALOG.length);
  assert.ok(SOURCE_CATALOG.filter(source => source.countryCode === 'IR').length >= 4);
  assert.ok(SOURCE_CATALOG.some(source => source.countryCode === 'PK'));
  assert.ok(SOURCE_CATALOG.some(source => source.kind === 'official' && source.countryCode === 'GB'));
  assert.equal(findCatalogSource('un-news').countryCode, '');
  assert.equal(findCatalogSource('unknown'), null);
  for (const source of SOURCE_CATALOG) {
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.equal(new URL(source.iconUrl).origin, new URL(source.url).origin);
    assert.equal(source.availability, source.collection === 'website' ? 'reference-only' : 'check-on-add');
    assert.ok(!('locations' in source));
    assert.ok(CATALOG_HOSTS.includes(new URL(source.url).hostname));
  }
});

test('archive dates validate leap days and reject rolled-over or malformed dates', () => {
  assert.equal(validateArchiveDate('2024-02-29'), '2024-02-29');
  for (const date of ['2025-02-29', '2024-02-30', '2024-3-20', '2024-13-01', '2024-03-20T00:00:00Z', '../secret', null]) {
    assert.throws(() => validateArchiveDate(date));
  }
});

test('official directory covers five requested countries and distinguishes websites from feeds', () => {
  for (const code of ['US','GB','IL','RU','CN']) assert.ok(SOURCE_CATALOG.some(item => item.kind === 'official' && item.countryCode === code), code);
  const israel=findCatalogSource('israel-prime-minister');
  const china=findCatalogSource('china-foreign-ministry');
  assert.equal(new URL(israel.url).hostname,'www.gov.il');
  assert.equal(new URL(china.url).hostname,'www.fmprc.gov.cn');
  assert.equal(israel.collection,'website');assert.equal(china.collection,'website');
  assert.equal(findCatalogSource('white-house').collection,'website');
  assert.ok(findCatalogSource('uk-prime-minister').url.endsWith('.atom'));
});

test('Guardian records preserve real media, source dates and exact Tehran day boundaries', () => {
  const valid = guardianArticle(item(), DAY);
  assert.equal(valid.title, 'World report & context');
  assert.equal(valid.summary, 'Reported facts from the source.');
  assert.equal(valid.publishedAt, '2024-03-20T12:00:00.000Z');
  assert.equal(valid.publishedAtKnown, true);
  assert.equal(valid.media[0].url, 'https://i.guim.co.uk/img/media/test.jpg');
  assert.ok(guardianArticle(item('previous-utc-day', '2024-03-19T21:00:00Z'), DAY));
  assert.equal(guardianArticle(item('next-tehran-day', '2024-03-20T22:00:00Z'), DAY), null);
  assert.equal(guardianArticle(item('invalid', 'not-a-date'), DAY), null);
  assert.equal(guardianArticle({ ...item(), webUrl: 'javascript:alert(1)' }, DAY), null);
  assert.equal(guardianArticle({ ...item(), webUrl: 'https://attacker.example/forged' }, DAY), null);
  assert.equal(guardianArticle({ ...item(), fields: {} }, DAY).imageUrl, null);
});

test('archive access is registered only after successful provider validation and never reflected in status', async () => {
  const store = fakeStore();
  const calls = [];
  const service = createArchiveService({ store, environment: {}, fetcher: async (url, options) => { calls.push({ url, options }); return ok(); } });
  assert.equal(service.status().guardianConfigured, false);
  const connected = await service.connectGuardian(TOKEN);
  assert.equal(connected.guardianConfigured, true);
  assert.ok(!JSON.stringify(connected).includes(TOKEN));
  assert.equal(new URL(calls[0].url).hostname, 'content.guardianapis.com');
  assert.equal(new URL(calls[0].url).searchParams.get('api-key'), TOKEN);
  assert.deepEqual(calls[0].options.allowedHosts, ['content.guardianapis.com']);
  assert.equal(store.getConnection('guardianArchive').token, TOKEN);
  const rejectedStore = fakeStore();
  const rejected = createArchiveService({ store: rejectedStore, environment: {}, fetcher: async () => JSON.stringify({ response: { status: 'error', message: TOKEN } }) });
  await assert.rejects(() => rejected.connectGuardian(TOKEN), error => error.status === 403 && !error.message.includes(TOKEN));
  assert.equal(rejected.status().guardianConfigured, false);
});

test('historical imports are bounded, deduplicated, explicitly partial and scoped to the requested Tehran day', async () => {
  const store = fakeStore();
  store.setConnection('guardianArchive', 'Archive', { token: TOKEN });
  const pages = [];
  const service = createArchiveService({ store, environment: {}, fetcher: async value => {
    const url = new URL(value);
    pages.push(Number(url.searchParams.get('page')));
    assert.equal(url.searchParams.get('from-date'), '2024-03-19');
    assert.equal(url.searchParams.get('to-date'), DAY);
    assert.equal(url.searchParams.get('q'), 'economy');
    assert.equal(url.searchParams.get('page-size'), '50');
    return pages.length === 1 ? ok([item(), item('outside', '2024-03-20T22:00:00Z')], 4) : ok([item(), item('earlier', '2024-03-19T21:00:00Z')], 4);
  } });
  const result = await service.importDay({ date: DAY, query: ' economy ' });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.imported, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.timeZone, 'Asia/Tehran');
  assert.equal(result.coverage.articleCount, 2);
  assert.ok(store.readArticles().every(article => article.archiveProvider === 'Guardian Content API'));
});

test('missing credentials leave local archive usable; injected bindings are reused without leaking values', async () => {
  const store = fakeStore();
  const missing = createArchiveService({ store, environment: {}, fetcher: async () => { throw new Error('Must not fetch'); } });
  assert.equal(missing.status().coverage.articleCount, 0);
  await assert.rejects(() => missing.importDay({ date: DAY }), error => error.status === 428);
  const injected = createArchiveService({ store, environment: { GUARDIAN_API_KEY: TOKEN }, fetcher: async url => {
    assert.equal(new URL(url).searchParams.get('api-key'), TOKEN);
    return ok([item()]);
  } });
  assert.equal(injected.status().guardianConfigured, true);
  assert.ok(!JSON.stringify(injected.status()).includes(TOKEN));
  assert.equal((await injected.importDay({ date: DAY })).imported, 1);
});

test('transport errors containing credential URLs cannot leak secrets through public archive errors', async () => {
  const store = fakeStore();
  const service = createArchiveService({ store, environment: { GUARDIAN_API_KEY: TOKEN }, fetcher: async url => { throw new Error(`network failed for ${url}`); } });
  await assert.rejects(() => service.importDay({ date: DAY }), error => error.status === 502 && !error.message.includes(TOKEN) && !error.message.includes('api-key='));
});

test('historical range imports retain Tehran boundaries and return a resumable page',async()=>{
 const store=fakeStore();store.setConnection('guardianArchive','Archive',{token:TOKEN});
 const service=createArchiveService({store,environment:{},fetcher:async raw=>{const url=new URL(raw);assert.equal(url.searchParams.get('page'),'3');assert.equal(url.searchParams.get('from-date'),'2023-10-23');return ok([item()],4);}});
 const result=await service.importRange({dateFrom:'2023-10-24',dateTo:'2026-10-24',page:3});assert.equal(result.nextPage,4);assert.equal(result.imported,1);
});
