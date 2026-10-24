import { randomUUID } from 'node:crypto';
import { safeMediaUrl } from './feeds.mjs';

export function decodeUpload(input,kind) {
  if(typeof input.base64!=='string'||input.base64.length>34*1024*1024||!/^[-\w .\u0600-\u06ff]{1,160}\.[a-z0-9]{2,5}$/i.test(String(input.name||'')))throw new Error('نام یا اندازهٔ فایل معتبر نیست.');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw new Error('ساختار فایل معتبر نیست.');
  const data=Buffer.from(input.base64,'base64');
  const maximum=(kind==='speech'?24:8)*1024*1024;if(!data.length||data.length>maximum)throw new Error(`حجم فایل باید کمتر از ${kind==='speech'?24:8} مگابایت باشد.`);
  const ext=input.name.split('.').at(-1).toLowerCase();let mime;
  if(kind==='speech') {
    if(ext==='mp3'&&(data.subarray(0,3).toString()==='ID3'||data[0]===0xff&&(data[1]&0xe0)===0xe0))mime='audio/mpeg';
    if(ext==='wav'&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WAVE')mime='audio/wav';
    if(['mp4','m4a'].includes(ext)&&data.subarray(4,8).toString()==='ftyp')mime=ext==='mp4'?'video/mp4':'audio/mp4';
    if(ext==='webm'&&data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))mime='video/webm';
    if(ext==='ogg'&&data.subarray(0,4).toString()==='OggS')mime='audio/ogg';
    if(ext==='flac'&&data.subarray(0,4).toString()==='fLaC')mime='audio/flac';
  }else {
    if(['jpg','jpeg'].includes(ext)&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)mime='image/jpeg';
    if(ext==='png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
    if(ext==='webp'&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')mime='image/webp';
    if(ext==='pdf'&&data.subarray(0,5).toString()==='%PDF-')mime='application/pdf';
  }
  if(!mime)throw new Error('قالب واقعی فایل با نوع رسانهٔ پشتیبانی‌شده سازگار نیست.');
  return {data,mime,name:`upload.${ext}`,displayName:input.name};
}
const seconds=value=>{const parts=value.replace(',','.').split(':').map(Number);return parts.length===3?parts[0]*3600+parts[1]*60+parts[2]:parts.length===2?parts[0]*60+parts[1]:NaN;};
export function parseSubtitles(value) {
  if(typeof value!=='string'||value.length>500000)throw new Error('اندازهٔ زیرنویس معتبر نیست.');
  const segments=[];
  for(const block of value.replace(/^\uFEFF/,'').replaceAll('\r','').split(/\n\s*\n/)) {
    const lines=block.split('\n'),index=lines.findIndex(line=>/-->/.test(line));if(index<0)continue;
    const range=lines[index].match(/((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})/);if(!range)continue;
    const start=seconds(range[1]),end=seconds(range[2]),text=lines.slice(index+1).join(' ').replace(/<[^>]+>/g,'').trim();
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&text)segments.push({start,end,text});
  }
  if(!segments.length)throw new Error('زیرنویس زمان‌بندی‌شدهٔ SRT یا VTT معتبر پیدا نشد.');
  return segments.sort((a,b)=>a.start-b.start).slice(0,10000);
}
export function createMediaLab({store,intelligence}) {
  function save(input,result,kind,provider) {
    if(input.sourceUrl&&!safeMediaUrl(input.sourceUrl))throw new Error('پیوند منبع باید HTTPS عمومی باشد.');
    if(input.articleId&&!store.article(input.articleId))throw new Error('خبر پیوست‌شده پیدا نشد.');
    const value={id:randomUUID(),name:String(input.name||'متن واردشده').slice(0,160),kind,provider,sourceUrl:input.sourceUrl||'',articleId:input.articleId||null,createdAt:new Date().toISOString(),...result,text:result.text.slice(0,500000)};
    store.db.prepare('INSERT INTO media_transcripts VALUES(?,?)').run(value.id,JSON.stringify(value));return value;
  }
  let busy=false;
  async function process(input,kind) {
    if(busy)throw Object.assign(new Error('پردازش رسانهٔ قبلی هنوز تمام نشده است.'),{status:409});
    const file=decodeUpload(input,kind);busy=true;
    try {const result=kind==='speech'?await intelligence.speech(file):await intelligence.chatOcr(file);return save(input,result,kind,kind==='speech'?'OpenAI Whisper':'OpenAI vision OCR');}finally{busy=false;}
  }
  function importText(input) {const segments=parseSubtitles(input.text);return save(input,{text:segments.map(s=>s.text).join('\n'),segments,language:''},'subtitles','user-imported SRT/VTT');}
  function list(query='') {
    if(typeof query!=='string'||query.length>250)throw new Error('جست‌وجوی متن معتبر نیست.');
    const where=query?" WHERE instr(news_normalize(json_extract(payload,'$.text')||' '||json_extract(payload,'$.name')),news_normalize(?))>0":'',args=query?[query]:[];
    const rows=store.db.prepare(`SELECT payload FROM media_transcripts${where} ORDER BY rowid DESC LIMIT 50`).all(...args).map(row=>{const {text,segments,...item}=JSON.parse(row.payload);return {...item,excerpt:text.slice(0,250),segmentCount:segments?.length||0};});
    return {items:rows,total:Number(store.db.prepare(`SELECT COUNT(*) AS n FROM media_transcripts${where}`).get(...args).n)};
  }
  function get(id){const row=store.db.prepare('SELECT payload FROM media_transcripts WHERE id=?').get(id);if(!row)throw Object.assign(new Error('متن رسانه پیدا نشد.'),{status:404});return JSON.parse(row.payload);}
  return {process,importText,list,get,isBusy:()=>busy,remove:id=>store.db.prepare('DELETE FROM media_transcripts WHERE id=?').run(id).changes};
}
