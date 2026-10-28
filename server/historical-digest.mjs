import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {validateArchiveDate} from './archive-provider.mjs';
import {cleanText,safeMediaUrl} from './feeds.mjs';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function digestUrl(date){validateArchiveDate(date);const [year,month,day]=date.split('-');return `https://en.wikipedia.org/wiki/Portal:Current_events/${year}_${months[Number(month)-1]}_${Number(day)}`;}
export function parseHistoricalDigest(html,date){
 const sourceUrl=digestUrl(date),$=load(html),events=[];
 $('.description li').each((_,element)=>{
  const node=$(element).clone();node.find('ul,ol,script,style,sup').remove();
  const text=cleanText(node.text());if(text.length<30)return;
  const references=[];node.find('a.external[href]').each((_,a)=>{const url=safeMediaUrl($(a).attr('href'),sourceUrl);if(url&&!/\.wikipedia\.org$|\.wikimedia\.org$/.test(new URL(url).hostname)&&!references.includes(url))references.push(url);});
  if(!references.length||events.length>=60)return;
  const id=createHash('sha256').update(date+'|'+text).digest('hex').slice(0,24);if(events.some(e=>e.id===id))return;
  events.push({id,date,title:text.slice(0,220),summary:text,url:references[0],references,sourceUrl,sourceName:'Wikipedia · Current events',dateBasis:'editorial-event-day'});
 });
 if(!events.length)throw Object.assign(new Error('مرور تاریخی این روز در پاسخ عمومی منبع قابل خواندن نبود. دسترسی شبکه یا موجودبودن صفحه را بررسی کنید؛ هیچ خبر ساختگی جایگزین نمی‌شود.'),{status:422});
 return {date,events,sourceUrl,sourceName:'Wikipedia · Current events',license:'CC BY-SA؛ متن مرور روزانه با پیوند به نسخهٔ منبع و خبرهای استنادشده',scope:'مرور ویکی‌پدیا از رویدادهای ثبت‌شدهٔ این روز؛ تاریخ رویداد است، نه لزوماً زمان انتشار خبر اصلی و نه آرشیو کامل خبرگزاری‌ها.'};
}
export function registerHistoricalDigest(app,{store,fetcher},route){
 app.get('/api/archive/digest',route((req,res)=>{validateArchiveDate(req.query.date);res.json({digest:store.getSetting(`historicalDigest:${req.query.date}`),cached:true});}));
 app.post('/api/archive/digest',route(async(req,res)=>{
  const date=validateArchiveDate(req.body?.date),cached=store.getSetting(`historicalDigest:${date}`);
  if(cached)return res.json({digest:cached,cached:true});
  let html;try{html=await fetcher(digestUrl(date),{allowedHosts:['en.wikipedia.org'],maxBytes:4000000,timeoutMs:15000});}catch{throw Object.assign(new Error('دریافت مرور تاریخی از ویکی‌پدیا ممکن نشد. اتصال اینترنت یا محدودیت دسترسی به منبع را بررسی کنید.'),{status:502});}
  const digest={...parseHistoricalDigest(html,date),importedAt:new Date().toISOString()};store.setSetting(`historicalDigest:${date}`,digest);res.json({digest,cached:false});
 }));
}
