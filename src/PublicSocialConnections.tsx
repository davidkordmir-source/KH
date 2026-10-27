import {useState,type FormEvent} from 'react';
import {Check,ExternalLink,Link2,LoaderCircle,Plus,Trash2} from 'lucide-react';
import {request} from './newsroom-client';

type Source={id:string;name:string;url:string;platform:string;enabled:boolean;lastError:string|null;lastFetchedAt:string|null};
const descriptions:Record<string,string>={
 instagram:'آزمایشی: نام پیج یا لینک مستقیم پست عمومی را وارد کنید. فقط متن و رسانه‌ای خوانده می‌شود که خود اینستاگرام بدون ورود نمایش دهد؛ صفحهٔ ورود یا کپچا اتصال موفق محسوب نمی‌شود.',
 x:'آزمایشی: نام حساب یا لینک پست عمومی را وارد کنید. از نمایش عمومی خود X استفاده می‌شود؛ همهٔ حساب‌ها و پست‌ها بدون ورود قابل دریافت نیستند.',
 telegram:'نام یا لینک کانال عمومی را وارد کنید. پیش‌نمایش وب تلگرام خوانده می‌شود؛ ربات، توکن و ورود لازم نیست. فقط پست‌های عمومی قابل نمایش در وب، نه کانال خصوصی یا تاریخچهٔ کامل.',
 youtube:'شناسهٔ UC…، لینک کانال یا @handle را وارد کنید. عنوان، توضیح و تصویر ویدیوهای تازه از فید عمومی خوانده می‌شود؛ فایل ویدیو دانلود نمی‌شود.',
 mastodon:'لینک عمومی پروفایل را وارد کنید. پست‌های منتشرشده در RSS عمومی همان سرور خوانده می‌شوند؛ محتوای خصوصی دریافت نمی‌شود.',
 bluesky:'نام حساب عمومی را وارد کنید. پست‌های عمومی بدون کلید، رمز و ورود از سرویس عمومی Bluesky دریافت می‌شوند.',
};
const names:Record<string,string>={telegram:'تلگرام عمومی',youtube:'YouTube',mastodon:'Mastodon',bluesky:'Bluesky',instagram:'اینستاگرام عمومی · آزمایشی',x:'X عمومی · آزمایشی'};
const placeholders:Record<string,string>={telegram:'@channel یا https://t.me/channel',youtube:'@handle یا https://www.youtube.com/channel/UC…',mastodon:'https://mastodon.social/@username',bluesky:'handle.bsky.social',instagram:'@username یا https://www.instagram.com/p/…/',x:'@username یا https://x.com/username/status/…'};
export default function PublicSocialConnections({sources,onChanged}:{sources:Source[];onChanged:()=>Promise<void>}) {
 const [type,setType]=useState('telegram'),[input,setInput]=useState(''),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const connected=sources.filter(source=>source.platform.endsWith('-public'));
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   if(type==='bluesky')await request('/custom-connections','POST',{type:'bluesky',actor:input.trim(),label:label.trim()||undefined});
   else await request('/public-connections','POST',{type,input:input.trim(),label:label.trim()||undefined});
   await onChanged();setNotice('منبع عمومی ثبت شد؛ دریافت‌های بعدی با جمع‌آوری خودکار انجام می‌شود.');setInput('');setLabel('');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="custom-networks" aria-label="شبکه‌های اجتماعی بدون کلید API"><div className="section-title-row"><div><h3><Link2 size={18}/> دریافت بدون کلید API</h3><p className="section-description">فقط لینک یا نام صفحهٔ عمومی را وارد کنید؛ هیچ رمز، کلید یا توکنی لازم نیست.</p></div></div>
 <form className="custom-connection-form" onSubmit={event=>void submit(event)}>
 <label>شبکه<select aria-label="شبکه بدون کلید" value={type} disabled={busy} onChange={event=>{setType(event.target.value);setInput('');setError('');setNotice('');}}>{Object.entries(names).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
 <p className="custom-provider-description">{descriptions[type]}</p>
 <label>نام دلخواه<input aria-label="نام منبع بدون کلید" value={label} onChange={event=>setLabel(event.target.value)} maxLength={100} disabled={busy}/></label>
 <label>لینک یا شناسهٔ عمومی<input aria-label="لینک منبع بدون کلید" dir="ltr" value={input} onChange={event=>setInput(event.target.value)} placeholder={placeholders[type]} maxLength={2048} required disabled={busy}/></label>
 <button className="primary-button" disabled={busy||!input.trim()}>{busy?<LoaderCircle size={16} className="spin"/>:<Plus size={16}/>} {busy?'در حال بررسی دسترسی عمومی…':'افزودن بدون کلید'}</button>
 </form>
 {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="wb-success" role="status"><Check size={15}/>{notice}</p>}
 <div className="custom-connection-list">{connected.map(source=><div className="catalog-row" key={source.id}><Link2 size={18}/><div><strong>{source.name}</strong><small>{source.lastError?source.lastError:!source.enabled?'دریافت متوقف است':source.lastFetchedAt?'دریافت عمومی موفق؛ بدون کلید':'در انتظار دریافت'}</small><a href={source.url} target="_blank" rel="noreferrer">صفحهٔ عمومی <ExternalLink size={12}/></a></div><button className="subtle-danger" disabled={busy} aria-label={`حذف منبع عمومی ${source.name}`} onClick={async()=>{setBusy(true);setError('');try{await request(`/sources/${source.id}`,'DELETE');await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><Trash2 size={16}/></button></div>)}</div>
 <div className="info-strip"><p>این روش ورود به حساب شخصی نیست. دسترسی شبکه به سایت لازم است و انتشار پست تازه ممکن است با تأخیر دیده شود. اینستاگرام و X آزمایشی‌اند: فقط داده‌ای دریافت می‌شود که بدون ورود در نمایش عمومی خود پلتفرم در دسترس باشد. ورود، کپچا و محدودیت دسترسی دور زده نمی‌شود. فیسبوک و لینکدین در این بخش پشتیبانی نمی‌شوند.</p></div>
 </section>;
}
