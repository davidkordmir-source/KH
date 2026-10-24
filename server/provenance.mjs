import { createHash } from 'node:crypto';
import { normalizeStoryTitle } from './enrichment.mjs';
import { safeMediaUrl } from './feeds.mjs';
const idFor=url=>createHash('sha256').update(url).digest('hex').slice(0,20);
const sentences=article=>(article.fullText||article.summary||'').match(/[^.!?؟\n]+[.!?؟]?/g)?.map(normalizeStoryTitle).filter(text=>text.length>=100&&text.split(' ').length>=14)||[];
export function buildProvenance(articles,research=()=>({})) {
  articles=[...articles].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
  const nodes=new Map(),edges=[],seen=new Set();
  const node=(url,entry={})=>{if(!nodes.has(url))nodes.set(url,{id:idFor(url),url,label:entry.title||new URL(url).hostname,articleId:entry.id||null,publishedAt:entry.publishedAtKnown===false?null:entry.publishedAt||null,sourceName:entry.sourceName||new URL(url).hostname});return nodes.get(url);};
  const edge=(from,to,basis,label)=>{const key=`${from}|${to}|${basis}`;if(from===to||seen.has(key))return;seen.add(key);edges.push({from:node(from).id,to:node(to).id,basis,label});};
  for(const article of articles)node(article.url,article);
  for(const article of articles){
    for(const reference of article.references||[]){if(!safeMediaUrl(reference.url))continue;node(reference.url,{title:reference.label});edge(article.url,reference.url,'publisher-link',reference.label||'پیوند منتشرشده در متن فید');}
    const primary=research(article.id)?.primaryUrl;if(primary&&safeMediaUrl(primary)){node(primary);edge(article.url,primary,'user-primary','منبع اولیه به ثبت کاربر');}
  }
  const textIndex=new Map();
  for(const article of articles)for(const text of sentences(article).slice(0,30)){
    const matches=textIndex.get(text)||[];
    for(const other of matches.slice(0,3))edge(article.url,other.url,'shared-text','جملهٔ طولانی یکسان؛ جهت، ترتیب انتشار ثبت‌شده است و منشأ بازنشر را ثابت نمی‌کند');
    matches.push(article);textIndex.set(text,matches);
  }
  const dated=articles.filter(a=>a.publishedAtKnown!==false).sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
  return {nodes:[...nodes.values()].slice(0,150),edges:edges.slice(0,250),earliest:dated[0]?{id:dated[0].id,title:dated[0].title,url:dated[0].url,publishedAt:dated[0].publishedAt}:null,scope:`${articles.length} خبر انتخاب‌شده از آرشیو؛ پیوند، اشاره یا متن مشترک به‌تنهایی مالکیت خبر و استقلال منابع را اثبات نمی‌کند.`};
}
