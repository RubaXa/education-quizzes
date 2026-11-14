// @vitest-environment jsdom
/** @see ../../docs/modules/families/README.md#birthday */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BirthdayTheme from './BirthdayTheme'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const child = { familyId: 'family', childId: 'child', role: 'student' as const, displayName: 'Саша', birthday: '11-15', timezone: 'Europe/Moscow' }
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.useFakeTimers() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
it('changes at Moscow midnight in an open page and keeps all task actions', async () => {
  vi.setSystemTime(new Date('2026-11-14T20:59:30Z'))
  await act(async () => root.render(<BirthdayTheme child={child}><button>Мои задания</button><input aria-label="Черновик" defaultValue="Сохрани меня" /></BirthdayTheme>))
  expect(host.textContent).not.toContain('С днём рождения')
  const draft = host.querySelector('input')!
  await act(async () => { vi.advanceTimersByTime(60_000) })
  expect(host.textContent).toContain('С днём рождения, Саша!')
  expect(host.querySelector('button')?.textContent).toBe('Мои задания')
  expect(host.querySelector('input')).toBe(draft)
  expect(draft.value).toBe('Сохрани меня')
  await act(async () => { vi.advanceTimersByTime(24 * 60 * 60_000) })
  expect(host.textContent).not.toContain('С днём рождения')
})
it('never borrows another child birthday or accepts an impossible date', async () => {
  vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
  for (const birthday of [undefined, '02-31', '11-16']) {
    await act(async () => root.render(<BirthdayTheme child={{ ...child, birthday }}>Уроки</BirthdayTheme>))
    expect(host.querySelector('[aria-label="Поздравление Education"]')).toBeNull()
    expect(host.textContent).toBe('Уроки')
  }
})
