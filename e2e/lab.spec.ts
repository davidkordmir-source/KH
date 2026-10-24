import {test,expect} from '@playwright/test';
test('research tools render and subtitle import works without an AI key',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');await page.getByRole('button',{name:'دستیار و ابزارهای تازه',exact:true}).first().click();
 const nav=page.getByRole('navigation',{name:'ابزارهای پژوهش هوشمند'});
 for(const name of ['دستیار آرشیو','رویدادهای چندزبانه','شرکت‌ها و نمادها','مسیر انتشار','ویندوز و موبایل','تنظیم سرویس‌ها']){await nav.getByRole('button',{name,exact:true}).click();await expect(nav.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');}
 await nav.getByRole('button',{name:'گفتار و سند',exact:true}).click();await page.getByLabel('نوع پردازش رسانه').selectOption('subtitles');await page.getByLabel('فایل پردازش رسانه').setInputFiles({name:'sample.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:02,500 --> 00:00:05,000\nمتن نمونه برای آزمون\n')});await page.getByRole('button',{name:'پردازش و ذخیرهٔ متن'}).click();await expect(page.locator('.transcript-segment')).toContainText('متن نمونه');expect(errors).toEqual([]);
});
