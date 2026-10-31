// @vitest-environment jsdom
/** @see ../../docs/shared/design/compact-review.md#verification */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import ReviewBrief from './ReviewBrief'
import { reviewBriefExamples, reviewBriefUncertain, reviewBriefVerified } from '@/lib/reviewBriefExamples'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); host.innerHTML = '' })
async function show(data = reviewBriefExamples[0].data) {
  if (!root) { document.body.append(host); root = createRoot(host) }
  await act(async () => root!.render(<ReviewBrief data={data} />))
}

it('keeps the accepted part and one action visible without opening explanatory content', async () => {
  await show()
  expect(host.querySelector('.edu-review-confirmed')?.textContent).toContain('3 + 2 = 5')
  expect(host.querySelector('.edu-review-question')?.textContent).toBe('Сколько карандашей всего?')
  expect(host.querySelectorAll('.edu-review-question')).toHaveLength(1)
  expect(host.querySelector('details')?.open).toBe(false)
  expect(host.querySelectorAll('dl dd')).toHaveLength(2)
  expect(host.querySelector('.edu-review-bracket')?.getAttribute('aria-hidden')).toBe('true')
})

it('closes the previous optional explanation when a different review is shown', async () => {
  await show()
  host.querySelector('details')!.open = true
  await show(reviewBriefExamples[1].data)
  expect(host.querySelector('details')?.open).toBe(false)
  expect(host.querySelector('blockquote')?.textContent).toBe('В лесу росли высокая берёза.')
  expect(host.querySelector('.edu-review-mark-focus')?.textContent).toBe('росли')
  expect(host.textContent).not.toContain('росла')
})

it('does not turn a verified or unreadable record into an error or a new correction task', async () => {
  await show({ ...reviewBriefVerified, question: 'This stale question must not become a new task.' })
  expect(host.querySelector('.edu-review-question')).toBeNull()
  expect(host.querySelector('.edu-review-state')?.textContent).toBe('Зачтено')
  await show(reviewBriefUncertain)
  expect(host.querySelector('.edu-review-state')?.textContent).toBe('Уточняем')
  expect(host.textContent).not.toContain('Неверно')
  expect(host.querySelector('.edu-review-question')?.textContent).toContain('чёткий фрагмент')
})

it('preserves supplied timeline order rather than deriving chronology or an interval', async () => {
  const example = reviewBriefExamples[2].data
  if (example.visual?.kind !== 'timeline') throw new Error('Missing timeline fixture')
  await show({ ...example, visual: { ...example.visual, events: [...example.visual.events].reverse() } })
  expect([...host.querySelectorAll('.edu-review-date')].map(el => el.textContent)).toEqual(['1721', '1703'])
  expect(host.querySelector('.edu-review-question')?.textContent).toContain('Сколько лет')
})

it('preserves separate addressable explanations and a supplied comparison without adding an answer', async () => {
  await show()
  const details = [...host.querySelectorAll('details')]
  expect(details.map(el => el.querySelector('summary')?.textContent)).toEqual(['Что нужно найти', 'Проверка найденного'])
  expect(details.every(el => !el.open)).toBe(true)
  expect([...host.querySelectorAll('table tbody td')].map(el => el.textContent)).toEqual(['3', '2', '5'])
  expect(host.querySelectorAll('.edu-review-question')).toHaveLength(1)
  expect(host.querySelector('table')?.getAttribute('aria-label')).toContain('уже найденного')
})
