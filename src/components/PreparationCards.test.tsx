// @vitest-environment jsdom
/** @see ../../docs/modules/school-diary/dashboard.md#weekend-work-contract */
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,expect,it,vi} from 'vitest'
import PreparationCards from './PreparationCards'
vi.mock('../WeekendMathSlot',()=>({default:({title}:{title:string})=><article>{title}</article>}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
beforeEach(()=>localStorage.clear())
const slots=[{dayToken:'day-role',taskIds:['old'],title:'Прошлая подготовка',lessonDate:'2026-11-19',dueDate:'2026-11-19',preparationThrough:'2026-11-18',dates:['2026-11-18'],availableFrom:'2026-11-18',mode:'until-complete' as const},{dayToken:'future',taskIds:['new'],title:'Будущая подготовка',lessonDate:'2026-11-30',dueDate:'2026-11-30',preparationThrough:'2026-11-29',dates:['2026-11-27'],availableFrom:'2026-11-27',mode:'until-complete' as const}]
it.each([false,true])('archives only the local overview, remembers it, and restores the original slot: parent=%s',async parent=>{
 const h=document.createElement('div'),root=createRoot(h);document.body.append(h)
 const draw=(scope='person-calendar')=>root.render(<PreparationCards scope={scope} slots={slots} parent={parent} selectedDate="2026-11-27"/>)
 try{
  await act(async()=>draw())
  expect(h.querySelectorAll('[aria-label="В архив"]')).toHaveLength(1)
  await act(async()=>h.querySelector<HTMLButtonElement>('[aria-label="В архив"]')!.click())
  expect(h.querySelectorAll('article')).toHaveLength(1)
  expect(h.querySelector('article')?.textContent).toBe('Будущая подготовка')
  expect(h.querySelector('details')?.open).toBe(false)
  await act(async()=>root.render(null));await act(async()=>draw())
  expect(h.querySelectorAll('article')).toHaveLength(1)
  await act(async()=>draw('other-person'))
  expect(h.querySelectorAll('article')).toHaveLength(2)
  await act(async()=>draw())
  expect(h.querySelectorAll('article')).toHaveLength(1)
  await act(async()=>h.querySelector<HTMLButtonElement>('[aria-label="Вернуть из архива"]')!.click())
  expect(h.querySelectorAll('article')).toHaveLength(2)
  expect(slots[0].taskIds).toEqual(['old'])
 }finally{await act(async()=>root.unmount());h.remove()}
})
