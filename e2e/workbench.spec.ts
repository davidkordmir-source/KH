import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const article={id:'research-fixture',title:'بانک مرکزی آمریکا گزارش نرخ بهره منتشر کرد',summary:'توضیح دریافت‌شده از فید منبع.',fullText:'متن کامل‌تر دریافت‌شده از فید با جزئیات پژوهشی.',summaryAuto:'توضیح دریافت‌شده از فید منبع.',url:'https://news.example/research',sourceId:'fixture',sourceName:'منبع آزمایشی',publishedAt:'2024-03-20T08:00:00.000Z',publishedAtKnown:true,language:'fa',category:'economy',platform:'rss',saved:false,imageUrl:null,media:[],locations:[]};
const emptyResearch={folder:'',note:'',tags:[],review:'unchecked',evidenceUrl:'',reviewNote:''};

test('all newsroom tools open without browser errors, including responsive layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/markets*',route=>route.fulfill({json:{updatedAt:new Date().toISOString(),quotes:[],errors:[]}}));
  await page.goto('/');await page.getByRole('button',{name:'بانک خبر پیشرفته',exact:true}).click();
  const tools=page.getByRole('navigation',{name:'ابزارهای بانک خبر'});
  for(const label of ['جست‌وجو و پژوهش','پروندهٔ رویدادها','مرکز هشدار','ریسک و تقویم بازار','اشخاص و سازمان‌ها','آرشیو رسانه','سلامت منابع','پشتیبان و بازیابی','ترجمه و به‌روزرسانی']){
    await tools.getByRole('button',{name:label,exact:true}).click();
    await expect(tools.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.wb-error')).toHaveCount(0);
  }
  await tools.getByRole('button',{name:'جست‌وجو و پژوهش',exact:true}).click();
  await page.screenshot({path:test.info().outputPath('workbench-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().left>=innerWidth)).toBe(true);
  await expect(page.getByRole('textbox',{name:'عبارت جست‌وجوی پیشرفته'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('workbench-mobile.png'),fullPage:true});
  expect(errors).toEqual([]);
});

test('advanced Jalali search opens original content and persists research edits through the API',async({page})=>{
  let research={...emptyResearch};let lastParameters=new URLSearchParams();
  await page.route('**/api/articles?*',route=>{lastParameters=new URL(route.request().url()).searchParams;return route.fulfill({json:{articles:[article],total:1,limit:50,offset:0}});});
  await page.route('**/api/newsroom/articles/research-fixture',route=>route.fulfill({json:{article,research,versions:[]}}));
  await page.route('**/api/newsroom/articles/research-fixture/research',route=>{research={...research,...route.request().postDataJSON()};return route.fulfill({json:{research}});});
  await page.goto('/');await page.getByRole('button',{name:'بانک خبر پیشرفته',exact:true}).click();
  await page.getByRole('textbox',{name:'عبارت جست‌وجوی پیشرفته'}).fill('"نرخ بهره"');
  await page.getByText('فیلترهای تاریخ، مکان، منبع و پوشه',{exact:true}).click();
  await page.getByRole('textbox',{name:'از تاریخ پیشرفته'}).fill('۱۴۰۳/۰۱/۰۱');await page.getByRole('textbox',{name:'تا تاریخ پیشرفته'}).fill('1403/01/02');
  await page.getByRole('button',{name:'جست‌وجو در آرشیو',exact:true}).click();
  await expect.poll(()=>lastParameters.get('dateFrom')).toBe('2024-03-20');expect(lastParameters.get('dateTo')).toBe('2024-03-21');
  await page.getByRole('button',{name:'متن، ترجمه و یادداشت',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'پرونده و پژوهش خبر'});await expect(dialog).toBeVisible();await expect(dialog.locator('.wb-original')).toContainText('جزئیات پژوهشی');
  await dialog.getByRole('textbox',{name:'پوشهٔ خبر',exact:true}).fill('پژوهش بازار');await dialog.getByRole('textbox',{name:'یادداشت خبر',exact:true}).fill('مقایسه با اطلاعیهٔ رسمی');await dialog.getByRole('button',{name:'ذخیرهٔ یادداشت و بررسی',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('ذخیره شد');
  await dialog.getByRole('button',{name:'بستن پروندهٔ خبر'}).click();await page.getByRole('button',{name:'متن، ترجمه و یادداشت',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'یادداشت خبر',exact:true})).toHaveValue('مقایسه با اطلاعیهٔ رسمی');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('alert rules and saved searches survive reload and can be paused',async({page,request})=>{
  const label=`هشدار آزمون ${Date.now()}`,savedLabel=`جست‌وجوی آزمون ${Date.now()}`;
  let ruleId='',searchId='';
  try{
    await page.goto('/');await page.getByRole('button',{name:'بانک خبر پیشرفته',exact:true}).click();await page.getByRole('textbox',{name:'عبارت جست‌وجوی پیشرفته'}).fill('نرخ بهره');await page.getByRole('button',{name:'جست‌وجو در آرشیو',exact:true}).click();await page.getByRole('button',{name:'ذخیرهٔ جست‌وجو',exact:true}).click();await page.getByRole('textbox',{name:'نام جست‌وجوی ذخیره‌شده'}).fill(savedLabel);await page.getByRole('button',{name:'ثبت جست‌وجو',exact:true}).click();await expect(page.getByRole('button',{name:savedLabel,exact:true})).toBeVisible();
    const searches=await(await request.get('/api/newsroom/searches')).json();searchId=searches.searches.find((s:{name:string})=>s.name===savedLabel).id;
    await page.getByRole('button',{name:'مرکز هشدار',exact:true}).click();await page.getByRole('textbox',{name:'نام قانون هشدار'}).fill(label);await page.getByRole('textbox',{name:'عبارت قانون هشدار'}).fill('نرخ بهره');await page.getByRole('button',{name:'افزودن قانون هشدار',exact:true}).click();
    const row=page.locator('.wb-rules .wb-card').filter({hasText:label});await expect(row).toBeVisible();const rules=await(await request.get('/api/newsroom/rules')).json();ruleId=rules.rules.find((r:{name:string})=>r.name===label).id;
    await row.getByRole('button',{name:'فعال · توقف',exact:true}).click();await expect(row.getByRole('button',{name:'متوقف · فعال‌سازی',exact:true})).toBeVisible();
    await page.reload();await page.getByRole('button',{name:'بانک خبر پیشرفته',exact:true}).click();await expect(page.getByRole('button',{name:savedLabel,exact:true})).toBeVisible();await page.getByRole('button',{name:'مرکز هشدار',exact:true}).click();await expect(row.getByRole('button',{name:'متوقف · فعال‌سازی',exact:true})).toBeVisible();
  }finally{if(ruleId)await request.delete(`/api/newsroom/rules/${ruleId}`);if(searchId)await request.delete(`/api/newsroom/searches/${searchId}`);}
});

test('encrypted backup download has the expected format and restore requires an explicit selection and confirmation',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'بانک خبر پیشرفته',exact:true}).click();await page.getByRole('button',{name:'پشتیبان و بازیابی',exact:true}).click();
  await expect(page.getByRole('button',{name:'بازیابی فایل انتخاب‌شده',exact:true})).toBeDisabled();await page.getByRole('textbox',{name:'گذرواژهٔ پشتیبان'}).fill('browser-test-password');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'دانلود پشتیبان رمزگذاری‌شده',exact:true}).click();const download=await downloadPromise;const file=await download.path();expect(file).toBeTruthy();expect(readFileSync(file!).subarray(0,8).toString()).toBe('DIDEBAN3');
  await expect(page.getByRole('textbox',{name:'گذرواژهٔ پشتیبان'})).toHaveValue('');await expect(page.getByRole('button',{name:'بازیابی فایل انتخاب‌شده',exact:true})).toBeDisabled();
});
