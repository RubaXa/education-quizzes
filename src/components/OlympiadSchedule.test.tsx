// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import OlympiadSchedule from './OlympiadSchedule'
import type { OlympiadCalendar } from '@/lib/olympiad/calendar'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('moves the clock through the opening boundary without pretending an unknown finish', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-22T10:59:59+03:00'))
  const host = document.createElement('div'), root = createRoot(host)
  const calendar: OlympiadCalendar = { checkedAt: '2026-10-31T15:00:00Z', registrationUrl: 'https://www.energy-hope.ru/', registrationNote: 'Проверь регистрацию', events: [{ id: 'qualifier', title: 'Отбор', at: '2026-11-22T11:00:00+03:00', sourceUrl: 'https://www.energy-hope.ru/actual/grafik.html', provisional: true }], notes: [], preparation: ['Попробуй задачу ниже.'], sources: [] }
  try {
    await act(async () => root.render(<OlympiadSchedule calendar={calendar} />))
    expect(host.textContent).toContain('0 мин. 1 сек.')
    expect(host.textContent).toContain('предварительно')
    expect(host.textContent?.split('Проверь регистрацию')).toHaveLength(2)
    expect(host.textContent).not.toContain('Регистрацию у организатора нужно пройти отдельно')
    expect(host.querySelector('.olympiad-registration')?.closest('details')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(1000))
    expect(host.textContent).toContain('время окончания не опубликовано')
    expect(host.textContent).not.toContain('Идёт · осталось')
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})

it('renders unknown dates and date-only events without an invented countdown', async () => {
 const host=document.createElement('div'), root=createRoot(host)
 const calendar: OlympiadCalendar={checkedAt:'2026-10-31T15:00:00Z',registrationUrl:'https://example.org/',registrationLinkLabel:'Сайт организатора',registrationNote:'Регистрация ещё не объявлена',statusLabel:'Ждём даты',events:[],notes:[],preparation:['Реши архивную задачу 6 класса.'],sources:[]}
 try {
 await act(async()=>root.render(<OlympiadSchedule calendar={calendar}/>))
 expect(host.textContent).toContain('Следующие даты ещё не опубликованы')
 expect(host.textContent).toContain('Реши архивную задачу')
 expect(host.querySelector('a')?.textContent).toContain('Сайт организатора')
 await act(async()=>root.render(<OlympiadSchedule calendar={{...calendar,events:[{id:'contest',title:'Конкурс',at:'2027-02-21',sourceUrl:'https://example.org/'}]}}/>))
 expect(host.textContent).toContain('21 февраля')
 expect(host.textContent).not.toContain('00:00')
 expect(host.textContent).not.toContain('Через')
 }finally{await act(async()=>root.unmount())}
})
