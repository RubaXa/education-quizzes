/** @see ../docs/modules/school-diary/school-calendar.md */
import { expect, it, vi } from 'vitest'
import { calendarFailure, calendarShape, captureSchoolCalendar, schoolYearWindow } from './school-calendar.mjs'
it('uses the academic-year range only as a source query, without guessing vacation dates', () => {
  expect(schoolYearWindow('2026-10-19')).toEqual({ from: '2026-09-01', to: '2027-08-31' })
  expect(schoolYearWindow('2026-08-31')).toEqual({ from: '2025-09-01', to: '2026-08-31' })
  expect(() => schoolYearWindow('2026-02-30')).toThrow('invalid_calendar_date')
})
it('captures exactly one request through the already scoped adapter', async () => {
  const payload = { fixture: [] }, getSchoolCalendar = vi.fn().mockResolvedValue(payload)
  const capture = await captureSchoolCalendar({ getSchoolCalendar }, '2026-10-19', () => '2026-10-19T00:00:00Z')
  expect(getSchoolCalendar).toHaveBeenCalledExactlyOnceWith('2026-09-01', '2027-08-31')
  expect(capture.payload).toBe(payload)
  expect(capture).not.toHaveProperty('vacations')
})
it('does not turn a source failure into an empty calendar', async () => {
  await expect(captureSchoolCalendar({ getSchoolCalendar: async () => { throw Error('offline') } }, '2026-10-19')).rejects.toThrow('offline')
  await expect(captureSchoolCalendar({ getSchoolCalendar: async () => null }, '2026-10-19')).rejects.toThrow('invalid_calendar_payload')
})
it('prints shape only, with no personal field values', () => {
  expect(JSON.stringify(calendarShape([{ title: 'PRIVATE_NAME', start_date: 'PRIVATE_DATE' }]))).not.toMatch(/PRIVATE_/)
})
it('reports a safe API status without credentials, student IDs, URL or response body', () => {
  expect(calendarFailure(Error('API 404: https://school.mos.ru/?student_id=PRIVATE\nPRIVATE_RESPONSE'))).toEqual({ operation: 'captureSchoolCalendar', httpStatus: 404, code: 'mesh-http-error' })
})
it('preserves a private failure body without retaining the request URL', async () => {
  const save = vi.fn()
  await expect(captureSchoolCalendar({ getSchoolCalendar: async () => { throw Error('API 400: https://school.mos.ru/?student_id=PRIVATE\n{"message":"fixture"}') } },
    '2026-10-19', () => '2026-10-19T00:00:00Z', save)).rejects.toThrow('API 400')
  expect(save.mock.calls[0][0].responseBody).toBe('{"message":"fixture"}')
  expect(JSON.stringify(save.mock.calls[0])).not.toContain('PRIVATE')
})
