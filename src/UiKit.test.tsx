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

/** @see ../docs/shared/design/compact-review.md#showcase */
it('uses the actual work-review and quiz adapters in the shared review catalogue', async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Компактный разбор')!.click())
 expect(host.querySelectorAll('.edu-review-brief')).toHaveLength(2)
 expect(host.querySelector('.edu-review-facts')).not.toBeNull()
 const choose=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('.edu-kit-presets button')].find(button=>button.textContent===label)!.click()
 await act(async()=>choose('Русский'));expect(host.querySelector('.edu-review-annotation')).not.toBeNull()
 await act(async()=>choose('История'));expect(host.querySelector('.edu-review-timeline')).not.toBeNull()
 await act(async()=>choose('Зачтено'));expect(host.querySelectorAll('.edu-review-question')).toHaveLength(1)
 await act(async()=>choose('Неясно'));expect(host.querySelectorAll('.edu-review-question')).toHaveLength(2)
 expect(host.textContent).not.toContain('школьные карточки ещё используют прежний вид')
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
 expect(host.querySelectorAll('nav button')).toHaveLength(18)
 expect([...host.querySelectorAll('nav button')].map(node=>node.textContent).join(' ')).toContain('История олимпиад')
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
 expect(input.accept).toContain('image/*'); expect(input.accept).toContain('.pdf'); expect(input.accept).toContain('.docx'); expect(input.accept).toContain('.xlsx'); expect(input.accept).toContain('.txt');expect(input.multiple).toBe(true)
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

/** @see ../docs/modules/materials/audio-library.md#player */
it('uses the shared lazy audio player with local media and retry demonstration', async () => {
 vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
 vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Аудиоплеер')!.click())
 expect(host.querySelectorAll('.edu-audio')).toHaveLength(2)
 expect(host.querySelectorAll('audio')).toHaveLength(2)
 expect(host.querySelectorAll('.edu-audio-speed')).toHaveLength(2)
 expect(host.querySelector('audio')?.getAttribute('src')).toBeNull()
 await act(async()=>host.querySelector<HTMLButtonElement>('.edu-audio button')!.click())
 expect(host.querySelector('audio')?.src).toMatch(/^data:audio\/wav;base64,/)
 expect(host.querySelector('audio')?.controls).toBe(false)
 const players=host.querySelectorAll('.edu-audio')
 await act(async()=>players[1].querySelector<HTMLButtonElement>('button')!.click())
 expect(players[1].querySelector('[role="alert"]')).not.toBeNull()
 expect(players[1].textContent).toContain('Повторить')
 vi.restoreAllMocks()
})

/** @see ../docs/decisions/ui-kit-photo-help-2026-10-27.md */
it('previews the photo help flow with real gallery and local state only', async () => {
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Письменная задача')!.click())
 expect(host.querySelector('.problem-card')).not.toBeNull()
 const details=host.querySelector<HTMLDetailsElement>('.problem-statement-help')!
 expect(host.querySelectorAll('.day-upload-list')).toHaveLength(1)
 expect(host.querySelector('.day-upload-chip')?.getAttribute('aria-expanded')).toBe('false')
 await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'))})
 const form=details.querySelector<HTMLFormElement>('form')!
 expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true)
 const selected=()=>host.querySelectorAll<HTMLButtonElement>('.day-upload-chip[aria-pressed="true"]')
 const photos=()=>host.querySelectorAll<HTMLButtonElement>('.day-upload-chip')
 expect(photos()).toHaveLength(2)
 await act(async()=>photos()[0].click()); await act(async()=>photos()[1].click())
 expect(selected()).toHaveLength(2)
 await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'))})
 expect(photos()[0].getAttribute('aria-expanded')).toBe('false')
 await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'))})
 expect(selected()).toHaveLength(2)
 await act(async()=>form.querySelector<HTMLButtonElement>('button[type=submit]')!.click())
 expect(host.textContent).toContain('Помощь запрошена');expect(selected()).toHaveLength(0)
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Показать условный ответ после синхронизации')!.click())
 expect(form.textContent).toContain('3 + 5 = 8')
 expect(photos()[0].disabled).toBe(true)
 const input=form.querySelector<HTMLInputElement>('input[type=file]')!
 expect(input.multiple).toBe(true)
 Object.defineProperty(input,'files',{value:[new File(['demo'],'photo.jpg',{type:'image/jpeg'})],configurable:true})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
 expect(photos()).toHaveLength(3);expect(selected()).toHaveLength(1)
 await act(async()=>form.querySelector<HTMLButtonElement>('button[type=submit]')!.click())
 expect(host.textContent).toContain('Помощь запрошена')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Родитель')!.click())
 expect(host.querySelector('.problem-statement-help input[type=file]')).toBeNull()
 expect(host.querySelectorAll('.day-upload-list')).toHaveLength(1)
 expect(host.querySelectorAll('.day-upload-list .artifact-avatar')).toHaveLength(3)
 expect(host.textContent).toContain('Фото запроса: Фото 1, Фото 2, Фото 3')
 expect(host.querySelector('.day-upload-chip')?.getAttribute('aria-expanded')).toBe('false')
 expect(fetchMock).not.toHaveBeenCalled();vi.unstubAllGlobals()
})

