import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { desktopRequest } from './desktop.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function passwordHash(password,salt=randomBytes(16).toString('hex')) {
  if(typeof password!=='string'||password.length<16||password.length>256)throw new Error('گذرواژهٔ دسترسی باید بین ۱۶ و ۲۵۶ نویسه باشد.');
  return `${salt}:${scryptSync(password,salt,32).toString('hex')}`;
}
export function createAccess({store,publicMode=process.env.APP_PUBLIC_MODE==='1',password=process.env.APP_ADMIN_PASSWORD||'',passwordFile=process.env.APP_ADMIN_PASSWORD_FILE||''}={}) {
  if(passwordFile)password=readFileSync(passwordFile,'utf8').trim();
  if(password){const old=store.getSetting('accessPasswordHash');if(!old||!matches(password,old)){store.setSetting('accessPasswordHash',passwordHash(password));store.db.exec('DELETE FROM login_sessions');}}
  if(publicMode&&!store.getSetting('accessPasswordHash'))throw new Error('APP_PUBLIC_MODE requires a configured access password.');
  const attempts=new Map();
  function matches(input,encoded) {try{const [salt,hash]=encoded.split(':');if(typeof input!=='string'||input.length>256)return false;return timingSafeEqual(scryptSync(input,salt,32),Buffer.from(hash,'hex'));}catch{return false;}}
  const required=()=>!!store.getSetting('accessPasswordHash');
  function session(req) {const cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('dideban_session='))?.slice(16);if(!cookie||!/^[a-f0-9]{64}$/.test(cookie))return false;const record=store.db.prepare('SELECT expires_at FROM login_sessions WHERE token_hash=?').get(digest(cookie));return !!record&&Date.parse(record.expires_at)>Date.now();}
  function register(app) {
    app.get('/api/access/status',(req,res)=>res.json({required:required(),authenticated:!required()||session(req),publicMode}));
    app.post('/api/access/login',(req,res)=>{
      const key=req.socket.remoteAddress||'local',now=Date.now(),prior=attempts.get(key)||{count:0,since:now};
      if(now-prior.since>900000){prior.count=0;prior.since=now;}
      if(prior.count>=8)return res.status(429).json({error:'تلاش‌های ورود زیاد است؛ پانزده دقیقه بعد دوباره امتحان کنید.'});
      if(!required())return res.json({authenticated:true});
      if(!matches(req.body?.password,store.getSetting('accessPasswordHash'))){prior.count++;attempts.set(key,prior);return res.status(401).json({error:'گذرواژه درست نیست.'});}
      attempts.delete(key);const token=randomBytes(32).toString('hex'),expires=new Date(now+86400000).toISOString();
      store.db.prepare('DELETE FROM login_sessions WHERE expires_at<?').run(new Date().toISOString());
      store.db.prepare('INSERT INTO login_sessions VALUES(?,?,?)').run(digest(token),expires,new Date(now).toISOString());
      res.setHeader('Set-Cookie',`dideban_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${publicMode?'; Secure':''}`);res.json({authenticated:true});
    });
    app.post('/api/access/logout',(req,res)=>{const token=String(req.headers.cookie||'').match(/(?:^|;\s*)dideban_session=([a-f0-9]{64})/)?.[1];if(token)store.db.prepare('DELETE FROM login_sessions WHERE token_hash=?').run(digest(token));res.setHeader('Set-Cookie',`dideban_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${publicMode?'; Secure':''}`);res.json({authenticated:false});});
    app.use('/api',(req,res,next)=>{if(req.path==='/health'||!required()||session(req)||desktopRequest(req))return next();res.status(401).json({error:'برای دسترسی به بانک خبر وارد شوید.'});});
  }
  return {register,required,publicMode};
}
