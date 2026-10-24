import { useState } from 'react';
import { Building2,GitBranch,Languages,MessageCircle,Monitor,ScanText,Settings2 } from 'lucide-react';
import ArchiveAssistant from './ArchiveAssistant';
import SemanticDesk from './SemanticDesk';
import MediaLab from './MediaLab';
import CompaniesDesk from './CompaniesDesk';
import DesktopDesk from './DesktopDesk';
import IntelligenceSettings from './IntelligenceSettings';
import ProvenanceView from './ProvenanceView';
import './lab.css';
type Tab='assistant'|'semantic'|'media'|'companies'|'provenance'|'desktop'|'settings';
export default function ResearchLab({onSelect}:{onSelect:(id:string)=>void}) {
  const [tab,setTab]=useState<Tab>('assistant');
  const tabs:{id:Tab;name:string;icon:typeof MessageCircle}[]=[{id:'assistant',name:'دستیار آرشیو',icon:MessageCircle},{id:'semantic',name:'رویدادهای چندزبانه',icon:Languages},{id:'media',name:'گفتار و سند',icon:ScanText},{id:'companies',name:'شرکت‌ها و نمادها',icon:Building2},{id:'provenance',name:'مسیر انتشار',icon:GitBranch},{id:'desktop',name:'ویندوز و موبایل',icon:Monitor},{id:'settings',name:'تنظیم سرویس‌ها',icon:Settings2}];
  return <section className="wb lab" aria-label="دستیار و ابزارهای تازه"><nav className="wb-tabs lab-tabs" aria-label="ابزارهای پژوهش هوشمند">{tabs.map(item=><button key={item.id} aria-pressed={tab===item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}><item.icon size={16}/>{item.name}</button>)}</nav>{tab==='assistant'&&<ArchiveAssistant onSelect={onSelect}/>} {tab==='semantic'&&<SemanticDesk onSelect={onSelect}/>} {tab==='media'&&<MediaLab onSelect={onSelect}/>} {tab==='companies'&&<CompaniesDesk onSelect={onSelect}/>} {tab==='provenance'&&<ProvenanceView/>} {tab==='desktop'&&<DesktopDesk/>} {tab==='settings'&&<IntelligenceSettings/>}</section>;
}
