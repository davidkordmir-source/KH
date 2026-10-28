import {createBrowserReader} from './browser-reader.mjs';
import { timingSafeEqual } from 'node:crypto';
import { createUpdater } from './updater.mjs';
export function desktopRequest(req,secret=process.env.DIDEBAN_DESKTOP_SECRET||'') {
  const supplied=String(req.headers['x-dideban-desktop']||''),peer=req.socket.remoteAddress;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)||secret.length<32||supplied.length!==secret.length)return false;
  return timingSafeEqual(Buffer.from(secret),Buffer.from(supplied));
}
export function createDesktop({store,fetcher,backups,isBusy,shutdown=()=>process.emit('SIGTERM')}) {
  const updater=createUpdater({store,fetcher,backups});
  const reader=createBrowserReader({store});
  const route=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
  function register(app) {
    reader.registerPublic(app,route);
    app.get('/api/lab/desktop',(_req,res)=>res.json(updater.status()));
    app.put('/api/lab/desktop/preferences',route((req,res)=>res.json(updater.setPreferences(req.body||{}))));
    app.post('/api/lab/desktop/check',route(async(_req,res)=>res.json(await updater.check())));
    app.post('/api/lab/desktop/prepare',route(async(_req,res)=>res.json(await updater.prepare())));
    app.use('/api/desktop',(req,res,next)=>desktopRequest(req)?next():res.status(403).json({error:'این فرمان فقط از راه‌انداز محلی ویندوز مجاز است.'}));
    reader.registerDesktop(app,route);
    app.get('/api/desktop/status',(_req,res)=>res.json(updater.status(true)));
    app.post('/api/desktop/before-install',route((_req,res)=>{if(isBusy())return res.status(409).json({error:'جمع‌آوری یا پردازش هنوز در حال انجام است.'});res.json(updater.beforeInstall());}));
    app.post('/api/desktop/shutdown',(_req,res)=>{res.json({stopping:true});setTimeout(shutdown,100).unref();});
  }
  return {register,updater};
}
