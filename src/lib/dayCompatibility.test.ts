import { describe, expect, it, vi } from 'vitest'
import { normalizeDayPage, normalizeDayDashboard, UnsupportedDataSchemaError } from './dayCompatibility'
import { readCachedDayDashboard } from './dayDashboardStore'

const a = 'a'.repeat(32), b = 'b'.repeat(32)
const page = () => ({ schemaVersion: 1, kind: 'parent', date: '2026-10-12', targetDate: '2026-10-13', subjects: [{ id: 'history', tasks: [{ id: 'mesh-7', testToken: a }] }],
  testPlacements: [{ taskId: 'mesh-7', subjectId: 'history', token: `old-slug~${b}` }, { taskId: 'mesh-7', subjectId: 'history', token: a }] })

describe('совместимость дневных данных', () => {
  it('читает legacy-дубликат, оставляя только токен действующего задания', () => {
    const normalized = normalizeDayPage(page())
    expect(normalized.testPlacements).toEqual([{ taskId: 'mesh-7', subjectId: 'history', token: a }])
  })
  it('читает старую страницу без schemaVersion, если её основная форма известна', () => {
    const legacy = Object.fromEntries(Object.entries(page()).filter(([key]) => key !== 'schemaVersion'))
    expect(normalizeDayPage(legacy).testPlacements).toHaveLength(1)
  })
  it('явно блокирует неизвестную новую схему', () => {
    expect(() => normalizeDayPage({ ...page(), schemaVersion: 2 })).toThrow(UnsupportedDataSchemaError)
    expect(() => normalizeDayDashboard({ schemaVersion: 2, kind: 'parent', days: [] })).toThrow(UnsupportedDataSchemaError)
  })
  it('не показывает сохранённый календарь другой роли или неподдерживаемой схемы', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null })
    data.set('education-day-dashboard-v1:calendar', JSON.stringify({ schemaVersion: 1, kind: 'parent', days: [] }))
    expect(readCachedDayDashboard('calendar', 'parent')?.kind).toBe('parent')
    expect(readCachedDayDashboard('calendar', 'student')).toBeNull()
    data.set('education-day-dashboard-v1:calendar', JSON.stringify({ schemaVersion: 2, kind: 'parent', days: [] }))
    expect(readCachedDayDashboard('calendar', 'parent')).toBeNull()
    vi.unstubAllGlobals()
  })
})
