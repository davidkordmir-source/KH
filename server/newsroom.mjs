import { createHash, randomUUID } from 'node:crypto';
import { normalizeStoryTitle } from './enrichment.mjs';
import { safeMediaUrl } from './feeds.mjs';
import { SOURCE_CATALOG, OFFICIAL_WEBSITES } from './catalog.mjs';
import { createCalendarService } from './calendar.mjs';
import { companyFields } from './company.mjs';

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);
const stop = new Set('the a an and or of to in on for with from is are was at as by this that says said new news live report latest و در به از با برای که این آن را یک خبر گزارش تازه فوری است شد می ها'.split(' '));
const tokens = text => new Set(normalizeStoryTitle(text).split(' ').filter(word => word.length > 1 && !stop.has(word)));
export function similarHeadlines(a, b) {
  const left = tokens(a), right = tokens(b);
  if (normalizeStoryTitle(a) === normalizeStoryTitle(b) && left.size >= 4) return 1;
  if (Math.min(left.size, right.size) < 5) return 0;
  const numbers = set => [...set].filter(word => /^\d+$/.test(word)).join(',');
  if (numbers(left) && numbers(right) && numbers(left) !== numbers(right)) return 0;
  const common = [...left].filter(word => right.has(word)).length;
  return common >= 4 ? common / new Set([...left, ...right]).size : 0;
}

export function groupEvents(articles, sources = [], options = {}) {
  const groups = [], sourceMap = new Map(sources.map(s => [s.id, s]));
  for (const article of [...articles].sort((a,b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))) {
    let group = groups.find(item => article.publishedAtKnown !== false && item.articles[0].publishedAtKnown !== false && Math.abs(Date.parse(article.publishedAt) - Date.parse(item.firstAt)) <= 48 * 3600000 && (options.compare?options.compare(item.articles[0],article):similarHeadlines(item.title, article.title)) >= 0.58);
    if (!group) { group = { id: hash(article.id), title: article.title, firstAt: article.publishedAt, lastAt: article.publishedAt, articles: [] }; groups.push(group); }
    group.articles.push(article); group.lastAt = article.publishedAt;
  }
  return groups.map(group => ({ ...group, count: group.articles.length, sourceCount: new Set(group.articles.map(a => sourceMap.get(a.sourceId)?.publisher || new URL(a.url).hostname.replace(/^www\./,''))).size,
    method: options.method || 'lexical-similarity', independentConfirmation: false })).sort((a,b) => b.lastAt.localeCompare(a.lastAt));
}

const trimmed = (value, maximum = 200) => typeof value === 'string' ? value.trim().slice(0,maximum) : '';
const validCountry = value => !value || /^[A-Z]{2}$/.test(value);
export function validateRule(input, previous) {
  const rule = { id: previous?.id || randomUUID(), name: trimmed(input.name,100), enabled: input.enabled !== false, type: input.type === 'market' ? 'market' : 'news',
    query: trimmed(input.query,250), exclude:trimmed(input.exclude,250),language:trimmed(input.language,20),city:trimmed(input.city,100),country: trimmed(input.country,2).toUpperCase(), sourceId: trimmed(input.sourceId,100), category: trimmed(input.category,30),
    minimumPriority: Number(input.minimumPriority || 0), symbol: trimmed(input.symbol,20), threshold: Number(input.threshold || 0), condition: input.condition || 'change',
    since: previous?.since || new Date(Date.now() - (input.includeRecent ? 24*3600000 : 0)).toISOString(), createdAt: previous?.createdAt || new Date().toISOString() };
  if (!rule.name || !validCountry(rule.country) || !Number.isInteger(rule.minimumPriority) || rule.minimumPriority<0 || rule.minimumPriority>3) throw new Error('نام قانون، کشور یا اولویت معتبر نیست.');
  if (rule.type === 'news' && !rule.query && !rule.country && !rule.city && !rule.language && !rule.sourceId && !rule.category && !rule.minimumPriority) throw new Error('برای هشدار دست‌کم یک موضوع، کشور، شهر، زبان، منبع یا اولویت انتخاب کنید.');
  if (rule.type === 'market' && (!['BZ=F','XAUUSD','^GSPC','^IXIC','^DJI'].includes(rule.symbol) || !['change','above','below'].includes(rule.condition) || !Number.isFinite(rule.threshold) || rule.threshold <= 0)) throw new Error('نماد، شرط یا آستانهٔ بازار معتبر نیست.');
  return rule;
}

