import { describe,expect,it } from 'vitest'
import { projectReviewSupplement,reviewSupplementErrors,reviewVisualValid } from './review-content.mjs'
it('stores table rows as maps rather than Firestore-incompatible nested arrays',()=>{
 expect(reviewVisualValid({kind:'comparison',label:'Таблица',columns:['A','B'],rows:[{cells:['1','2']}]})).toBe(true)
 expect(reviewVisualValid({kind:'comparison',label:'Таблица',columns:['A','B'],rows:[['1','2']]})).toBe(false)
 expect(reviewVisualValid({kind:'comparison',label:'Таблица',columns:['A','B'],rows:[{cells:['1','2'],answerKey:'closed'}]})).toBe(false)
})
describe('public compact review content',()=>{
 const supplement=()=>({version:1,visual:{kind:'facts',label:'Две роли',items:[{label:'Первый',value:'Лжец'},{label:'Второй',value:'Рыцарь'}]},details:[{label:'Запись',quotation:'Дословная запись.',text:'Проверь связь с ролью.'}]})
 it('keeps validated public text and graphics without mutating the input',()=>{
  const source=supplement(),before=JSON.stringify(source),result=projectReviewSupplement(source)
  expect(result).toEqual(source);expect(result).not.toBe(source);expect(JSON.stringify(source)).toBe(before)
 })
 it('rejects closed answer metadata at every public nesting level',()=>{
  for(const mutate of [r=>r.answerKey='closed',r=>r.visual.items[0].expected='closed',r=>r.details[0].privatePlan='closed']){
   const value=supplement();mutate(value);expect(reviewSupplementErrors(value).length).toBeGreaterThan(0);expect(projectReviewSupplement(value)).toBeUndefined()
  }
 })
 it('rejects unknown rendering and oversized or ragged tables',()=>{
  for(const visual of [{kind:'html',label:'html',html:'<script/>'},{kind:'comparison',label:'table',columns:['A','B'],rows:[['1']]}])
   expect(projectReviewSupplement({version:1,visual})).toBeUndefined()
 })
})
