/** @see ../../../docs/modules/school-diary/school-calendar.md */
import { expect, it, vi } from 'vitest'
import { MeshDiaryAdapter } from './mesh.mjs'
it('uses confirmed from/to parameters and the selected pupil through the existing authenticated API', async () => {
  const adapter = new MeshDiaryAdapter({ studentId: 'child-profile', profileId: 'child-profile', parentProfileId: 'parent-profile' }, () => {})
  const payload = { fixture: [] }
  adapter.api.apiFetch = vi.fn().mockResolvedValue({ payload })
  expect(await adapter.getSchoolCalendar('2026-09-01', '2027-08-31')).toBe(payload)
  const [address, options] = adapter.api.apiFetch.mock.calls[0], url = new URL(address)
  expect(url.pathname).toBe('/api/family/mobile/v1/periods_schedules')
  expect(Object.fromEntries(url.searchParams)).toEqual({ student_id: 'child-profile', profile_id: 'child-profile', from: '2026-09-01', to: '2027-08-31' })
  expect(options.headers).toEqual({ 'profile-id': 'parent-profile' })
})
it('rejects malformed or reversed source query ranges before any network request', async () => {
  const adapter = new MeshDiaryAdapter({}, () => {})
  adapter.api.apiFetch = vi.fn()
  await expect(adapter.getSchoolCalendar('2026-02-30', '2027-08-31')).rejects.toThrow('invalid_calendar_range')
  await expect(adapter.getSchoolCalendar('2027-08-31', '2026-09-01')).rejects.toThrow('invalid_calendar_range')
  expect(adapter.api.apiFetch).not.toHaveBeenCalled()
})
