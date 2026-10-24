import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, extractFeedMedia, safeMediaUrl } from '../server/feeds.mjs';
import { validateCustomConnection, collectCustomArticles } from '../server/custom-connectors.mjs';
import { collectPlatformArticles } from '../server/platforms.mjs';
import { createTelegramMediaService } from '../server/telegram-media.mjs';

test('RSS carries only original image/video attachments and the publisher logo', () => {
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Publisher</title><link>https://publisher.example/news</link><image><url>https://publisher.example/logo.png</url></image><item><title>Actual report</title><link>https://publisher.example/report</link><pubDate>Fri, 23 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Report</p><img src="/images/report.jpg"><video poster="https://cdn.example/poster.png"><source src="https://cdn.example/report.mp4" type="video/mp4"></video>]]></description><media:group><media:content url="https://cdn.example/news.webm" type="video/webm"/><media:thumbnail url="https://cdn.example/news.png"/></media:group></item></channel></rss>`;
  const [article] = parseFeed(xml, { id: 'original', name: 'Original', url: 'https://publisher.example/rss' });
  assert.equal(article.sourceIconUrl, 'https://publisher.example/logo.png');
  assert.ok(article.media.some(item => item.type === 'video' && item.url === 'https://cdn.example/news.webm'));
  assert.ok(article.media.some(item => item.type === 'video' && item.url === 'https://cdn.example/report.mp4' && item.poster === 'https://cdn.example/poster.png'));
  assert.ok(article.media.some(item => item.type === 'image' && item.url === 'https://publisher.example/images/report.jpg'));
  assert.ok(!article.imageUrl.endsWith('.webm') && !article.imageUrl.endsWith('.mp4'));
  assert.equal(article.media.every(item => item.source === 'feed'), true);
});

test('media parsing rejects private URLs, unknown enclosures, tracking pixels and invented fallbacks', () => {
  const media = extractFeedMedia({ enclosure: [
    { '@_url': 'https://cdn.example/real.mp4', '@_type': 'video/mp4' },
    { '@_url': 'https://127.0.0.1/photo.png', '@_type': 'image/png' },
    { '@_url': 'https://cdn.example/download-unknown' },
  ], description: '<img src="https://cdn.example/pixel.png" width="1" height="1"><img src="http://cdn.example/insecure.jpg">' }, 'https://publisher.example/report');
  assert.deepEqual(media, [{ type: 'video', url: 'https://cdn.example/real.mp4', mimeType: 'video/mp4', source: 'feed' }]);
  assert.deepEqual(extractFeedMedia({}, 'https://publisher.example/report'), []);
  assert.equal(safeMediaUrl('https://[::1]/private.png'), null);
  assert.equal(safeMediaUrl('https://user:secret@cdn.example/p.png'), null);
  assert.equal(safeMediaUrl('https://localhost./private.png'), null);
  assert.equal(safeMediaUrl('javascript:alert(1)'), null);
  assert.deepEqual(extractFeedMedia({ enclosure: { '@_url': 'https://www.youtube.com/watch?v=report', '@_type': 'video/mp4' } }, 'https://publisher.example/report'), []);
});

test('Mastodon validates a selected instance and keeps its token bound to that origin', async () => {
  const calls = [];
  const credentials = { instanceUrl: 'https://social.example', accountId: '42', token: 'mock-mastodon-token' };
  const result = await validateCustomConnection('mastodon', credentials, async (url, options) => {
    calls.push({ url, options });
    return url.includes('statuses') ? [] : { id: '42', display_name: '<b>Public account</b>' };
  });
  assert.equal(result.label, 'Public account');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).hostname, 'social.example');
    assert.deepEqual(call.options.allowedHosts, ['social.example']);
    assert.equal(call.options.headers.Authorization, 'Bearer mock-mastodon-token');
    assert.ok(!call.url.includes('mock-mastodon-token'));
  }
  await assert.rejects(() => validateCustomConnection('mastodon', { ...credentials, instanceUrl: 'https://127.0.0.1' }, async () => ({})), /HTTPS/);
  await assert.rejects(() => validateCustomConnection('mastodon', { ...credentials, instanceUrl: 'https://social.example/api/other' }, async () => ({})), /اصلی/);
});

test('Mastodon imports real attachments without exposing private posts or duplicate URLs', async () => {
  const post = { id: '1', content: '<p>Public news</p>', visibility: 'public', url: 'https://social.example/@reporter/1', created_at: '2026-10-23T08:00:00Z', account: { display_name: 'Reporter', avatar: 'https://social.example/avatar.png' }, media_attachments: [{ type: 'video', url: 'https://cdn.example/report.mp4', preview_url: 'https://cdn.example/report.jpg' }] };
  const articles = await collectCustomArticles('mastodon', { instanceUrl: 'https://social.example', accountId: '42' }, [], async () => [post, post, { ...post, url: 'https://social.example/@reporter/2', visibility: 'private' }]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].media[0].type, 'video');
  assert.equal(articles[0].media[0].poster, 'https://cdn.example/report.jpg');
  assert.equal(articles[0].sourceIconUrl, 'https://social.example/avatar.png');
  assert.equal(articles[0].summary, 'Public news');
});

