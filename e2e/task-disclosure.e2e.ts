/** @see ../docs/modules/school-diary/day-page.md#task-disclosure */
import {test,expect} from '@playwright/test'
for(const width of [320,390,540])test(`compact assignments ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('#/ui-kit');await page.getByRole('navigation').getByRole('button',{name:'Карточки заданий',exact:true}).click()
 const example=page.getByRole('region',{name:'Свёрнутые задания',exact:true}),cards=example.locator('.edu-task-disclosure')
 await expect(cards).toHaveCount(3)
 for(const card of await cards.all()){
  await expect(card).not.toHaveAttribute('open','')
  await expect(card.locator('.edu-task-body')).not.toBeVisible()
  await expect(card.locator('.edu-task-title')).toBeVisible();await expect(card.locator('.edu-task-summary-status')).toBeVisible()
  const widthCheck=await card.evaluate(el=>({id:el.id,client:el.clientWidth,scroll:el.scrollWidth,wide:[...el.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>el.getBoundingClientRect().right+1).slice(0,5).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width,text:n.textContent?.slice(0,80)}))}));expect(widthCheck.scroll<=widthCheck.client,JSON.stringify(widthCheck)).toBe(true)
  expect(await card.locator(':scope > summary').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  expect(await card.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(180)
 }
 const first=cards.nth(0),second=cards.nth(1)
 await first.locator(':scope > summary').press('Space');await expect(first).toHaveAttribute('open','');await expect(second).not.toHaveAttribute('open','')
 await first.getByRole('textbox',{name:'Моя заметка',exact:true}).fill('Моя запись')
 await first.locator(':scope > summary').click();await expect(first).not.toHaveAttribute('open','')
 await example.getByRole('button',{name:'Обновить статус ЦДЗ в примере',exact:true}).click();await expect(second.locator(':scope > summary')).toContainText('ЦДЗ выполнено');await expect(first).not.toHaveAttribute('open','');await expect(second).not.toHaveAttribute('open','')
 await first.locator(':scope > summary').press('Enter');await expect(first.getByRole('textbox')).toHaveValue('Моя запись')
 await first.locator(':scope > summary').click()
 const quiz=cards.nth(2);await quiz.locator(':scope > summary').click();await expect(quiz.locator('.day-quiz-lineage')).toBeVisible();await quiz.locator(':scope > summary').first().click();await expect(quiz.locator('.day-quiz-lineage')).not.toBeVisible()
})
