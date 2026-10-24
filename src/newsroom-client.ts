import { useEffect, useRef, useState } from 'react';
import * as jalaali from 'jalaali-js';

export async function request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch(`/api${path}`,{method,signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||'دریافت یا ثبت اطلاعات انجام نشد.');
  return payload as T;
}
export function useResource<T>(path:string,initial:T) {
  const [data,setData]=useState<T>(initial),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');void request<T>(path,'GET',undefined,controller.signal).then(next=>{if(!controller.signal.aborted)setData(next);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[path,revision]);
  return {data,setData,loading,error,reload:()=>setRevision(value=>value+1)};
}
export const faNumber=(value:number)=>value.toLocaleString('fa-IR');
export function dateTime(value?:string|null) {
  if(!value||!Number.isFinite(Date.parse(value)))return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(value));
}
export function inputDate(value:string) {
  if(!value.trim())return '';
  const numbers=value.trim().replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660));
  const fields=numbers.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);if(!fields)throw new Error('تاریخ را مانند ۱۴۰۳/۰۱/۰۱ یا 2024-03-20 وارد کنید.');
  let [year,month,day]=fields.slice(1).map(Number);
  if(year<1700) {if(year<1200||!jalaali.isValidJalaaliDate(year,month,day))throw new Error('تاریخ شمسی معتبر نیست.');const converted=jalaali.toGregorian(year,month,day);year=converted.gy;month=converted.gm;day=converted.gd;}
  const result=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed=new Date(`${result}T00:00:00Z`);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==result)throw new Error('تاریخ معتبر نیست.');return result;
}
export function downloadBlob(blob:Blob,name:string) {const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
export type AlertRecord={id:string;ruleId:string;ruleName:string;title:string;url:string;sourceName?:string;publishedAt?:string;createdAt:string;read:boolean;count?:number;type:string};
type NotificationPreferences={browser:boolean;quietStart:string;quietEnd:string};
export function isQuietHours(preferences:NotificationPreferences,date=new Date()) {
  const time=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Tehran'}).format(date);
  const {quietStart:start,quietEnd:end}=preferences;
  return start===end?false:start<end?time>=start&&time<end:time>=start||time<end;
}
export function useNewsAlerts() {
  const [unread,setUnread]=useState(0),seen=useRef<Set<string>|null>(null);
  useEffect(()=>{
    let disposed=false,timeout:ReturnType<typeof setTimeout>;const controller=new AbortController();
    async function poll() {
      try {
        const result=await request<{unread:number;alerts:AlertRecord[];preferences:NotificationPreferences}>('/newsroom/alerts','GET',undefined,controller.signal);
        if(disposed)return;setUnread(result.unread);
        if(seen.current && result.preferences.browser && !isQuietHours(result.preferences) && 'Notification' in window && Notification.permission==='granted') {
          for(const item of result.alerts.filter(a=>!a.read&&!seen.current!.has(a.id)).slice(0,3)) {
            const notification=new Notification(item.ruleName,{body:item.title,tag:item.id});notification.onclick=()=>{window.focus();notification.close();};
          }
        }
        seen.current=new Set(result.alerts.map(a=>a.id));
      }catch{/* The main dashboard reports server connectivity. */}
      finally {if(!disposed)timeout=setTimeout(poll,15000);}
    }
    void poll();return()=>{disposed=true;clearTimeout(timeout);controller.abort();};
  },[]);
  return unread;
}