test('Bluesky accepts the actor form field and reads the public AppView without a token', async () => {
  const calls = [];
  const auth = await validateCustomConnection('bluesky', { actor: 'reporter.bsky.social', token: 'not-needed' }, async (url, options) => {
    calls.push({ url, options });
    return url.includes('getProfile') ? { did: 'did:plc:example', handle: 'reporter.bsky.social', displayName: 'Reporter' } : { feed: [] };
  });
  assert.equal(auth.normalizedCredentials.accountId, 'reporter.bsky.social');
  assert.equal(auth.label, 'Reporter');
  assert.equal(calls.every(call => !call.options.headers.Authorization && !call.url.includes('not-needed')), true);
  const articles = await collectCustomArticles('bluesky', { actor: 'reporter.bsky.social' }, [], async () => ({ feed: [{ post: { uri: 'at://did:plc:example/app.bsky.feed.post/post123', author: { did: 'did:plc:example', handle: 'reporter.bsky.social' }, record: { text: 'Bluesky report', createdAt: '2026-10-23T08:00:00Z' }, embed: { images: [{ fullsize: 'https://cdn.example/actual.jpg' }] } } }] }));
  assert.equal(articles.length, 1);
  assert.equal(articles[0].imageUrl, 'https://cdn.example/actual.jpg');
  assert.equal(articles[0].url, 'https://bsky.app/profile/did%3Aplc%3Aexample/post/post123');
});

test('Bale verifies a bot, polls once with an offset and never publishes its credentials', async () => {
  const token = '123456:mock-bale-token';
  const validate = await validateCustomConnection('bale', { token }, async (url, options) => {
    assert.equal(new URL(url).hostname, 'tapi.bale.ai');
    assert.deepEqual(options.allowedHosts, ['tapi.bale.ai']);
    return { ok: true, result: { is_bot: true, username: 'NewsBot' } };
  });
  assert.equal(validate.label, 'NewsBot');
  const messages = { ok: true, result: [{ update_id: 101, channel_post: { message_id: 9, text: 'خبر بله', date: 1792742400, chat: { id: '-10055', type: 'channel', username: 'news_channel', title: 'خبرها' }, photo: [{ file_id: 'unpublished-file-id' }] } }] };
  const articles = await collectCustomArticles('bale', { token, channels: ['@news_channel'], offset: 100 }, [], async (url, options) => {
    assert.ok(url.endsWith('/getUpdates'));
    assert.equal(JSON.parse(options.body).offset, 100);
    return messages;
  });
  assert.equal(articles.length, 1);
  assert.equal(articles.nextCredentials.offset, 102);
  assert.equal(articles[0].mediaAvailable, true);
  assert.ok(!JSON.stringify(articles).includes(token) && !JSON.stringify(articles).includes('unpublished-file-id'));
  await assert.rejects(() => validateCustomConnection('bale', { token }, async () => { throw new Error('token=' + token); }), error => !error.message.includes(token));
});

test('Instagram videos retain the original media URL and actual thumbnail', async () => {
  const articles = await collectPlatformArticles('instagram', { token: 'mock-token', accountId: '22', label: 'Reporter' }, [], async () => ({ data: [{ id: '1', caption: 'Report video', media_type: 'VIDEO', media_url: 'https://cdn.example/actual.mp4', thumbnail_url: 'https://cdn.example/actual.jpg', permalink: 'https://www.instagram.com/p/abc/', timestamp: '2026-10-23T08:00:00Z' }] }));
  assert.equal(articles[0].media[0].type, 'video');
  assert.equal(articles[0].media[0].url, 'https://cdn.example/actual.mp4');
  assert.equal(articles[0].imageUrl, 'https://cdn.example/actual.jpg');
});

function telegramService(overrides = {}) {
  const values = new Map();
  const token = '123456:mock_telegram_token_for_tests';
  const store = {
    getSetting: key => values.get(key), setSetting: (key, value) => values.set(key, value),
    getConnection: () => ({ token }),
  };
  const calls = [];
  const service = createTelegramMediaService({ store,
    requestJson: async (url, options) => { calls.push({ url, options }); return { ok: true, result: { file_path: 'photos/file_1.jpg', file_size: 16 } }; },
    fetchBinary: async (url, options) => { calls.push({ url, options }); return Buffer.from([255, 216, 255, 224, 0, 0, 0, 0, 0]); },
    ...overrides,
  });
  return { ...service, store, calls, token, values };
}

test('Telegram media exposes only opaque same-origin references, resolves files on the fixed API host', async () => {
  const service = telegramService();
  const [media] = service.mediaForMessage({ photo: [{ file_id: 'photo-file-id', file_size: 16 }] });
  assert.match(media.url, /^\/api\/media\/telegram\/[0-9a-f]{40}$/);
  assert.ok(!JSON.stringify(media).includes(service.token) && !JSON.stringify(media).includes('photo-file-id'));
  const result = await service.fetchMedia(media.url.split('/').at(-1));
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.data.length, 9);
  assert.equal(service.calls.every(call => new URL(call.url).hostname === 'api.telegram.org'), true);
  assert.equal(service.calls[1].options.maxBytes, 8 * 1024 * 1024);
});

test('Telegram media rejects unregistered IDs, path escapes, HTML and oversized files', async () => {
  await assert.rejects(() => telegramService().fetchMedia('a'.repeat(40)), error => error.status === 404);
  const pathEscape = telegramService({ requestJson: async () => ({ ok: true, result: { file_path: '../secret.html' } }) });
  const media = pathEscape.mediaForMessage({ photo: [{ file_id: 'photo-file-id' }] })[0];
  await assert.rejects(() => pathEscape.fetchMedia(media.url.split('/').at(-1)), error => error.status === 415);
  const html = telegramService({ fetchBinary: async () => Buffer.from('<html>not an image</html>') });
  const htmlMedia = html.mediaForMessage({ photo: [{ file_id: 'photo-file-id' }] })[0];
  await assert.rejects(() => html.fetchMedia(htmlMedia.url.split('/').at(-1)), error => error.status === 415);
  assert.deepEqual(telegramService().mediaForMessage({ video: { file_id: 'video-id', file_size: 30 * 1024 * 1024 } }), []);
});
