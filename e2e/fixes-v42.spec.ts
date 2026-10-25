import {test,expect} from '@playwright/test';
const article={id:'foreign',title:'Original English headline',summary:'Original publisher report',url:'https://news.example/1',imageUrl:null,sourceId:'source',sourceName:'Publisher',platform:'rss',publishedAt:new Date().toISOString(),category:'world',language:'en',saved:false};
const dashboard={articles:[article],sources:[],connections:[],keywords:[],syncErrors:[],lastSyncAt:null};
test('foreign news has direct one-click Persian translation and retains original text',async({page})=>{
 await page.route('**/api/dashboard',route=>route.fulfill({json:dashboard}));
 await page.route('**/api/newsroom/articles/foreign/translate',route=>{expect(route.request().postDataJSON()).toEqual({target:'fa'});return route.fulfill({json:{title:'عنوان ترجمه‌شده',body:'متن فارسی خبر',provider:'Test translator'}});});
 await page.goto('/');await page.getByRole('button',{name:'ترجمه به فارسی',exact:true}).click();
 await expect(page.locator('.article-card')).toContainText('عنوان ترجمه‌شده');await expect(page.locator('.article-card')).toContainText(article.title);
});
test('mouse wheel zooms the map in and out',async({page})=>{
 await page.route('**/api/dashboard',route=>route.fulfill({json:dashboard}));
 await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
 await page.goto('/');await page.getByRole('button',{name:'نقشهٔ خبر',exact:true}).click();
 const map=page.locator('.atlas-map');await expect(map.locator('[data-country="IR"]')).toBeAttached();
 const out=map.locator('.leaflet-control-zoom-out');await expect(out).toHaveClass(/leaflet-disabled/);
 await map.hover({position:{x:180,y:200}});await page.mouse.wheel(0,-120);
 await expect(out).not.toHaveClass(/leaflet-disabled/);await page.waitForTimeout(400);await page.mouse.wheel(0,120);await expect(out).toHaveClass(/leaflet-disabled/);
});
test('add-source dialog clearly offers link-only mode for sites without feeds',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/^منابع خبری/}).click();await page.getByRole('button',{name:'افزودن منبع',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'روش افزودن منبع'}).selectOption('link');await expect(dialog).toContainText('هیچ خبری از آن جمع‌آوری نمی‌شود');
});
