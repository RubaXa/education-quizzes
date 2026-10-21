/// <reference types="node" />
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import UiKit from './UiKit'
import { uiKitQuizExamples } from './lib/uiKitExamples'
import { summarize } from '@/lib/quiz'
import { getNotificationDigestPresentation, NOTIFICATION_EXAMPLES } from '../packages/education-presentation/notification.mjs'
vi.mock('@/lib/store',()=>({requestQuizFollowup:vi.fn(),setQuizRequired:vi.fn()}))
vi.mock('./education-design-tokens.css?raw',async()=>({default:(await import('node:fs')).readFileSync('src/education-design-tokens.css','utf8')}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const host=document.createElement('div');let root:ReturnType<typeof createRoot>|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host.remove();host.innerHTML=''})
/** @see ../docs/shared/design/ui-kit.md */
it('uses the real components, token source and local interactive controls',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 expect(host.querySelector('.edu-result-badge')?.textContent).toContain('87%')
 expect(host.querySelectorAll('.problem-group')).toHaveLength(2)
 expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2)
 await act(async()=>{ for (const button of host.querySelectorAll<HTMLButtonElement>('.problem-group-toggle')) button.click() })
 expect(host.querySelectorAll('.day-practice-variant')).toHaveLength(2)
 expect(host.textContent).toContain('Проверено')
 expect(host.textContent).toContain('Исправить')
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

/** @see ../docs/modules/materials/storage-privacy.md#multi-task-photo */
it('demonstrates one attachment and read-only references using the real shared component', async () => {
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Связанные фото')!.click())
 expect(host.querySelectorAll('.artifact-avatar')).toHaveLength(1)
 expect(host.querySelectorAll('.linked-work-photo-reference')).toHaveLength(2)
 expect(host.querySelector('.day-upload-chip')?.getAttribute('title')).toContain('20 октября 2026, 13:03 МСК')
 expect(host.querySelectorAll('.linked-work-photo-view')).toHaveLength(0)
 await act(async()=>host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
 expect(host.querySelector('.day-upload-expanded img')).not.toBeNull()
 expect(host.querySelector('.day-upload-expanded time')?.textContent).toContain('МСК')
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Закрыть фото"]')!.click())
 expect(host.querySelector('.day-upload-expanded')).toBeNull()
 await act(async()=>host.querySelector<HTMLButtonElement>('.linked-work-photo-reference')!.click())
 expect(host.querySelectorAll('.linked-work-photo-view')).toHaveLength(1)
 expect(host.querySelector('.linked-work-photo-reference')?.getAttribute('title')).toContain('20 октября 2026, 13:03 МСК')
 expect(host.querySelector('.linked-work-photo-view time')?.textContent).toContain('МСК')
 expect(host.querySelector('input[type="file"]')).toBeNull()
})

/** @see ../docs/shared/design/ui-kit.md */
it('preserves grouped navigation and the shared grade average simulator',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 expect([...host.querySelectorAll('nav small')].map(node=>node.textContent)).toEqual(['Основы','Компоненты','Составные сценарии'])
 expect(host.querySelectorAll('nav button')).toHaveLength(10)
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Средний балл')!.click())
 const range=host.querySelector<HTMLInputElement>('input[type="range"]')!
 expect([range.min,range.max,range.step]).toEqual(['200','500','1'])
 expect(host.querySelector('.edu-grade-slider output')?.textContent).toBe('4,50')
 expect(host.querySelector('.edu-grade-slider')).not.toBeNull()
})

