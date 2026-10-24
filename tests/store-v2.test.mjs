import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { detectLocations, extractiveSummary, normalizeStoryTitle } from '../server/enrichment.mjs';

const article = (id, overrides = {}) => ({
  id, title: `خبر شماره ${id} درباره دستاورد علمی تازه`, summary: 'گزارش منبع دربارهٔ یک دستاورد علمی است. این گزارش یک متن آزمایشی است.',
  url: `https://news.example/${id}`, sourceId: 'fixture', sourceName: 'منبع آزمون', platform: 'rss', imageUrl: null,
  publishedAt: '2026-10-23T10:00:00.000Z', publishedAtKnown: true, category: 'science', language: 'fa', saved: false,
  ...overrides,
});
function directory(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dideban-store-v2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bookmarks and archived news survive more than 2000 newer stories, ingestion and restart', t => {
  const dir = directory(t);
  let store = new Store(dir);
  const old = article('old-saved', { publishedAt: '2024-03-21T09:00:00.000Z' });
  store.addArticles([old]);
  store.saveArticle(old.id, true);
  store.addArticles(Array.from({ length: 2105 }, (_, i) => article(`new-${i}`)));
  assert.equal(store.archiveCoverage().articleCount, 2106);
  assert.equal(store.searchArchive({ dateFrom: '2024-03-21', dateTo: '2024-03-21' }).total, 1);
  assert.ok(store.dashboard().articles.some(item => item.id === old.id && item.saved));
  assert.equal(store.savedArticles().length, 1);
  store.close();
  store = new Store(dir);
  try {
    store.addArticles([{ ...old, id: 'new-id-from-another-parser', saved: false }]);
    const [saved] = store.savedArticles();
    assert.equal(saved.id, old.id);
    assert.equal(saved.saved, true);
    assert.equal(store.saveArticle(saved.id, false), 1);
    assert.equal(store.savedArticles().length, 0);
    assert.equal(store.searchArchive({ query: 'old-saved' }).total, 1);
  } finally { store.close(); }
});

