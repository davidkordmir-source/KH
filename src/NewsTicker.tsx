import { useState } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import './news-ticker.css';

type Story = {id:string; title:string; url:string; sourceName:string; publishedAt:string; publishedAtKnown?:boolean; priority?:number; breakingScore?:number; read?:boolean};

export default function NewsTicker({articles,onOpen}:{articles:Story[];onOpen:(article:Story)=>void}) {
  const [paused,setPaused]=useState(false);
  const important=articles.filter(article=>Number(article.priority||0)>=2 || (Number(article.breakingScore||0)>=55 && article.publishedAtKnown!==false && Date.parse(article.publishedAt)>=Date.now()-86400000));
  const stories=[...(important.length?important:articles)].sort((a,b)=>Number(b.priority||0)-Number(a.priority||0) || (important.length?Number(b.breakingScore||0)-Number(a.breakingScore||0):0) || Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,15);
  const duration=Math.max(35,Math.min(360,stories.reduce((sum,item)=>sum+item.title.length+item.sourceName.length,0)/8));
  return <section className={`tv-news-ticker ${paused?'tv-paused':''}`} aria-label="زیرنویس متحرک خبرها">
    <strong className="tv-ticker-label"><Radio size={18}/>{important.length?'خبرهای مهم':'آخرین خبرها'}</strong>
    <div className="tv-ticker-window">
      {stories.length ? <div className="tv-ticker-track" style={{animationDuration:`${duration}s`}}>
        {[0,1].map(copy=><div className="tv-ticker-group" key={copy} aria-hidden={copy===1?true:undefined}>
          {stories.map(article=><a key={article.id} href={article.url} target="_blank" rel="noreferrer" tabIndex={copy===1?-1:0} onClick={()=>onOpen(article)}><span className="tv-story-source">{article.sourceName}</span><span dir="auto">{article.title}</span><span className="tv-story-separator" aria-hidden="true">◆</span></a>)}
        </div>)}
      </div> : <p className="tv-ticker-empty">در انتظار دریافت خبرها؛ «جمع‌آوری خبرها» را بزنید.</p>}
    </div>
    <button type="button" className="tv-ticker-control" disabled={!stories.length} aria-label={paused?'ادامهٔ زیرنویس خبری':'توقف زیرنویس خبری'} aria-pressed={paused} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={16}/>:<Pause size={16}/>}<span>{paused?'ادامه':'توقف'}</span></button>
  </section>;
}
