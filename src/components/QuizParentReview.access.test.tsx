// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({watch:vi.fn(),stop:vi.fn(),deliver:undefined as undefined|((r:unknown)=>void)}))
vi.mock('@/lib/quizParentReview',()=>({watchQuizParentReview:(token:string,id:string,change:(r:unknown)=>void)=>{state.watch(token,id);state.deliver=change;return state.stop}}))
vi.mock('@/lib/quizReviewConversation',()=>({watchQuizStepGuidance:(_t:string,_i:string,c:(g:unknown[])=>void)=>{c([]);return()=>{}},watchQuizReplyHistory:(_t:string,_i:string,c:(h:unknown[])=>void)=>{c([]);return()=>{}},sendQuizReviewReply:vi.fn()}))
import QuizResultConversation from './QuizResultConversation'
import {parentPilotAnalysis,parentPilotResult} from '@/ui-kit/ParentReviewPilotExample'
import {parentReviewContext} from '../../packages/education-presentation/parent-review.mjs'
it('fetches the full guide only as parent and discards late private snapshots on a role change',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),submittedAt={seconds:100}
 const record={schemaVersion:1,quizToken:'quiz',questionId:parentPilotResult.question.id,context:parentReviewContext(parentPilotResult,submittedAt),analysis:parentPilotAnalysis}
 try{
  await act(async()=>root.render(<QuizResultConversation token="quiz" result={parentPilotResult} index={0} parent={false} submittedAt={submittedAt}/>))
  expect(state.watch).not.toHaveBeenCalled();expect(host.textContent).not.toContain(parentPilotAnalysis.answer)
  await act(async()=>root.render(<QuizResultConversation token="quiz" result={parentPilotResult} index={0} parent submittedAt={submittedAt}/>))
  expect(state.watch).toHaveBeenCalledWith('quiz',parentPilotResult.question.id)
  await act(async()=>state.deliver!(record));expect(host.textContent).toContain(parentPilotAnalysis.answer)
  const route=host.querySelector('.day-parent-learning-route')!
  expect(route).not.toBeNull()
  await act(async()=>route.querySelector<HTMLElement>('summary')!.click())
  const stage=route.querySelector('.day-learning-route-stage')!
  await act(async()=>stage.querySelector<HTMLElement>('summary')!.click())
  const choice=[...stage.querySelectorAll<HTMLButtonElement>('.edu-solution-case-choices button')].find(b=>b.textContent==='Поступок Архипа')!
  await act(async()=>choice.click())
  expect(choice.getAttribute('aria-pressed')).toBe('true')
  expect(stage.querySelector('.edu-solution-selected-case')?.textContent).toContain('Архип запер их на ключ')
  expect(host.querySelector('[role="switch"]')).toBeNull()
  const late=state.deliver
  await act(async()=>root.render(<QuizResultConversation token="quiz" result={parentPilotResult} index={0} parent={false} submittedAt={submittedAt}/>))
  await act(async()=>late!(record))
  expect(state.stop).toHaveBeenCalled();expect(host.textContent).not.toContain(parentPilotAnalysis.answer);expect(host.textContent).toContain(parentPilotResult.guidance!.question)
 }finally{await act(async()=>root.unmount());host.remove()}
})
