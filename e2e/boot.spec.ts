import {test,expect} from '@playwright/test';

test('blocked browser storage and missing optional Intl support cannot blank the app',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});
    Object.defineProperty(Intl,'DisplayNames',{value:undefined,configurable:true});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('اتاق خبر شما');
  await expect(page.getByRole('button',{name:'جمع‌آوری خبرها',exact:true})).toBeVisible();
});

test('an unavailable app module produces a recovery screen instead of an empty page',async({page})=>{
  await page.route('**/src/App.tsx*',route=>route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('اجرای رابط دیدبان ممکن نشد');
  await expect(page.getByRole('button',{name:'تلاش دوباره',exact:true})).toBeVisible();
});
