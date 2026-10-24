import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { createNewsroom, groupEvents } from '../server/newsroom.mjs';
import { createBackupService } from '../server/backups.mjs';
import { parseCalendar } from '../server/calendar.mjs';
import { parseFeed } from '../server/feeds.mjs';

const record=(id,extra={})=>({id,title:'بانک مرکزی آمریکا تصمیم تازه درباره نرخ بهره اعلام کرد',summary:'گزارش درباره تصمیم اقتصادی آمریکا است.',fullText:'گزارش درباره تصمیم اقتصادی آمریکا است. متن بلند شامل عبارت ویژه ذخیره پژوهشی در بخش پایانی است.',url:`https://news.example/${id}`,sourceId:'fixture',sourceName:'ناشر آزمایشی',platform:'rss',publishedAt:new Date().toISOString(),publishedAtKnown:true,category:'economy',language:'fa',...extra});
function storage(t) {const dir=mkdtempSync(path.join(tmpdir(),'dideban-v3-')),store=new Store(dir);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
async function api(t,fetcher=async()=>{throw new Error('Unexpected external request');}) {
  const store=storage(t),instance=createApp({store,directory:store.directory,fetcher,urlValidator:async value=>({url:new URL(value)})}),server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {...instance,call:(url,method='GET',body)=>fetch(base+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})};
}

test('FTS searches full feed content, Persian variants, exact phrases, exclusions and date/source filters',async t=>{
  const {store,call}=await api(t);
  store.addArticles([record('a'),record('b',{fullText:'ذخیره یک پژوهشی بدون عبارت دقیق',language:'en'}),record('c',{publishedAt:'2024-03-20T08:00:00.000Z',fullText:'ذخیره پژوهشی بدون خبر اقتصادی',category:'science'})]);
  const search=async params=>(await(await call('/api/articles?'+new URLSearchParams(params))).json());
  assert.equal((await search({query:'"ذخیره پژوهشی"',language:'fa'})).total,2);
  assert.equal((await search({query:'"ذخيره پژوهشي"',dateFrom:'2026-01-01'})).total,1);
  assert.equal((await search({query:'"ذخیره پژوهشی"',exclude:'ویژه'})).total,1);
  assert.equal((await search({query:'"ذخیره پژوهشی"',category:'science',sourceId:'fixture'})).articles[0].id,'c');
  assert.equal((await search({query:'"; DROP TABLE articles; --'})).total,0);
  assert.equal((await call('/api/articles?sourceId=one&sourceId=two')).status,400);
});

test('event clustering compares likely related reports without merging read state or asserting independent confirmation',t=>{
  const store=storage(t);const articles=[record('one'),record('two',{sourceId:'second',url:'https://other.example/two',title:'بانک مرکزی آمریکا تصمیم تازه درباره نرخ بهره امروز اعلام کرد'}),record('unrelated',{title:'مسابقات فوتبال نوجوانان در شهر تهران آغاز شد'}),record('old',{publishedAt:'2024-01-01T00:00:00.000Z'})];
  const groups=groupEvents(articles,[{id:'fixture',publisher:'shared'},{id:'second',publisher:'shared'}]);
  assert.equal(groups.length,3);const related=groups.find(g=>g.count===2);assert.equal(related.sourceCount,1);assert.equal(related.independentConfirmation,false);
  store.addArticles(articles);store.markRead('one');assert.equal(store.article('two').read,false);
});

test('research, revisions, folders and profile aliases persist without changing original news or inventing verification',async t=>{
  const {store,call}=await api(t);store.addArticles([record('one')]);
  assert.equal((await call('/api/newsroom/articles/one/research','PUT',{review:'corroborated'})).status,400);
  assert.equal((await call('/api/newsroom/articles/one/research','PUT',{folder:'انرژی',note:'یادداشت شخصی',tags:['نفت'],review:'disputed',reviewNote:'نیازمند بررسی سند',evidenceUrl:'https://evidence.example/report'})).status,200);
  store.addArticles([record('one',{title:'نسخه اصلاح شده خبر بانک مرکزی آمریکا درباره نرخ بهره'})]);
  const detail=await(await call('/api/newsroom/articles/one')).json();assert.equal(detail.research.note,'یادداشت شخصی');assert.equal(detail.versions.length,1);assert.match(detail.versions[0].title,/تصمیم تازه/);
  assert.equal((await(await call('/api/articles?folder='+encodeURIComponent('انرژی'))).json()).total,1);
  const created=await(await call('/api/newsroom/profiles','POST',{name:'نهاد نمونه',type:'organization',aliases:['بانک مرکزی آمریکا'],links:[{url:'https://example.org',label:'Official',verified:false}]})).json();
  const profile=await(await call(`/api/newsroom/profiles/${created.profile.id}`)).json();assert.equal(profile.articles.length,1);assert.equal(profile.profile.links[0].verified,false);
});

