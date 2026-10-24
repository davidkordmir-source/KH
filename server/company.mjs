import { parseYahooChart, MARKET_HOSTS } from './markets.mjs';
export function companyFields(input) {
  const symbol=typeof input.marketSymbol==='string'?input.marketSymbol.trim().toUpperCase():'';
  const cik=typeof input.cik==='string'?input.cik.trim().replace(/^0+/,''):'';
  const leaders=Array.isArray(input.leaders)?input.leaders.map(value=>String(value).trim().slice(0,100)).filter(Boolean).slice(0,15):[];
  if(symbol&&!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol))throw new Error('نماد شرکت معتبر نیست.');
  if(cik&&!/^\d{1,10}$/.test(cik))throw new Error('شناسهٔ CIK باید حداکثر ده رقم باشد.');
  return {marketSymbol:symbol,cik,leaders};
}
export function createCompanyService({store,fetcher}) {
  const cache=new Map(),pending=new Map();
  async function get(id) {
    const row=store.db.prepare('SELECT payload FROM profiles WHERE id=?').get(id);if(!row)throw Object.assign(new Error('پروندهٔ شرکت پیدا نشد.'),{status:404});
    const company=JSON.parse(row.payload);if(company.type!=='company')throw new Error('این پرونده از نوع شرکت نیست.');
    const key=JSON.stringify([id,company.marketSymbol,company.cik]);if(cache.has(key)&&Date.now()-cache.get(key).time<300000)return cache.get(key).result;if(pending.has(key))return pending.get(key);
    const operation=(async()=>{
      const result={company,quote:null,filings:[],errors:[],checkedAt:new Date().toISOString()};
      await Promise.all([
        (async()=>{if(!company.marketSymbol)return;for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const instrument={symbol:company.marketSymbol,nameFa:company.name,unit:'واحد ارز اعلام‌شدهٔ بورس',kind:'equity',currency:null,providerUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(company.marketSymbol)}/`};const raw=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(company.marketSymbol)}?interval=1d&range=3mo`,{allowedHosts:MARKET_HOSTS,maxBytes:3000000});const parsed=JSON.parse(raw);result.quote={...parseYahooChart(parsed,instrument),currency:parsed.chart?.result?.[0]?.meta?.currency||null,unit:parsed.chart?.result?.[0]?.meta?.currency||'واحد منبع'};return;}catch{/* Try the second Yahoo endpoint. */}}result.errors.push('قیمت شرکت از منبع بورس دریافت نشد.');})(),
        (async()=>{if(!company.cik)return;try{const raw=await fetcher(`https://data.sec.gov/submissions/CIK${company.cik.padStart(10,'0')}.json`,{allowedHosts:['data.sec.gov'],maxBytes:5000000,headers:{'User-Agent':`Dideban newsroom research ${process.env.SEC_CONTACT_EMAIL||'(personal use; contact not configured)'}`}}),data=JSON.parse(raw),recent=data.filings?.recent;if(!recent||!Array.isArray(recent.accessionNumber))throw new Error('No filings');result.filings=recent.accessionNumber.slice(0,30).flatMap((accession,index)=>{const document=recent.primaryDocument?.[index];if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof document!=='string'||!/^[A-Za-z0-9_.-]+$/.test(document))return [];return [{form:recent.form?.[index]||'',filingDate:recent.filingDate?.[index]||'',reportDate:recent.reportDate?.[index]||'',description:recent.primaryDocDescription?.[index]||document,url:`https://www.sec.gov/Archives/edgar/data/${company.cik}/${accession.replaceAll('-','')}/${document}`}];});}catch{result.errors.push('اطلاعیه‌های SEC دریافت نشد؛ دسترسی منبع و تنظیم SEC_CONTACT_EMAIL را بررسی کنید.');}})(),
      ]);
      cache.set(key,{time:Date.now(),result});return result;
    })().finally(()=>pending.delete(key));pending.set(key,operation);return operation;
  }
  return {get};
}
