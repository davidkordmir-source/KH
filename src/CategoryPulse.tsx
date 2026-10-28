import {Shield,Landmark,Users,Globe2} from 'lucide-react';
import type {Article} from './App';
const groups=[{id:'military',name:'نظامی',icon:Shield,color:'#257d8b'},{id:'politics',name:'سیاسی',icon:Landmark,color:'#8a6cbb'},{id:'social',name:'اجتماعی',icon:Users,color:'#d18b50'},{id:'all',name:'همهٔ خبرها',icon:Globe2,color:'#1b9e86'}];
export default function CategoryPulse({articles,selected,onSelect}:{articles:Article[];selected:string;onSelect:(value:string)=>void}){
 const counts=new Map<string,number>();for(const article of articles)counts.set(article.category,(counts.get(article.category)||0)+1);
 const maximum=Math.max(1,...groups.map(group=>group.id==='all'?articles.length:counts.get(group.id)||0));
 return <section className="category-pulse" aria-label="نمای کلی دسته‌های خبر"><div className="pulse-caption"><span>نبض خبرهای شما</span><small>بر اساس خبرهای بارگذاری‌شده · دسته‌بندی را خودتان تغییر دهید</small></div><div className="pulse-grid">{groups.map(group=>{const count=group.id==='all'?articles.length:counts.get(group.id)||0;return <button aria-pressed={selected===group.id} key={group.id} onClick={()=>onSelect(group.id)} style={{'--pulse-color':group.color} as React.CSSProperties}><div><span className="pulse-icon"><group.icon size={20}/></span><span>{group.name}<small>نمایش این دسته</small></span><strong>{count.toLocaleString('fa-IR')}</strong></div><span className="pulse-meter"><i style={{width:`${count/maximum*100}%`}}/></span></button>;})}</div></section>;
}
