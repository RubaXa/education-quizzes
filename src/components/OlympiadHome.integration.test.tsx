// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OlympiadHome from './OlympiadHome'
import { watchFamilyOlympiadTasks, watchPublicOlympiads } from '@/lib/educationStore'

vi.mock('@/lib/educationStore', () => ({ watchFamilyOlympiadTasks: vi.fn(), watchPublicOlympiads: vi.fn() }))
vi.mock('@/lib/browserAccessTrace', () => ({ traceOlympiad: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div')
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); host.innerHTML = ''; vi.resetAllMocks() })
const publicItems = [{ id: 'shared', title: 'Общая олимпиада', deadline: '2026-11-05' }, { id: 'future', title: 'Другая олимпиада', deadline: null }]
const familyTask = { id: 'task', title: 'Семейная подготовка', dueDate: '2026-11-05', projectionSourceDate: '2026-11-04', learningContext: { kind: 'olympiad' as const, id: 'shared' }, testTokens: [] }
it.each(['parent', 'student'] as const)('combines the public catalog with only the %s family assignments', async role => {
  vi.mocked(watchPublicOlympiads).mockImplementation(next => { next(publicItems); return () => {} })
  vi.mocked(watchFamilyOlympiadTasks).mockImplementation((_family, _child, next) => { next([familyTask]); return () => {} })
  document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<OlympiadHome familyId="family" childId="child" parent={role === 'parent'} dashboardToken="demo" />))
  expect(host.textContent).toContain('Общая олимпиада')
  expect(host.textContent).not.toContain('Семейная подготовка')
  expect(host.textContent).toContain('Другая олимпиада')
  expect(host.textContent).toContain('5 ноября 2026 г.')
  expect(host.textContent).toContain('Подготовка ещё не подключена')
  expect(host.querySelectorAll('button').length).toBe(1)
  expect(vi.mocked(watchFamilyOlympiadTasks).mock.calls[0].slice(0, 2)).toEqual(['family', 'child'])
})
it('keeps family practice visible when the shared catalog cannot load', async () => {
  vi.mocked(watchPublicOlympiads).mockImplementation((_next, fail) => { fail(new Error('offline')); return () => {} })
  vi.mocked(watchFamilyOlympiadTasks).mockImplementation((_family, _child, next) => { next([familyTask]); return () => {} })
  document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<OlympiadHome familyId="family" childId="child" parent dashboardToken="demo" />))
  expect(host.textContent).toContain('Общий каталог временно недоступен')
  expect(host.textContent).toContain('Олимпиада — название уточняется')
})
