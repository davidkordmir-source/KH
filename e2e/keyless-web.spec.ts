import {test,expect} from '@playwright/test';
const article={id:'google',title:'Original headline',summary:'Original report',url:'https://news.example/1',imageUrl:null,sourceId:'source',sourceName:'Publisher',platform:'rss',publishedAt:new Date().toISOString(),category:'world',language:'en',saved:false};
test('one-click Google translation needs no key, retains original text and offers a real web fallback',async({page})=>{
 await page.route('**/api/dashboard',route=>route.fulfill({json:{articles:[article],sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
 let fail=false;await page.route('**/api/newsroom/articles/google/translate-google',route=>{expect(route.request().postDataJSON()).toEqual({target:'fa'});return route.fulfill(fail?{status:502,json:{error:'گوگل نیاز به بررسی مرورگر دارد.'}}:{json:{title:'ترجمهٔ گوگل',body:'متن فارسی',provider:'Google Translate (وب، بدون کلید)'}});});
 await page.goto('/');await page.getByRole('button',{name:'ترجمهٔ گوگل به فارسی · بدون کلید',exact:true}).click();await expect(page.locator('.generated-summary')).toContainText('ترجمهٔ گوگل');await expect(page.locator('.article-card')).toContainText(article.title);
 const url=new URL(await page.getByRole('link',{name:'بازکردن در گوگل',exact:true}).getAttribute('href')||'');expect(url.hostname).toBe('translate.google.com');expect(url.searchParams.get('tl')).toBe('fa');expect(url.searchParams.get('text')).toContain(article.title);
 fail=true;await page.getByRole('button',{name:'ترجمهٔ گوگل به فارسی · بدون کلید',exact:true}).click();await expect(page.getByRole('alert')).toContainText('بررسی مرورگر');
});
test('Instagram and X keyless options are clearly experimental and never request passwords or keys',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'حساب‌های متصل',exact:true}).click();const section=page.getByRole('region',{name:'شبکه‌های اجتماعی بدون کلید API'});
 for(const type of ['instagram','x']){await section.getByRole('combobox',{name:'شبکه بدون کلید'}).selectOption(type);await expect(section).toContainText('آزمایشی');await expect(section.locator('input[type=password]')).toHaveCount(0);}
});
