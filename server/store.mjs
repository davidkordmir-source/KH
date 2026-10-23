import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';

export const DEFAULT_SOURCES = [
  { id: 'bbc-persian', name: 'بی‌بی‌سی فارسی', url: 'https://feeds.bbci.co.uk/persian/rss.xml' },
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
];

export const CAPABILITIES = {
  telegram: 'ربات تلگرام؛ فقط پیام‌های جدید کانال‌ها و گروه‌هایی که ربات به آن‌ها دسترسی دارد، بدون تاریخچهٔ حساب شخصی.',
  x: 'API رسمی X با Bearer Token؛ جست‌وجوی ۷ روز اخیر بر اساس کلیدواژه‌ها و سطح دسترسی طرح API شما.',
  instagram: 'API رسمی Meta؛ پست‌ها و هشتگ‌های مجاز حساب حرفه‌ای با Access Token و شناسهٔ حساب. دسترسی حساب شخصی و صفحه‌های خصوصی شامل نمی‌شود.',
  facebook: 'API رسمی Meta؛ پست‌های صفحهٔ مجاز با Page Access Token و شناسهٔ صفحه. دسترسی به صفحه‌ها تابع مجوزهای برنامه است.',
  linkedin: 'API رسمی LinkedIn؛ پست‌های سازمان مجاز با Access Token و شناسهٔ سازمان. نیازمند تأیید محصول API و دسترسی سازمان است.',
};

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, 'credentials.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    chmodSync(keyPath, 0o600);
    this.key = readFileSync(keyPath);
    this.db = new DatabaseSync(path.join(directory, 'news.sqlite'));
    chmodSync(path.join(directory, 'news.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1,last_fetched_at TEXT,last_error TEXT);
      CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,saved INTEGER NOT NULL DEFAULT 0,published_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections(platform TEXT PRIMARY KEY,label TEXT NOT NULL,secret TEXT NOT NULL);
    `);
    if (!this.getSetting('initialized', false)) {
      for (const source of DEFAULT_SOURCES) this.db.prepare('INSERT OR IGNORE INTO sources(id,name,url) VALUES(?,?,?)').run(source.id, source.name, source.url);
      this.setSetting('keywords', ['ایران', 'هوش مصنوعی', 'اقتصاد']);
      this.setSetting('initialized', true);
    }
  }
  close() { this.db.close(); }
  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  sources() { return this.db.prepare('SELECT * FROM sources ORDER BY rowid').all().map(row => ({ id: row.id, name: row.name, url: row.url, platform: 'rss', enabled: Boolean(row.enabled), lastFetchedAt: row.last_fetched_at, lastError: row.last_error })); }
  addSource({ name, url }) { const id = randomUUID(); this.db.prepare('INSERT INTO sources(id,name,url) VALUES(?,?,?)').run(id, name, url); return this.sources().find(source => source.id === id); }
  updateSource(id, enabled) { return this.db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(Number(enabled), id).changes; }
  deleteSource(id) { return this.db.prepare('DELETE FROM sources WHERE id=?').run(id).changes; }
  markSource(id, error = null) { this.db.prepare('UPDATE sources SET last_error=?,last_fetched_at=CASE WHEN ? IS NULL THEN ? ELSE last_fetched_at END WHERE id=?').run(error, error, new Date().toISOString(), id); }
  addArticles(articles) {
    const insert = this.db.prepare('INSERT INTO articles(id,url,payload,published_at) VALUES(?,?,?,?) ON CONFLICT(url) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at');
    this.db.exec('BEGIN');
    try { for (const article of articles) insert.run(article.id, article.url, JSON.stringify(article), article.publishedAt); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.exec('DELETE FROM articles WHERE saved=0 AND id NOT IN (SELECT id FROM articles ORDER BY published_at DESC LIMIT 1500)');
  }
  saveArticle(id, saved) { return this.db.prepare('UPDATE articles SET saved=? WHERE id=?').run(Number(saved), id).changes; }
  articles() { return this.db.prepare('SELECT payload,saved FROM articles ORDER BY published_at DESC LIMIT 2000').all().map(row => ({ ...JSON.parse(row.payload), saved: Boolean(row.saved) })); }
  encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.'); }
  decrypt(value) { const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64')); const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')); }
  setConnection(platform, label, secret) { this.db.prepare('INSERT INTO connections(platform,label,secret) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET label=excluded.label,secret=excluded.secret').run(platform, label, this.encrypt(secret)); }
  getConnection(platform) { const row = this.db.prepare('SELECT * FROM connections WHERE platform=?').get(platform); return row ? { platform, label: row.label, ...this.decrypt(row.secret) } : null; }
  deleteConnection(platform) { return this.db.prepare('DELETE FROM connections WHERE platform=?').run(platform).changes; }
  connections() { const rows = this.db.prepare('SELECT platform,label FROM connections').all(); return Object.entries(CAPABILITIES).map(([platform, capability]) => { const row = rows.find(item => item.platform === platform); return { platform, connected: Boolean(row), label: row?.label || null, capability }; }); }
  dashboard() { return { articles: this.articles(), sources: this.sources(), connections: this.connections(), keywords: this.getSetting('keywords', []), lastSyncAt: this.getSetting('lastSyncAt'), syncErrors: this.getSetting('syncErrors', []) }; }
}
