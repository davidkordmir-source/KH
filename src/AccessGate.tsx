import { createContext,useContext,useEffect,useState,type PropsWithChildren } from 'react';
import { LockKeyhole,LogOut,RefreshCw } from 'lucide-react';
import { request } from './newsroom-client';
type Access={required:boolean;authenticated:boolean};
const AccessContext=createContext<Access>({required:false,authenticated:true});
export function SessionControls(){const status=useContext(AccessContext);return status.required?<button className="secondary-button" onClick={()=>void request('/access/logout','POST',{}).then(()=>location.reload())}><LogOut size={14}/>خروج</button>:null;}
export default function AccessGate({children}:PropsWithChildren) {
  const [status,setStatus]=useState<Access|null>(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();void request<Access>('/access/status','GET',undefined,controller.signal).then(setStatus).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[revision]);
  async function login(){setBusy(true);setError('');try{await request('/access/login','POST',{password});setPassword('');setRevision(value=>value+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(status?.authenticated)return <AccessContext.Provider value={status}>{children}</AccessContext.Provider>;
  return <main className="access-page"><form className="access-card" onSubmit={e=>{e.preventDefault();void login();}}><LockKeyhole size={32}/><h1>{status?'ورود به بانک خبری دیدبان':'دیدبان در حال آماده‌شدن است…'}</h1>{status&&<><p>برای دسترسی به آرشیو شخصی، گذرواژهٔ تنظیم‌شده روی رایانه را وارد کنید.</p><label>گذرواژه<input aria-label="گذرواژهٔ ورود" type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="primary-button" disabled={busy}>{busy?'بررسی ورود…':'ورود به دیدبان'}</button></>}{error&&<><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={()=>{setError('');setRevision(value=>value+1);}}><RefreshCw size={14}/>تلاش دوباره</button></>}</form></main>;
}