export function createNewsroom({ store, markets, fetcher }) {
  const calendarService=createCalendarService({store,fetcher});
  const readJson = table => store.db.prepare(`SELECT payload FROM ${table} ORDER BY rowid DESC`).all().map(row => JSON.parse(row.payload));
  const putJson = (table, value) => store.db.prepare(`INSERT INTO ${table}(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(value.id,JSON.stringify(value));
  if(!store.getSetting('officialProfilesSeeded',false)) {
    const aliases={'white-house':['کاخ سفید','White House'],'uk-prime-minister':['نخست وزیر بریتانیا','Downing Street'],'kremlin':['کرملین','Kremlin'],'china-foreign-ministry':['وزارت خارجه چین','Chinese foreign ministry'],'china-state-council':['شورای دولتی چین','State Council'],'israel-prime-minister':['نخست وزیر اسرائیل','Israeli prime minister']};
    for(const item of SOURCE_CATALOG.filter(s=>s.kind==='official'))putJson('profiles',{id:`official-${item.id}`,name:item.name,type:'organization',country:item.countryCode||'',aliases:aliases[item.id]||[],description:item.description||'',links:[{label:'وب‌سایت نهاد',url:OFFICIAL_WEBSITES[item.id]||item.url,verified:false}],updatedAt:new Date().toISOString()});
    store.setSetting('officialProfilesSeeded',true);
  }
  const research = id => {
    const row = store.db.prepare('SELECT * FROM research_items WHERE article_id=?').get(id);
    return row ? { folder: row.folder, note: row.note, tags: JSON.parse(row.tags), review: row.review, evidenceUrl: row.evidence_url, reviewNote: row.review_note,primaryUrl:row.primary_url, updatedAt: row.updated_at } : { folder:'',note:'',tags:[],review:'unchecked',evidenceUrl:'',reviewNote:'',primaryUrl:'' };
  };
  const article = id => { const item=store.article(id); if(!item)throw Object.assign(new Error('خبر پیدا نشد.'),{status:404});return item; };
  function saveResearch(id,input) {
    if (!store.db.prepare('SELECT id FROM articles WHERE id=?').get(id)) throw Object.assign(new Error('خبر پیدا نشد.'),{status:404});
    const old = research(id), value = {...old,...input};
    if (!['unchecked','corroborated','corrected','disputed','retracted'].includes(value.review)) throw new Error('وضعیت بررسی معتبر نیست.');
    const evidence = trimmed(value.evidenceUrl,2000);
    const primary=trimmed(value.primaryUrl,2000);if(primary&&!safeMediaUrl(primary))throw new Error('پیوند منبع اولیه باید HTTPS عمومی باشد.');
    if (evidence && !safeMediaUrl(evidence)) throw new Error('پیوند مستندات باید HTTPS عمومی باشد.');
    if (value.review !== 'unchecked' && !trimmed(value.reviewNote,2000)) throw new Error('برای ثبت بررسی، توضیح و مستندات بررسی را وارد کنید.');
    const tags = Array.isArray(value.tags) ? [...new Set(value.tags.map(t=>trimmed(t,50)).filter(Boolean))].slice(0,20) : [];
    store.db.prepare(`INSERT INTO research_items(article_id,folder,note,tags,review,evidence_url,review_note,updated_at,primary_url) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET folder=excluded.folder,note=excluded.note,tags=excluded.tags,review=excluded.review,evidence_url=excluded.evidence_url,review_note=excluded.review_note,updated_at=excluded.updated_at,primary_url=excluded.primary_url`).run(id,trimmed(value.folder,100),trimmed(value.note,10000),JSON.stringify(tags),value.review,evidence,trimmed(value.reviewNote,2000),new Date().toISOString(),primary);
    return research(id);
  }
  function health() {
    return store.sources().map(source => {
      const counts = store.db.prepare("SELECT COUNT(*) AS total,MAX(published_at) AS latest FROM articles WHERE json_extract(payload,'$.sourceId')=?").get(source.id);
      const age = source.lastFetchedAt ? Date.now()-Date.parse(source.lastFetchedAt) : Infinity;
      return {...source, articleCount:Number(counts.total),latestArticleAt:counts.latest||null,status:!source.enabled?'disabled':source.lastError?'error':!source.lastFetchedAt?'pending':age>3600000?'stale':'healthy'};
    });
  }
  function saveProfile(input, id) {
    const profiles = readJson('profiles');
    if (!id && profiles.length>=200) throw new Error('حداکثر ۲۰۰ پرونده قابل ثبت است.');
    const links = (Array.isArray(input.links)?input.links:[]).slice(0,12).map(link=>({label:trimmed(link.label,100),url:trimmed(link.url,2000),verified:link.verified===true}));
    if (links.some(link=>!safeMediaUrl(link.url))) throw new Error('پیوند حساب رسمی باید HTTPS عمومی باشد.');
    const value = {id:id||randomUUID(),name:trimmed(input.name,150),type:['person','organization','company'].includes(input.type)?input.type:'person',country:trimmed(input.country,2).toUpperCase(),aliases:(Array.isArray(input.aliases)?input.aliases:[]).map(a=>trimmed(a,100)).filter(Boolean).slice(0,15),description:trimmed(input.description,3000),links,...companyFields(input),updatedAt:new Date().toISOString()};
    if (!value.name || !validCountry(value.country)) throw new Error('نام و کشور پرونده معتبر نیست.');
    putJson('profiles',value);return value;
  }
  function profileArticles(id) {
    const profile=readJson('profiles').find(p=>p.id===id);if(!profile) throw Object.assign(new Error('پرونده پیدا نشد.'),{status:404});
    const ids=new Map();
    for(const name of [profile.name,...profile.aliases,...(profile.leaders||[])]) for(const item of store.articles({query:`"${name.replaceAll('"','')}"`,limit:500})) ids.set(item.id,item);
    return {profile,articles:[...ids.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),scope:'حداکثر ۵۰۰ خبر برای هر نام؛ تطبیق نام در متن، نه احراز هویت خودکار'};
  }
  function putRule(input,id) {
    const rules=readJson('watch_rules'),old=rules.find(r=>r.id===id);
    if(id&&!old) throw Object.assign(new Error('قانون پیدا نشد.'),{status:404});
    if(!id&&rules.length>=100) throw new Error('حداکثر ۱۰۰ قانون قابل ثبت است.');
    const value=validateRule({...old,...input},old);putJson('watch_rules',value);return value;
  }
  const alerts = () => store.db.prepare('SELECT * FROM news_alerts ORDER BY created_at DESC LIMIT 300').all().map(row=>({...JSON.parse(row.payload),id:row.id,ruleId:row.rule_id,createdAt:row.created_at,read:Boolean(row.read)}));
  function insertAlert(rule,key,payload) {
    return Number(store.db.prepare('INSERT OR IGNORE INTO news_alerts VALUES(?,?,?,?,?,0)').run(randomUUID(),rule.id,key,JSON.stringify({...payload,ruleName:rule.name}),new Date().toISOString()).changes);
  }
  let evaluating;
  async function evaluate() {
    if(evaluating)return evaluating;
    evaluating=(async()=>{
      let added=0;
      const rules=readJson('watch_rules').filter(r=>r.enabled);
      for(const rule of rules.filter(r=>r.type==='news')) {
        const items=store.articles({query:rule.query,exclude:rule.exclude,language:rule.language,city:rule.city,country:rule.country,sourceId:rule.sourceId,category:rule.category,dateFrom:rule.since,limit:1000}).filter(a=>(a.priority||0)>=rule.minimumPriority);
        for(const event of groupEvents(items,store.sources())) {
          const same=store.db.prepare('SELECT group_key,payload FROM news_alerts WHERE rule_id=? AND created_at>=?').all(rule.id,new Date(Date.now()-48*3600000).toISOString()).find(row=>similarHeadlines(JSON.parse(row.payload).title,event.title)>=0.58);
          const payload={type:'news',title:event.title,url:event.articles[0].url,articleId:event.articles[0].id,sourceName:event.articles[0].sourceName,publishedAt:event.lastAt,count:event.count,ruleName:rule.name};
          if(same) store.db.prepare('UPDATE news_alerts SET payload=? WHERE rule_id=? AND group_key=?').run(JSON.stringify(payload),rule.id,same.group_key);
          else added+=insertAlert(rule,event.id,payload);
        }
      }
      const marketRules=rules.filter(r=>r.type==='market');
      if(marketRules.length) {
        const data=await markets.getMarkets();
        for(const rule of marketRules) {
          const item=(data.quotes||[]).find(i=>i.symbol===rule.symbol);
          if(!item||item.stale||item.fallback||item.frequency?.startsWith('monthly')||!Number.isFinite(item.value)||!item.asOf||!Number.isFinite(Date.parse(item.asOf))||Math.abs(Date.now()-Date.parse(item.asOf))>48*3600000)continue;
          if(rule.condition==='change' && (!Number.isFinite(item.changePercent)||Math.abs(item.changePercent)<rule.threshold))continue;
          if(rule.condition==='above'&&item.value<rule.threshold||rule.condition==='below'&&item.value>rule.threshold)continue;
          added+=insertAlert(rule,`${item.symbol}:${item.asOf.slice(0,10)}`,{type:'market',title:`${item.nameFa} · ${item.value} ${item.unit}`,url:item.providerUrl,sourceName:item.provider,publishedAt:item.asOf,value:item.value,changePercent:item.changePercent});
        }
      }
      store.setSetting('lastAlertsCheck',new Date().toISOString());return {added,alerts:alerts()};
    })().finally(()=>{evaluating=null;});return evaluating;
  }
  async function translate(id,target='fa') {
    if(!['fa','en','ar','fr','de','ru','zh-Hans','tr','es'].includes(target))throw new Error('زبان ترجمه پشتیبانی نمی‌شود.');
    const connection=store.getConnection('translator');if(!connection)throw Object.assign(new Error('ابتدا کلید رسمی Microsoft Translator را در تنظیمات وارد کنید.'),{status:409});
    const item=article(id),text=(item.fullText||item.summary||'').slice(0,14000),key=hash(`${id}|${item.title}|${text}|${target}`);
    const cached=store.db.prepare('SELECT payload FROM translations WHERE cache_key=?').get(key);if(cached)return JSON.parse(cached.payload);
    let response;
    try {response=JSON.parse(await fetcher(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${target}`,{method:'POST',headers:{'Content-Type':'application/json','Ocp-Apim-Subscription-Key':connection.token,...(connection.region?{'Ocp-Apim-Subscription-Region':connection.region}:{})},body:JSON.stringify([{Text:item.title},{Text:text||item.title}]),allowedHosts:['api.cognitive.microsofttranslator.com'],maxBytes:500000}));}catch{throw new Error('ترجمه انجام نشد؛ کلید، منطقه و دسترسی سرویس را بررسی کنید.');}
    if(!Array.isArray(response)||response.length!==2||response.some(r=>typeof r.translations?.[0]?.text!=='string'))throw new Error('سرویس ترجمه پاسخ معتبر نداد.');
    const result={title:response[0].translations[0].text,body:response[1].translations[0].text,target,provider:'Microsoft Translator',translatedAt:new Date().toISOString(),inputScope:item.fullText?'publisher-feed':'feed-description',truncated:(item.fullText||item.summary||'').length>14000};
    store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?)').run(key,JSON.stringify(result));return result;
  }
  function saveCalendar(input) {
    const value={id:randomUUID(),title:trimmed(input.title,200),time:trimmed(input.time,40),country:trimmed(input.country,2).toUpperCase(),url:trimmed(input.url,2000),note:trimmed(input.note,1000),origin:'user-entered'};
    if(!value.title||!Number.isFinite(Date.parse(value.time))||!validCountry(value.country)||!safeMediaUrl(value.url))throw new Error('عنوان، زمان معتبر و پیوند رسمی رویداد لازم است.');
    if(readJson('calendar_events').length>=1000)throw new Error('حداکثر هزار رویداد در تقویم قابل ثبت است.');
    value.time=new Date(value.time).toISOString();putJson('calendar_events',value);return value;
  }
  function risk() {
    const queryTerms=['تحریم','sanctions','نرخ بهره','interest rates','تورم','inflation','حریم هوایی','airspace','هشدار سفر','travel advisory','آتش بس','ceasefire','تنش','tensions'];
    const since=new Date(Date.now()-7*86400000).toISOString(),map=new Map();
    for(const query of queryTerms)for(const item of store.articles({query:`"${query}"`,dateFrom:since,limit:100}))map.set(item.id,item);
    return {articles:[...map.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,200),method:'keyword-matches',calendar:readJson('calendar_events').sort((a,b)=>a.time.localeCompare(b.time)),calendarFeeds:calendarService.feeds(),lastCheck:store.getSetting('lastAlertsCheck')};
  }
  return {health,research,saveResearch,article,readJson,putRule,alerts,evaluate,translate,saveProfile,profileArticles,saveCalendar,risk,calendarService,isEvaluating:()=>Boolean(evaluating),
    events:filters=>({events:groupEvents(store.articles({...filters,limit:1000}),store.sources()),scope:'حداکثر ۱۰۰۰ خبر مطابق فیلتر؛ گروه‌بندی احتمالی بر پایهٔ شباهت واژگان، در بازهٔ ۴۸ ساعت'}),
    versions:id=>store.db.prepare('SELECT title,body,captured_at AS capturedAt FROM article_versions WHERE article_id=? ORDER BY id DESC LIMIT 50').all(id),
    remove:(table,id)=>store.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes,
    markAlert:(id)=>store.db.prepare('UPDATE news_alerts SET read=1 WHERE id=?').run(id).changes,
  };
}
