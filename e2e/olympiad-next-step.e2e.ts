/** @see ../docs/shared/design/information-hierarchy.md */
import{expect,test}from'@playwright/test'
for(const width of [320,390,540])for(const role of ['Родитель','Ученик'])test(`${role}: next task precedes organization at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:740});await page.goto('#/ui-kit');await page.getByRole('button',{name:'Страница олимпиады',exact:true}).click()
 if(role==='Ученик')await page.getByRole('button',{name:role,exact:true}).click()
 const context=page.getByRole('region',{name:'Подготовка к олимпиаде',exact:true}),overview=context.locator('.olympiad-overview'),action=overview.getByRole('button',{name:'Открыть задачу',exact:true})
 await expect(action).toHaveCount(1);await expect(context.locator('.olympiad-preparation-next')).toHaveCount(1)
 await overview.evaluate(el=>el.scrollIntoView({block:'start'}))
 const box=await action.boundingBox();expect(box!.y+box!.height).toBeLessThan(740)
 expect(await action.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
 expect(await overview.locator('.olympiad-registration').isVisible()).toBe(false)
 expect((await overview.textContent())!.split('Регистрация и отправка решений — в кабинете организатора.')).toHaveLength(2)
 expect(await action.evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.olympiad-next-event')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
 await action.click();await expect(context.locator('#olympiad-practice-demo-task')).toBeFocused();expect(new URL(page.url()).hash).toBe('#/ui-kit')
 await overview.locator('.olympiad-information-details summary').first().click();await expect(overview.locator('.olympiad-registration')).toBeVisible();await expect(overview.locator('.olympiad-registration')).toHaveAttribute('href','https://example.org/registration')
})
