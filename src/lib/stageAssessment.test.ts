import {describe,it,expect} from 'vitest'
import {stageAssessmentResults,stageAssessmentReview} from './stageAssessment'
import {stageCompletion} from './parentCompletion'
import type {DayWorkReview} from './dayStore'
const task={stageAssessments:[{stageId:'oral',title:'Готовность к ответу',scope:'Самопроверка по тексту; не запись речи.',token:'root'}]}
const review={id:'day:review',taskId:'english',checkableStageIds:['written','oral'],checkedAt:{seconds:1,nanoseconds:0},items:[{stageId:'written',label:'Тетрадь',status:'correct'},{stageId:'oral',label:'Устная готовность',status:'cannot-assess'}]} as DayWorkReview
const tests={root:{testId:'a',status:'submitted',familyOptional:true},retry:{testId:'b',linkedToTestId:'a',status:'submitted',slug:'english'}}
describe('addressed stage assessment evidence',()=>{
 it('takes the linked retry, independent of quiz optionality, retaining the other stage and photo review',()=>{
  const result=stageAssessmentResults(task,tests,{root:{points:3,maxPoints:9},retry:{points:8,maxPoints:9}})
  expect(result[0]).toMatchObject({state:'passed',token:'retry',detail:'Подтверждено тестом · 8 из 9'})
  const derived=stageAssessmentReview(review,result)
  expect(stageCompletion(derived,[])?.complete).toBe(true)
  expect(review.items![1].status).toBe('cannot-assess')
  expect(derived?.items?.[0]).toEqual(review.items![0])
 })
 it('never accepts an old pass when a new retry is open or waiting for review',()=>{
  const scores={root:{points:9,maxPoints:9}}
  for(const status of ['open','submitted']){
   const result=stageAssessmentResults(task,{...tests,retry:{...tests.retry,status}},scores)
   expect(stageCompletion(stageAssessmentReview(review,result),[])?.complete).toBe(false)
  }
 })
 it('keeps unknown, wrong results and a pending requested continuation open',()=>{
  expect(stageAssessmentResults(task,{}, {})[0].state).toBe('waiting')
  expect(stageAssessmentResults(task,tests,{retry:{points:4,maxPoints:9}})[0].state).toBe('needs-fix')
  expect(stageAssessmentResults(task,{root:{...tests.root,followupRequested:true}},{root:{points:9,maxPoints:9}})[0].state).toBe('waiting')
 })
})
