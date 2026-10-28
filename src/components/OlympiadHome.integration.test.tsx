// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import OlympiadHome from './OlympiadHome'
import { watchFamilyOlympiadTasks, watchPublicOlympiads, watchOlympiadGrade, watchOlympiadSelections, setOlympiadSelection } from '@/lib/educationStore'
vi.mock('@/lib/educationStore', () => ({ watchFamilyOlympiadTasks: vi.fn(), watchPublicOlympiads: vi.fn(), watchOlympiadGrade: vi.fn(), watchOlympiadSelections: vi.fn(), setOlympiadSelection: vi.fn() }))
vi.mock('@/lib/browserAccessTrace', () => ({ traceOlympiad: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const host = document.createElement('div'); let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); host.innerHTML = ''; vi.resetAllMocks() })
const publicItems = [{ id: 'shared', title: 'Общая олимпиада', deadline: '2026-11-05', gradeLevels:[5,6] }, { id: 'future', title: 'Другая олимпиада', deadline: null, gradeLevels:[6] }]
const familyTask = { id:'task', title:'Семейная подготовка', dueDate:'2026-11-05', projectionSourceDate:'2026-11-04', learningContext:{kind:'olympiad' as const,id:'shared'},testTokens:[] }
function fixture(role:'parent'|'student', selected:string[] = []) {
  let update: (ids:string[])=>void = () => {}
  vi.mocked(watchOlympiadGrade).mockImplementation((_f,_c,next) => { next(6); return () => {} })
  vi.mocked(watchPublicOlympiads).mockImplementation(next => { next(publicItems); return () => {} })
  vi.mocked(watchFamilyOlympiadTasks).mockImplementation((_f,_c,next) => { next([familyTask]); return () => {} })
  vi.mocked(watchOlympiadSelections).mockImplementation((_f,_c,next) => { update=next; next(selected); return () => {} })
  vi.mocked(setOlympiadSelection).mockImplementation(async (_f,_c,id,value) => { update(value ? [id] : []) })
  document.body.append(host); root=createRoot(host)
  return act(async () => root!.render(<OlympiadHome familyId="family" childId="child" parent={role==='parent'} dashboardToken="demo" />))
}
it('parent selects a catalog item and sees it in active', async () => {
 await fixture('parent')
 expect(host.textContent).toContain('Активные 0')
 const tabs=host.querySelectorAll<HTMLButtonElement>('[role=tab]'); await act(async()=>tabs[1].click())
 expect(host.textContent).toContain('Общая олимпиада'); expect(host.textContent).not.toContain('Семейная подготовка'); expect(host.textContent).toContain('5 ноября 2026 г.')
 const toggle=host.querySelector<HTMLButtonElement>('[role=switch]')!; expect(toggle.getAttribute('aria-checked')).toBe('false')
 await act(async()=>toggle.click()); expect(setOlympiadSelection).toHaveBeenCalledWith('family','child','shared',true)
 expect(host.textContent).toContain('Активные 1'); await act(async()=>tabs[0].click()); expect(host.textContent).toContain('Общая олимпиада')
})
it('student sees selected items and cannot select others', async()=>{
 await fixture('student',['shared']);expect(host.textContent).toContain('Общая олимпиада');expect(host.textContent).not.toContain('Доступные');expect(host.querySelector('[role=switch]')).toBeNull();expect(host.textContent).not.toContain('Другая олимпиада')
})
it('does not claim selection succeeded when the write fails', async()=>{
 await fixture('parent');vi.mocked(setOlympiadSelection).mockRejectedValue(new Error('denied'))
 await act(async()=>host.querySelectorAll<HTMLButtonElement>('[role=tab]')[1].click());await act(async()=>host.querySelector<HTMLButtonElement>('[role=switch]')!.click());expect(host.textContent).toContain('Не удалось изменить участие');expect(host.textContent).toContain('Активные 0')
})