test('translation uses the official bounded API, caches by article content and never exposes credentials',async t=>{
  let calls=0;
  const {store,call}=await api(t,async(url,options)=>{assert.match(url,/^https:\/\/api\.cognitive\.microsofttranslator\.com\/translate/);assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'secret-translator-key');assert.equal(JSON.parse(options.body).length,2);calls++;return JSON.stringify([{translations:[{text:'عنوان ترجمه'}]},{translations:[{text:'متن ترجمه'}]}]);});
  store.addArticles([record('one')]);assert.equal((await call('/api/newsroom/articles/one/translate','POST',{target:'fa'})).status,409);
  await call('/api/newsroom/translator','POST',{token:'secret-translator-key',region:'westeurope'});
  const first=await(await call('/api/newsroom/articles/one/translate','POST',{target:'fa'})).json();assert.equal(first.title,'عنوان ترجمه');
  await call('/api/newsroom/articles/one/translate','POST',{target:'fa'});assert.equal(calls,1);
  store.addArticles([record('one',{fullText:'متن جدید ناشر'})]);await call('/api/newsroom/articles/one/translate','POST',{target:'fa'});assert.equal(calls,2);
  const status=await(await call('/api/newsroom/settings')).text();assert.ok(!status.includes('secret-translator-key'));
  const bytes=readFileSync(path.join(store.directory,'news.sqlite'));assert.ok(!bytes.includes(Buffer.from('secret-translator-key')));
});

test('alerts group copies, survive repeat checks, respect start time and keep history independent of browser quiet hours',async t=>{
  const {store,call}=await api(t);store.addArticles([record('a'),record('b',{sourceId:'second',title:'بانک مرکزی آمریکا تصمیم تازه درباره نرخ بهره امروز اعلام کرد'})]);
  await call('/api/newsroom/rules','POST',{name:'بانک مرکزی',query:'"نرخ بهره"',includeRecent:true});
  const first=await(await call('/api/newsroom/alerts/check','POST',{})).json();assert.equal(first.added,1);assert.equal(first.alerts[0].count,2);
  assert.equal((await(await call('/api/newsroom/alerts/check','POST',{})).json()).added,0);
  await call(`/api/newsroom/alerts/${first.alerts[0].id}/read`,'POST',{});assert.equal((await(await call('/api/newsroom/alerts')).json()).unread,0);
  await call('/api/newsroom/rules','POST',{name:'از اکنون',query:'"نرخ بهره"'});assert.equal((await(await call('/api/newsroom/alerts/check','POST',{})).json()).added,0);
  await call('/api/newsroom/notifications','PUT',{browser:true,quietStart:'23:00',quietEnd:'07:00'});
  assert.equal((await(await call('/api/newsroom/alerts')).json()).preferences.quietStart,'23:00');
});

