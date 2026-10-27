import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';
import {parseGoogleTranslation,translateWithGoogleWeb,googleTranslationLink} from '../server/google-web-translation.mjs';
import {profileSpec,parsePublicProfile,collectPublicProfile} from '../server/public-profile-pages.mjs';
const json=node=>`<html><script type="application/json">${JSON.stringify(node)}</script></html>`;
const ig=profileSpec('instagram','@reporter');
const post={shortcode:'ABC_123',caption:{text:'Public report from the publisher'},taken_at:1793095200,user:{username:'reporter',is_private:false},image_versions2:{candidates:[{url:'https://cdn.example/actual.jpg'}]}};
const x=profileSpec('x','https://x.com/reporter');
const tweet={id_str:'12345',full_text:'Public X report',created_at:'2026-10-27T10:00:00Z',user:{screen_name:'reporter',profile_image_url_https:'https://cdn.example/avatar.jpg'},extended_entities:{media:[{type:'photo',media_url_https:'https://cdn.example/actual.jpg'}]}};
test('Google web translation accepts only a real result container and does not parse CAPTCHA or consent as translations',async()=>{
 assert.equal(parseGoogleTranslation('<div class="result-container">خبر &amp; گزارش</div>'),'خبر & گزارش');
 for(const html of ['<html>Consent page</html>','<div class="result-container">Fake</div><form action="/sorry"></form>'])assert.throws(()=>parseGoogleTranslation(html));
 const calls=[];const result=await translateWithGoogleWeb({title:'Original',summary:'a'.repeat(3500)},'fa',async(url,options)=>{calls.push(url);assert.equal(new URL(url).hostname,'translate.google.com');assert.equal(new URL(url).pathname,'/m');assert.equal(new URL(url).searchParams.get('tl'),'fa');assert.deepEqual(options.allowedHosts,['translate.google.com']);assert.equal(options.headers,undefined);return '<div class="result-container">ترجمه</div>';});
 assert.equal(calls.length,4);assert.equal(result.truncated,true);assert.equal(result.characterLimit,3000);assert.equal(result.title,'ترجمه');assert.equal(new URL(googleTranslationLink('a & b')).searchParams.get('text'),'a & b');
 await assert.rejects(()=>translateWithGoogleWeb({title:'a',summary:'b'},'fa',async()=>'<html>Verification required</html>'),error=>error.status===502);
});
test('public Instagram parsing accepts only the selected publisher/posts and skips private profiles, ads and biographies',()=>{
 const source={...ig,id:'ig',name:'Instagram reporter'};
 const items=parsePublicProfile(json([post,{...post,shortcode:'OTHER_1',user:{username:'someoneelse'}},{username:'reporter',biography:'Not news'}]),source);
 assert.equal(items.length,1);assert.equal(items[0].url,'https://www.instagram.com/p/ABC_123/');assert.equal(items[0].imageUrl,'https://cdn.example/actual.jpg');assert.equal(items[0].publishedAtKnown,true);assert.equal(items[0].platform,'instagram');
 assert.throws(()=>parsePublicProfile(json([post,{username:'reporter',is_private:true}]),source),error=>error.code==='PRIVATE_PROFILE');
 assert.throws(()=>parsePublicProfile('<html><h1>Log in</h1><img src="/logo.jpg"></html>',source));
 assert.throws(()=>parsePublicProfile(json(post),{...source,url:'https://www.instagram.com/p/WRONG_1/'}));
 const direct={...source,url:'https://www.instagram.com/p/ABC_123/'};
 assert.equal(parsePublicProfile(json(post),direct).length,1);
 assert.throws(()=>parsePublicProfile(json({...post,user:{username:'reporter',is_private:true}}),direct),error=>error.code==='PRIVATE_PROFILE');
 const schema={'@type':'SocialMediaPosting',url:'https://www.instagram.com/p/SCHEMA_1/',articleBody:'Structured publisher post',author:{url:'https://www.instagram.com/reporter/'},datePublished:'2026-10-27T10:00:00Z',image:'https://cdn.example/schema.jpg'};assert.equal(parsePublicProfile(json(schema),source)[0].imageUrl,'https://cdn.example/schema.jpg');
 assert.throws(()=>parsePublicProfile(json({...schema,author:{url:'https://www.instagram.com/other/'}}),source));
 for(const input of ['https://instagram.com.attacker.example/reporter','https://user:secret@instagram.com/reporter','http://instagram.com/reporter','https://www.instagram.com/accounts/login'])assert.throws(()=>profileSpec('instagram',input));
});
test('X public widgets preserve genuine tweet media and reject other users and protected records',async()=>{
 const source={...x,id:'x',name:'X reporter'},items=parsePublicProfile(json({props:{pageProps:{timeline:{entries:[{tweet}, {tweet:{...tweet,id_str:'2',user:{screen_name:'someoneelse'}}},{tweet:{...tweet,id_str:'3',user:{screen_name:'reporter',protected:true}}}]}}}}),source);
 assert.equal(items.length,1);assert.equal(items[0].url,'https://x.com/reporter/status/12345');assert.equal(items[0].media[0].url,'https://cdn.example/actual.jpg');
 const calls=[];await collectPublicProfile(source,async(url,options)=>{calls.push(url);assert.ok(options.allowedHosts.includes(new URL(url).hostname));assert.equal(options.headers,undefined);return json(tweet);});assert.equal(new URL(calls[0]).hostname,'syndication.twitter.com');
 for(const input of ['https://x.com.attacker.example/reporter','https://user:secret@x.com/reporter','https://x.com/login','https://127.0.0.1/reporter'])assert.throws(()=>profileSpec('x',input));
});
test('keyless translation API caches real results, preserves originals and invalidates on publisher edits without a translator connection',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dideban-google-web-'));let calls=0;
 const instance=createApp({directory,urlValidator:async value=>({url:new URL(value)}),fetcher:async()=>{calls++;return '<div class="result-container">ترجمهٔ آزمایشی</div>';}});
 instance.store.addArticles([{id:'article',title:'Original headline',summary:'Original publisher body',url:'https://news.example/1',publishedAt:'2026-10-27T10:00:00Z',sourceId:'source',sourceName:'Source',platform:'rss',language:'en',category:'world'}]);
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,translate=()=>fetch(base+'/api/newsroom/articles/article/translate-google',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"target":"fa"}'});
 assert.equal((await translate()).status,200);assert.equal(calls,2);await translate();assert.equal(calls,2);assert.equal(instance.store.getConnection('translator'),null);assert.equal(instance.store.article('article').title,'Original headline');
 const dashboard=await(await fetch(base+'/api/dashboard')).json();assert.equal(dashboard.articles[0].translatedTitle,'ترجمهٔ آزمایشی');
 instance.store.addArticles([{...instance.store.article('article'),title:'Publisher revision'}]);await translate();assert.equal(calls,4);
});
test('Instagram and X are saved only when genuine public posts are available, and refresh retains saved markers',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dideban-public-profiles-'));
 const instance=createApp({directory,urlValidator:async value=>({url:new URL(value)}),fetcher:async url=>url.includes('empty')?'<html>Login</html>':url.includes('twitter.com')?json(tweet):json(post)});
 for(const source of instance.store.sources())instance.store.updateSource(source.id,{enabled:false});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`,connect=body=>fetch(base+'/api/public-connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await connect({type:'instagram',input:'reporter'})).status,201);assert.equal((await connect({type:'x',input:'reporter'})).status,201);assert.equal((await connect({type:'instagram',input:'empty'})).status,422);
 const records=instance.store.articles();assert.equal(records.length,2);instance.store.saveArticle(records[0].id,true);await instance.sync();assert.equal(instance.store.article(records[0].id).saved,true);assert.equal(instance.store.connections().filter(c=>c.connected).length,0);
});
