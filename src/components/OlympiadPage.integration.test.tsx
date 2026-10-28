// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OlympiadPage from './OlympiadPage'
import { olympiadRequest } from '@/lib/olympiad/client'

vi.mock('@/lib/olympiad/client',()=>({olympiadRequest:vi.fn()}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
const catalog=[{id:'o1',title:'Олимпиада',participationEnabled:true,lessons:[{id:'l1',version:'1',title:'Перебор',topicId:'t'}]}]
const attempt={attemptId:'a1',lessonId:'l1',lessonVersion:'1',status:'active'}
const view={title:'Перебор',status:'active',currentStep:1,stepCount:1,step:{id:'s1',prompt:'Как действовать?',options:[{id:'x',text:'Вариант X'},{id:'y',text:'Вариант Y'}]}}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML='';vi.clearAllMocks()})
it('resumes the authorised child attempt and sends commands without receiving keys',async()=>{
 vi.mocked(olympiadRequest).mockImplementation(async body=>{
  if(body.action==='list')return catalog as never
  if(body.action==='list-attempts')return [attempt] as never
  if(body.action==='view')return view as never
  if(body.action==='act')return {...view,feedback:{correct:true,text:'Правильно'}} as never
  throw Error('unexpected')
 })
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent={false} dashboardToken="token"/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='Открыть урок')!.click())
 expect(host.textContent).toContain('Как действовать?')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='Вариант X')!.click())
 expect(host.textContent).toContain('Правильно')
 const calls=vi.mocked(olympiadRequest).mock.calls.map(call=>call[0])
 expect(calls.find(call=>call.action==='view')?.scope).toEqual({familyId:'family',childId:'child',olympiadId:'o1',attemptId:'a1'})
 expect(calls.some(call=>call.action==='parent-detail')).toBe(false)
 expect(JSON.stringify(view)).not.toContain('correctOptionIds')
})
it('requests private detail only in the parent view',async()=>{
 vi.mocked(olympiadRequest).mockImplementation(async body=>{
  if(body.action==='list')return catalog as never
  if(body.action==='list-attempts')return [attempt] as never
  if(body.action==='parent-detail')return {view,steps:[{id:'s1',prompt:'Как действовать?',options:[{id:'x',text:'Вариант X'}],correctOptionIds:['x']}],events:[]} as never
  throw Error('unexpected')
 })
 document.body.append(host);root=createRoot(host)
 await act(async()=>root!.render(<OlympiadPage familyId="family" childId="child" olympiadId="o1" parent dashboardToken="token"/>))
 expect(host.textContent).not.toContain('Открыть урок')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='Разбор')!.click())
 expect(host.textContent).toContain('Верные варианты: Вариант X')
})
