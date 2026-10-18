/// <reference types="node" />
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import UiKit from './UiKit'
import { uiKitQuizExamples } from './lib/uiKitExamples'
import { summarize } from '@/lib/quiz'
import { getNotificationPresentation, NOTIFICATION_EXAMPLES } from '../packages/education-presentation/notification.mjs'
vi.mock('@/lib/store',()=>({requestQuizFollowup:vi.fn(),setQuizRequired:vi.fn()}))
vi.mock('./education-design-tokens.css?raw',async()=>({default:(await import('node:fs')).readFileSync('src/education-design-tokens.css','utf8')}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML=''})
/** @see ../docs/shared/design/ui-kit.md */
it('uses the real components, token source and local interactive controls',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 expect(host.querySelector('.edu-result-badge')?.textContent).toContain('87%')
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='84.99%')!.click())
 expect(host.querySelector('.edu-result-badge')?.getAttribute('data-tone')).toBe('attention')
 const select=host.querySelector('select')!;await act(async()=>{select.value='waiting';select.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('[role="meter"]')).toBeNull()
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Цвета и токены')!.click())
 expect(host.textContent).toContain('--edu-status-success-ink');expect(host.textContent).toContain('var(--edu-success-ink)')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='История тестов')!.click())
 expect(host.querySelector('.day-quiz-lineage')).not.toBeNull()
 expect(host.textContent).toContain('условными данными')
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(0)
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-quiz-history-select')!.click())
 expect(host.querySelectorAll('a[href*="/t/"]')).toHaveLength(0)
})
it('has internally consistent example points and counts',()=>{
 for(const test of uiKitQuizExamples){const score=summarize(test.results!);expect(score.earned).toBe(test.points);expect(score.possible).toBe(test.maxPoints)}
})

/** @see ../docs/shared/design/ui-kit.md */
it('preserves grouped navigation and the shared grade average simulator',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 expect([...host.querySelectorAll('nav small')].map(node=>node.textContent)).toEqual(['Основы','Компоненты','Составные сценарии'])
 expect(host.querySelectorAll('nav button')).toHaveLength(7)
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Средний балл')!.click())
 const range=host.querySelector<HTMLInputElement>('input[type="range"]')!
 expect([range.min,range.max,range.step]).toEqual(['200','500','1'])
 expect(host.querySelector('.edu-grade-slider output')?.textContent).toBe('4,50')
 expect(host.querySelector('.edu-grade-slider')).not.toBeNull()
})

/** @see ../docs/modules/school-diary/dashboard.md#compact-homework */
it('previews the real homework component and its existing click targets',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Сводка ДЗ')!.click())
 expect(host.querySelector('[aria-label="Домашнее задание"] time')?.textContent).toBe('Понедельник, 19 октября')
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')!.click())
 expect(host.querySelector('[role="status"]')?.textContent).toContain('Английский язык')
 expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-homework-complete')?.open).toBe(false)
})

/** @see ../docs/modules/materials/material-clarification.md */
it('previews the source question using the shared local photo control',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Уточнение материала')!.click())
 expect(host.querySelector('[aria-label="Уточнение материала"]')).not.toBeNull()
 const input=host.querySelector<HTMLInputElement>('.day-upload input')!
 expect(input.accept).toBe('image/*');expect(input.multiple).toBe(true)
 Object.defineProperty(input,'files',{value:[new File(['demo'],'notes.jpg',{type:'image/jpeg'})],configurable:true})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
 expect(host.textContent).toContain('Выбрано файлов: 1')
 expect(host.textContent).not.toContain('Работа проверена')
})

/** @see ../docs/shared/design/telegram.md#визуальная-система */
it('matches all seven shared notification examples and keeps preview actions local',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.includes('Telegram-уведомления'))!.click())
 const template=host.querySelector<HTMLSelectElement>('select[aria-label="Шаблон уведомления"]')!
 expect(template.options).toHaveLength(7)
 const localAction={label:'Посмотреть пример',url:'https://rubaxa.github.io/education-quizzes/#/ui-kit'}
 for(const example of NOTIFICATION_EXAMPLES){
  await act(async()=>{template.value=example.id;template.dispatchEvent(new Event('change',{bubbles:true}))})
  const model=getNotificationPresentation(example.event,{demo:true,action:localAction})
  expect(model.eventEmoji).toMatch(/\S/)
  expect(host.querySelector('.edu-telegram-message-heading h3')?.textContent).toBe(model.headline)
  expect(host.querySelector('.edu-telegram-event-icon')?.getAttribute('data-event-icon')).toBe(model.eventIcon)
  expect(host.querySelector('.edu-telegram-meta')?.textContent ?? '').toContain(model.childName ?? '')
  expect(host.querySelector('.edu-telegram-meta')?.textContent ?? '').toContain(model.subject ?? '')
  expect(host.querySelector('.edu-telegram-primary-content')?.textContent ?? '').toContain(model.title ?? '')
  expect(host.querySelector('.edu-telegram-primary-content')?.textContent ?? '').toContain(model.value ? `Оценка: ${model.value}` : '')
  expect(host.querySelector('.edu-telegram-date')?.textContent ?? '').toBe(model.occurredLabel ?? '')
  expect(host.querySelector('.edu-telegram-status')?.getAttribute('data-status') ?? null).toBe(model.status?.id ?? null)
  expect(host.querySelector('.edu-telegram-status')?.textContent ?? '').toBe(model.status?.label ?? '')
 }
 await act(async()=>{template.value='upload';template.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('.edu-telegram-status')?.textContent).toContain('Ждёт проверки')
 expect(host.querySelector('.edu-telegram-status')?.getAttribute('data-status')).toBe('waiting')
 expect(host.querySelector('.edu-telegram-status')?.getAttribute('data-status')).not.toBe('complete')
 expect(host.textContent).toContain('Демонстрация. Реальный вид зависит от темы Telegram')
 const content=host.querySelector<HTMLSelectElement>('select[aria-label="Содержание уведомления"]')!
 await act(async()=>{content.value='long';content.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.textContent).toContain('Проверить и решить задания по теме')
 expect(host.textContent).toContain('Ученик А — демонстрационное имя с длинной подписью')
 await act(async()=>{content.value='no-context';content.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.textContent).not.toContain('Ученик А')
 await act(async()=>{content.value='short';content.dispatchEvent(new Event('change',{bubbles:true}))})
 const action=host.querySelector<HTMLButtonElement>('.edu-telegram-action')!
 expect(action.textContent).toContain('Посмотреть пример')
 await act(async()=>action.click())
 expect(host.querySelector('.edu-telegram-feedback')?.textContent).toContain('переход не выполняется')
 expect(fetchMock).not.toHaveBeenCalled()
 vi.unstubAllGlobals()
})
