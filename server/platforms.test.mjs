import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPlatformArticles, validatePlatformConnection, PlatformAccessError } from './platforms.mjs';

const credentials = { token: 'fixture-token-value', accountId: '12345' };

test('Facebook validates feed access as well as account identity, and keeps token out of URLs', async () => {
  const calls = [];
  const connection = await validatePlatformConnection('facebook', credentials, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? { id: '12345', name: 'Example newsroom' } : { data: [] };
  });
  assert.equal(connection.label, 'Example newsroom');
  assert.equal(calls.length, 2);
  assert.match(new URL(calls[1].url).pathname, /12345\/posts$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token-value');
  assert.equal(calls.some(call => call.url.includes(credentials.token)), false);
});

test('Facebook identity response alone cannot establish a usable connection', async () => {
  let calls = 0;
  await assert.rejects(validatePlatformConnection('facebook', credentials, async () => ++calls === 1 ? { id: '12345', name: 'Example' } : { error: { message: 'missing read scope' } }), PlatformAccessError);
});

test('account identifiers cannot escape a fixed official API destination', async () => {
  let called = false;
  await assert.rejects(validatePlatformConnection('instagram', { ...credentials, accountId: '../me?access_token=x' }, async () => { called = true; }), PlatformAccessError);
  assert.equal(called, false);
});

test('Instagram collects authorized own media and hashtag results, deduplicating permalinks', async () => {
  const item = { id: '7', caption: 'خبر مهم جهان', permalink: 'https://www.instagram.com/p/example/', timestamp: '2026-10-22T09:00:00Z', media_type: 'IMAGE', media_url: 'https://images.example.com/story.jpg' };
  const calls = [];
  const articles = await collectPlatformArticles('instagram', credentials, ['#خبر', '#خبر', 'has space'], async url => {
    calls.push(url);
    if (url.includes('/ig_hashtag_search?')) return { data: [{ id: '98765' }] };
    return { data: [item] };
  });
  assert.equal(calls.length, 3);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].sourceId, 'instagram:12345');
  assert.equal(articles[0].platform, 'instagram');
  assert.equal(articles[0].language, 'fa');
  assert.equal(articles[0].publishedAt, '2026-10-22T09:00:00.000Z');
  assert.deepEqual(articles.warnings, []);
});

test('Instagram hashtag permission failure preserves own media and returns a visible warning', async () => {
  const item = { caption: 'A published report', permalink: 'https://www.instagram.com/p/report/', timestamp: '2026-10-22T09:00:00Z', media_type: 'VIDEO', media_url: 'https://images.example.com/video.mp4' };
  const articles = await collectPlatformArticles('instagram', credentials, ['news'], async url => {
    if (url.includes('/ig_hashtag_search?')) throw new Error('denied');
    return { data: [item] };
  });
  assert.equal(articles.length, 1);
  assert.equal(articles[0].imageUrl, null);
  assert.equal(articles.warnings.length, 1);
});

test('LinkedIn sends versioned official headers and scopes queries to the selected organization', async () => {
  let call;
  const connection = await validatePlatformConnection('linkedin', { ...credentials, accountId: 'urn:li:organization:987' }, async (url, options) => {
    call = { url, options };
    return { elements: [] };
  });
  assert.equal(new URL(call.url).hostname, 'api.linkedin.com');
  assert.equal(new URL(call.url).searchParams.get('author'), 'urn:li:organization:987');
  assert.equal(call.options.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.match(call.options.headers['LinkedIn-Version'], /^\d{6}$/);
  assert.match(connection.label, /organization:987/);
});

test('LinkedIn parses organization text posts, rejecting invalid dates and missing text', async () => {
  const articles = await collectPlatformArticles('linkedin', credentials, [], async () => ({ elements: [
    { id: 'urn:li:share:123', commentary: '<b>Research update</b>', publishedAt: 1792659600000 },
    { id: 'urn:li:share:124', commentary: 'Invalid date', publishedAt: 'invalid' },
    { id: 'urn:li:share:125', commentary: '', publishedAt: 1792659600000 },
  ] }));
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'Research update');
  assert.equal(articles[0].url, 'https://www.linkedin.com/feed/update/urn:li:share:123/');
});

test('provider transport errors cannot leak the bearer token', async () => {
  await assert.rejects(validatePlatformConnection('facebook', credentials, async () => { throw new Error(`Authorization: Bearer ${credentials.token}`); }), error => {
    assert.equal(error.message.includes(credentials.token), false);
    assert.equal(error.status, 502);
    return true;
  });
});
