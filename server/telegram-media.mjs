import { createHash } from 'node:crypto';

const MEDIA = {
  jpg: { type: 'image', mime: 'image/jpeg' }, jpeg: { type: 'image', mime: 'image/jpeg' },
  png: { type: 'image', mime: 'image/png' }, webp: { type: 'image', mime: 'image/webp' }, gif: { type: 'image', mime: 'image/gif' },
  mp4: { type: 'video', mime: 'video/mp4' }, webm: { type: 'video', mime: 'video/webm' },
};
const LIMITS = { image: 8 * 1024 * 1024, video: 25 * 1024 * 1024 };
const HOST = 'api.telegram.org';

export class MediaAccessError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'MediaAccessError'; this.status = status; }
}

function signatureMatches(data, ext) {
  if (!Buffer.isBuffer(data) || data.length < 8) return false;
  if (ext === 'jpg' || ext === 'jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (ext === 'png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === 'gif') return /^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'));
  if (ext === 'webp') return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (ext === 'mp4') return data.subarray(4, 8).toString('ascii') === 'ftyp';
  if (ext === 'webm') return data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

/** Resolve Bot API files server-side; public article payloads never contain tokens. */
export function createTelegramMediaService({ store, requestJson, fetchBinary }) {
  if (!store || typeof requestJson !== 'function' || typeof fetchBinary !== 'function') throw new TypeError('Telegram media storage and requesters are required.');
  function register(file, type) {
    if (!file || typeof file.file_id !== 'string' || !/^[a-zA-Z0-9_-]{4,512}$/.test(file.file_id)) return null;
    if (Number(file.file_size) > LIMITS[type]) return null;
    const id = createHash('sha256').update(`telegram:${type}:${file.file_id}`).digest('hex').slice(0, 40);
    const key = `telegramMedia:${id}`;
    if (!store.getSetting(key)) store.setSetting(key, { fileId: file.file_id, type });
    return `/api/media/telegram/${id}`;
  }
  function mediaForMessage(message = {}) {
    const media = [];
    const photos = (Array.isArray(message.photo) ? message.photo : []).filter(photo => !Number(photo.file_size) || Number(photo.file_size) <= LIMITS.image);
    const photo = photos.at(-1);
    const image = register(photo, 'image');
    if (image) media.push({ type: 'image', url: image, source: 'platform' });
    const video = register(message.video, 'video');
    if (video) {
      const poster = register(message.video?.thumbnail || message.video?.thumb, 'image');
      const mimeType = /^video\/(?:mp4|webm)$/i.test(message.video?.mime_type || '') ? message.video.mime_type : undefined;
      media.push({ type: 'video', url: video, ...(mimeType ? { mimeType } : {}), ...(poster ? { poster } : {}), source: 'platform' });
    }
    return media;
  }
  async function fetchMedia(id) {
    if (!/^[0-9a-f]{40}$/.test(String(id))) throw new MediaAccessError('رسانه پیدا نشد.', 404);
    const entry = store.getSetting(`telegramMedia:${id}`);
    if (!entry || !['image', 'video'].includes(entry.type) || typeof entry.fileId !== 'string') throw new MediaAccessError('رسانه پیدا نشد.', 404);
    const connection = store.getConnection('telegram');
    if (!connection?.token) throw new MediaAccessError('برای مشاهدهٔ این رسانه، اتصال ربات تلگرام باید فعال باشد.', 409);
    if (!/^[0-9]{5,}:[a-zA-Z0-9_-]{20,}$/.test(connection.token)) throw new MediaAccessError('اعتبار اتصال تلگرام نیاز به بررسی دارد.', 409);
    let file;
    try {
      const result = await requestJson(`https://${HOST}/bot${connection.token}/getFile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: entry.fileId }), allowedHosts: [HOST],
      });
      if (!result?.ok || !result.result?.file_path) throw new Error('File unavailable');
      file = result.result;
    } catch { throw new MediaAccessError('دریافت رسانهٔ اصلی از تلگرام ممکن نشد. دسترسی ربات و شبکه را بررسی کنید.', 502); }
    const filepath = String(file.file_path);
    if (filepath.length > 512 || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(filepath)) throw new MediaAccessError('نوع یا مسیر فایل رسانه مجاز نیست.', 415);
    const ext = filepath.split('.').at(-1).toLowerCase();
    const format = MEDIA[ext];
    if (!format || format.type !== entry.type) throw new MediaAccessError('نوع رسانه با فایل اصلی سازگار نیست.', 415);
    const maxBytes = LIMITS[entry.type];
    if (Number(file.file_size) > maxBytes) throw new MediaAccessError('حجم رسانه بیش از حد مجاز است.', 413);
    let data;
    try {
      data = await fetchBinary(`https://${HOST}/file/bot${connection.token}/${filepath}`, { responseType: 'buffer', maxBytes, timeoutMs: 30_000, allowedHosts: [HOST] });
    } catch { throw new MediaAccessError('دریافت فایل اصلی رسانه از تلگرام ممکن نشد.', 502); }
    if (!Buffer.isBuffer(data) || data.length > maxBytes) throw new MediaAccessError('حجم یا قالب پاسخ رسانه مجاز نیست.', 413);
    if (!signatureMatches(data, ext)) throw new MediaAccessError('پاسخ تلگرام یک فایل تصویری یا ویدیویی معتبر نیست.', 415);
    return { data, contentType: format.mime };
  }
  return { mediaForMessage, fetchMedia };
}
