import {test,expect} from '@playwright/test';
test.afterEach(async({request})=>{const data=await(await request.get('/api/dashboard')).json();for(const source of data.sources||[])if(source.url==='https://www.president.gov.ua/en/news/speeches')await request.delete(`/api/sources/${source.id}`);});
test('Ukraine official source can be registered as pending with honest status even if network collection is denied',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'منابع رسمی مقامات',exact:true}).click();await page.getByLabel('کشورهای منابع رسمی').getByRole('button',{name:'اوکراین',exact:true}).click();
 const row=page.locator('.catalog-row').filter({hasText:'ریاست‌جمهوری اوکراین'});await row.getByRole('button',{name:'ثبت برای بررسی بعدی',exact:true}).click();const card=page.locator('.source-card').filter({hasText:'ریاست‌جمهوری اوکراین'});await expect(card).toContainText('دریافت تأیید نشده');await expect(card.getByRole('button',{name:'بررسی دریافت'})).toBeVisible();
 const reader=page.getByRole('region',{name:'ورود دستی سخنرانی مقامات'});await reader.locator('summary').click();await reader.getByRole('textbox',{name:'لینک پست دستی'}).fill('https://www.president.gov.ua/en/news/e2e-speech');await reader.getByRole('textbox',{name:'متن پست دستی'}).fill('متن آزمایشی که کاربر از سخنرانی رسمی انتخاب کرده است.');await reader.getByRole('button',{name:'ذخیرهٔ پست دستی',exact:true}).click();await expect(reader.getByRole('status')).toContainText('ذخیره شد');
});
test('source dialog exposes pending registration separately from verified collection',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:/^منابع خبری/}).click();await page.getByRole('button',{name:'افزودن منبع',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'روش افزودن منبع'}).selectOption('pending');await expect(dialog).toContainText('دریافت خبر تأیید نشده');
});
