import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {createPublicHistory,guardianDayUrl,publicHistoryLinks} from '../server/public-history.mjs';
import {Store} from '../server/store.mjs';
const news={id:'manual-category-test',url:'https://news.example/item',title:'Publisher headline',summary:'Publisher body',sourceId:'fixture',sourceName:'Source',category:'world',platform:'rss',language:'en',publishedAt:'2026-10-27T10:00:00Z'};
async function fixture(t){const directory=mkdtempSync(path.join(os.tmpdir(),'khabarnama-v7-')),instance=createApp({directory,fetcher:async()=>'<rss><channel/></rss>',urlValidator:async value=>({url:new URL(value)})});const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;const call=(url,body)=>fetch(base+url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return{...instance,call,directory};}
test('manual and custom categories survive publisher re-ingestion, filtering, clearing and reopening the database',async t=>{
 const {store,call,directory}=await fixture(t);store.addArticles([news]);
 const categories=await(await call('/api/categories')).json();for(const id of ['military','politics','social'])assert.ok(categories.categories.some(c=>c.id===id));
 assert.equal((await call('/api/articles/manual-category-test/category',{category:'military'})).status,200);
 store.addArticles([{...news,title:'Publisher update',category:'economy'}]);assert.equal(store.article(news.id).category,'military');assert.equal(store.article(news.id).originalCategory,'economy');assert.equal(store.articles({category:'military'}).length,1);
 const custom=await(await call('/api/categories',{name:'خبرهای انرژی'})).json();await call('/api/articles/manual-category-test/category',{category:custom.category.id});
 const filtered=await(await call(`/api/articles?category=${custom.category.id}`)).json();assert.equal(filtered.total,1);
 const reopened=new Store(directory);try{assert.equal(reopened.article(news.id).category,custom.category.id);assert.equal(reopened.getSetting('userCategories')[0].name,'خبرهای انرژی');}finally{reopened.close();}
 await call('/api/articles/manual-category-test/category',{category:null});assert.equal(store.article(news.id).category,'economy');assert.equal((await call('/api/articles/manual-category-test/category',{category:'invalid'})).status,400);
});
test('public historical import uses actual publisher timestamps, Tehran boundaries and source media without API credentials',async()=>{
 assert.equal(guardianDayUrl('2023-10-27'),'https://www.theguardian.com/world/2023/oct/27/all');
 const url='https://www.theguardian.com/world/2023/oct/27/real-story',outside='https://www.theguardian.com/world/2023/oct/27/outside';
 const listing=`<a data-link-name="article" href="${url}"><h3>Real headline</h3></a><a data-link-name="article" href="${outside}">Other headline</a><a data-link-name="article" href="https://evil.example/world/2023/oct/27/bad">Bad</a>`;
 assert.equal(publicHistoryLinks(listing).length,2);const articles=[];
 const service=createPublicHistory({store:{addArticles:items=>articles.push(...items),archiveCoverage:()=>({articleCount:articles.length})},fetcher:async(value,options)=>{
  assert.deepEqual(options.allowedHosts,['www.theguardian.com']);assert.equal(options.headers,undefined);
  if(value.endsWith('/all'))return listing;
  return `<script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url:value,headline:'Actual historical article',description:'Original publisher summary',datePublished:value===outside?'2023-10-27T23:00:00Z':'2023-10-27T10:00:00Z',image:'https://i.guim.co.uk/actual.jpg'})}</script>`;
 }});
 const result=await service.importDay({date:'2023-10-27'});assert.equal(result.imported,1);assert.equal(articles[0].publishedAt,'2023-10-27T10:00:00.000Z');assert.equal(articles[0].imageUrl,'https://i.guim.co.uk/actual.jpg');assert.equal(result.partial,true);assert.equal(service.isBusy(),false);
 await assert.rejects(()=>createPublicHistory({store:{},fetcher:async()=>'<html>Access denied</html>'}).importDay({date:'2023-10-27'}),error=>error.status===502);
});
test('manual Instagram import needs a post link and explicit text, keeps unknown dates honest and blocks the desktop bridge from ordinary requests',async t=>{
 const {call,store}=await fixture(t);
 assert.equal((await call('/api/lab/reader/manual',{url:'https://www.instagram.com/reporter/',text:'Selected public text'})).status,400);
 const response=await call('/api/lab/reader/manual',{url:'https://www.instagram.com/p/ABC_123/',text:'متن انتخاب‌شدهٔ کاربر درباره خبر عمومی'});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.article.publishedAtKnown,false);assert.equal(data.article.textScope,'manual-browser-selection');assert.deepEqual(data.article.media,[]);
 store.saveArticle(data.article.id,true);await call('/api/lab/reader/manual',{url:data.article.url,text:'متن انتخاب‌شدهٔ تازه از همان پست'});assert.equal(store.article(data.article.id).saved,true);
 assert.equal((await call('/api/lab/reader/manual',{url:'https://127.0.0.1/p/ABC_123/',text:'Not allowed'})).status,400);
 assert.equal((await call('/api/desktop/reader/capture',{id:'forged',url:data.article.url,text:'Unsolicited'})).status,403);
 assert.equal((await call('/api/lab/reader/open',{type:'instagram',input:'reporter'})).status,409);
});