test('market alerts require fresh actual quotes and ignore stale historical fallback values',async t=>{
  const store=storage(t);let quote={symbol:'BZ=F',nameFa:'برنت',value:80,unit:'USD',changePercent:3,asOf:new Date().toISOString(),stale:false,provider:'fixture',providerUrl:'https://quotes.example'};
  const room=createNewsroom({store,fetcher:async()=>'',markets:{getMarkets:async()=>({quotes:[quote]})}});
  room.putRule({name:'حرکت برنت',type:'market',symbol:'BZ=F',condition:'change',threshold:2});assert.equal((await room.evaluate()).added,1);assert.equal((await room.evaluate()).added,0);
  room.putRule({name:'قیمت قدیمی',type:'market',symbol:'BZ=F',condition:'above',threshold:50});quote={...quote,asOf:'2020-01-01T00:00:00.000Z'};assert.equal((await room.evaluate()).added,0);
  quote={...quote,asOf:new Date().toISOString(),stale:true};assert.equal((await room.evaluate()).added,0);
  quote={...quote,stale:false,asOf:'not-a-date'};assert.equal((await room.evaluate()).added,0);
  quote={...quote,asOf:new Date().toISOString(),fallback:true};assert.equal((await room.evaluate()).added,0);
});

test('encrypted backup restores into a different key and retains notes, search index, subscriptions and credentials',t=>{
  const original=storage(t),destination=storage(t);original.addArticles([record('old')]);original.saveArticle('old',true);original.setConnection('x','Account',{token:'sensitive-credential'});
  const room=createNewsroom({store:original,markets:{},fetcher:async()=>''});room.saveResearch('old',{folder:'پژوهش',note:'پایدار'});room.putRule({name:'موضوع',query:'اقتصاد'});
  const sourceBackups=createBackupService(original),archive=sourceBackups.exportArchive('long-backup-password');assert.ok(!archive.includes(Buffer.from('sensitive-credential')));assert.ok(!archive.includes(Buffer.from('پایدار')));
  const targetBackups=createBackupService(destination);destination.addArticles([record('current')]);
  assert.throws(()=>targetBackups.restoreArchive(archive.toString('base64'),'wrong-backup-password'),/گذرواژه/);assert.ok(destination.article('current'));
  const tampered=Buffer.from(archive);tampered[tampered.length-1]^=1;assert.throws(()=>targetBackups.restoreArchive(tampered.toString('base64'),'long-backup-password'),/آسیب/);
  assert.equal(targetBackups.restoreArchive(archive.toString('base64'),'long-backup-password').articleCount,1);
  assert.equal(destination.article('current'),null);assert.equal(destination.article('old').saved,true);assert.equal(destination.getConnection('x').token,'sensitive-credential');assert.equal(destination.searchArchive({query:'"ذخیره پژوهشی"'}).total,1);
  assert.equal(createNewsroom({store:destination,markets:{},fetcher:async()=>''}).research('old').note,'پایدار');assert.ok(targetBackups.list().length);
});

test('restore needs explicit confirmation and exports neutralize spreadsheet formulas',async t=>{
  const {store,call}=await api(t);store.addArticles([record('formula',{title:'=HYPERLINK("https://example.org")'})]);
  const response=await call('/api/newsroom/export?format=csv');assert.equal(response.status,200);assert.match(await response.text(),/\u0027=HYPERLINK/);
  assert.equal((await call('/api/newsroom/backups/restore','POST',{archive:'bad',password:'long-enough-password'})).status,400);assert.equal(store.archiveCoverage().articleCount,1);
  const json=await(await call('/api/newsroom/export?format=json')).json();assert.equal(json.exported,1);assert.equal(json.truncated,false);assert.ok(!JSON.stringify(json).includes('credentials.key'));
});

test('saving a search and subscribing is atomic when alert validation fails',async t=>{
  const {call}=await api(t);
  assert.equal((await call('/api/newsroom/searches','POST',{name:'Invalid subscription',filters:{},subscribe:true})).status,400);
  assert.equal((await(await call('/api/newsroom/searches')).json()).searches.length,0);
  const response=await call('/api/newsroom/searches','POST',{name:'Valid subscription',filters:{query:'"نرخ بهره"',country:'US'},subscribe:true});assert.equal(response.status,201);
  const result=await response.json();assert.ok(result.rule.id);assert.equal((await(await call('/api/newsroom/rules')).json()).rules.length,1);
});

