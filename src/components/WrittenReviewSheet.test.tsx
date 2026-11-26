// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {describe,it,expect} from 'vitest'
import WorkReview from './WorkReview'
import type {DayWorkReview} from '@/lib/dayStore'
import {writtenSheetExample,writtenSheetUploads} from '@/ui-kit/WrittenReviewSheetExample'
import {studentReviewProjection} from '../../storage/review-projection.mjs'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
describe('written work sheet in the real WorkReview',()=>{
 it.each([false,true])('opens comments inline and originals without changing the accepted work, parent=%s',async parent=>{
  const data=structuredClone(writtenSheetExample),before=JSON.stringify(data),h=document.createElement('div'),root=createRoot(h);document.body.append(h)
  try{
   await act(async()=>root.render(<WorkReview parent={parent} uploads={writtenSheetUploads} review={parent?data:studentReviewProjection(data) as DayWorkReview}/>))
   expect(h.querySelector('.edu-review-state')?.textContent).toBe('Зачтено')
   const mark=h.querySelector<HTMLButtonElement>('.edu-written-mark.corrected')!
   expect(mark).not.toBeNull();expect(h.querySelector('.edu-written-comment')).toBeNull()
   await act(async()=>mark.click())
   expect(mark.getAttribute('aria-expanded')).toBe('true')
   expect(h.querySelector('.edu-written-comment')?.textContent).toContain('исправление принято')
   expect(mark.closest('.edu-written-block')?.querySelector('.edu-written-comment')).not.toBeNull()
   await act(async()=>h.querySelector<HTMLButtonElement>('[aria-label="Закрыть пояснение"]')!.click())
   expect(h.querySelector('.edu-written-comment')).toBeNull()
   await act(async()=>Array.from(h.querySelectorAll('button')).find(b=>b.textContent?.startsWith('Оригиналы'))!.click())
   expect(h.querySelector('.education-image')).not.toBeNull()
   expect(h.querySelector('.edu-review-question')).toBeNull()
   expect(JSON.stringify(data)).toBe(before)
  }finally{await act(async()=>root.unmount());h.remove()}
 })
 it('labels old observations as fragments and never reads a private item as transcription',async()=>{
  const h=document.createElement('div'),root=createRoot(h);document.body.append(h)
  const r:DayWorkReview={id:'legacy',taskId:'t',status:'partial',items:[{label:'closed',observed:'PRIVATE ANSWER',status:'incorrect'}],studentFeedback:{title:'Работа',confirmed:'Начало верно',focus:'Проверь глагол',question:'Какое время?',steps:[{stageId:'a',uploadId:'u',location:'Строка 1',status:'partial',observation:'I goes',explanation:'Проверь форму.'}]}}
  try{await act(async()=>root.render(<WorkReview uploads={[]} review={r}/>));expect(h.textContent).toContain('Распознанные фрагменты');expect(h.textContent).toContain('I goes');expect(h.textContent).not.toContain('PRIVATE ANSWER')}finally{await act(async()=>root.unmount());h.remove()}
 })
})
