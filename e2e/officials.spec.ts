import {test,expect} from '@playwright/test';

test('official sources have all five country filters and truthful website actions',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'منابع رسمی مقامات',exact:true}).click();
  const shortcuts=page.getByLabel('کشورهای منابع رسمی');
  for(const name of ['ایالات متحده','بریتانیا','اسرائیل','روسیه','چین']) await expect(shortcuts.getByRole('button',{name,exact:true})).toBeVisible();
  await shortcuts.getByRole('button',{name:'چین',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'کشور منبع'})).toHaveValue('CN');
  const rows=page.locator('.catalog-row');await expect(rows).toHaveCount(3);
  await expect(rows.filter({hasText:'وزارت امور خارجهٔ چین'})).toBeVisible();
  await expect(rows.getByRole('link',{name:'مشاهدهٔ سایت رسمی'})).toHaveCount(2);
  await expect(rows.getByRole('button',{name:'افزودن',exact:true})).toHaveCount(1);
  await shortcuts.getByRole('button',{name:'اسرائیل',exact:true}).click();
  await expect(rows.filter({hasText:'دفتر نخست‌وزیر اسرائیل'}).getByRole('link',{name:'مشاهدهٔ سایت رسمی'})).toHaveAttribute('href',/https:\/\/www\.gov\.il\//);
  await expect(rows).toHaveCount(2);
  await shortcuts.getByRole('button',{name:'بریتانیا',exact:true}).click();
  await expect(rows.getByRole('button',{name:'افزودن',exact:true})).toHaveCount(3);
});
