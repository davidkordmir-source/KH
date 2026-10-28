import {randomUUID} from 'node:crypto';
export const BASE_CATEGORIES=Object.freeze([
 {id:'military',name:'نظامی'},{id:'politics',name:'سیاسی'},{id:'social',name:'اجتماعی'},{id:'economy',name:'اقتصادی'},
 {id:'world',name:'جهان'},{id:'technology',name:'فناوری'},{id:'science',name:'دانش'},{id:'sports',name:'ورزش'},{id:'general',name:'عمومی'},
]);
export function categoryList(store){return [...BASE_CATEGORIES,...store.getSetting('userCategories',[])];}
export function registerCategories(app,store){
 app.get('/api/categories',(_req,res)=>res.json({categories:categoryList(store)}));
 app.post('/api/categories',(req,res)=>{
  const name=req.body?.name;if(typeof name!=='string'||!name.trim()||name.length>40)return res.status(400).json({error:'نام دسته باید بین ۱ تا ۴۰ نویسه باشد.'});
  if(categoryList(store).some(item=>item.name===name.trim()))return res.status(409).json({error:'این دسته قبلاً وجود دارد.'});
  const custom=store.getSetting('userCategories',[]);if(custom.length>=30)return res.status(400).json({error:'حداکثر ۳۰ دستهٔ دلخواه قابل ساخت است.'});
  const category={id:`custom-${randomUUID()}`,name:name.trim()};store.setSetting('userCategories',[...custom,category]);res.status(201).json({category,categories:categoryList(store)});
 });
 app.post('/api/articles/:id/category',(req,res)=>{
  const category=req.body?.category;
  if(category!==null&&!categoryList(store).some(item=>item.id===category))return res.status(400).json({error:'دسته معتبر نیست.'});
  const item=store.article(req.params.id);if(!item)return res.status(404).json({error:'خبر پیدا نشد.'});
  const originalCategory=item.originalCategory||item.category||'general';
  const updated={...item,originalCategory,userCategory:category,category:category||originalCategory};
  store.db.prepare('UPDATE articles SET payload=? WHERE id=?').run(JSON.stringify(updated),item.id);
  res.json({article:store.article(item.id)});
 });
}
