import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
import {createIntelligenceService,validateClaims} from '../server/intelligence.mjs';
import {verifyManifest,verifyInstaller} from '../server/updater.mjs';
import {parseSubtitles,decodeUpload} from '../server/media-lab.mjs';
import {extractReferences} from '../server/feeds.mjs';
import {buildProvenance} from '../server/provenance.mjs';
const article={id:'a',title:'گزارش تازه نفت و اقتصاد ایران',summary:'قیمت نفت در گزارش اقتصادی ایران بررسی شده است.',url:'https://news.example/a',sourceId:'fixture',sourceName:'News',publishedAt:new Date().toISOString(),language:'fa',category:'economy'};
function storeFor(t){const dir=mkdtempSync(path.join(tmpdir(),'lab-test-')),store=new Store(dir);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return store;}
test('archive assistant returns genuine source quotations and rejects invented citations',async t=>{
 const store=storeFor(t);store.addArticles([article]);const service=createIntelligenceService({store,fetcher:async()=>{throw Error('Unexpected API');}});
 const answer=await service.ask({question:'نفت ایران'});assert.equal(answer.claims[0].url,article.url);assert.ok((article.title+'\n'+article.summary).includes(answer.claims[0].quote));
 assert.equal(validateClaims([{articleId:'a',text:'Unsupported',quote:'invented text here'}],[article]).length,0);
 assert.equal((await service.ask({question:'فوتبال'})).insufficient,true);
});
test('semantic vectors group translated headlines without changing read flags',async t=>{
 const store=storeFor(t);store.addArticles([article,{...article,id:'b',url:'https://other.example/b',title:'Iran oil economy report released today',language:'en'}]);store.setConnection('intelligence','AI',{token:'test-only-key-that-is-not-real',embeddingModel:'text-embedding-3-small'});
 const service=createIntelligenceService({store,fetcher:async()=>JSON.stringify({data:[0,1].map(index=>({index,embedding:Array.from({length:512},(_,i)=>i===0?1:0)}))})});
 assert.equal((await service.index()).indexed,2);assert.equal(service.semanticEvents().events.length,1);assert.equal(store.article('b').read,false);
 store.addArticles([{...article,title:'عنوان کاملا تغییر یافته'}]);assert.equal(service.status().indexed,1);
});
test('subtitle timestamps and actual upload file signatures are validated',()=>{
 const result=parseSubtitles('1\n00:00:02,500 --> 00:00:05,000\nمتن سخنرانی\n');assert.equal(result[0].start,2.5);
 assert.throws(()=>decodeUpload({name:'fake.mp3',base64:Buffer.from('<html>fake</html>').toString('base64')},'speech'));
});
test('provenance uses real publisher links and explicit user attribution',()=>{
 const refs=extractReferences('<a href="https://original.example/story">Original report</a>',article.url);assert.equal(refs.length,1);
 const graph=buildProvenance([{...article,references:refs}],()=>({primaryUrl:'https://agency.example/release'}));assert.equal(graph.edges.length,2);assert.equal(graph.earliest.url,article.url);
});
test('update signatures, exact download destinations and binary hashes fail closed',()=>{
 const pair=generateKeyPairSync('ed25519'),binary=Buffer.alloc(2048);binary.write('MZ');
 const payload={format:1,version:'0.5.0',createdAt:new Date().toISOString(),windows:{url:'https://raw.githubusercontent.com/davidkordmir-source/KH/v0.5.0/downloads/Dideban-v0.5.0-Setup-Windows-x64.exe',sha256:createHash('sha256').update(binary).digest('hex'),size:binary.length}};
 const bytes=Buffer.from(JSON.stringify(payload)),wrapper={payload:bytes.toString('base64'),signature:sign(null,bytes,pair.privateKey).toString('base64')};assert.equal(verifyManifest(wrapper,pair.publicKey).version,'0.5.0');assert.ok(verifyInstaller(binary,payload.windows));
 assert.throws(()=>verifyManifest({...wrapper,payload:Buffer.from('{}').toString('base64')},pair.publicKey));binary[100]^=1;assert.throws(()=>verifyInstaller(binary,payload.windows));
});
test('protected archive requires a real login session and logout invalidates it',async t=>{
 const store=storeFor(t),instance=createApp({store,directory:store.directory,accessOptions:{password:'a-long-private-test-password'}}),server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/api/dashboard')).status,401);
 const login=await fetch(base+'/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'a-long-private-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,200);
 await fetch(base+'/api/access/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal((await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).status,401);
});
