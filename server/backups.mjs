import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, chmodSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

const TABLES=['sources','articles','settings','connections','story_state','article_versions','research_items','profiles','watch_rules','news_alerts','translations','calendar_events','saved_searches'];
const MAGIC=Buffer.from('DIDEBAN3');
function passwordKey(password,salt) {
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('گذرواژهٔ پشتیبان باید بین ۱۲ و ۲۵۶ نویسه باشد.');
  return scryptSync(password,salt,32);
}
export function createBackupService(store) {
  const directory=path.join(store.directory,'backups');mkdirSync(directory,{recursive:true,mode:0o700});
  const list=()=>readdirSync(directory).filter(name=>/^news-\d{8}-\d+\.sqlite$/.test(name)).map(name=>({name,size:statSync(path.join(directory,name)).size,createdAt:statSync(path.join(directory,name)).mtime.toISOString()})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  function snapshot(force=false) {
    const settings=store.getSetting('backupPreferences',{enabled:true,retention:7});
    const day=new Date().toISOString().slice(0,10).replaceAll('-','');
    if(!force&&(!settings.enabled||list().some(item=>item.name.startsWith(`news-${day}-`))))return null;
    const name=`news-${day}-${Date.now()}.sqlite`,file=path.join(directory,name);
    store.db.prepare('VACUUM INTO ?').run(file);chmodSync(file,0o600);
    for(const old of list().slice(Math.min(30,Math.max(2,Number(settings.retention)||7))))rmSync(path.join(directory,old.name));
    store.setSetting('lastBackupAt',new Date().toISOString());return {name,size:statSync(file).size};
  }
  function exportArchive(password) {
    const salt=randomBytes(16),iv=randomBytes(12),key=passwordKey(password,salt);
    const temp=mkdtempSync(path.join(tmpdir(),'dideban-export-'));
    try {
      const file=path.join(temp,'news.sqlite');store.db.prepare('VACUUM INTO ?').run(file);chmodSync(file,0o600);
      const data=readFileSync(file);if(data.length>48*1024*1024)throw new Error('این خروجی قابل‌حمل تا ۴۸ مگابایت پایگاه داده را پشتیبانی می‌کند؛ برای آرشیو بزرگ‌تر از پوشهٔ داده پشتیبان بگیرید.');
      const payload=Buffer.from(JSON.stringify({format:3,createdAt:new Date().toISOString(),database:data.toString('base64'),key:store.key.toString('base64')}));
      const cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(payload),cipher.final()]);
      return Buffer.concat([MAGIC,salt,iv,cipher.getAuthTag(),body]);
    }finally{rmSync(temp,{recursive:true,force:true});}
  }
  function restoreDatabase(data,key) {
    const temp=mkdtempSync(path.join(tmpdir(),'dideban-restore-'));
    let source;
    try {
      if(data.length>48*1024*1024||data.subarray(0,16).toString()!=='SQLite format 3\u0000')throw new Error('پایگاه پشتیبان معتبر نیست.');
      const file=path.join(temp,'news.sqlite');writeFileSync(file,data,{mode:0o600});source=new DatabaseSync(file,{readOnly:true});source.exec('PRAGMA trusted_schema=OFF;');
      if(Object.values(source.prepare('PRAGMA quick_check').get())[0]!=='ok')throw new Error('بررسی سلامت پشتیبان ناموفق بود.');
      const imported=new Map();
      for(const table of TABLES) {
        const columns=store.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        const existing=source.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        if(columns.some(c=>!existing.includes(c)))throw new Error('ساختار این پشتیبان با نسخهٔ برنامه سازگار نیست.');
        const rows=source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
        if(table==='connections')for(const row of rows) {
          const [iv,tag,body]=row.secret.split('.').map(value=>Buffer.from(value,'base64'));
          const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
          const secret=JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8'));
          row.secret=store.encrypt(secret);
        }
        if(table==='articles')for(const row of rows) { const item=JSON.parse(row.payload);if(!item.title||!/^https?:\/\//.test(item.url))throw new Error('خبر نامعتبر در پشتیبان وجود دارد.'); }
        imported.set(table,{columns,rows});
      }
      snapshot(true);
      store.db.exec('BEGIN');
      try {
        for(const table of [...TABLES].reverse())store.db.exec(`DELETE FROM ${table}`);
        for(const [table,{columns,rows}] of imported) {
          const insert=store.db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
          for(const row of rows)insert.run(...columns.map(c=>row[c]));
        }
        store.db.exec('COMMIT');
      }catch(error){store.db.exec('ROLLBACK');throw error;}
      return {restored:true,articleCount:store.archiveCoverage().articleCount};
    }finally{source?.close();rmSync(temp,{recursive:true,force:true});}
  }
  function restoreArchive(archive,password) {
    if(typeof archive!=='string'||archive.length>94*1024*1024)throw new Error('اندازهٔ پشتیبان معتبر نیست.');
    const data=Buffer.from(archive,'base64');if(!data.subarray(0,8).equals(MAGIC)||data.length<53)throw new Error('قالب فایل پشتیبان معتبر نیست.');
    const key=passwordKey(password,data.subarray(8,24));let payload;
    try {const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(24,36));decipher.setAuthTag(data.subarray(36,52));payload=JSON.parse(Buffer.concat([decipher.update(data.subarray(52)),decipher.final()]).toString('utf8'));}catch{throw new Error('گذرواژه نادرست است یا فایل پشتیبان آسیب دیده است.');}
    if(payload.format!==3||typeof payload.key!=='string'||typeof payload.database!=='string')throw new Error('محتوای پشتیبان معتبر نیست.');
    return restoreDatabase(Buffer.from(payload.database,'base64'),Buffer.from(payload.key,'base64'));
  }
  return {list,snapshot,exportArchive,restoreArchive,restoreLocal:name=>{
    if(!list().some(item=>item.name===name))throw new Error('پشتیبان محلی پیدا نشد.');
    return restoreDatabase(readFileSync(path.join(directory,name)),store.key);
  }};
}
