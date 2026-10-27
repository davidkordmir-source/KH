import {googleTranslationLink} from './google-translation-link';
import { useEffect, useState } from 'react';
import { Languages, LoaderCircle } from 'lucide-react';
import type { Article } from './App';
import { request } from './newsroom-client';

type Translation = {title:string;body:string;provider:string;truncated?:boolean;characterLimit?:number};
export default function PersianTranslation({article}:{article:Pick<Article,'id'|'title'|'summary'> & Partial<Pick<Article,'language'|'translatedTitle'|'translatedSummary'|'translationProvider'|'fullText'>>}) {
  const [translation,setTranslation]=useState<Translation|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setTranslation(null);setError('');},[article.id,article.title,article.summary]);
  if (article.language?.toLowerCase().split(/[-_]/)[0] === 'fa' || (!article.language && /[\u0600-\u06ff]/.test(article.title))) return null;
  const title=translation?.title || article.translatedTitle;
  async function translate(provider:'google'|'microsoft'){
    if(busy)return;setBusy(true);setError('');
    try{setTranslation(await request<Translation>(`/newsroom/articles/${encodeURIComponent(article.id)}/${provider==='google'?'translate-google':'translate'}`,'POST',{target:'fa'}));}
    catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <div className="article-translation">
    <button className="text-button" disabled={busy} onClick={()=>void translate('google')}>{busy?<LoaderCircle size={15} className="spin"/>:<Languages size={15}/>} {busy?'در حال ترجمه…':'ترجمهٔ گوگل به فارسی · بدون کلید'}</button>
    <a className="text-button" href={googleTranslationLink(`${article.title}\n\n${article.fullText||article.summary}`)} target="_blank" rel="noreferrer">بازکردن در گوگل</a>
    <button className="text-button" disabled={busy} onClick={()=>void translate('microsoft')}>Microsoft · با کلید</button>
    <small style={{display:'block'}}>ترجمهٔ گوگل با درخواست شما انجام می‌شود؛ متن خبر به Google ارسال می‌شود؛ دریافت داخلی تا ۳۰۰۰ نویسهٔ متن است.</small>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {title&&<div className="generated-summary" lang="fa" dir="rtl"><small>ترجمهٔ ماشینی فارسی · {translation?.provider || article.translationProvider}</small><h3>{title}</h3><p>{translation?.body || article.translatedSummary}</p>{translation?.truncated&&<small>فقط {translation.characterLimit||3000} نویسهٔ نخست ترجمه شده است.</small>}</div>}
  </div>;
}
