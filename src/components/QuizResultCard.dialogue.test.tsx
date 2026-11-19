// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import QuizResultCard from './QuizResultCard'
import type {ReviewConversationBinding} from './ReviewConversation'
import type {QuestionResult} from '@/lib/quiz'
const activity={kind:'choice' as const,label:'Кто действовал?',instruction:'Выбери персонажа.',tokens:[{id:'a',text:'Первый персонаж'},{id:'b',text:'Второй персонаж'}]}
const result:QuestionResult={question:{id:'q',kind:'single',prompt:'Кто открыл дверь?',points:1},answer:'a',points:0,guidance:{observation:'В ответе перепутаны два действия.',question:'Кто произнёс приказ?',presentation:{version:1,activity},source:{title:'Текст',edition:'Учебное издание',section:'Глава',pages:'1',locator:'Абзац'}}}
it('quiz feedback persists an explicit micro-answer, restores waiting, and parent stays read-only without changing points',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const send=vi.fn<ReviewConversationBinding['send']>(async()=> 'a'.repeat(64)),before=JSON.stringify(result)
 const conversation:ReviewConversationBinding={canReply:true,ready:true,guidance:[],loadHistory:c=>{c([]);return()=>{}},send}
 try{
  await act(async()=>root.render(<QuizResultCard result={result} index={0} submittedAt={{seconds:100}} conversation={conversation}/>))
  await act(async()=>host.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{if(b.textContent==='Первый персонаж')b.click()}))
  expect(send).not.toHaveBeenCalled()
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Отправить ответ')
  expect(button).toBeDefined()
  await act(async()=>button!.click());expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]?.[0]).toMatchObject({intent:'answer',step:{question:'Кто произнёс приказ?'},value:JSON.stringify({selected:['a'],groups:{},written:{}})})
  expect(host.textContent).toContain('Ответ отправлен');expect(host.textContent).toContain('0 из 1 баллов');expect(JSON.stringify(result)).toBe(before)
  await act(async()=>root.render(<QuizResultCard parent result={result} index={0} submittedAt={{seconds:100}} conversation={conversation}/>))
  expect(host.querySelectorAll('input,textarea,select')).toHaveLength(0)
  expect(host.textContent).not.toContain('Отправить ответ');expect(host.textContent).not.toContain('Непонятно')
 }finally{await act(async()=>root.unmount());host.remove()}
})

it('keeps the assessed written answer and its explanation visible while a follow-up is awaiting review',async()=>{
 const written:QuestionResult = {
  ...result,
  question:{...result.question,kind:'long',prompt:'На что рассчитывал герой и какого факта он не знал?'},
  answer:'Напарник обиделся.',
  guidance:{
   ...result.guidance!,
   answerFeedback:{confirmed:'Ты понял реакцию напарника.',missing:'Назови ожидание героя и факт, которого он не знал.',next:'Найди нужный факт в истории и свяжи его с выводом.'},
  },
 }
 const host=document.createElement('div')
 document.body.append(host)
 const root=createRoot(host)
 const conversation:ReviewConversationBinding={canReply:true,ready:true,guidance:[],loadHistory:change=>{change([]);return()=>{}},send:async()=>'b'.repeat(64)}
 try {
  await act(async()=>root.render(<QuizResultCard result={written} index={3} conversation={conversation}/>))
  const checkFeedback=()=>{
   for(const text of ['Ваш текстовый ответ','Напарник обиделся.','Что получилось','Ты понял реакцию напарника.','Чего не хватило','Назови ожидание героя и факт, которого он не знал.','Как дополнить','Найди нужный факт в истории и свяжи его с выводом.','0 из 1 баллов']) expect(host.textContent).toContain(text)
  }
  checkFeedback()
  const click=async(text:string)=>{await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)?.click())}
  await click('Первый персонаж')
  await click('Отправить ответ')
  expect(host.textContent).toContain('Ответ на следующий шаг отправлен')
  checkFeedback()
  expect(host.querySelector('.edu-step-tokens')).toBeNull()
  expect(host.querySelector('details:not([open]) textarea')).not.toBeNull()
 } finally {await act(async()=>root.unmount());host.remove()}
})
