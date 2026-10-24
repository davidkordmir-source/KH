import { createHash, randomUUID } from 'node:crypto';
import { safeMediaUrl } from './feeds.mjs';

function calendarTime(value, zone) {
  const match=value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if(!match)return null;
  const [,year,month,day,hour='12',minute='00',second='00',utc]=match;
  const fields=[year,month,day,hour,minute,second].map(Number),target=Date.UTC(fields[0],fields[1]-1,fields[2],fields[3],fields[4],fields[5]);
  if(!Number.isFinite(target)||new Date(target).getUTCMonth()!==fields[1]-1||fields[3]>23||fields[4]>59||fields[5]>59)return null;
  if(utc||!match[4])return new Date(target).toISOString();
  if(!zone)return null; // Floating times have no reliable timezone; do not guess.
  try {
    const formatter=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    let candidate=target;
    for(let i=0;i<3;i++) {
      const parts=formatter.formatToParts(new Date(candidate)),get=type=>Number(parts.find(p=>p.type===type)?.value);
      const asUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
      const difference=target-asUtc;if(!difference)return new Date(candidate).toISOString();candidate+=difference;
    }
    return null;
  }catch{return null;}
}
const unescapeText=value=>String(value||'').replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1').replace(/<[^>]+>/g,'').trim();
export function parseCalendar(body,feed) {
  if(!/^BEGIN:VCALENDAR\s*$/m.test(body)||body.length>1000000)throw new Error('منبع باید تقویم معتبر iCalendar باشد.');
  const unfolded=body.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,''),events=[];let skipped=0;
  for(const match of unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)) {
    if(events.length>=500){skipped++;continue;}
    const values={},params={};
    for(const line of match[1].split('\n')) {const colon=line.indexOf(':');if(colon<0)continue;const [key,...attributes]=line.slice(0,colon).split(';');values[key]=line.slice(colon+1);params[key]=attributes;}
    const zone=params.DTSTART?.find(a=>a.startsWith('TZID='))?.slice(5).replaceAll('"','');
    const time=values.DTSTART&&calendarTime(values.DTSTART,zone),title=unescapeText(values.SUMMARY).slice(0,200);
    // Recurrence expansion requires provider-specific exception handling.
    if(!time||!title||values.RRULE){skipped++;continue;}
    events.push({id:'ical-'+createHash('sha256').update(`${feed.id}|${values.UID||title}|${values.DTSTART}`).digest('hex').slice(0,24),title,time,country:feed.country||'',url:safeMediaUrl(values.URL)||feed.url,note:unescapeText(values.DESCRIPTION).slice(0,1000),origin:'ical',feedId:feed.id,sourceName:feed.name,allDay:!values.DTSTART.includes('T'),cancelled:values.STATUS==='CANCELLED'});
  }
  return {events,skipped};
}
export function createCalendarService({store,fetcher}) {
  const feeds=()=>store.getSetting('calendarFeeds',[]);
  async function ingest(feed) {
    const body=await fetcher(feed.url,{maxBytes:1000000});const parsed=parseCalendar(body,feed);
    const insert=store.db.prepare('INSERT INTO calendar_events(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
    store.db.exec('BEGIN');try {for(const event of parsed.events)insert.run(event.id,JSON.stringify(event));store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
    return {count:parsed.events.length,skipped:parsed.skipped};
  }
  async function add(input) {
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!safeMediaUrl(input.url)||input.country&&!/^[A-Z]{2}$/.test(input.country))throw new Error('نام، کد کشور یا نشانی HTTPS تقویم معتبر نیست.');
    if(feeds().length>=20)throw new Error('حداکثر ۲۰ تقویم عمومی قابل اتصال است.');
    if(feeds().some(feed=>feed.url===input.url))throw new Error('این تقویم قبلاً متصل شده است.');
    const feed={id:randomUUID(),name:input.name.trim(),url:input.url,country:input.country||''};
    const result=await ingest(feed);store.setSetting('calendarFeeds',[...feeds(),{...feed,...result,lastFetchedAt:new Date().toISOString(),lastError:null}]);return {...feed,...result};
  }
  async function sync() {
    const results=[];
    for(const feed of feeds()) {try{results.push({...feed,...await ingest(feed),lastFetchedAt:new Date().toISOString(),lastError:null});}catch{results.push({...feed,lastError:'دریافت تقویم انجام نشد؛ نشانی، قالب و دسترسی منبع را بررسی کنید.'});}}
    // A feed may have been removed while the network request was running.
    const current=feeds();store.setSetting('calendarFeeds',current.map(feed=>results.find(r=>r.id===feed.id)||feed));return results;
  }
  return {feeds,add,sync,remove:id=>store.setSetting('calendarFeeds',feeds().filter(f=>f.id!==id))};
}
