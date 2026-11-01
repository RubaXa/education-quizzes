import {describe,it,expect} from 'vitest'
import {reviewReplyErrors,reviewResponseErrors,resolveReviewReplyStep} from './review-reply.mjs'
const activity={kind:'write',label:'Твой вывод',instruction:'Запиши свою мысль.',tokens:[{id:'n',text:'Вывод'}],frame:[{slotId:'n'}]}
const step={question:'Что верно о сумме?',activity}
const review={status:'partial',checkedAt:'2026-11-01',studentFeedback:{title:'Проверь связь',confirmed:'Оба случая найдены.',focus:'Проверь отрицание.',question:step.question,presentation:{version:1,activity}}}
const reply={version:1,sourceId:'review',checkedAt:'2026-11-01',correctedAt:null,step,intent:'answer',value:JSON.stringify({selected:[],groups:{},written:{n:'моя мысль'}})}
describe('current review reply',()=>{
 it('binds the response to the exact published question and review revision',()=>{
  expect(reviewReplyErrors(reply)).toEqual([])
  expect(resolveReviewReplyStep(reply,review)).toEqual(step)
  expect(()=>resolveReviewReplyStep({...reply,step:{...step,question:'Подмена'}},review)).toThrow()
  expect(()=>resolveReviewReplyStep(reply,{...review,checkedAt:'new'})).toThrow()
 })
 it('allows one-click stuck; rejects empty answers, invented tokens and hidden evaluators',()=>{
  expect(reviewReplyErrors({...reply,intent:'stuck',value:'{"selected":[],"groups":{},"written":{}}'})).toEqual([])
  for(const patch of [{value:'{"selected":[],"groups":{},"written":{}}'},{value:'{"written":{"secret":"9"}}'},{answer:'secret'}]) expect(reviewReplyErrors({...reply,...patch}).length).toBeGreaterThan(0)
 })
 it('requires a concrete feedback and one safe next model, or explicit step closure',()=>{
  const response={outcome:'partial',message:'Ты учёл первую фразу. Проверь отрицание во второй.',next:{title:'Проверь связь',confirmed:'Первая связь сохранена.',focus:'Теперь вторая фраза.',question:step.question,presentation:{version:1,activity}}}
  expect(reviewResponseErrors(response)).toEqual([])
  expect(reviewResponseErrors({...response,next:{...response.next,answer:'9'}}).length).toBeGreaterThan(0)
  expect(reviewResponseErrors({outcome:'correct',message:'Этот переход обоснован.',complete:true})).toEqual([])
  expect(reviewResponseErrors({outcome:'correct',message:'Верно'}).length).toBeGreaterThan(0)
 })
})
