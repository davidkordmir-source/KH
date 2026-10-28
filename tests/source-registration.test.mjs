import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {SOURCE_CATALOG} from '../server/catalog.mjs';
import {knownFeedUrl,sourceAccessError} from '../server/source-access.mjs';
const feed='<rss><channel><item><title>Genuine headline</title><link>https://news.example/report</link><pubDate>Wed, 28 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
async function fixture(t,fetcher){const directory=mkdtempSync(path.join(os.tmpdir(),'source-registration-'));const instance=createApp({directory,fetcher,urlValidator:async value=>{const url=new URL(value);if(url.hostname==='127.0.0.1')throw Error('private');return{url};}});for(const s of instance.store.sources())instance.store.updateSource(s.id,{enabled:false});const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;return{...instance,call:(url,body)=>fetch(base+url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})};}
test('known public feed destinations are used only for exact publishers and official organization matches',()=>{
 assert.equal(knownFeedUrl('https://www.irna.ir/'),'https://www.irna.ir/rss');const alternative=SOURCE_CATALOG.find(source=>source.id==='zelensky-public-telegram');assert.equal(alternative.countryCode,'UA');assert.equal(alternative.platform,'telegram-public');assert.equal(knownFeedUrl('https://www.gov.uk/'),null);assert.equal(knownFeedUrl('https://www.irna.ir.attacker.example/'),null);
 const error=sourceAccessError(new Error('پاسخ سرویس: HTTP 403.'));assert.equal(error.status,502);assert.match(error.message,/لزوماً/);
});
test('403 is not reported as a successful connection; pending registration is durable and resolves after a genuine fetch',async t=>{
 let blocked=true,calls=0;const {call,store,sync}=await fixture(t,async()=>{calls++;if(blocked)throw Error('پاسخ سرویس: HTTP 403.');return feed;});
 let response=await call('/api/sources',{name:'Blocked publisher',url:'https://news.example/'});assert.equal(response.status,502);assert.match((await response.json()).error,/RSS/);assert.equal(store.sources().filter(s=>s.name==='Blocked publisher').length,0);
 const before=calls;response=await call('/api/sources',{name:'Pending publisher',url:'https://news.example/',mode:'pending'});assert.equal(response.status,201);const pending=await response.json();assert.equal(calls,before);assert.equal(pending.platform,'auto');assert.equal(pending.lastFetchedAt,null);assert.equal(store.sources().find(s=>s.id===pending.id).lastError,null);
 await sync();assert.equal(store.articles().length,0);blocked=false;await sync();const saved=store.sources().find(s=>s.id===pending.id);assert.equal(saved.platform,'rss');assert.ok(saved.lastFetchedAt);assert.equal(store.articles()[0].sourceId,pending.id);
});
test('official references and the Ukraine speech source can be registered without claiming collection; retry preserves pending status on denial',async t=>{
 const {call,store}=await fixture(t,async()=>{throw Error('پاسخ سرویس: HTTP 403.');});
 const reference=await call('/api/catalog/israel-prime-minister/add',{});assert.equal(reference.status,201);assert.equal((await reference.json()).source.platform,'website-link');
 const response=await call('/api/catalog/ukraine-president/add',{mode:'pending'});assert.equal(response.status,201);const {source}=await response.json();assert.equal(source.kind,'official');assert.equal(source.platform,'auto');assert.equal(source.lastFetchedAt,null);
 assert.equal((await call(`/api/sources/${source.id}/retry`,{})).status,502);assert.equal(store.sources().find(s=>s.id===source.id).lastFetchedAt,null);
 assert.equal((await call('/api/lab/reader/manual',{url:'https://t.me/unrelated_channel/1',text:'Not an official-site selection'})).status,400);
 const manual=await call('/api/lab/reader/manual',{url:'https://www.president.gov.ua/en/news/test-official-speech',text:'Text selected by the user from an official speech page.'});assert.equal(manual.status,200);const data=await manual.json();assert.equal(data.article.sourceKind,'official');assert.equal(data.article.publishedAtKnown,false);
 assert.equal((await call('/api/lab/reader/manual',{url:'http://www.president.gov.ua/en/news/a',text:'Unsafe scheme'})).status,400);
});
test('a publisher root can collect its known RSS while its homepage is never fetched',async t=>{
 const urls=[];const {call,store}=await fixture(t,async url=>{urls.push(url);return feed;});for(const source of store.sources())if(source.url==='https://www.irna.ir/rss')store.deleteSource(source.id);assert.equal((await call('/api/sources',{name:'IRNA',url:'https://www.irna.ir/'})).status,201);assert.deepEqual(urls,['https://www.irna.ir/rss']);
});
