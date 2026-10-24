import { normalizeStoryTitle } from './enrichment.mjs';

// Treat user input as text, never as FTS operators. Quoted phrases stay phrases.
export function searchExpression(value) {
  const terms = String(value || '').match(/"[^"]+"|[^\s"]+/g) || [];
  return terms.map(term => normalizeStoryTitle(term)).filter(Boolean).map(term => `"${term.replace(/"/g, '""')}"`).join(' AND ');
}

export function initializeSearch(store) {
  store.db.function('news_normalize', { deterministic: true }, value => normalizeStoryTitle(value));
  store.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS news_search USING fts5(id UNINDEXED,title,body,source,tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS news_search_insert AFTER INSERT ON articles BEGIN
      INSERT INTO news_search(id,title,body,source) VALUES(new.id,news_normalize(json_extract(new.payload,'$.title')),news_normalize(COALESCE(NULLIF(json_extract(new.payload,'$.fullText'),''),json_extract(new.payload,'$.summary'))),news_normalize(json_extract(new.payload,'$.sourceName'))); END;
    CREATE TRIGGER IF NOT EXISTS news_search_update AFTER UPDATE OF payload ON articles BEGIN
      DELETE FROM news_search WHERE id=old.id;
      INSERT INTO news_search(id,title,body,source) VALUES(new.id,news_normalize(json_extract(new.payload,'$.title')),news_normalize(COALESCE(NULLIF(json_extract(new.payload,'$.fullText'),''),json_extract(new.payload,'$.summary'))),news_normalize(json_extract(new.payload,'$.sourceName'))); END;
    CREATE TRIGGER IF NOT EXISTS news_search_delete AFTER DELETE ON articles BEGIN DELETE FROM news_search WHERE id=old.id; END;`);
  if (!store.getSetting('searchInitialized', false)) {
    store.db.exec(`DELETE FROM news_search; INSERT INTO news_search(id,title,body,source) SELECT id,news_normalize(json_extract(payload,'$.title')),news_normalize(COALESCE(NULLIF(json_extract(payload,'$.fullText'),''),json_extract(payload,'$.summary'))),news_normalize(json_extract(payload,'$.sourceName')) FROM articles;`);
    store.setSetting('searchInitialized', true);
  }
}
