// @vitest-environment jsdom
/** @see ../../docs/shared/design/student-review-step.md */
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it} from 'vitest'
import WorkReview from './WorkReview'
import {studentReviewProjection} from '../../storage/review-projection.mjs'
import type {DayWorkReview} from '@/lib/dayStore'
import type {ReviewActivityData} from '../../packages/education-presentation/review-activity.mjs'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const activity:ReviewActivityData={kind:'build',label:'Собери запись',instruction:'Нажимай на данные в выбранном порядке.',joiner:' + ',tokens:[{id:'a',text:'3'},{id:'b',text:'5'}]}
it('lets the actual learner projection manipulate the current model without revealing a solution, scoring or writing',async()=>{
 const privateReview={id:'r',taskId:'t',status:'partial',studentFeedback:{title:'Объедини группы',confirmed:'Обе группы найдены.',focus:'Нужны все предметы.',question:'Сколько их всего?',presentation:{version:1,activity}},assessmentBasis:{requirement:'Closed condition',limitation:'Домашняя необязательная практика. Объём помощи неизвестен.'},tutoringPlan:{responseCriterion:'Closed answer 8'}}
 const projected=studentReviewProjection(privateReview) as DayWorkReview
 const before=JSON.stringify(projected),host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<WorkReview review={projected} uploads={[]}/>))
  expect(host.querySelector('.edu-step')).not.toBeNull()
  expect(host.textContent).not.toMatch(/Closed|необязательная|Объём помощи/)
  const buttons=()=>Array.from(host.querySelectorAll('button'))
  await act(async()=>buttons().find(b=>b.textContent==='5')!.click())
  await act(async()=>buttons().find(b=>b.textContent==='3')!.click())
  expect(host.querySelector('output')?.textContent?.replace(/\s/g,'')).toBe('5+3')
  expect(host.querySelector('output')?.textContent).not.toContain('8')
  expect(host.querySelectorAll('.edu-review-question')).toHaveLength(1)
  expect(host.querySelector('.edu-review-state')?.textContent).toBe('Есть правка')
  expect(JSON.stringify(projected)).toBe(before)
  await act(async()=>buttons().find(b=>b.textContent==='Сбросить')!.click())
  expect(host.querySelector('output')?.textContent).toBe('…')
  await act(async()=>root.render(<WorkReview review={{...projected,status:'verified'}} uploads={[]}/>))
  expect(host.querySelector('.edu-step')).toBeNull();expect(host.querySelector('.edu-review-question')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
})
