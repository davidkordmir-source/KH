import {randomUUID,createHash} from 'node:crypto';
import {profileSpec} from './public-profile-pages.mjs';
import {cleanText,categoryFor} from './feeds.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function createBrowserReader({store,available=Boolean(process.env.DIDEBAN_DESKTOP_SECRET)}){
 let pending=null,active=null,draft=null;
 function selection(input){
  if(typeof input.url!=='string'||input.url.length>2048||typeof input.text!=='string'||input.text.trim().length<2||input.text.length>20000)throw fail('لینک پست و متن انتخاب‌شدهٔ بین ۲ تا ۲۰ هزار نویسه لازم است.');
  let host;try{host=new URL(input.url).hostname;}catch{throw fail('لینک معتبر نیست.');}
  const type=['instagram.com','www.instagram.com'].includes(host)?'instagram':['x.com','www.x.com','twitter.com','www.twitter.com'].includes(host)?'x':null;
  if(!type)throw fail('فقط لینک مستقیم پست اینستاگرام یا X پذیرفته می‌شود.');
  const spec=profileSpec(type,input.url);
  if(type==='instagram'?!/\/(p|reel)\//.test(spec.url):!spec.url.includes('/status/'))throw fail('یک پست را باز کنید و لینک همان پست را بدهید؛ لینک صفحهٔ پروفایل کافی نیست.');
  const text=cleanText(input.text);if(text.length<2)throw fail('متن پست قابل خواندن نیست.');const title=cleanText(input.title||'').slice(0,300)||text.slice(0,180);
  const date=typeof input.publishedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(input.publishedAt)?new Date(input.publishedAt):null;
  return {id:randomUUID(),type,url:spec.url,text,title,publishedAt:date&&Number.isFinite(date.getTime())?date.toISOString():null};
 }
 function save(value){
  const article={id:createHash('sha256').update(value.url).digest('hex').slice(0,24),url:value.url,title:value.title,summary:value.text.slice(0,2400),fullText:value.text,
   sourceId:`manual-browser:${value.type}`,sourceName:`انتخاب دستی از ${value.type==='instagram'?'اینستاگرام':'X'}`,platform:value.type,textScope:'manual-browser-selection',
   publishedAt:value.publishedAt||new Date().toISOString(),publishedAtKnown:Boolean(value.publishedAt),language:/[\u0600-\u06ff]/.test(value.text)?'fa':'en',category:categoryFor(value.text),media:[],imageUrl:null,saved:false};
  store.addArticles([article]);return {article:store.article(article.id),imported:1};
 }
 return {
  registerPublic(app,route){
   app.get('/api/lab/reader',(_req,res)=>res.json({available,draft,mode:'manual-selection'}));
   app.post('/api/lab/reader/open',route((req,res)=>{
    if(!available)throw fail('این پنجره فقط در اجرای نصب‌شدهٔ ویندوز فعال است؛ از ورود دستی متن و لینک در همین بخش استفاده کنید.',409);
    if(!['instagram','x'].includes(req.body?.type)||typeof req.body?.input!=='string'||req.body.input.length>2048)throw fail('شبکه و لینک معتبر لازم است.');
    const spec=profileSpec(req.body.type,req.body.input);active={id:randomUUID(),type:req.body.type,url:spec.url};pending=active;draft=null;res.json({queued:true});
   }));
   app.post('/api/lab/reader/import',route((req,res)=>{if(!draft||req.body?.id!==draft.id)throw fail('ابتدا متن را از پنجرهٔ خواندن دریافت کنید.',409);const value=selection({...draft,text:req.body.text??draft.text,title:req.body.title??draft.title});const result=save(value);draft=null;res.json(result);}));
   app.post('/api/lab/reader/manual',route((req,res)=>res.json(save(selection(req.body||{})))));
  },
  registerDesktop(app,route){
   app.get('/api/desktop/reader/next',(_req,res)=>{const job=pending;pending=null;res.json({job});});
   app.post('/api/desktop/reader/capture',route((req,res)=>{
    if(!active||req.body?.id!==active.id)throw fail('پنجرهٔ خواندن معتبر نیست.',409);
    const value=selection(req.body);if(value.type!==active.type)throw fail('پست باید متعلق به شبکهٔ انتخاب‌شده باشد.');
    draft=value;res.json({captured:true});
   }));
  }
 };
}
