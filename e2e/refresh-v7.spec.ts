import {test,expect} from '@playwright/test';
const article={id:'category',url:'https://news.example/1',title:'خبر نمونه برای دسته‌بندی',summary:'متن آزمایشی برای نمایش رابط جدید',sourceId:'test',sourceName:'منبع آزمون',category:'world',language:'fa',platform:'rss',publishedAt:'2026-10-28T10:00:00Z',saved:false,userCategory:null as string|null};
const categories=[{id:'military',name:'نظامی'},{id:'politics',name:'سیاسی'},{id:'social',name:'اجتماعی'},{id:'world',name:'جهان'}];
test('manual category selection updates the visible filter and has a persistent API action',async({page})=>{
 await page.route('**/api/dashboard',route=>route.fulfill({json:{articles:[article],categories,sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
 await page.route('**/api/articles/category/category',route=>{const value=route.request().postDataJSON().category;article.userCategory=value;article.category=value||'world';return route.fulfill({json:{article}});});
 await page.goto('/');await expect(page.locator('.brand')).toContainText('خبرنما');await page.getByRole('combobox',{name:`دسته‌بندی خبر ${article.title}`}).selectOption('military');
 await expect(page.locator('.manual-category')).toContainText('انتخاب شما');await page.locator('.category-tabs').getByRole('button',{name:'نظامی',exact:true}).click();await expect(page.locator('.article-card')).toHaveCount(1);
 await page.locator('.category-tabs').getByRole('button',{name:'اجتماعی',exact:true}).click();await expect(page.locator('.article-card')).toHaveCount(0);
});
test('large news lists initially render 40 cards and progressively show more instead of blocking navigation',async({page})=>{
 await page.route('**/api/dashboard',route=>route.fulfill({json:{articles:Array.from({length:100},(_,index)=>({...article,id:`item-${index}`,url:`https://news.example/${index}`})),categories,sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null}}));
 await page.goto('/');await expect(page.locator('.article-card')).toHaveCount(40);await page.screenshot({path:test.info().outputPath('khabarnama-overview.png'),fullPage:false});await page.getByRole('button',{name:/نمایش ۴۰ خبر بعدی/}).click();await expect(page.locator('.article-card')).toHaveCount(80);
 await page.screenshot({path:test.info().outputPath('khabarnama-newsroom.png'),fullPage:false});
});
test('archive offers a real keyless historical request and distinguishes a network failure from an empty local bank',async({page})=>{
 await page.route('**/api/archive/public-day',route=>{expect(route.request().postDataJSON().date).toBe('2024-03-20');return route.fulfill({status:502,json:{error:'صفحهٔ آرشیو عمومی ناشر قابل دریافت نبود.'}});});
 await page.goto('/');await page.getByRole('button',{name:'تاریخچهٔ خبر',exact:true}).click();await page.getByRole('textbox',{name:'سال هجری شمسی'}).fill('۱۴۰۳');await page.getByRole('textbox',{name:'ماه هجری شمسی'}).fill('۰۱');await page.getByRole('textbox',{name:'روز هجری شمسی'}).fill('۰۱');await page.getByRole('button',{name:'دریافت اینترنتی روز انتخاب‌شده · بدون کلید',exact:true}).click();await expect(page.getByRole('alert')).toContainText('آرشیو عمومی ناشر');
});
test('Instagram fallback permits an explicit manual post import without any password field',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'حساب‌های متصل',exact:true}).click();const reader=page.getByRole('region',{name:'خواندن دستی از اینستاگرام و ایکس'});await reader.locator('summary').click();await reader.getByRole('textbox',{name:'لینک پست دستی'}).fill('https://www.instagram.com/p/BROWSER_TEST/');await reader.getByRole('textbox',{name:'متن پست دستی'}).fill('متن انتخابی آزمایشی از پست عمومی');await reader.getByRole('button',{name:'ذخیرهٔ پست دستی',exact:true}).click();await expect(reader.getByRole('status')).toContainText('پست در بانک خبر ذخیره شد');await expect(reader.locator('input[type=password]')).toHaveCount(0);
});
