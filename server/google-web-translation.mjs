import {load} from 'cheerio';

export function googleTranslationLink(text,target='fa') {
  const url=new URL('https://translate.google.com/');
  url.search=new URLSearchParams({sl:'auto',tl:target,text:String(text||'').slice(0,3000),op:'translate'});
  return url.href;
}
export function parseGoogleTranslation(html) {
  const $=load(html);
  if($('form[action*="sorry"],iframe[src*="recaptcha"],[data-sitekey]').length)throw new Error('Google requires browser verification');
  const text=$('.result-container').first().text().trim();
  if(!text||text.length>12000)throw new Error('No readable Google translation');
  return text;
}
export async function translateWithGoogleWeb(item,target,fetcher) {
  if(!['fa','en','ar','fr','de','ru','zh-CN','tr','es'].includes(target))throw Object.assign(new Error('زبان ترجمه پشتیبانی نمی‌شود.'),{status:400});
  const original=item.fullText||item.summary||'',body=original.slice(0,3000);
  const chunks=body.match(/[\s\S]{1,1000}/gu)||[];
  const inputs=[item.title.slice(0,500),...chunks];
  const translated=[];
  try {
    for(const input of inputs) {
      const url=new URL('https://translate.google.com/m');url.search=new URLSearchParams({sl:'auto',tl:target,q:input});
      const html=await fetcher(url.href,{allowedHosts:['translate.google.com'],maxBytes:500000,timeoutMs:9000});
      translated.push(parseGoogleTranslation(html));
    }
  }catch{throw Object.assign(new Error('ترجمهٔ وب گوگل در دسترس نبود یا نیاز به بررسی مرورگر دارد. از «بازکردن در گوگل» استفاده کنید؛ هیچ کلیدی لازم نیست.'),{status:502});}
  return {title:translated[0],body:translated.slice(1).join('\n\n'),target,provider:'Google Translate (وب، بدون کلید)',translatedAt:new Date().toISOString(),inputScope:item.textScope||'publisher-text',truncated:original.length>3000,characterLimit:3000};
}
