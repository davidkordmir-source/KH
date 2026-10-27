import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {telegramChannel,parseTelegramPublic,publicSourceSpec,collectPublicSource} from '../server/public-social.mjs';
const source={id:'public-test',name:'کانال آزمون',url:'https://t.me/s/test_channel',platform:'telegram-public'};
const html=`<html><body><div class="tgme_channel_info_header_title">Public publisher</div><a class="tgme_channel_info_header_photo"><img src="https://cdn.example/avatar.jpg"></a>
<div class="tgme_widget_message" data-post="test_channel/12"><div class="tgme_widget_message_text">خبر واقعی کانال<br><b>درباره اقتصاد ایران</b><a href="https://news.example/report">اصل گزارش</a><script>bad()</script></div><a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.example/photo.jpg')"></a><video src="https://cdn.example/video.mp4" poster="https://cdn.example/poster.jpg"></video><a class="tgme_widget_message_date"><time datetime="2026-10-27T10:00:00Z"></time></a></div>
<div class="tgme_widget_message" data-post="another_channel/13"><div class="tgme_widget_message_text">Wrong channel</div></div></body></html>`;
test('Telegram input is normalized and rejects invitations, credentials and non-Telegram hosts',()=>{
 for(const input of ['@Test_Channel','https://t.me/Test_Channel/12','https://t.me/s/test_channel'])assert.equal(telegramChannel(input),'test_channel');
 for(const input of ['https://t.me.attacker.example/test_channel','https://user:secret@t.me/test_channel','https://t.me/+invite','https://t.me/joinchat/abc','https://t.me/c/1234/1','https://t.me/share/url','http://t.me/test_channel','ab','https://127.0.0.1/test_channel'])assert.throws(()=>telegramChannel(input),input);
});
test('public Telegram previews retain actual text, media, dates and attribution without executing scripts',()=>{
 const items=parseTelegramPublic(html,source);assert.equal(items.length,1);const article=items[0];assert.match(article.title,/خبر واقعی کانال/);assert.ok(!article.summary.includes('bad()'));assert.equal(article.url,'https://t.me/test_channel/12');assert.equal(article.sourceId,source.id);assert.equal(article.sourceIconUrl,'https://cdn.example/avatar.jpg');assert.equal(article.media.length,2);assert.equal(article.publishedAt,'2026-10-27T10:00:00.000Z');assert.equal(article.references[0].url,'https://news.example/report');
 const unknown=parseTelegramPublic(html.replace('2026-10-27T10:00:00Z','invalid').replace('https://cdn.example/photo.jpg','https://127.0.0.1/private'),source)[0];assert.equal(unknown.publishedAtKnown,false);assert.equal(unknown.imageUrl,null);
 assert.throws(()=>parseTelegramPublic('<html>Open in Telegram or log in</html>',source),error=>error.status===422);
});
test('YouTube handles resolve only publisher-advertised channel feeds and cannot forward to another host',async()=>{
 const id='UC'+'a'.repeat(22),calls=[];
 const spec=await publicSourceSpec('youtube','@testhandle',async(url,options)=>{calls.push(url);assert.deepEqual(options.allowedHosts,['www.youtube.com']);return `<link rel="alternate" href="https://www.youtube.com/feeds/videos.xml?channel_id=${id}">`;});
 assert.equal(spec.url,`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);assert.equal(calls.length,1);
 await assert.rejects(()=>publicSourceSpec('youtube','https://www.youtube.com.attacker.example/channel/'+id,async()=>{throw Error('Must not fetch');}));
 await assert.rejects(()=>publicSourceSpec('youtube','@testhandle',async()=>`<link rel="alternate" href="https://attacker.example/feeds/videos.xml?channel_id=${id}">`));
 const mastodon=await publicSourceSpec('mastodon','https://social.example/@reporter',async()=>{throw Error('Must not fetch');});assert.equal(mastodon.url,'https://social.example/@reporter.rss');
});
test('public source API never requires or stores keys; rejects blocked sources and keeps bookmarks across refresh',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dideban-public-social-')),calls=[];
 const instance=createApp({directory,urlValidator:async value=>{const url=new URL(value);if(url.hostname==='127.0.0.1')throw Error('private');return{url};},fetcher:async(url,options)=>{calls.push({url,options});if(url.includes('/s/empty_channel'))return '<html>private</html>';return html;}});
 for(const item of instance.store.sources())instance.store.updateSource(item.id,{enabled:false});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(base+'/api/public-connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const response=await post({type:'telegram',input:'@test_channel',label:'منبع عمومی'});assert.equal(response.status,201);const payload=await response.json();assert.equal(payload.scope,'public-only');assert.equal(payload.imported,1);assert.equal(payload.source.platform,'telegram-public');assert.equal(instance.store.connections().filter(c=>c.connected).length,0);
 assert.equal(calls[0].url,'https://t.me/s/test_channel');assert.deepEqual(calls[0].options.allowedHosts,['t.me']);assert.ok(!calls[0].options.headers?.Authorization);
 const article=instance.store.articles()[0];instance.store.saveArticle(article.id,true);await instance.sync();assert.equal(instance.store.articles()[0].saved,true);assert.equal(instance.store.articles()[0].platform,'telegram');
 assert.equal((await post({type:'telegram',input:'https://t.me/test_channel'})).status,409);
 assert.equal((await post({type:'telegram',input:'@empty_channel'})).status,422);assert.equal(instance.store.sources().filter(s=>s.platform==='telegram-public').length,1);
 assert.equal((await post({type:'mastodon',input:'https://127.0.0.1/@reporter'})).status,400);
});
