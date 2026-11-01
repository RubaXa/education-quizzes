/** @see ../docs/shared/design/ui-kit.md */
import {test,expect} from '@playwright/test'
for(const width of [320,390,540])test(`real quiz runner geometry ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('#/ui-kit')
 await page.getByRole('navigation').getByRole('button',{name:'История тестов',exact:true}).click()
 const kit=page.getByRole('region',{name:'Экран вопроса теста',exact:true})
 for(const format of ['Один вариант','Несколько вариантов','Код Python','Короткий ответ','Объяснение']){
  await kit.getByRole('button',{name:format,exact:true}).click()
  const card=kit.locator('.question-card');await card.scrollIntoViewIfNeeded()
  await expect(card).toBeVisible()
  const geometry=await card.evaluate(el=>{
   const box=el.getBoundingClientRect(),chips=[...el.querySelectorAll('.quiz-question-topline > *')].map(c=>c.getBoundingClientRect())
   return {inside:box.left>=0&&box.right<=innerWidth+1,overflow:el.scrollWidth>el.clientWidth,
    chipsInside:chips.every(c=>c.left>=box.left&&c.right<=box.right),
    overlap:chips.length===2&&chips[0].left<chips[1].right&&chips[0].right>chips[1].left&&chips[0].top<chips[1].bottom&&chips[0].bottom>chips[1].top}
  })
  expect(geometry).toEqual({inside:true,overflow:false,chipsInside:true,overlap:false})
 }
 await expect(kit.locator('.hero-description')).toContainText('к 3 ноября')
 await kit.getByRole('button',{name:'Один вариант',exact:true}).click()
 await kit.getByRole('radio').first().check();await expect(kit.getByRole('radio').first()).toBeChecked()
 await kit.getByRole('button',{name:'Только чтение',exact:true}).click();await expect(kit.getByRole('radio').first()).toBeDisabled()
})
