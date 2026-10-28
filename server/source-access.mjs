import {SOURCE_CATALOG,OFFICIAL_WEBSITES} from './catalog.mjs';
export function knownFeedUrl(value){
 const url=new URL(value);
 for(const [id,website] of Object.entries(OFFICIAL_WEBSITES))if(url.href.replace(/\/$/,'')===website.replace(/\/$/,''))return SOURCE_CATALOG.find(s=>s.id===id)?.url||null;
 if(url.hostname==='www.bbc.com'&&/^\/persian\/?$/.test(url.pathname))return 'https://feeds.bbci.co.uk/persian/rss.xml';
 if(url.pathname!=='/'||url.search)return null;
 const matches=SOURCE_CATALOG.filter(source=>source.kind!=='official'&&source.platform==='rss'&&source.collection!=='website'&&new URL(source.url).origin===url.origin);
 return matches.length===1?matches[0].url:null;
}
export function sourceAccessError(error){
 if(error?.code==='UPSTREAM_FORBIDDEN'||/HTTP\s*403\b/i.test(String(error?.message)))return Object.assign(new Error('دریافت خبر رد شد (HTTP 403). سایت یا شبکه اجازهٔ دریافت خودکار نداده است؛ این خطا لزوماً به معنی نیاز به کلید API نیست. نشانی مستقیم RSS یا «ثبت برای بررسی بعدی» را امتحان کنید و صفحهٔ منبع را در مرورگر باز کنید.'),{status:502,code:'SOURCE_ACCESS_DENIED'});
 return error;
}
