// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {describe,it,expect,vi} from 'vitest'
import WorkReview from './WorkReview'
import type {DayWorkReview,DayHelp} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {ReviewConversationBinding} from './ReviewConversation'
const activity={kind:'write' as const,label:'Твоя запись',instruction:'Напиши свою мысль.',tokens:[{id:'own',text:'Твой вывод'}],frame:[{slotId:'own'}]}
const review:DayWorkReview={id:'day:task',taskId:'task',status:'partial',checkedAt:{seconds:100},studentFeedback:{title:'Проверь связь',confirmed:'Первый переход сохранён.',focus:'Теперь проверь вторую фразу.',question:'Что следует из этой фразы?',presentation:{version:1,activity}}}
const next={title:'Проверь следующий переход',confirmed:'Связь установлена.',focus:'Проверь совместимость.',question:'Могут ли оба требования выполняться?',presentation:{version:1 as const,activity}}
async function run(fn:(host:HTMLDivElement,draw:(p?:boolean)=>Promise<void>,state:{history:DayHelp[];guidance:DayGuidance[];send:ReturnType<typeof vi.fn>;emit:()=>Promise<void>})=>Promise<void>){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 let changed:((h:DayHelp[])=>void)|undefined
 const state={history:[] as DayHelp[],guidance:[] as DayGuidance[],send:vi.fn(async()=> 'a'.repeat(64)),emit:async()=>{await act(async()=>changed?.(state.history))}}
 const binding:ReviewConversationBinding={canReply:true,ready:true,help:undefined,guidance:state.guidance,loadHistory:c=>{changed=c;c(state.history);return()=>{}},send:state.send}
 const draw=async(parent=false)=>{await act(async()=>root.render(<WorkReview review={review} uploads={[]} conversation={{...binding,guidance:state.guidance}} parent={parent}/>))}
 try{await draw();await fn(host,draw,state)}finally{await act(async()=>root.unmount());host.remove()}
}
const click=async(h:HTMLElement,t:string)=>act(async()=>Array.from(h.querySelectorAll('button')).find(b=>b.textContent===t)!.click())
describe('learner reply dialogue',()=>{
 it('sends only an explicit answer, survives pending snapshots, then shows the checked next step',()=>run(async(h,draw,state)=>{
  const before=JSON.stringify(review),input=h.querySelector('input')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'моя мысль');input.dispatchEvent(new Event('input',{bubbles:true}))})
  expect(state.send).not.toHaveBeenCalled()
  await click(h,'Отправить ответ')
  expect(state.send).toHaveBeenCalledTimes(1)
  const [reply]=state.send.mock.calls[0] as unknown as [any]
  expect(reply.step.question).toBe(review.studentFeedback!.question)
  expect(JSON.parse(reply.value).written.own).toBe('моя мысль')
  expect(h.textContent).toContain('Ответ отправлен');expect(h.querySelector('input')).toBeNull()
  state.history=[{id:'h',taskId:'task',revision:1,eventReceiptId:'a'.repeat(64),reviewReply:reply,requestedAt:{seconds:200}}]
  await state.emit()
  state.guidance=[{id:`help-${'a'.repeat(64)}`,taskId:'task',stageId:'help-response',stageIndex:0,level:'hint',text:'Твоя мысль подтверждена.',guideRevision:1,actorPersonId:'operator',createdAt:201,sourceRequestEventId:'a'.repeat(64),reviewContext:{checkedAt:review.checkedAt,correctedAt:null},reviewResponse:{outcome:'correct',message:'Твоя мысль подтверждена.',next}}]
  await draw()
  expect(h.textContent).toContain('Твоя мысль подтверждена.');expect(h.querySelector('.edu-review-question')?.textContent).toBe(next.question)
  expect(h.querySelector('input')?.value).toBe('');expect(JSON.stringify(review)).toBe(before)
  await draw(true);expect(h.textContent).not.toContain('Отправить ответ');expect(h.textContent).not.toContain('Непонятно')
 }))
 it('sends stuck in one click without text/photos and accepts a later explanation',()=>run(async(h,_draw,state)=>{
  await click(h,'Непонятно');expect(state.send.mock.calls[0]?.[0]).toMatchObject({intent:'stuck'})
  expect(state.send.mock.calls[0]?.[1]).toBe('');expect(h.textContent).toContain('Вопрос отправлен')
  const input=h.querySelector('textarea')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Не понимаю отрицание');input.dispatchEvent(new Event('input',{bubbles:true}))})
  await click(h,'Отправить пояснение');expect(state.send).toHaveBeenCalledTimes(2);expect(state.send.mock.calls[1]?.[1]).toBe('Не понимаю отрицание')
 }))
 it('keeps input on failure and retries the same operation; accepted work has no action',()=>run(async(h,draw,state)=>{
  state.send.mockRejectedValueOnce(new Error('network'))
  await click(h,'Непонятно');expect(h.textContent).toContain('Не удалось отправить')
  await click(h,'Непонятно');expect(state.send.mock.calls[0]?.[2]).toBe(state.send.mock.calls[1]?.[2])
  await draw(true);expect(h.textContent).not.toContain('Отправить пояснение')
 }))
 it('ignores malformed untrusted JSON and keeps a newer explanation ahead of an old response',()=>run(async(h,draw,state)=>{
  await click(h,'Непонятно')
  const [reply]=state.send.mock.calls[0] as unknown as [any]
  const newer='b'.repeat(64)
  state.history=[{id:'bad',taskId:'task',revision:1,eventReceiptId:'c'.repeat(64),reviewReply:{...reply,value:'bad JSON'},requestedAt:{seconds:999}},
   {id:'first',taskId:'task',revision:1,eventReceiptId:'a'.repeat(64),reviewReply:reply,requestedAt:{seconds:200}},
   {id:'latest',taskId:'task',revision:1,eventReceiptId:newer,reviewReply:reply,requestText:'Не понимаю отрицание',requestedAt:{seconds:201}}]
  await state.emit()
  state.guidance=[{id:`help-${'a'.repeat(64)}`,taskId:'task',stageId:'help-response',stageIndex:0,level:'hint',text:'Первый отклик',guideRevision:1,actorPersonId:'operator',createdAt:202,sourceRequestEventId:'a'.repeat(64),reviewContext:{checkedAt:review.checkedAt,correctedAt:null},reviewResponse:{outcome:'correct',message:'Старый отклик',next}}]
  await draw();expect(h.textContent).toContain('Вопрос отправлен');expect(h.textContent).not.toContain('Старый отклик');expect(h.textContent).toContain('Не понимаю отрицание')
 }))

})
