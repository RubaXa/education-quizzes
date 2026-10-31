/** @see ../docs/modules/assessments/olympiad-history.md#персональная-подготовка */
import { expect,test } from '@playwright/test'
for(const width of [320,390,540])test(`personal next step and archived evidence at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:950});await page.goto('#/ui-kit');await page.getByRole('button',{name:'История олимпиад',exact:true}).click()
 const example=page.locator('#olympiad-history-showcase'),summary=example.getByRole('region',{name:'Моя подготовка',exact:true})
 await expect(summary).toContainText('Уже получается');await expect(summary).toContainText('Над чем работаем');await expect(summary.getByRole('button',{name:'Открыть задачу',exact:true})).toHaveCount(1)
 expect(await summary.locator('.olympiad-preparation-group p').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px')
 expect(await summary.getByRole('heading',{name:'Уже получается'}).evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px')
 await summary.getByRole('button',{name:'Прошлый сезон · работа №1',exact:true}).click();await expect(summary.getByRole('link',{name:'Открыть файл',exact:true})).toHaveAttribute('href',/^blob:/)
 await summary.getByRole('button',{name:'Закрыть прошлую работу',exact:true}).click();await expect(summary.getByRole('link',{name:'Открыть файл',exact:true})).toHaveCount(0)
 await summary.getByRole('button',{name:'Открыть задачу',exact:true}).click();await expect(example.locator('[data-preparation-next]')).toHaveAttribute('data-preparation-next','opened');expect(new URL(page.url()).hash).toBe('#/ui-kit')
 await example.getByRole('button',{name:'Ученик',exact:true}).click();await expect(summary).not.toContainText('Примечания к источникам')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
