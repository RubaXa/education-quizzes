// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import HomeworkOverview from './HomeworkOverview'
import type { CachedHomeworkRow } from '@/lib/dayDashboardViewCache'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root: ReturnType<typeof createRoot> | undefined
const host = document.createElement('div')
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML=''})
const row = (id:string, group:CachedHomeworkRow['group']):CachedHomeworkRow => ({subject:{id,name:id,icon:'📚',tasks:[{title:'Упр. 218 и 223'}]},group,done:group==='complete'?1:0,items:[{id:`${id}-task`,title:'Упр. 218 и 223',state:group==='complete'?'done':group==='waiting'?'unclear':'todo',detail:'№ 218 проверен; № 223 не виден целиком',unresolvedReason:'missing-evidence'}]})
/** @see ../../docs/modules/school-diary/dashboard.md#compact-homework */
it('shows one short title and one explicit date, with counted groups instead of a duplicate banner',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<HomeworkOverview date="2026-10-19" rows={[row('Русский','action'),row('Литература','waiting'),row('Математика','complete')]} onOpen={()=>{}}/>))
 expect(host.querySelector('h2')?.textContent).toBe('Домашнее задание')
 expect(host.querySelector('time')?.textContent).toBe('Понедельник, 19 октября')
 expect(host.querySelector('time')?.dateTime).toBe('2026-10-19')
 expect([...host.querySelectorAll('h3')].map(h=>h.textContent)).toEqual(['Сделать · 1','Проверка · 1'])
 expect(host.textContent).not.toMatch(/учебн[а-я]* дн|Уроки |Требуют внимания|Пока не удалось подтвердить/)
 expect(host.querySelector('.day-dashboard-homework-summary')).toBeNull()
 expect(host.querySelector<HTMLDetailsElement>('details')?.open).toBe(false)
 expect(host.querySelector('details summary')?.textContent).toBe('Сделано · 1')
})
it('keeps a precise missing-evidence reason, separates it from the task and opens the same target',async()=>{
 const item=row('Русский','waiting'),open=vi.fn(),all=vi.fn()
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<HomeworkOverview date="2026-10-20" rows={[item]} onOpen={open} onOpenAll={all}/>))
 expect(host.querySelector('.day-dashboard-homework-status')?.textContent).toContain('Не вся работа видна')
 expect(host.querySelector('.day-dashboard-homework-next')?.textContent).toBe('Упр. 218 и 223')
 expect(host.querySelector('.day-dashboard-homework-reason')?.textContent).toContain('№ 223 не виден целиком')
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')!.click())
 expect(open).toHaveBeenCalledWith(item,'Русский-task')
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-dashboard-detail-link')!.click())
 expect(all).toHaveBeenCalledOnce()
})
it('keeps unknown source text visible and does not invent the next date',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<HomeworkOverview onOpen={()=>{}} fallback={<p>Дата следующего ДЗ пока неизвестна.</p>}/>))
 expect(host.querySelector('time')).toBeNull()
 expect(host.textContent).toContain('Дата следующего ДЗ пока неизвестна')
})
it('does not repeat a generic action as a second explanation',async()=>{
 const item=row('Английский','action');item.items[0].detail='Нужно дополнить работу'
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<HomeworkOverview date="2026-10-19" rows={[item]} onOpen={()=>{}}/>))
 expect(host.querySelector('.day-dashboard-homework-status')?.textContent).toBe('Дополнить')
 expect(host.querySelector('.day-dashboard-homework-reason')).toBeNull()
 expect(host.textContent).toContain('Упр. 218 и 223')
})
it('formats a legacy authored reason without rewriting the task source or click target',async()=>{
 const item=row('Русский','waiting'),open=vi.fn();item.items[0].detail='Видно2слова.';item.items[0].title='Учитель:выпиши2слова.'
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<HomeworkOverview rows={[item]} onOpen={open}/>))
 expect(host.querySelector('.day-dashboard-homework-reason')?.textContent).toBe('Видно 2 слова.')
 expect(host.querySelector('.day-dashboard-homework-next')?.textContent).toBe('Учитель:выпиши2слова.')
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')!.click())
 expect(open).toHaveBeenCalledWith(item,'Русский-task')
 expect(item.items[0].detail).toBe('Видно2слова.')
})