/** @see ../docs/decisions/olympiad-domain-ldd-2026-10-27.md */
it('previews the shared lesson from a student projection',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Игровой урок')!.click())
 expect(host.querySelector('.olympiad-lesson')?.textContent).toContain('Шаг 1 из 1')
 const choices=host.querySelectorAll<HTMLButtonElement>('.olympiad-lesson-options button')
 await act(async()=>choices[1].click());expect(host.textContent).toContain('Попробуй ещё раз')
 await act(async()=>choices[0].click());expect(host.textContent).toContain('Верно')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Завершить урок')!.click())
 expect(host.textContent).toContain('Урок завершён')
})

it('previews the shared family olympiad catalog and participation locally',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Список олимпиад')!.click())
 expect(host.textContent).toContain('Активные 0')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button=>button.textContent?.includes('Доступные'))!.click())
 await act(async()=>host.querySelector<HTMLButtonElement>('[role=switch]')!.click())
 expect(host.textContent).toContain('Активные 1')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Ученик')!.click())
 expect(host.textContent).not.toContain('Выключить подготовку')
 expect(host.querySelector('[aria-label="Открыть олимпиаду «Формула Единства / Третье тысячелетие · пример»"]')).not.toBeNull()
})

it('previews the same role-aware olympiad page without a network request',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock)
 URL.createObjectURL=vi.fn(()=> 'blob:demo');URL.revokeObjectURL=vi.fn()
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Страница олимпиады')!.click())
 expect(host.textContent).toContain('Математическая олимпиада · пример')
 expect(host.textContent).toContain('Чётность и сумма')
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Ученик')!.click())
 expect(host.textContent).toContain('Чётность и сумма')
 expect(fetchMock).not.toHaveBeenCalled();vi.unstubAllGlobals()
})

/** @see ../docs/shared/design/ui-kit.md#иконки-файлов */
it('shows shared Lucide file icons for every accepted format and switches the actual expanded preview',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Файлы и превью')!.click())
 const {workFileTypes}=await import('../storage/work-file-types.mjs')
 expect(host.querySelectorAll('.edu-kit-file-formats button')).toHaveLength(Object.keys(workFileTypes).length)
 expect(host.querySelectorAll('.edu-kit-file-families .work-file-preview')).toHaveLength(6)
 expect(host.querySelector('.edu-kit-file-families img')).not.toBeNull()
 expect(host.querySelector('.lucide-camera')).toBeNull()
 for(const icon of ['file-text','file-spreadsheet','presentation'])expect(host.querySelector(`.edu-kit-file-families .lucide-${icon}`)).not.toBeNull()
 for(const svg of host.querySelectorAll('.work-file-preview svg')){expect(svg.getAttribute('stroke-width')).toBe('2');expect(svg.getAttribute('fill')).toBe('none')}
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Показать XLSX"]')!.click())
 expect(host.querySelector('.edu-kit-file-expanded strong')?.textContent).toBe('Пример.xlsx')
 expect(host.querySelector('.edu-kit-file-expanded [data-file-kind]')?.getAttribute('data-file-kind')).toBe('spreadsheet')
 expect(host.querySelector('.edu-kit-file-expanded .lucide-file-spreadsheet')).not.toBeNull()
 expect(host.querySelector('[aria-label="Показать XLSX"]')?.getAttribute('aria-pressed')).toBe('true')
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Показать PNG"]')!.click())
 expect(host.querySelector('.edu-kit-file-expanded img')).not.toBeNull()
 expect(host.querySelector('.edu-kit-file-expanded .work-file-format')).toBeNull()
 expect(host.querySelector('.edu-kit-file-expanded .lucide-camera')).toBeNull()
})

/** @see ../docs/shared/design/ui-kit.md#вложения-в-карточке-задания */
it('shows the actual day and weekend attachment compositions with working role, deletion and upload controls',async()=>{
 document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<UiKit/>))
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Файлы и превью')!.click())
 const example=host.querySelector<HTMLElement>('[aria-label="Вложения в карточке задания"]')!
 await act(async()=>example.querySelector<HTMLElement>('.problem-card-heading')!.click())
 expect(example.querySelectorAll('.day-upload-chip')).toHaveLength(3)
 expect(example.querySelector('.day-upload-head')?.textContent).toContain('Файлы работы')
 expect(example.querySelector('.work-photo-gallery-compact')).toBeNull()
 expect(example.querySelector('.weekend-math-photo-delete')).toBeNull()
 await act(async()=>[...example.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Выходной лист')!.click())
 // Switching the route composition recreates the task in its initial closed state.
 await act(async()=>example.querySelector<HTMLElement>('.problem-card-heading')!.click())
 expect(example.querySelector('.work-photo-gallery-compact')).not.toBeNull()
 expect(example.querySelectorAll('.weekend-math-photo-delete')).toHaveLength(3)
 await act(async()=>[...example.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Родитель')!.click())
 expect(example.querySelector('input[type=file]')).toBeNull()
 expect(example.querySelector('.weekend-math-photo-delete')).toBeNull()
})
