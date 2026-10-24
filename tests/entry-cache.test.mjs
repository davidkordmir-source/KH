import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,utimesSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

test('upgrades with equal HTML size and timestamp cannot reuse stale entry documents', async t => {
  const dir=mkdtempSync(path.join(os.tmpdir(),'dideban-cache-'));
  const html=path.join(dir,'index.html');
  writeFileSync(html,'<script src="/assets/old.js"></script>');
  const stamp=new Date('2026-10-22T00:00:00Z');utimesSync(html,stamp,stamp);
  const instance=createApp({directory:path.join(dir,'data'),distDirectory:dir});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));instance.store.close();rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const first=await fetch(base);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(first.headers.get('etag'),null);
  writeFileSync(html,'<script src="/assets/new.js"></script>');utimesSync(html,stamp,stamp);
  const updated=await fetch(base,{headers:{'If-Modified-Since':stamp.toUTCString(),'If-None-Match':'W/"stale-release"'}});
  assert.equal(updated.status,200);assert.match(await updated.text(),/new\.js/);
  const missing=await fetch(base+'/assets/old.js');assert.equal(missing.status,404);assert.doesNotMatch(missing.headers.get('content-type'),/html/);
});
