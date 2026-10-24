import { createIntelligenceService } from './intelligence.mjs';
import { createMediaLab } from './media-lab.mjs';
import { createCompanyService } from './company.mjs';
import { buildProvenance } from './provenance.mjs';
import { archiveFilters } from './newsroom-routes.mjs';

const route=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
export function createLab({store,fetcher,newsroom}) {
  const intelligence=createIntelligenceService({store,fetcher}),media=createMediaLab({store,intelligence}),companies=createCompanyService({store,fetcher});
  function register(app,dateBound) {
    app.get('/api/lab/status',(_req,res)=>res.json(intelligence.status()));
    app.post('/api/lab/config',route((req,res)=>{
      const {token,model='gpt-4.1-mini',embeddingModel='text-embedding-3-small',autoIndex=false}=req.body||{};
      if(typeof token!=='string'||token.length<16||token.length>1000||/[\r\n]/.test(token)||!['gpt-4.1-mini','gpt-4.1','gpt-4o-mini'].includes(model)||!['text-embedding-3-small','text-embedding-3-large'].includes(embeddingModel)||typeof autoIndex!=='boolean')throw new Error('کلید یا مدل سرویس معتبر نیست.');
      store.setConnection('intelligence','OpenAI archive tools',{token,model,embeddingModel});store.setSetting('autoSemanticIndex',autoIndex);res.json({configured:true,verified:false});
    }));
    app.delete('/api/lab/config',(_req,res)=>{store.deleteConnection('intelligence');store.setSetting('autoSemanticIndex',false);res.json({removed:true});});
    app.post('/api/lab/ask',route(async(req,res)=>res.json(await intelligence.ask(req.body||{},archiveFilters(req.body?.filters||{},dateBound)))));
    app.get('/api/lab/questions',(_req,res)=>res.json({items:intelligence.history()}));
    app.delete('/api/lab/questions/:id',(req,res)=>res.json({removed:Number(store.db.prepare('DELETE FROM archive_questions WHERE id=?').run(req.params.id).changes)}));
    app.post('/api/lab/index',route(async(_req,res)=>res.json(await intelligence.index())));
    app.get('/api/lab/events',route((req,res)=>res.json(intelligence.semanticEvents(archiveFilters(req.query,dateBound)))));
    app.post('/api/lab/media/speech',route(async(req,res)=>res.json({item:await media.process(req.body||{},'speech')})));
    app.post('/api/lab/media/ocr',route(async(req,res)=>res.json({item:await media.process(req.body||{},'document')})));
    app.post('/api/lab/media/subtitles',route((req,res)=>res.status(201).json({item:media.importText(req.body||{})})));
    app.get('/api/lab/media',route((req,res)=>res.json(media.list(req.query.query||''))));
    app.get('/api/lab/media/:id',route((req,res)=>res.json({item:media.get(req.params.id)})));
    app.delete('/api/lab/media/:id',(req,res)=>res.json({removed:Number(media.remove(req.params.id))}));
    app.get('/api/lab/provenance',route((req,res)=>{
      let articles;
      if(req.query.articleId){const target=newsroom.article(String(req.query.articleId)),groups=intelligence.semanticEvents().events;articles=groups.find(group=>group.articles.some(a=>a.id===target.id))?.articles||[target];}
      else articles=store.articles({...archiveFilters(req.query,dateBound),limit:50});
      res.json(buildProvenance(articles,newsroom.research));
    }));
    app.get('/api/lab/companies/:id',route(async(req,res)=>res.json(await companies.get(req.params.id))));
  }
  return {register,intelligence,media,companies,isBusy:()=>media.isBusy()||intelligence.isBusy()};
}
