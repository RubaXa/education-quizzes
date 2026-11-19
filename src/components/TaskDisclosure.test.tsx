// @vitest-environment jsdom
/** @see ../../docs/modules/school-diary/day-page.md#task-disclosure */
import {act,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect} from 'vitest'
import TaskDisclosure from './TaskDisclosure'
it('starts closed, preserves the visible status and its body draft across toggles and updates',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 function Draft(){const [value,setValue]=useState('');return <input aria-label="Моя запись" value={value} onChange={e=>setValue(e.target.value)}/>}
 const draw=async(status:string)=>act(async()=>root.render(<TaskDisclosure id="day-task-x" title="ФЕТТ: пройти отборочный тур на каникулах" status={<span>{status}</span>} assignmentLabel="Задание 1 из 2" meta="В тетради"><Draft/></TaskDisclosure>))
 try{
  await draw('Статус неизвестен');const card=host.querySelector('details')!,summary=card.querySelector('summary')!,input=card.querySelector('input')!
  expect(card.open).toBe(false);expect(summary.textContent).toContain('ФЕТТ: пройти отборочный тур на каникулах');expect(summary.textContent).toContain('Статус неизвестен');expect(summary.textContent).toContain('Задание 1 из 2')
  await act(async()=>summary.click());expect(card.open).toBe(true)
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Моя мысль');input.dispatchEvent(new Event('input',{bubbles:true}))})
  await draw('Работа получена · ждёт проверки');expect(card.open).toBe(true);expect(input.value).toBe('Моя мысль')
  await act(async()=>summary.click());expect(card.open).toBe(false)
  await draw('Проверяем работу');expect(card.open).toBe(false)
  await act(async()=>summary.click());expect(card.open).toBe(true);expect(input.value).toBe('Моя мысль')
 }finally{await act(async()=>root.unmount());host.remove()}
})

it('explains an uncertain status without toggling the assignment and restores trigger focus',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<TaskDisclosure title="Упражнение" status="Нужно уточнение" statusExplanation="На фото не виден последний пункт."><input aria-label="Сохранённая запись" defaultValue="Моя запись"/></TaskDisclosure>))
  const card=host.querySelector('details')!,summary=host.querySelector('summary')!
  const trigger=host.querySelector<HTMLButtonElement>('button[aria-label="Почему такой статус"]')
  expect(trigger).not.toBeNull()
  await act(async()=>trigger!.click());expect(card.open).toBe(false)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('На фото не виден последний пункт.')
  await act(async()=>document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async()=>summary.click());expect(card.open).toBe(true)
  await act(async()=>trigger!.click());expect(card.open).toBe(true)
  expect(host.querySelector('input')?.value).toBe('Моя запись')
 }finally{await act(async()=>root.unmount());host.remove()}
})