test('historical world digest retains source references, editorial event dates and local cache instead of inventing publication timestamps',async t=>{
 const {parseHistoricalDigest,digestUrl}=await import('../server/historical-digest.mjs');
 assert.equal(digestUrl('2023-10-27'),'https://en.wikipedia.org/wiki/Portal:Current_events/2023_October_27');
 const html='<div class="description"><ul><li>Armed conflicts<ul><li>A genuine historical event summary with sufficient context. <a class="external" href="https://news.example/original">Source</a></li></ul></li></ul></div>';
 const result=parseHistoricalDigest(html,'2023-10-27');assert.equal(result.events.length,1);assert.equal(result.events[0].dateBasis,'editorial-event-day');assert.equal(result.events[0].url,'https://news.example/original');assert.equal(result.events[0].date,'2023-10-27');assert.ok(!('publishedAt' in result.events[0]));assert.throws(()=>parseHistoricalDigest('<html>Denied</html>','2023-10-27'));
 const directory=mkdtempSync(path.join(os.tmpdir(),'khabarnama-digest-'));let calls=0;
 const instance=createApp({directory,fetcher:async()=>{calls++;return html;},urlValidator:async value=>({url:new URL(value)})});const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 for(let index=0;index<2;index++){const response=await fetch(base+'/api/archive/digest',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"date":"2023-10-27"}'});assert.equal(response.status,200);}
 assert.equal(calls,1);const cached=await(await fetch(base+'/api/archive/digest?date=2023-10-27')).json();assert.equal(cached.digest.events.length,1);assert.equal(instance.store.articles().length,0);
});

test('the native reader keeps captured text as a draft until user confirmation and requires the desktop nonce',async t=>{
 const original=process.env.DIDEBAN_DESKTOP_SECRET,secret='synthetic-reader-secret-for-tests-only';process.env.DIDEBAN_DESKTOP_SECRET=secret;
 t.after(()=>{if(original===undefined)delete process.env.DIDEBAN_DESKTOP_SECRET;else process.env.DIDEBAN_DESKTOP_SECRET=original;});
 const {app,store,call}=await fixture(t);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await call('/api/lab/reader/open',{type:'instagram',input:'reporter'})).status,200);
 assert.equal((await fetch(base+'/api/desktop/reader/next')).status,403);
 const desktop=(url,body)=>fetch(base+url,{headers:{'X-Dideban-Desktop':secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const {job}=await(await desktop('/api/desktop/reader/next')).json();assert.equal(job.url,'https://www.instagram.com/reporter/');
 assert.equal((await desktop('/api/desktop/reader/capture',{id:job.id,url:'https://www.instagram.com/p/SELECTED_123/',text:'User selected public post text'})).status,200);
 assert.equal(store.articles().length,0);const {draft}=await(await call('/api/lab/reader')).json();assert.ok(draft.id);assert.equal((await call('/api/lab/reader/import',{id:draft.id})).status,200);assert.equal(store.articles().length,1);assert.equal((await call('/api/lab/reader/import',{id:draft.id})).status,409);
});
