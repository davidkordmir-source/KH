import { useEffect, useState } from 'react';
import { Languages, LoaderCircle } from 'lucide-react';
import type { Article } from './App';
import { request } from './newsroom-client';

type Translation = {title:string;body:string;provider:string};
export default function PersianTranslation({article}:{article:Pick<Article,'id'|'title'|'summary'> & Partial<Pick<Article,'language'|'translatedTitle'|'translatedSummary'|'translationProvider'>>}) {
  const [translation,setTranslation]=useState<Translation|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setTranslation(null);setError('');},[article.id,article.title,article.summary]);
  if (article.language?.toLowerCase().split(/[-_]/)[0] === 'fa' || (!article.language && /[\u0600-\u06ff]/.test(article.title))) return null;
  const title=translation?.title || article.translatedTitle;
  async function translate(){
    if(busy)return;setBusy(true);setError('');
    try{setTranslation(await request<Translation>(`/newsroom/articles/${encodeURIComponent(article.id)}/translate`,'POST',{target:'fa'}));}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <div className="article-translation">
    <button className="text-button" disabled={busy} onClick={()=>void translate()}>{busy?<LoaderCircle size={15} className="spin"/>:<Languages size={15}/>} {busy?'در حال ترجمه…':title?'نمایش دوبارهٔ ترجمهٔ فارسی':'ترجمه به فارسی'}</button>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {title&&<div className="generated-summary" lang="fa" dir="rtl"><small>ترجمهٔ ماشینی فارسی · {translation?.provider || article.translationProvider}</small><h3>{title}</h3><p>{translation?.body || article.translatedSummary}</p></div>}
  </div>;
}
