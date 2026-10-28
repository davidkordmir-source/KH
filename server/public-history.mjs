import {load} from 'cheerio';
import {validateArchiveDate} from './archive-provider.mjs';
import {parseWebsite} from './websites.mjs';
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const dayOf=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function guardianDayUrl(date){validateArchiveDate(date);const [y,m,d]=date.split('-');return `https://www.theguardian.com/world/${y}/${months[Number(m)-1]}/${d}/all`;}
export function publicHistoryLinks(html){
 const $=load(html),urls=new Set();
 $('a[href]').each((_,element)=>{try{const url=new URL($(element).attr('href'),'https://www.theguardian.com');if(url.hostname==='www.theguardian.com'&&/^\/[a-z-]+\/\d{4}\/[a-z]{3}\/\d{2}\/(?!all(?:\/|$))[^/?#]+$/.test(url.pathname)&&($(element).find('h2,h3,h4').length||$(element).attr('data-link-name')==='article')){url.hash='';url.search='';if(urls.size<24)urls.add(url.href);}}catch{}});
 return [...urls];
}
export function createPublicHistory({store,fetcher}){
 let pending=null;
 async function collect(date){
  const previous=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10),links=new Set();let listingErrors=0;
  for(const day of [date,previous])try{const html=await fetcher(guardianDayUrl(day),{allowedHosts:['www.theguardian.com'],maxBytes:4000000,timeoutMs:12000});for(const url of publicHistoryLinks(html))if(links.size<24)links.add(url);}catch{listingErrors++;}
  if(!links.size)throw Object.assign(new Error('صفحهٔ آرشیو عمومی ناشر قابل دریافت نبود. این نتیجه به معنی نبود خبر در آن روز نیست؛ دسترسی شبکه یا محدودیت سایت را بررسی کنید.'),{status:502});
  const articles=new Map();let failed=0;
  const targets=[...links];
  for(let index=0;index<targets.length;index+=4)await Promise.all(targets.slice(index,index+4).map(async url=>{try{
   const html=await fetcher(url,{allowedHosts:['www.theguardian.com'],maxBytes:4000000,timeoutMs:9000});
   for(const item of parseWebsite(html,{id:'guardian-public-history',name:'The Guardian · آرشیو عمومی',url,language:'en'}))if(item.publishedAtKnown&&dayOf(item.publishedAt)===date)articles.set(item.url,{...item,archiveProvider:'Guardian public web archive'});
  }catch{failed++;}}));
  if(!articles.size)throw Object.assign(new Error('برای این روز، مقاله‌ای با تاریخ انتشار قابل تأیید از آرشیو عمومی دریافت نشد. ممکن است پاسخ ناشر محدود شده باشد؛ آرشیو محلی و کلید اختیاری Guardian همچنان در دسترس‌اند.'),{status:422});
  store.addArticles([...articles.values()]);
  return {imported:articles.size,date,provider:'Guardian · آرشیو عمومی بدون کلید',partial:true,checked:targets.length,failed:failed+listingErrors,coverage:store.archiveCoverage(),scope:'فقط مقالات قابل دریافت Guardian با تاریخ واقعی همان روز به وقت تهران؛ پوشش جهانی و کامل نیست.'};
 }
 return {isBusy:()=>Boolean(pending),importDay({date}={}){validateArchiveDate(date);if(pending)throw Object.assign(new Error('دریافت تاریخی قبلی هنوز در حال انجام است.'),{status:409});pending=collect(date).finally(()=>{pending=null;});return pending;}};
}
