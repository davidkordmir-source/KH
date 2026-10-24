import { createHash, verify, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
export function compareVersions(a,b) {const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;}
export function verifyManifest(document,publicKey) {
  if(!document||typeof document.payload!=='string'||typeof document.signature!=='string'||document.payload.length>20000)throw new Error('ساختار اطلاعیهٔ به‌روزرسانی معتبر نیست.');
  const bytes=Buffer.from(document.payload,'base64'),signature=Buffer.from(document.signature,'base64');
  if(!verify(null,bytes,publicKey,signature))throw new Error('امضای به‌روزرسانی معتبر نیست؛ هیچ فایلی اجرا نمی‌شود.');
  const payload=JSON.parse(bytes.toString('utf8'));
  if(payload.format!==1||!/^\d+\.\d+\.\d+$/.test(payload.version)||!Number.isFinite(Date.parse(payload.createdAt)))throw new Error('اطلاعات نسخه معتبر نیست.');
  const asset=payload.windows;
  if(!asset||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isInteger(asset.size)||asset.size<1024||asset.size>100*1024*1024)throw new Error('مشخصات فایل به‌روزرسانی معتبر نیست.');
  const expected=`https://raw.githubusercontent.com/davidkordmir-source/KH/v${payload.version}/downloads/Dideban-v${payload.version}-Setup-Windows-x64.exe`;
  if(asset.url!==expected)throw new Error('مقصد فایل به‌روزرسانی مجاز نیست.');return payload;
}
export function verifyInstaller(bytes,asset) {
  if(!Buffer.isBuffer(bytes)||bytes.length!==asset.size||bytes.subarray(0,2).toString()!=='MZ')throw new Error('حجم یا قالب نصب‌کننده با اطلاعیهٔ امضاشده یکسان نیست.');
  if(!timingSafeEqual(createHash('sha256').update(bytes).digest(),Buffer.from(asset.sha256,'hex')))throw new Error('هش نصب‌کننده صحیح نیست؛ فایل اجرا نمی‌شود.');return true;
}
export function createUpdater({store,fetcher,backups,platform=process.platform,publicKey=readFileSync(new URL('../desktop/update-public-key.pem',import.meta.url),'utf8'),version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version,desktop=!!process.env.DIDEBAN_DESKTOP_SECRET}) {
  const directory=path.join(store.directory,'updates');mkdirSync(directory,{recursive:true,mode:0o700});let latest=null,pending=null,lastCheck=0,error=null;
  const preferences=()=>store.getSetting('desktopPreferences',{autoUpdate:false});
  function status(privateDetails=false) {
    const ready=store.getSetting('preparedUpdate');
    return {current:version,latest:latest?.version||null,available:!!latest&&compareVersions(latest.version,version)>0,ready:!!ready&&compareVersions(ready.version,version)>0,preparedVersion:ready?.version||null,signatureVerified:!!latest,supported:platform==='win32'&&desktop,preferences:preferences(),lastCheck:lastCheck?new Date(lastCheck).toISOString():null,error,...(privateDetails&&ready?{installerPath:path.join(directory,ready.name),sha256:ready.sha256}:{})};
  }
  async function check() {
    try {
      const raw=await fetcher('https://raw.githubusercontent.com/davidkordmir-source/KH/main/updates/latest.json',{allowedHosts:['raw.githubusercontent.com'],maxBytes:30000});
      const verified=verifyManifest(JSON.parse(raw),publicKey),highest=store.getSetting('highestUpdateVersion',version);
      if(compareVersions(verified.version,highest)<0)throw new Error('اطلاعیه قدیمی‌تر از نسخهٔ معتبر قبلی است.');
      if(compareVersions(verified.version,highest)>0)store.setSetting('highestUpdateVersion',verified.version);
      latest=verified;lastCheck=Date.now();error=null;return status();
    }catch(reason){error='بررسی امضا و دریافت نسخهٔ جدید انجام نشد؛ اتصال شبکه یا اعتبار اطلاعیه را بررسی کنید.';throw reason;}
  }
  async function prepare() {
    if(platform!=='win32'||!desktop)throw Object.assign(new Error('نصب خودکار فقط از اجرای کنار ساعتِ نسخهٔ نصب‌شدهٔ ویندوز در دسترس است.'),{status:409});
    if(pending)return pending;
    pending=(async()=>{
      await check();if(!latest||compareVersions(latest.version,version)<=0)return status();
      const bytes=await fetcher(latest.windows.url,{allowedHosts:['raw.githubusercontent.com'],maxBytes:100*1024*1024,timeoutMs:120000,responseType:'buffer'});verifyInstaller(bytes,latest.windows);
      const name=`Dideban-${latest.version}-setup.exe`,temporary=path.join(directory,`${name}.partial`);writeFileSync(temporary,bytes,{mode:0o600});renameSync(temporary,path.join(directory,name));
      store.setSetting('preparedUpdate',{version:latest.version,name,sha256:latest.windows.sha256,size:latest.windows.size});return status();
    })().finally(()=>{pending=null;});return pending;
  }
  function beforeInstall() {
    const ready=store.getSetting('preparedUpdate');if(!ready||compareVersions(ready.version,version)<=0)throw new Error('نصب‌کنندهٔ آماده وجود ندارد.');
    if(!/^Dideban-\d+\.\d+\.\d+-setup\.exe$/.test(ready.name))throw new Error('مسیر نصب‌کننده معتبر نیست.');
    const filename=path.join(directory,ready.name);if(!existsSync(filename))throw new Error('فایل به‌روزرسانی پیدا نشد.');verifyInstaller(readFileSync(filename),{size:ready.size,sha256:ready.sha256});
    backups.snapshot(true);return status(true);
  }
  async function tick(){if(platform==='win32'&&desktop&&preferences().autoUpdate&&Date.now()-lastCheck>6*3600000){lastCheck=Date.now();try{await prepare();}catch{/* A failed update leaves the installed version running. */}}}
  return {status,check,prepare,beforeInstall,tick,isBusy:()=>!!pending,setPreferences:value=>{if(typeof value.autoUpdate!=='boolean')throw new Error('تنظیم به‌روزرسانی معتبر نیست.');store.setSetting('desktopPreferences',{autoUpdate:value.autoUpdate});return status();}};
}