test('calendar imports respect UTC and named timezones, preserve source URLs, reject floating times and declare recurrence omissions',t=>{
  const calendar='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART;TZID=America/New_York:20261024T140000\r\nSUMMARY:Central bank statement\r\nURL:https://centralbank.example/event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:two\r\nDTSTART:20261024T140000\r\nSUMMARY:Floating event\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:three\r\nDTSTART:20261024T140000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Repeating event\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const result=parseCalendar(calendar,{id:'cal',name:'Official calendar',url:'https://centralbank.example/calendar.ics'});assert.equal(result.events.length,1);assert.equal(result.events[0].time,'2026-10-24T18:00:00.000Z');assert.equal(result.skipped,2);
  assert.throws(()=>parseCalendar('<html>Not calendar</html>',{}),/تقویم معتبر/);
});

test('feed parsing retains long publisher content and source-declared language',()=>{
  const text='source content '.repeat(300);const feed=`<rss><channel><language>ar</language><item><title>نشرة اقتصادية</title><link>https://news.example/long</link><description>short summary</description><content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[${text}]]></content:encoded></item></channel></rss>`;
  const [article]=parseFeed(feed,{id:'a',name:'Arabic'});assert.ok(article.fullText.length>1600);assert.equal(article.summary,'short summary');assert.equal(article.language,'ar');
});

test('public iCalendar connections validate real content, update stable event IDs, and report source failures',async t=>{
  let broken=false;
  const feed='BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:meeting\nDTSTART:20261025T140000Z\nSUMMARY:Official meeting\nEND:VEVENT\nEND:VCALENDAR';
  const {call}=await api(t,async()=>{if(broken)throw new Error('private connection detail');return feed;});
  assert.equal((await call('/api/newsroom/calendar/feeds','POST',{name:'Unsafe',url:'https://127.0.0.1/calendar.ics'})).status,400);
  const response=await call('/api/newsroom/calendar/feeds','POST',{name:'Official calendar',url:'https://calendar.example/feed.ics',country:'US'});assert.equal(response.status,201);
  let risk=await(await call('/api/newsroom/risk')).json();assert.equal(risk.calendar.length,1);assert.equal(risk.calendarFeeds[0].count,1);
  await call('/api/sync','POST',{});risk=await(await call('/api/newsroom/risk')).json();assert.equal(risk.calendar.length,1);
  broken=true;await call('/api/sync','POST',{});risk=await(await call('/api/newsroom/risk')).json();assert.ok(risk.calendarFeeds[0].lastError);assert.ok(!JSON.stringify(risk).includes('private connection detail'));
});

test('source health covers the entire archive and multilingual metadata is applied to newly ingested content',async t=>{
  const feed='<rss><channel><item><title>نشرة اقتصادية</title><link>https://news.example/arabic</link><description>تقرير اقتصادي</description></item></channel></rss>';
  const {store,call}=await api(t,async()=>feed);
  const response=await call('/api/sources','POST',{name:'Arabic source',url:'https://arabic.example/rss',language:'ar',topics:'economy',publisher:'group-one'});assert.equal(response.status,201);const source=await response.json();assert.equal(source.language,'ar');
  await call('/api/sync','POST',{});assert.equal(store.articles({sourceId:source.id})[0].language,'ar');
  const health=await(await call('/api/newsroom/health')).json();const row=health.sources.find(s=>s.id===source.id);assert.equal(row.status,'healthy');assert.equal(row.articleCount,1);assert.equal(row.publisher,'group-one');
});

test('upgrading a v2 database makes a consistent safety copy and preserves bookmarks and the credentials key',t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'dideban-v2-upgrade-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let store=new Store(directory);store.addArticles([record('previous')]);store.saveArticle('previous',true);store.setConnection('x','Existing account',{token:'preserved-key'});store.close();
  const key=readFileSync(path.join(directory,'credentials.key'));
  const old=new DatabaseSync(path.join(directory,'news.sqlite'));old.exec('DROP TABLE research_items');old.close();
  store=new Store(directory);t.after(()=>store.close());assert.deepEqual(readFileSync(path.join(directory,'credentials.key')),key);assert.equal(store.article('previous').saved,true);assert.equal(store.getConnection('x').token,'preserved-key');
  const snapshot=new DatabaseSync(path.join(directory,'news.pre-v3.sqlite'),{readOnly:true});assert.equal(snapshot.prepare('SELECT saved FROM articles WHERE id=?').get('previous').saved,1);snapshot.close();
});