/** @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract */
it('shows matching parent preview and learner disclosure for the selected full stage', async () => {
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Подсказка и раскрытие')!.click())
 expect(host.textContent).toContain('Прямая и направления')
 expect(host.textContent).toContain('Переходы ±1, ±2, ±4, ±8, ±16 дм')
 expect(host.textContent).toContain('Можно считать последний переход равным +16')
 expect(host.textContent).toContain('Лист учителя №2')
 expect(host.textContent).not.toContain('demo-only:teacher-sheet')
 expect(host.textContent).not.toContain('Демонстрационный источник')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Весь шаг')!.click())
 const preview=host.querySelector('.day-learning-route-preview')!
 expect(preview.textContent).toContain('Прямая и направления')
 expect(preview.textContent).toContain('Можно считать последний переход равным +16')
 expect(preview.textContent).toContain('Лист учителя №2')
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

/** @see ../docs/modules/school-diary/school-calendar.md#представление */
it('demonstrates the shared calendar with local selection and explicit synthetic data',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Календарь и каникулы')!.click())
 expect(host.textContent).toContain('Условный пример, не календарь семьи')
 expect(host.querySelectorAll('.day-dashboard-vacation')).toHaveLength(1)
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-date="2026-10-26"]')!.click())
 expect(host.querySelector('[role="status"]')?.textContent).toBe('Выбрана дата: 2026-10-26')
 expect(host.querySelector('[aria-pressed="true"]')?.getAttribute('data-date')).toBe('2026-10-26')
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

/** @see ../docs/shared/design/telegram.md#компактная-сводка */
it('matches all seven templates through the shared compact digest and keeps controls local',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent?.includes('Telegram-уведомления'))!.click())
 const template=host.querySelector<HTMLSelectElement>('select[aria-label="Шаблон уведомления"]')!
 expect(template.options).toHaveLength(7)
 for(const example of NOTIFICATION_EXAMPLES){
  await act(async()=>{template.value=example.id;template.dispatchEvent(new Event('change',{bubbles:true}))})
  const output=host.querySelector('.edu-telegram-message-text')?.textContent ?? ''
  if(example.id==='review'){
   expect(output.split('\n')).toEqual([
    'Ученик А · 3 изменения',
    'Спецкурс · К четвергу, 22 октября',
    '🟢 №3 · Шестьдесят горшков — проверено',
    '🟠 №1 · Книги на полках — Ожидало проверки → нужна правка',
    'Не объяснён второй случай.',
    '🟢 №5 · Периметр — проверено',
   ])
   expect(host.querySelectorAll('.edu-telegram-history-bubble')).toHaveLength(3)
   expect(host.querySelector('.edu-telegram-history')?.textContent).toContain('📷 №1 · Книги на полках — получено 1 файл · ждут проверки')
   expect(host.querySelector('.edu-telegram-history')?.textContent).toContain('Объяснение добавлено. Замечание снято.')
  }else{
   const fields:Record<string,unknown>={...example.event.fields,childName:'Ученик А',subject:'Математика'}
   const event={...example.event,source:'demo',fields}
   const model=getNotificationDigestPresentation([event])
   expect(model?.text).toBe(output)
   expect(model?.header).toContain('Ученик А · 1 изменение')
   expect(model?.context).toContain('Математика')
  }
  expect(host.querySelector('.edu-telegram-stage')?.querySelectorAll('a[href]')).toHaveLength(0)
  expect(host.querySelector('.edu-telegram-message-heading')).toBeNull()
 }
 await act(async()=>{template.value='upload';template.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('.edu-telegram-message-text')?.textContent).toContain('получено 1 файл · ждут проверки')
 expect(host.querySelector('.edu-telegram-message-text')?.textContent).not.toContain('проверено')
 expect(host.textContent).toContain('Демонстрация. Шрифт и цвета Telegram задаёт выбранная тема клиента.')
 const content=host.querySelector<HTMLSelectElement>('select[aria-label="Содержание уведомления"]')!
 await act(async()=>{content.value='long';content.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.textContent).toContain('Проверить и решить задания по теме')
 expect(host.textContent).toContain('Александр Иванов — демонстрационное имя с длинной подписью')
 await act(async()=>{content.value='no-context';content.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('.edu-telegram-message')).toBeNull()
 expect(host.querySelector('.edu-telegram-no-message')?.textContent).toContain('не включено в Telegram-сводку')
 await act(async()=>{template.value='review';template.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(async()=>{content.value='short';content.dispatchEvent(new Event('change',{bubbles:true}))})
 expect(host.querySelector('.edu-telegram-message-text')?.textContent).toContain('№3 · Шестьдесят горшков')
 expect(host.querySelector('.edu-telegram-stage')?.querySelectorAll('.edu-telegram-action, a[href]')).toHaveLength(0)
 expect(fetchMock).not.toHaveBeenCalled()
 vi.unstubAllGlobals()
})
