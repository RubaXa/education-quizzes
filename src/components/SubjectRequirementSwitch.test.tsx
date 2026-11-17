// @vitest-environment jsdom
/** @see ../../docs/shared/design/student-review-step.md#assignment-clarification */
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import SubjectRequirementSwitch from './SubjectRequirementSwitch'
import UiKit from '@/UiKit'
import AssignmentClarificationExample from '@/ui-kit/AssignmentClarificationExample'
import type {DayTask} from '@/lib/dayStore'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
HTMLElement.prototype.scrollIntoView=vi.fn()
it('uses the same unlabeled parent switch, read-only child choice and local UI Kit transport',async()=>{
 const host=document.createElement('div'),root=createRoot(host),change=vi.fn(async()=>{})
 const task={id:'history',kind:'read',title:'Учим записи в тетради',status:'unknown'} as DayTask
 try{
  await act(async()=>root.render(<SubjectRequirementSwitch name="История" tasks={[task]} events={[]} parent ready onChange={change}/>))
  const button=host.querySelector<HTMLButtonElement>('[role=switch]')!
  expect(button.getAttribute('aria-checked')).toBe('true');expect(button.textContent).toBe('')
  await act(async()=>button.click());expect(change).toHaveBeenCalledWith(false)
  await act(async()=>root.render(<SubjectRequirementSwitch name="История" tasks={[task]} events={[{id:'local',taskId:'history',action:'task-optional',reviewCheckedAt:null,decidedAt:{seconds:1,nanoseconds:0}}]} parent={false} ready/>))
  expect(host.querySelector('[role=switch]')).toBeNull();expect(host.textContent).toContain('По выбору семьи')
  await act(async()=>root.render(<AssignmentClarificationExample task={task} subjectName="История"/>))
  await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Родитель решает')!.click())
  expect(host.querySelectorAll('input,textarea,select')).toHaveLength(0)
  await act(async()=>host.querySelector<HTMLButtonElement>('[role=switch]')!.click())
  expect(host.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false')
 }finally{await act(async()=>root.unmount())}
})

it('opens the shared adaptive block from its graph deep link',async()=>{
 const host=document.createElement('div'),root=createRoot(host)
 try{
  window.location.hash='#/ui-kit/?decision=english.production&focus=review.support'
  await act(async()=>root.render(<UiKit/>))
  const link=Array.from(host.querySelectorAll('a')).find(a=>a.getAttribute('href')==='#/ui-kit/?section=compact-review&focus=review.support')!
  expect(link).toBeDefined()
  await act(async()=>{window.location.hash=link.getAttribute('href')!;window.dispatchEvent(new HashChangeEvent('hashchange'))})
  expect(host.querySelector('#review-adaptive')).not.toBeNull()
  expect(host.querySelector('[aria-label="Режим общего блока"]')?.textContent).toContain('Выбор ответа')
  await act(async()=>{window.location.hash='#/ui-kit/?decision=english.production&focus=family.requirement';window.dispatchEvent(new HashChangeEvent('hashchange'))})
  expect(host.querySelector('[aria-label="Уточнение и семейный выбор"]')).not.toBeNull()
 }finally{await act(async()=>root.unmount());window.location.hash=''}
})