test('legacy migration takes a consistent backup and fixes a payload ID without losing saved state or key', t => {
  const dir = directory(t), key = randomBytes(32);
  writeFileSync(path.join(dir, 'credentials.key'), key);
  const legacy = new DatabaseSync(path.join(dir, 'news.sqlite'));
  legacy.exec(`CREATE TABLE articles(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,saved INTEGER NOT NULL DEFAULT 0,published_at TEXT NOT NULL);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  const record = article('wrong-payload-id');
  legacy.prepare('INSERT INTO articles VALUES(?,?,?,?,?)').run('canonical-id', record.url, JSON.stringify(record), 1, record.publishedAt);
  legacy.prepare('INSERT INTO settings VALUES(?,?)').run('initialized', 'true');
  legacy.close();
  const store = new Store(dir);
  try {
    assert.equal(store.savedArticles()[0].id, 'canonical-id');
    assert.equal(store.savedArticles()[0].saved, true);
    assert.ok(store.savedArticles()[0].summaryAuto);
    assert.deepEqual(readFileSync(path.join(dir, 'credentials.key')), key);
    const backupPath = path.join(dir, 'news.pre-v2.sqlite');
    assert.equal(existsSync(backupPath), true);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare('SELECT COUNT(*) AS total FROM articles').get().total, 1);
      assert.ok(!backup.prepare('PRAGMA table_info(articles)').all().some(column => column.name === 'fingerprint'));
    } finally { backup.close(); }
  } finally { store.close(); }
});

test('read state reaches same-day duplicate headlines and future copies, while priority and bookmarks remain independent', t => {
  const store = new Store(directory(t));
  try {
    const title = 'ایران و کشور همسایه درباره همکاری اقتصادی توافق کردند';
    store.addArticles([article('one', { title }), article('two', { title: `${title}!`, sourceId: 'another' })]);
    assert.equal(store.markRead('one', true), 2);
    store.saveArticle('one', true);
    store.setArticlePriority('one', 3);
    store.addArticles([article('three', { title }), article('another-day', { title, publishedAt: '2026-10-24T10:00:00.000Z' })]);
    store.addArticles([article('one', { title, saved: false })]);
    const all = store.articles();
    const one = all.find(a => a.id === 'one'), two = all.find(a => a.id === 'two'), three = all.find(a => a.id === 'three');
    assert.equal(one.priority, 3);
    assert.equal(one.saved, true);
    assert.equal(one.read, true);
    assert.equal(two.read, true);
    assert.equal(two.readInherited, true);
    assert.equal(three.read, true);
    assert.equal(three.duplicateCount, 2);
    assert.equal(all.find(a => a.id === 'another-day').read, false);
    assert.equal(store.markRead('one', false), 3);
    assert.equal(store.articles({ read: true }).length, 0);
  } finally { store.close(); }
});

test('geography uses explicit article mentions and word boundaries rather than publisher location', t => {
  assert.equal(detectLocations('The Chair announced a new research result.').length, 0);
  assert.equal(detectLocations('Georgia policy update').length, 0);
  const locations = detectLocations('جلسه در تهران با نمایندگان ایران و France برگزار شد.');
  assert.ok(locations.some(place => place.countryCode === 'IR' && place.city === 'تهران'));
  assert.ok(locations.some(place => place.countryCode === 'FR'));
  assert.ok(locations.every(place => place.confidence === 'mentioned'));
  const store = new Store(directory(t));
  try {
    const source = store.addSource({ name: 'Iranian publisher', url: 'https://publisher.example/rss', countryCode: 'IR', priority: 2, kind: 'official' });
    store.addArticles([article('no-location', { title: 'Research team publishes a new science report', summary: 'A paper has been published.', sourceId: source.id })]);
    assert.equal(store.articles()[0].locations.length, 0);
    assert.equal(store.searchArchive({ country: 'IR' }).total, 0);
    store.updateSource(source.id, { enabled: false, priority: 3 });
    const updated = store.sources().find(item => item.id === source.id);
    assert.equal(updated.priority, 3);
    assert.equal(updated.enabled, false);
    assert.equal(updated.kind, 'official');
  } finally { store.close(); }
});

test('archive filters exclude unknown publication dates and handle literal query characters', t => {
  const store = new Store(directory(t));
  try {
    store.addArticles([article('known', { title: 'Iran economy report marks 10% increase', summary: 'Tehran report.' }), article('unknown', { publishedAtKnown: false })]);
    assert.equal(store.searchArchive({ dateFrom: '2026-10-23', dateTo: '2026-10-23' }).total, 1);
    assert.equal(store.searchArchive({ country: 'IR', city: 'تهران' }).total, 1);
    assert.equal(store.searchArchive({ query: '10%' }).total, 1);
    assert.equal(store.archiveCoverage().unknownDateCount, 1);
    assert.equal(store.searchArchive({ limit: 1 }).articles.length, 1);
    assert.equal(store.searchArchive({ limit: 1, offset: 1 }).articles.length, 1);
  } finally { store.close(); }
});

test('extractive summaries only select source text and normalization retains different numbers and negation', () => {
  assert.equal(extractiveSummary('headline', 'First reported sentence. Second reported sentence. Third sentence.'), 'First reported sentence. Second reported sentence.');
  assert.equal(normalizeStoryTitle('رئیس گفت ۱۲ نفر؛ ایران'), normalizeStoryTitle('رئیس گفت 12 نفر ایران'));
  assert.notEqual(normalizeStoryTitle('Deal was approved by the government'), normalizeStoryTitle('Deal was not approved by the government'));
});

test('seen state is idempotent, durable, independent of unread, and never inferred from a duplicate read', t => {
  const dir = directory(t);
  let store = new Store(dir);
  const title = 'این عنوان مشترک درباره یک خبر علمی جدید است';
  store.addArticles([article('visible', { title }), article('duplicate', { title }), article('read-directly')]);
  assert.equal(store.markSeen(['visible', 'visible', 'missing']), 1);
  const initial = store.articles().find(item => item.id === 'visible');
  assert.equal(initial.seen, true);
  assert.equal(initial.read, false);
  assert.ok(initial.seenAt);
  assert.equal(store.markSeen(['visible']), 0);
  store.markRead('visible', true);
  assert.equal(store.articles().find(item => item.id === 'duplicate').read, true);
  assert.equal(store.articles().find(item => item.id === 'duplicate').seen, false);
  store.markRead('visible', false);
  store.markRead('read-directly', true);
  assert.equal(store.articles().find(item => item.id === 'read-directly').seen, true);
  store.addArticles([article('visible', { title, seen: false, read: false })]);
  store.close();
  store = new Store(dir);
  try {
    const persisted = store.articles().find(item => item.id === 'visible');
    assert.equal(persisted.seen, true);
    assert.equal(persisted.seenAt, initial.seenAt);
    assert.equal(persisted.read, false);
    assert.equal(store.articles().find(item => item.id === 'duplicate').seen, false);
    assert.equal(store.markSeen([]), 0);
    assert.throws(() => store.markSeen(Array.from({ length: 101 }, () => 'visible')), /۱۰۰/);
  } finally { store.close(); }
});
