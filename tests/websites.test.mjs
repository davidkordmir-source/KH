import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseWebsite,collectWebsite,discoverArticleLinks} from '../server/websites.mjs';
import {createApp} from '../server/app.mjs';
const source={id:'site',name:'Publisher',url:'https://news.example/'};
const news={ '@type':'NewsArticle',headline:'Real publisher headline',url:'https://news.example/202610250001',description:'Publisher summary',datePublished:'2026-10-25T10:00:00Z',image:{url:'https://news.example/photo.jpg'},inLanguage:'en'};
const html=node=>`<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(node)}</script></head></html>`;

test('website collection preserves real publisher news and media while rejecting decoration, paywalls and foreign URLs',()=>{
 const items=parseWebsite(html({'@graph':[news,{'@type':'Organization',name:'Publisher',logo:'https://news.example/logo.jpg'},{...news,url:'https://evil.example/1'},{...news,url:'https://news.example/private',isAccessibleForFree:false}]}),source);
 assert.equal(items.length,1);assert.equal(items[0].title,news.headline);assert.equal(items[0].publishedAt,'2026-10-25T10:00:00.000Z');assert.equal(items[0].imageUrl,news.image.url);assert.equal(items[0].textScope,'publisher-website');
 const unknown=parseWebsite(html({...news,datePublished:undefined,image:'https://127.0.0.1/x.jpg'}),source)[0];assert.equal(unknown.publishedAtKnown,false);assert.equal(unknown.imageUrl,null);
 assert.deepEqual(parseWebsite('<html><h1>Site title</h1><img src="/decor.jpg"></html>',source),[]);
});
test('website article discovery is bounded, same-publisher, validates fetches and never fabricates success',async()=>{
 const home='<html>'+Array.from({length:12},(_,i)=>`<a href="/2026102500${10+i}"><h2>Headline</h2></a>`).join('')+'<a href="https://other.example/202610250999"><h2>External</h2></a></html>';
 const links=discoverArticleLinks(home,source.url);assert.equal(links.length,6);assert.ok(links.every(url=>url.startsWith(source.url)));
 const validated=[],calls=[];
 const result=await collectWebsite(source,{urlValidator:async url=>validated.push(url),fetcher:async(url,options)=>{calls.push(url);assert.deepEqual(options.allowedHosts,['news.example']);return html({...news,url});}},home);
 assert.equal(result.articles.length,6);assert.deepEqual(validated,calls);
 await assert.rejects(()=>collectWebsite(source,{fetcher:async()=>'<html>Login</html>',urlValidator:async()=>{}},'<html>Empty</html>'),error=>error.status===422);
});
test('adding a website ingests validated news immediately, syncs again and permits explicit link-only storage without claiming collection',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'dideban-websites-'));let calls=0;
 const instance=createApp({directory,urlValidator:async value=>{const url=new URL(value);if(url.hostname==='127.0.0.1')throw new Error('private');return{url};},fetcher:async()=>{calls++;return html(news);}});
 for(const existing of instance.store.sources())instance.store.updateSource(existing.id,{enabled:false});
 const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.store.close();rmSync(directory,{recursive:true,force:true});});
 const request=(body)=>fetch(`http://127.0.0.1:${server.address().port}/api/sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let response=await request({name:'Website',url:source.url});assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.platform,'website');assert.equal(instance.store.articles().length,1);assert.equal(instance.store.articles()[0].sourceId,saved.id);
 assert.equal((await request({name:'Duplicate',url:source.url})).status,409);
 response=await request({name:'Bookmark',url:'https://reference.example/',mode:'link'});assert.equal(response.status,201);const link=await response.json();assert.equal(link.platform,'website-link');assert.equal(link.enabled,false);
 const before=calls;await instance.sync();assert.equal(calls,before+1);
 assert.equal((await request({name:'Private',url:'https://127.0.0.1',mode:'link'})).status,400);
});
