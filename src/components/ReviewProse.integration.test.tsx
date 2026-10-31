// @vitest-environment jsdom
/** @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback */
import { expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import ProblemTaskCard from './ProblemTaskCard'
import ParentTaskGuide from './ParentTaskGuide'
import MaterialRequest from './MaterialRequest'
import type { DayProblem, DayWorkReview, ParentTaskGuide as Guide } from '@/lib/dayStore'

// Synthetic counts and no real learner/upload identity.
const guide: Guide = { kind: 'worked-solution', presentation: 'math-route', overview: 'Разбор №1', boundary: 'Дано14точек.',
  stages: [{ id: 'answer', role: 'answer', title: 'Ответ и проверка', expected: 'Найти56отрезков.',
    rows: [{ label: 'Итог', value: '56отрезков', explanation: 'Проверка:14+12+...+2=56.' }],
    answer: '56отрезков', verification: [{ label: 'Сумма', value: '14+12+…+2=56' }],
    hintPreview: 'Сколько от0до14?', revealPreview: 'Получилось56отрезков.',
    source: { kind: 'teacher-file', ref: 'fixture', label: 'Лист', excerpt: 'Точный источник:14точек.' } }],
}
const review: DayWorkReview = { id: 'fixture', taskId: 'fixture', status: 'partial',
  items: [{ stageId: 'answer', label: 'Ответ и проверка', status: 'incorrect', observed: 'Ответ23варианта.',
    note: '8чётных и7нечётных дают56отрезков. Проверка:14+12+...+2=56.' }],
  studentFeedback: { title: 'Проверь число23варианта', confirmed: 'Начало верно.', focus: 'Осталось7точек.', question: 'Сколько от0до14?' },
}
const problem: DayProblem = { id: 'fixture', number: 1, title: 'Синтетическая задача', detail: 'Точный источник:14точек.', source: 'Лист',
  support: { skill: 'Подсчёт', state: 'unknown', evidence: 'Лист', evidenceRefs: ['fixture'], revision: 1,
    facts: [{ label: 'Всего', value: '14точек' }], find: 'Выбрать2точки', firstQuestion: 'Начни с2точек.' },
  original: { text: 'Точный источник:14точек.', attachmentRef: 'fixture' } }

it.each([true, false])('formats authored prose through the actual shared task composition, parent=%s', parent => {
  const before = JSON.stringify({ guide, review, problem })
  const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ label: 'Частично', tone: 'partial' }}
    links={[]} parent={parent} guide={guide} review={review} uploads={[]} helpAccess="ready" onPhotos={() => {}}
    guidance={[{ id: 'help', taskId: 'fixture', stageId: 'answer', stageIndex: 0, level: 'hint', text: 'Подсказка:начни с0до14.' } as any]} />)
  expect(html).toContain('Точный источник:14точек.')
  expect(html).toContain('14 точек')
  expect(html).toContain('Выбрать 2 точки')
  expect(html).toContain('Проверь число 23 варианта')
  if (parent) {
    expect(html).toContain('Ответ 23 варианта.')
    expect(html).toContain('8 чётных и 7 нечётных дают 56 отрезков.')
    expect(html).toContain('14 + 12 + ... + 2 = 56')
    expect(html).toContain('14 + 12 + … + 2 = 56')
    expect(html).toContain('56 отрезков')
    expect(html).not.toContain('Загрузить ')
  } else {
    expect(html).toContain('Подсказка: начни с 0 до 14.')
    expect(html).not.toContain('Разбор для родителя')
    expect(html).toContain('Загрузить ')
  }
  expect(JSON.stringify({ guide, review, problem })).toBe(before)
})

it('formats clarification questions and source-analysis prose, retaining the source receipt', () => {
  const request = { id: 'fixture', state: 'open' as const, question: 'О чём2записи?', photoPrompt: 'Добавь2страницы.' }
  const analysis = { requestId: 'fixture', topic: null, observed: 'Видно2записи и2×3=6.', quality: 'Есть2заголовка.',
    limitation: 'Не видно3страницы.', nextStep: 'Добавь3страницу.', evidence: [{ uploadId: 'fixture', location: 'вверху', text: 'Точный источник:2записи' }] }
  const before = JSON.stringify({ request, analysis })
  const html = renderToStaticMarkup(<MaterialRequest request={request} label="Уточнить" detail={analysis.nextStep} analysis={analysis} />)
  for (const text of ['О чём 2 записи?', 'Добавь 2 страницы.', 'Видно 2 записи и 2×3=6.', 'Есть 2 заголовка.', 'Не видно 3 страницы.', 'Добавь 3 страницу.']) expect(html).toContain(text)
  expect(JSON.stringify({ request, analysis })).toBe(before)
})

it('formats observations in the legacy parent guide too', () => {
  const html = renderToStaticMarkup(<ParentTaskGuide guide={{ ...guide, presentation: undefined }} review={review} />)
  expect(html).toContain('Ответ 23 варианта.')
  expect(html).toContain('Найти 56 отрезков.')
})

it('formats the preview while sending the original stage and keeping duplicate-send detection', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), send = vi.fn().mockResolvedValue(undefined)
  try {
    await act(async () => root.render(<ParentTaskGuide guide={guide} review={review} onSend={send} />))
    await act(async () => (host.querySelector('button[aria-label^="Выбрать подсказку"]') as HTMLButtonElement).click())
    expect(host.querySelector('.day-learning-route-preview p')?.textContent).toBe('Сколько от 0 до 14?')
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Отправить Пете')!
    await act(async () => button.click())
    expect(send).toHaveBeenCalledExactlyOnceWith(guide.stages[0], 'hint')
    expect(guide.stages[0].hintPreview).toBe('Сколько от0до14?')
    expect(host.textContent).toContain('Подсказка отправлена Пете.')
    expect(host.querySelector('button[aria-label^="Выбрать подсказку"]')).toBeNull()
    expect(host.querySelector('button[aria-label^="Выбрать показ"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
