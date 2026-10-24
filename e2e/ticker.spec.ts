import {test,expect} from '@playwright/test';

const story=(id:string,priority=0,breakingScore=0)=>({id,title:`عنوان نظامی آزمایشی ${id} برای زیرنویس خبر`,summary:'فقط دادهٔ آزمون',url:`https://example.com/${id}`,sourceName:'منبع آزمون',sourceId:'test',platform:'rss',publishedAt:new Date().toISOString(),publishedAtKnown:true,category:'world',language:'fa',saved:false,priority,breakingScore});

test('TV ticker automatically includes important stories, moves, pauses and remains fixed while scrolling',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/api/dashboard',route=>route.fulfill({json:{articles:[story('urgent',0,80),story('chosen',2),{...story('normal'),title:'گزارش قیمت بازار'}],sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
  await page.goto('/');const ticker=page.getByRole('region',{name:'زیرنویس متحرک خبرها'});
  await expect(ticker).toBeVisible();await expect(ticker).toContainText('فوری نظامی');
  await expect(ticker).toContainText('urgent');await expect(ticker).toContainText('chosen');await expect(ticker).not.toContainText('normal');
  const track=ticker.locator('.tv-ticker-track');
  await expect.poll(()=>track.evaluate(el=>getComputedStyle(el).transform)).not.toBe('none');
  const initial=await track.evaluate(el=>getComputedStyle(el).transform);
  await expect.poll(()=>track.evaluate(el=>getComputedStyle(el).transform)).not.toBe(initial);
  await page.getByRole('button',{name:'توقف زیرنویس خبری'}).click();await expect.poll(()=>track.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
  await page.getByRole('button',{name:'ادامهٔ زیرنویس خبری'}).click();await expect.poll(()=>track.evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('running');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  const rect=await ticker.boundingBox();expect(Math.round(rect!.y+rect!.height)).toBe(1000);
  await page.screenshot({path:test.info().outputPath('tv-ticker.png')});
});

test('ticker falls back to latest actual headlines and fits mobile without manual priority',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/dashboard',route=>route.fulfill({json:{articles:[story('latest')],sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
  await page.goto('/');const ticker=page.getByRole('region',{name:'زیرنویس متحرک خبرها'});
  await expect(ticker).toContainText('اخبار نظامی');await expect(ticker).toContainText('latest');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});

test('ticker remains visible with an honest empty state and respects reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  let articles: ReturnType<typeof story>[] = [];
  await page.route('**/api/dashboard',route=>route.fulfill({json:{articles,sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
  await page.goto('/');await expect(page.getByRole('region',{name:'زیرنویس متحرک خبرها'})).toContainText('در انتظار خبر مرتبط با امور نظامی');
  await expect(page.getByRole('button',{name:'توقف زیرنویس خبری'})).toBeDisabled();
  articles=[story('reduced-motion')]; await page.reload();
  await expect(page.locator('.tv-ticker-track')).toBeVisible();
  expect(await page.locator('.tv-ticker-track').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
