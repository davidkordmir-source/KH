import {test,expect} from '@playwright/test';
test('public social form accepts a Telegram channel without any secret input and reports real access failures',async({page})=>{
 await page.route('**/api/public-connections',route=>{expect(route.request().postDataJSON()).toEqual({type:'telegram',input:'@test_channel',label:'کانال آزمایشی'});return route.fulfill({status:422,json:{error:'پیش‌نمایش عمومی قابل خواندن پیدا نشد.'}});});
 await page.goto('/');await page.getByRole('button',{name:'حساب‌های متصل',exact:true}).click();
 const section=page.getByRole('region',{name:'شبکه‌های اجتماعی بدون کلید API'});await expect(section.locator('input[type=password]')).toHaveCount(0);
 await section.getByRole('textbox',{name:'نام منبع بدون کلید'}).fill('کانال آزمایشی');await section.getByRole('textbox',{name:'لینک منبع بدون کلید'}).fill('@test_channel');await section.getByRole('button',{name:'افزودن بدون کلید',exact:true}).click();await expect(section.getByRole('alert')).toContainText('پیش‌نمایش عمومی');
 await section.getByRole('combobox',{name:'شبکه بدون کلید'}).selectOption('bluesky');await expect(section).toContainText('بدون کلید، رمز و ورود');await expect(section).toContainText('اینستاگرام');
});
