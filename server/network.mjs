import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, ProxyAgent, fetch } from 'undici';

// These are fixed publisher/API identities used by the app, not user-supplied
// destinations. Cloud egress proxies resolve public names in environments where
// local DNS is unavailable; arbitrary RSS hostnames must still pass local DNS.
const TRUSTED_PROXY_HOSTS = new Set([
  'feeds.bbci.co.uk', 'www.theguardian.com', 'www.aljazeera.com',
  'api.telegram.org', 'api.x.com', 'api.twitter.com',
  'graph.facebook.com', 'graph.instagram.com', 'api.linkedin.com',
]);
const proxyConfigured = () => Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);

async function resolveWithDeadline(hostname, lookup) {
  let timer;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => { const error = new Error('DNS lookup timed out'); error.code = 'ETIMEOUT'; reject(error); }, 5000);
        timer.unref();
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function isPublicAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (net.isIP(ip) === 6) {
    // IPv4-mapped and transition ranges are rejected rather than interpreted inconsistently.
    return !(/^::|^f[cd]|^fe[89ab]|^ff|^2001:db8|^2002:|^64:ff9b:/.test(ip));
  }
  return false;
}

export async function validatePublicUrl(value, lookup = dns.lookup, { proxyAvailable = proxyConfigured() } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('نشانی معتبر نیست.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('فقط نشانی عمومی HTTPS بدون نام کاربری و رمز عبور مجاز است.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('دسترسی به نشانی‌های محلی مجاز نیست.');
  let addresses;
  try { addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await resolveWithDeadline(hostname, lookup); }
  catch (error) {
    if (proxyAvailable && TRUSTED_PROXY_HOSTS.has(hostname) && ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT'].includes(error.code)) return { url, addresses: [], resolvedByTrustedProxy: true };
    throw new Error('نام دامنه قابل شناسایی نیست. برای منابع سفارشی، دسترسی DNS عمومی لازم است.');
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('دسترسی به نشانی‌های محلی یا خصوصی مجاز نیست.');
  return { url, addresses };
}

let proxyAgent;
function createDispatcher(addresses) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) return { dispatcher: proxyAgent ||= new ProxyAgent(proxy), close: false };
  // Pin the validated DNS result to avoid resolving a second, potentially different IP.
  return { dispatcher: new Agent({ connect: { lookup(_hostname, options, callback) {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  } } }), close: true };
}

export async function safeFetch(value, { method = 'GET', headers = {}, body, maxBytes = 3_000_000, allowedHosts, timeoutMs = 18_000 } = {}) {
  let current = value;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const { url, addresses } = await validatePublicUrl(current);
    if (allowedHosts && !allowedHosts.includes(url.hostname)) throw new Error('مقصد این درخواست مجاز نیست.');
    const { dispatcher, close } = createDispatcher(addresses);
    try {
      const response = await fetch(url, {
        dispatcher, redirect: 'manual', method, headers: { 'User-Agent': 'DidbanNews/1.0 (RSS Reader)', ...headers }, body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('تعداد تغییر مسیرهای منبع بیش از حد مجاز است.');
        if (headers.Authorization || method !== 'GET') throw new Error('تغییر مسیر درخواست دارای اعتبارنامه مجاز نیست.');
        current = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`پاسخ سرویس: HTTP ${response.status}. دسترسی شبکه یا سطح دسترسی حساب را بررسی کنید.`);
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw new Error('حجم پاسخ منبع بیش از حد مجاز است.');
      }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error('حجم پاسخ منبع بیش از حد مجاز است.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('زمان انتظار برای پاسخ منبع به پایان رسید.');
      if (error.message === 'fetch failed') throw new Error('اتصال به منبع برقرار نشد؛ دسترسی شبکه را بررسی کنید.');
      throw error;
    } finally {
      if (close) await dispatcher.close();
    }
  }
  throw new Error('دریافت منبع ممکن نشد.');
}
