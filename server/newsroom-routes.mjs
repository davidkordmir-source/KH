import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const route=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
const text=(value,max=250)=>{if(value===undefined||value==='')return undefined;if(typeof value!=='string'||value.length>max)throw new Error('فیلتر جست‌وجو معتبر نیست.');return value;};
export function archiveFilters(query,dateBound) {
  const from=dateBound(query.dateFrom),to=dateBound(query.dateTo,true);
  if(from&&to&&from>to)throw new Error('ابتدای بازه باید پیش از انتهای آن باشد.');
  const country=text(query.country,2);if(country&&!/^[a-z]{2}$/i.test(country))throw new Error('کد کشور معتبر نیست.');
  return {query:text(query.query),exclude:text(query.exclude),country,city:text(query.city,100),sourceId:text(query.sourceId,100),language:text(query.language,20),category:text(query.category,30),folder:text(query.folder,100),dateFrom:from,dateTo:to,hasMedia:query.hasMedia==='true',savedOnly:query.savedOnly==='true',...(query.read==='true'||query.read==='false'?{read:query.read==='true'}:{})};
}
const csvCell=value=>{let content=String(value??'');if(/^[\s]*[=+\-@]/.test(content))content=`'${content}`;return `"${content.replaceAll('"','""')}"`;};
export function registerNewsroomRoutes({app,store,newsroom,backups,dateBound,fetcher,isSyncing}) {
  app.get('/api/newsroom/health',(_req,res)=>res.json({sources:newsroom.health(),coverage:store.archiveCoverage(),lastSyncAt:store.getSetting('lastSyncAt')}));
  app.get('/api/newsroom/events',route((req,res)=>res.json(newsroom.events(archiveFilters(req.query,dateBound)))));
  app.get('/api/newsroom/articles/:id',route((req,res)=>{const article=newsroom.article(req.params.id);res.json({article,research:newsroom.research(req.params.id),versions:newsroom.versions(req.params.id),source:store.sources().find(s=>s.id===article.sourceId)||null});}));
  app.put('/api/newsroom/articles/:id/research',route((req,res)=>res.json({research:newsroom.saveResearch(req.params.id,req.body||{})})));
  app.post('/api/newsroom/articles/:id/translate',route(async(req,res)=>res.json(await newsroom.translate(req.params.id,req.body?.target||'fa'))));
  app.get('/api/newsroom/folders',(_req,res)=>res.json({folders:store.db.prepare("SELECT folder,COUNT(*) AS count FROM research_items WHERE folder<>'' GROUP BY folder ORDER BY folder").all()}));
  app.get('/api/newsroom/searches',(_req,res)=>res.json({searches:newsroom.readJson('saved_searches')}));
  app.post('/api/newsroom/searches',route((req,res)=>{
    if(typeof req.body?.name!=='string'||!req.body.name.trim()||req.body.name.length>100)throw new Error('نام جست‌وجو لازم است.');
    if(newsroom.readJson('saved_searches').length>=100)throw new Error('حداکثر صد جست‌وجو قابل ذخیره است.');
    const value={id:randomUUID(),name:req.body.name.trim(),filters:archiveFilters(req.body.filters||{},dateBound),rawFilters:req.body.filters||{},createdAt:new Date().toISOString()};
    let rule;
    store.db.exec('BEGIN');
    try {
      store.db.prepare('INSERT INTO saved_searches VALUES(?,?)').run(value.id,JSON.stringify(value));
      if(req.body.subscribe===true)rule=newsroom.putRule({...value.filters,name:value.name,type:'news',includeRecent:false});
      store.db.exec('COMMIT');
    }catch(error){store.db.exec('ROLLBACK');throw error;}
    res.status(201).json({search:value,...(rule?{rule}:{})});
  }));
  app.delete('/api/newsroom/searches/:id',route((req,res)=>res.json({removed:newsroom.remove('saved_searches',req.params.id)})));
  app.get('/api/newsroom/profiles',(_req,res)=>res.json({profiles:newsroom.readJson('profiles')}));
  app.post('/api/newsroom/profiles',route((req,res)=>res.status(201).json({profile:newsroom.saveProfile(req.body||{})})));
  app.put('/api/newsroom/profiles/:id',route((req,res)=>res.json({profile:newsroom.saveProfile(req.body||{},req.params.id)})));
  app.get('/api/newsroom/profiles/:id',route((req,res)=>res.json(newsroom.profileArticles(req.params.id))));
  app.delete('/api/newsroom/profiles/:id',route((req,res)=>res.json({removed:newsroom.remove('profiles',req.params.id)})));
  app.get('/api/newsroom/rules',(_req,res)=>res.json({rules:newsroom.readJson('watch_rules'),lastCheck:store.getSetting('lastAlertsCheck'),preferences:store.getSetting('notificationPreferences',{browser:false,quietStart:'23:00',quietEnd:'07:00'})}));
  app.post('/api/newsroom/rules',route((req,res)=>res.status(201).json({rule:newsroom.putRule(req.body||{})})));
  app.put('/api/newsroom/rules/:id',route((req,res)=>res.json({rule:newsroom.putRule(req.body||{},req.params.id)})));
  app.delete('/api/newsroom/rules/:id',route((req,res)=>res.json({removed:newsroom.remove('watch_rules',req.params.id)})));
  app.get('/api/newsroom/alerts',(_req,res)=>res.json({alerts:newsroom.alerts(),unread:Number(store.db.prepare('SELECT COUNT(*) AS n FROM news_alerts WHERE read=0').get().n),lastCheck:store.getSetting('lastAlertsCheck'),preferences:store.getSetting('notificationPreferences',{browser:false,quietStart:'23:00',quietEnd:'07:00'})}));
  app.post('/api/newsroom/alerts/check',route(async(_req,res)=>res.json(await newsroom.evaluate())));
  app.post('/api/newsroom/alerts/read-all',(_req,res)=>res.json({updated:Number(store.db.prepare('UPDATE news_alerts SET read=1 WHERE read=0').run().changes)}));
  app.post('/api/newsroom/alerts/:id/read',route((req,res)=>res.json({updated:newsroom.markAlert(req.params.id)})));
  app.put('/api/newsroom/notifications',route((req,res)=>{
    const {browser,quietStart,quietEnd}=req.body||{};
    if(typeof browser!=='boolean'||![quietStart,quietEnd].every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))throw new Error('تنظیم ساعت سکوت معتبر نیست.');
    store.setSetting('notificationPreferences',{browser,quietStart,quietEnd});res.json({saved:true});
  }));
  app.get('/api/newsroom/risk',(_req,res)=>res.json(newsroom.risk()));
  app.post('/api/newsroom/calendar',route((req,res)=>res.status(201).json({event:newsroom.saveCalendar(req.body||{})})));
  app.delete('/api/newsroom/calendar/:id',route((req,res)=>res.json({removed:newsroom.remove('calendar_events',req.params.id)})));
  app.post('/api/newsroom/calendar/feeds',route(async(req,res)=>res.status(201).json({feed:await newsroom.calendarService.add(req.body||{})})));
  app.delete('/api/newsroom/calendar/feeds/:id',route((req,res)=>{newsroom.calendarService.remove(req.params.id);res.json({removed:true});}));
  app.get('/api/newsroom/settings',(_req,res)=>res.json({translator:!!store.getConnection('translator'),translatorRegion:store.getConnection('translator')?.region||'',backupPreferences:store.getSetting('backupPreferences',{enabled:true,retention:7})}));
  app.post('/api/newsroom/translator',route((req,res)=>{
    const {token,region}=req.body||{};
    if(typeof token!=='string'||token.length<10||token.length>500||/[\r\n]/.test(token)||typeof region!=='string'||!/^[a-z0-9-]{0,40}$/.test(region))throw new Error('کلید و منطقهٔ مترجم معتبر نیست.');
    store.setConnection('translator','Microsoft Translator',{token,region});res.json({configured:true,verified:false});
  }));
  app.delete('/api/newsroom/translator',(_req,res)=>{store.deleteConnection('translator');res.json({removed:true});});
  app.get('/api/newsroom/backups',(_req,res)=>res.json({backups:backups.list(),lastBackupAt:store.getSetting('lastBackupAt'),preferences:store.getSetting('backupPreferences',{enabled:true,retention:7})}));
  app.put('/api/newsroom/backups/preferences',route((req,res)=>{
    const {enabled,retention}=req.body||{};if(typeof enabled!=='boolean'||!Number.isInteger(retention)||retention<2||retention>30)throw new Error('تعداد نسخه‌ها باید بین ۲ و ۳۰ باشد.');
    store.setSetting('backupPreferences',{enabled,retention});res.json({saved:true});
  }));
  app.post('/api/newsroom/backups/snapshot',route((_req,res)=>res.json({backup:backups.snapshot(true)})));
  app.post('/api/newsroom/backups/export',route((req,res)=>{
    res.type('application/octet-stream').set('Content-Disposition','attachment; filename="Dideban-encrypted-backup.dideban"').send(backups.exportArchive(req.body?.password));
  }));
  app.post('/api/newsroom/backups/restore',route((req,res)=>{
    if(req.body?.confirm!=='RESTORE')throw new Error('بازیابی جایگزین داده‌های فعلی می‌شود؛ تأیید لازم است.');
    if(isSyncing()||newsroom.isEvaluating())throw Object.assign(new Error('تا پایان جمع‌آوری خبرها و بررسی هشدارها صبر کنید.'),{status:409});
    res.json(backups.restoreArchive(req.body.archive,req.body.password));
  }));
  app.post('/api/newsroom/backups/restore-local',route((req,res)=>{
    if(req.body?.confirm!=='RESTORE')throw new Error('بازیابی جایگزین داده‌های فعلی می‌شود؛ تأیید لازم است.');
    if(isSyncing()||newsroom.isEvaluating())throw Object.assign(new Error('تا پایان جمع‌آوری خبرها و بررسی هشدارها صبر کنید.'),{status:409});
    res.json(backups.restoreLocal(req.body.name));
  }));
  app.get('/api/newsroom/export',route((req,res)=>{
    const filters=archiveFilters(req.query,dateBound),result=store.searchArchive({...filters,limit:1000});
    const items=store.articles({...filters,limit:10000}).map(a=>({...a,research:newsroom.research(a.id)}));
    const date=new Date().toISOString().slice(0,10);
    if(req.query.format==='csv') {
      const columns=['id','title','sourceName','publishedAt','url','language','category','summary','fullText','folder','note','review','primaryUrl'];
      const lines=[columns.map(csvCell).join(','),...items.map(item=>columns.map(c=>csvCell(item[c]??item.research[c])).join(','))];
      res.type('text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="Dideban-${date}.csv"`).send('\uFEFF'+lines.join('\r\n'));
    }else res.type('application/json').set('Content-Disposition',`attachment; filename="Dideban-${date}.json"`).send(JSON.stringify({exportedAt:new Date().toISOString(),total:result.total,exported:items.length,truncated:result.total>items.length,scope:'collected publisher content',articles:items},null,2));
  }));
  app.get('/api/newsroom/update',route(async(_req,res)=>{
    const current=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
    let latest;
    try{latest=JSON.parse(await fetcher('https://raw.githubusercontent.com/davidkordmir-source/KH/main/package.json',{allowedHosts:['raw.githubusercontent.com'],maxBytes:20000})).version;}catch{throw new Error('بررسی نسخهٔ جدید ممکن نشد. اتصال اینترنت را بررسی کنید.');}
    if(typeof latest!=='string'||!/^\d+\.\d+\.\d+$/.test(latest))throw new Error('اطلاعات نسخه معتبر نیست.');
    res.json({current,latest,downloadUrl:`https://github.com/davidkordmir-source/KH/raw/refs/tags/v${latest}/downloads/Dideban-v${latest}-Windows-x64.zip`});
  }));
}
