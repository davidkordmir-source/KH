import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { enrichArticle, storyFingerprint } from './enrichment.mjs';
import { initializeSearch, searchExpression } from './search.mjs';

export const DEFAULT_SOURCES = [
  { id: 'bbc-persian', name: 'بی‌بی‌سی فارسی', url: 'https://feeds.bbci.co.uk/persian/rss.xml', iconUrl: 'https://www.bbc.com/favicon.ico', countryCode: 'GB' },
  { id: 'bbc-world', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', iconUrl: 'https://www.bbc.com/favicon.ico', countryCode: 'GB' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', iconUrl: 'https://www.theguardian.com/favicon.ico', countryCode: 'GB' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', iconUrl: 'https://www.aljazeera.com/favicon.ico', countryCode: 'QA' },
];
export const IRANIAN_SOURCES = [
  { id: 'isna', name: 'ایسنا', url: 'https://www.isna.ir/rss', iconUrl: 'https://www.isna.ir/favicon.ico', countryCode: 'IR' },
  { id: 'irna', name: 'ایرنا', url: 'https://www.irna.ir/rss', iconUrl: 'https://www.irna.ir/favicon.ico', countryCode: 'IR' },
  { id: 'mehr', name: 'مهر', url: 'https://www.mehrnews.com/rss', iconUrl: 'https://www.mehrnews.com/favicon.ico', countryCode: 'IR' },
  { id: 'tasnim', name: 'تسنیم', url: 'https://www.tasnimnews.com/fa/rss/feed/0/8/0', iconUrl: 'https://www.tasnimnews.com/favicon.ico', countryCode: 'IR' },
];
export const CAPABILITIES = {
  telegram: 'ربات تلگرام؛ فقط پیام‌های جدید کانال‌ها و گروه‌هایی که ربات به آن‌ها دسترسی دارد، بدون تاریخچهٔ حساب شخصی.',
  x: 'API رسمی X با Bearer Token؛ جست‌وجوی ۷ روز اخیر بر اساس کلیدواژه‌ها و سطح دسترسی طرح API شما.',
  instagram: 'API رسمی Meta؛ پست‌ها و هشتگ‌های مجاز حساب حرفه‌ای با Access Token و شناسهٔ حساب. دسترسی حساب شخصی و صفحه‌های خصوصی شامل نمی‌شود.',
  facebook: 'API رسمی Meta؛ پست‌های صفحهٔ مجاز با Page Access Token و شناسهٔ صفحه. دسترسی به صفحه‌ها تابع مجوزهای برنامه است.',
  linkedin: 'API رسمی LinkedIn؛ پست‌های سازمان مجاز با Access Token و شناسهٔ سازمان. نیازمند تأیید محصول API و دسترسی سازمان است.',
};

const json = value => JSON.stringify(value);
const boundedNumber = (value, fallback, maximum) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(maximum, Math.floor(Number(value)))) : fallback;
const safeIcon = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
const parsePayload = row => {
  const payload = JSON.parse(row.payload);
  return {
    ...payload, id: row.id, url: row.url,
    saved: Boolean(row.saved), seen: Boolean(row.seen), seenAt: row.seen_at || null, read: Boolean(row.read), readAt: row.read_at || null,
    readInherited: Boolean(row.read_inherited), priority: row.priority || 0,
    duplicateGroup: row.fingerprint?.startsWith('single:') ? null : row.fingerprint,
    duplicateCount: Math.max(0, Number(row.group_count || 1) - 1),
    duplicateOf: row.group_count > 1 && row.first_id !== row.id ? row.first_id : null,
  };
};
const selectArticles = `SELECT a.*, (SELECT COUNT(*) FROM articles d WHERE d.fingerprint=a.fingerprint) AS group_count,
  (SELECT d.id FROM articles d WHERE d.fingerprint=a.fingerprint ORDER BY d.published_at,d.id LIMIT 1) AS first_id FROM articles a`;

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, 'credentials.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    chmodSync(keyPath, 0o600);
    this.key = readFileSync(keyPath);
    const databasePath = path.join(directory, 'news.sqlite');
    this.db = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const oldArticles = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").get();
    const oldColumns = oldArticles ? this.db.prepare('PRAGMA table_info(articles)').all().map(column => column.name) : [];
    if(oldArticles && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_items'").get() && !this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_transcripts'").get()) {
      const backup=path.join(directory,'news.pre-v4.sqlite');
      if(!existsSync(backup)){this.db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
    }
    if(oldArticles && oldColumns.includes('fingerprint') && !this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_items'").get()) {
      const backup=path.join(directory,'news.pre-v3.sqlite');
      if(!existsSync(backup)){this.db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
    }
    if (oldArticles && !oldColumns.includes('fingerprint')) {
      // VACUUM INTO takes a consistent snapshot including WAL, unlike copying a live database file.
      const backup = path.join(directory, 'news.pre-v2.sqlite');
      if (!existsSync(backup)) { this.db.prepare('VACUUM INTO ?').run(backup); chmodSync(backup, 0o600); }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1,last_fetched_at TEXT,last_error TEXT);
      CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,saved INTEGER NOT NULL DEFAULT 0,published_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections(platform TEXT PRIMARY KEY,label TEXT NOT NULL,secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS story_state(fingerprint TEXT PRIMARY KEY,read INTEGER NOT NULL DEFAULT 0,read_at TEXT);
    `);
    const addColumns = (table, columns) => {
      const existing = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      for (const [name, definition] of Object.entries(columns)) if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    addColumns('articles', { seen: 'INTEGER NOT NULL DEFAULT 0', seen_at: 'TEXT', read: 'INTEGER NOT NULL DEFAULT 0', read_at: 'TEXT', read_inherited: 'INTEGER NOT NULL DEFAULT 0', priority: 'INTEGER NOT NULL DEFAULT 0', fingerprint: 'TEXT', date_known: 'INTEGER NOT NULL DEFAULT 1' });
    addColumns('sources', { priority: 'INTEGER NOT NULL DEFAULT 0', kind: "TEXT NOT NULL DEFAULT 'news'", icon_url: 'TEXT', country_code: 'TEXT', platform: "TEXT NOT NULL DEFAULT 'rss'" });
    this.db.exec('CREATE INDEX IF NOT EXISTS articles_fingerprint ON articles(fingerprint); CREATE INDEX IF NOT EXISTS articles_date ON articles(published_at); CREATE INDEX IF NOT EXISTS articles_saved ON articles(saved);');
    const initialized = this.getSetting('initialized', false);
    if (!initialized) {
      for (const source of DEFAULT_SOURCES) this.db.prepare('INSERT OR IGNORE INTO sources(id,name,url,icon_url,country_code) VALUES(?,?,?,?,?)').run(source.id, source.name, source.url, source.iconUrl, source.countryCode);
      this.setSetting('keywords', ['ایران', 'هوش مصنوعی', 'اقتصاد']);
      this.setSetting('initialized', true);
      this.setSetting('archiveStartedAt', new Date().toISOString());
    }
    if (this.getSetting('schemaVersion', 1) < 2) {
      this.db.exec('BEGIN');
      try {
        const update = this.db.prepare('UPDATE articles SET payload=?,fingerprint=?,date_known=? WHERE id=?');
        for (const row of this.db.prepare('SELECT id,url,payload FROM articles').all()) {
          const article = enrichArticle({ ...JSON.parse(row.payload), id: row.id, url: row.url });
          update.run(json(article), storyFingerprint(article.title, row.id, article.publishedAtKnown === false ? null : article.publishedAt), Number(article.publishedAtKnown !== false), row.id);
        }
        for (const source of DEFAULT_SOURCES) this.db.prepare('UPDATE sources SET icon_url=COALESCE(icon_url,?),country_code=COALESCE(country_code,?) WHERE id=?').run(source.iconUrl, source.countryCode, source.id);
        // Available on upgrade, initially disabled so network policy and source choices remain explicit.
        for (const source of IRANIAN_SOURCES) this.db.prepare('INSERT OR IGNORE INTO sources(id,name,url,enabled,icon_url,country_code) VALUES(?,?,?,0,?,?)').run(source.id, source.name, source.url, source.iconUrl, source.countryCode);
        this.setSetting('schemaVersion', 2);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    addColumns('sources', { language: "TEXT NOT NULL DEFAULT ''", topics: "TEXT NOT NULL DEFAULT ''", publisher: "TEXT NOT NULL DEFAULT ''" });
    this.db.exec(`CREATE TABLE IF NOT EXISTS article_versions(id INTEGER PRIMARY KEY,article_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,captured_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS versions_article ON article_versions(article_id);
      CREATE TABLE IF NOT EXISTS research_items(article_id TEXT PRIMARY KEY,folder TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',review TEXT NOT NULL DEFAULT 'unchecked',evidence_url TEXT NOT NULL DEFAULT '',review_note TEXT NOT NULL DEFAULT '',updated_at TEXT);
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS watch_rules(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS news_alerts(id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,group_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,UNIQUE(rule_id,group_key));
      CREATE INDEX IF NOT EXISTS alerts_date ON news_alerts(created_at);
      CREATE TABLE IF NOT EXISTS translations(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS saved_searches(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
    addColumns('research_items',{primary_url:"TEXT NOT NULL DEFAULT ''"});
    this.db.exec(`CREATE TABLE IF NOT EXISTS semantic_vectors(article_id TEXT PRIMARY KEY,content_hash TEXT NOT NULL,model TEXT NOT NULL,vector TEXT NOT NULL,indexed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_transcripts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_questions(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS login_sessions(token_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);`);
    initializeSearch(this);
  }
  close() { this.db.close(); }
  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, json(value)); }
  sources() {
    return this.db.prepare('SELECT * FROM sources ORDER BY rowid').all().map(row => ({ id: row.id, name: row.name, url: row.url, platform: row.platform || 'rss', enabled: Boolean(row.enabled), lastFetchedAt: row.last_fetched_at, lastError: row.last_error, priority: row.priority || 0, kind: row.kind || 'news', iconUrl: row.icon_url || null, countryCode: row.country_code || null, language: row.language, topics: row.topics, publisher: row.publisher }));
  }
  addSource({ name, url, enabled = true, priority = 0, kind = 'news', iconUrl = null, countryCode = null, platform = 'rss', language = '', topics = '', publisher = '' }) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO sources(id,name,url,enabled,priority,kind,icon_url,country_code,platform) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, url, Number(Boolean(enabled)), boundedNumber(priority, 0, 3), ['news', 'official', 'social'].includes(kind) ? kind : 'news', safeIcon(iconUrl), typeof countryCode === 'string' ? countryCode.toUpperCase().slice(0, 2) : null, platform);
    this.updateSource(id,{language,topics,publisher});
    return this.sources().find(source => source.id === id);
  }
  updateSource(id, values) {
    const patch = typeof values === 'boolean' ? { enabled: values } : values || {};
    const assignments = [], parameters = [];
    const add = (column, value) => { assignments.push(`${column}=?`); parameters.push(value); };
    if (typeof patch.enabled === 'boolean') add('enabled', Number(patch.enabled));
    if (Number.isInteger(patch.priority) && patch.priority >= 0 && patch.priority <= 3) add('priority', patch.priority);
    if (['news', 'official', 'social'].includes(patch.kind)) add('kind', patch.kind);
    if(typeof patch.platform==='string'&&/^[a-z0-9_-]{1,30}$/i.test(patch.platform))add('platform',patch.platform);
    if(typeof patch.url==='string'&&patch.url.length<=2048){const url=new URL(patch.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('نشانی منبع معتبر نیست.');add('url',url.href);}
    if (typeof patch.name === 'string' && patch.name.trim()) add('name', patch.name.trim().slice(0, 100));
    if (Object.hasOwn(patch, 'iconUrl')) add('icon_url', safeIcon(patch.iconUrl));
    if (typeof patch.countryCode === 'string' && /^[A-Za-z]{2}$/.test(patch.countryCode)) add('country_code', patch.countryCode.toUpperCase());
    for (const field of ['language', 'topics', 'publisher']) if (typeof patch[field] === 'string') add(field, patch[field].trim().slice(0, field === 'topics' ? 200 : 100));
    if (!assignments.length) return 0;
    return this.db.prepare(`UPDATE sources SET ${assignments.join(',')} WHERE id=?`).run(...parameters, id).changes;
  }
  deleteSource(id) { return this.db.prepare('DELETE FROM sources WHERE id=?').run(id).changes; }
  markSource(id, error = null) { this.db.prepare('UPDATE sources SET last_error=?,last_fetched_at=CASE WHEN ? IS NULL THEN ? ELSE last_fetched_at END WHERE id=?').run(error, error, new Date().toISOString(), id); }
  addArticles(articles) {
    const existingUrl = this.db.prepare('SELECT id,payload FROM articles WHERE url=?');
    const existingId = this.db.prepare('SELECT url FROM articles WHERE id=?');
    const story = this.db.prepare('SELECT read,read_at FROM story_state WHERE fingerprint=?');
    const insert = this.db.prepare(`INSERT INTO articles(id,url,payload,published_at,fingerprint,date_known,read,read_at,read_inherited) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at,fingerprint=excluded.fingerprint,date_known=excluded.date_known`);
    this.db.exec('BEGIN');
    let count = 0;
    try {
      for (const input of articles) {
        if (!input?.url || !input.title) continue;
        const previous = existingUrl.get(input.url);
        let id = previous?.id || input.id || createHash('sha256').update(input.url).digest('hex').slice(0, 24);
        if (existingId.get(id)?.url && existingId.get(id).url !== input.url) id = createHash('sha256').update(input.url).digest('hex').slice(0, 24);
        const article = enrichArticle({ ...input, id });
        if (previous) {
          const old = JSON.parse(previous.payload);
          if(old.userCategory){article.originalCategory=article.category;article.userCategory=old.userCategory;article.category=old.userCategory;}
          if (old.title !== article.title || (old.fullText || old.summary) !== (article.fullText || article.summary)) {
            this.db.prepare('INSERT INTO article_versions(article_id,title,body,captured_at) VALUES(?,?,?,?)').run(id, old.title, old.fullText || old.summary || '', new Date().toISOString());
          }
        }
        const fingerprint = storyFingerprint(article.title, id, article.publishedAtKnown === false ? null : article.publishedAt);
        const state = story.get(fingerprint);
        insert.run(id, article.url, json(article), article.publishedAt || new Date().toISOString(), fingerprint, Number(article.publishedAtKnown !== false), Number(Boolean(state?.read)), state?.read_at || null, Number(Boolean(state?.read)));
        count++;
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return count;
  }
  saveArticle(id, saved) { return this.db.prepare('UPDATE articles SET saved=? WHERE id=?').run(Number(saved), id).changes; }
  markSeen(ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('حداکثر ۱۰۰ شناسهٔ خبر معتبر مجاز است.');
    const unique = [...new Set(ids)];
    if (!unique.length) return 0;
    const placeholders = unique.map(() => '?').join(',');
    return this.db.prepare(`UPDATE articles SET seen=1,seen_at=COALESCE(seen_at,?) WHERE id IN (${placeholders}) AND seen=0`).run(new Date().toISOString(), ...unique).changes;
  }
  markRead(id, read = true) {
    const target = this.db.prepare('SELECT id,fingerprint FROM articles WHERE id=?').get(id);
    if (!target) return 0;
    const stamp = read ? new Date().toISOString() : null;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO story_state(fingerprint,read,read_at) VALUES(?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET read=excluded.read,read_at=excluded.read_at').run(target.fingerprint, Number(read), stamp);
      const updated = this.db.prepare('UPDATE articles SET read=?,read_at=?,read_inherited=CASE WHEN ?=1 AND id<>? THEN 1 ELSE 0 END WHERE fingerprint=?').run(Number(read), stamp, Number(read), id, target.fingerprint).changes;
      if (read) this.db.prepare('UPDATE articles SET seen=1,seen_at=COALESCE(seen_at,?) WHERE id=?').run(stamp, id);
      this.db.exec('COMMIT');
      return updated;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setArticlePriority(id, priority) {
    if (!Number.isInteger(priority) || priority < 0 || priority > 3) throw new Error('اولویت باید عددی بین صفر و سه باشد.');
    return this.db.prepare('UPDATE articles SET priority=? WHERE id=?').run(priority, id).changes;
  }
  _where(filters = {}) {
    const clauses = [], parameters = [];
    if (filters.savedOnly || filters.saved === true) clauses.push('a.saved=1');
    if (typeof filters.read === 'boolean') { clauses.push('a.read=?'); parameters.push(Number(filters.read)); }
    if (filters.dateFrom) { clauses.push('a.date_known=1 AND a.published_at>=?'); parameters.push(String(filters.dateFrom).length === 10 ? `${filters.dateFrom}T00:00:00.000Z` : String(filters.dateFrom)); }
    if (filters.dateTo) { clauses.push('a.date_known=1 AND a.published_at<=?'); parameters.push(String(filters.dateTo).length === 10 ? `${filters.dateTo}T23:59:59.999Z` : String(filters.dateTo)); }
    if (filters.country) { clauses.push("EXISTS(SELECT 1 FROM json_each(a.payload,'$.locations') l WHERE json_extract(l.value,'$.countryCode')=?)"); parameters.push(String(filters.country).toUpperCase()); }
    if (filters.city) { clauses.push("EXISTS(SELECT 1 FROM json_each(a.payload,'$.locations') l WHERE lower(json_extract(l.value,'$.city'))=lower(?))"); parameters.push(String(filters.city)); }
    if (filters.sourceId) { clauses.push("json_extract(a.payload,'$.sourceId')=?"); parameters.push(String(filters.sourceId)); }
    if (filters.platform) { clauses.push("json_extract(a.payload,'$.platform')=?"); parameters.push(String(filters.platform)); }
    if (filters.language) { clauses.push("json_extract(a.payload,'$.language')=?"); parameters.push(String(filters.language)); }
    if (filters.category) { clauses.push("json_extract(a.payload,'$.category')=?"); parameters.push(String(filters.category)); }
    if (filters.hasMedia) clauses.push("json_array_length(json_extract(a.payload,'$.media'))>0");
    if (filters.folder) { clauses.push('EXISTS(SELECT 1 FROM research_items r WHERE r.article_id=a.id AND r.folder=?)'); parameters.push(String(filters.folder)); }
    if (filters.exclude) {
      const expression = searchExpression(filters.exclude);
      if (expression) { clauses.push('a.id NOT IN (SELECT id FROM news_search WHERE news_search MATCH ?)'); parameters.push(expression.replaceAll(' AND ', ' OR ')); }
    }
    if (filters.query) {
      const expression = searchExpression(filters.query);
      if (expression) { clauses.push('a.id IN (SELECT id FROM news_search WHERE news_search MATCH ?)'); parameters.push(expression); }
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', parameters };
  }
  articles(filters = {}) {
    const where = this._where(filters);
    let query = `${selectArticles}${where.sql} ORDER BY a.published_at DESC,a.id`;
    if (filters.limit !== undefined) { query += ' LIMIT ? OFFSET ?'; where.parameters.push(boundedNumber(filters.limit, 100, 10000), boundedNumber(filters.offset, 0, Number.MAX_SAFE_INTEGER)); }
    return this.db.prepare(query).all(...where.parameters).map(parsePayload);
  }
  savedArticles() { return this.articles({ savedOnly: true }); }
  article(id) { const row = this.db.prepare(`${selectArticles} WHERE a.id=?`).get(id); return row ? parsePayload(row) : null; }
  searchArchive(filters = {}) {
    const limit = boundedNumber(filters.limit, 100, 1000), offset = boundedNumber(filters.offset, 0, Number.MAX_SAFE_INTEGER);
    const where = this._where(filters);
    return { articles: this.articles({ ...filters, limit, offset }), total: Number(this.db.prepare(`SELECT COUNT(*) AS total FROM articles a${where.sql}`).get(...where.parameters).total), limit, offset, coverage: this.archiveCoverage() };
  }
  archiveCoverage() {
    const row = this.db.prepare('SELECT COUNT(*) AS total,MIN(CASE WHEN date_known=1 THEN published_at END) AS oldest,MAX(CASE WHEN date_known=1 THEN published_at END) AS newest,SUM(CASE WHEN date_known=0 THEN 1 ELSE 0 END) AS unknown FROM articles').get();
    return { articleCount: Number(row.total), oldestPublishedAt: row.oldest || null, newestPublishedAt: row.newest || null, unknownDateCount: Number(row.unknown || 0), startedCollectingAt: this.getSetting('archiveStartedAt'), scope: 'local' };
  }
  encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const ciphertext = Buffer.concat([cipher.update(json(value)), cipher.final()]); return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.'); }
  decrypt(value) { const [iv, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64')); const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')); }
  setConnection(platform, label, secret) { this.db.prepare('INSERT INTO connections(platform,label,secret) VALUES(?,?,?) ON CONFLICT(platform) DO UPDATE SET label=excluded.label,secret=excluded.secret').run(platform, label, this.encrypt(secret)); }
  getConnection(platform) { const row = this.db.prepare('SELECT * FROM connections WHERE platform=?').get(platform); return row ? { platform, label: row.label, ...this.decrypt(row.secret) } : null; }
  deleteConnection(platform) { return this.db.prepare('DELETE FROM connections WHERE platform=?').run(platform).changes; }
  connections() {
    const rows = this.db.prepare('SELECT platform,label FROM connections').all();
    const custom = this.getSetting('customPlatforms', []);
    const metadata = { ...CAPABILITIES };
    if (Array.isArray(custom)) for (const item of custom) if (item && typeof item.platform === 'string') metadata[item.platform] = item.capability || 'اتصال سفارشی با دسترسی مجاز API';
    return Object.entries(metadata).map(([platform, capability]) => { const row = rows.find(item => item.platform === platform); return { platform, connected: Boolean(row), label: row?.label || null, capability }; });
  }
  dashboard() {
    const recent = this.articles({ limit: 1000 });
    const all = [...new Map([...recent, ...this.savedArticles()].map(article => [article.id, article])).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const coverage = this.archiveCoverage();
    return { articles: all.map(({fullText,...article})=>article), sources: this.sources(), connections: this.connections(), keywords: this.getSetting('keywords', []), lastSyncAt: this.getSetting('lastSyncAt'), syncErrors: this.getSetting('syncErrors', []), articleCount: coverage.articleCount, archiveCoverage: coverage };
  }
}
