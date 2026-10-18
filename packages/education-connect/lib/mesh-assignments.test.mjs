import { describe, expect, it } from 'vitest'
import { isCalendarOnlyEvent, MeshDiaryAdapter } from './mesh.mjs'

function fixture(count) {
  const date = '2026-10-15'
  const events = Array.from({ length: count }, (_, index) => ({
    id: index + 1, start_at: `${date}T09:00:00`, subject_name: `Предмет ${index + 1}`,
    homework: { total_count: 1, descriptions: [`Задание ${index + 1}`] },
  }))
  return { date, events, scheduleCache: new Map([[date, events]]) }
}

describe('подробные карточки МЭШ', () => {
  it('keeps the raw schedule array intact for the sync snapshot', async () => {
    const date = '2026-10-13'
    const raw = [{ id: 80, source: 'OLYMPIAD', start_at: '2026-10-12T09:00:00+03:00',
      finish_at: '2026-10-15T21:30:00+03:00', title: 'private source data' }]
    const adapter = { api: { async getSchedule(begin, end, options) {
      expect([begin, end, options.mesRole]).toEqual([date, date, 'parent'])
      return raw
    } }, scheduleCache: new Map() }
    const returned = await MeshDiaryAdapter.prototype.getSchedule.call(adapter, date)
    expect(returned).toBe(raw)
    expect(adapter.scheduleCache.get(date)).toBe(raw)
  })

  it('does not request lesson details for confirmed calendar OLYMPIAD records', async () => {
    const date = '2026-10-15'
    const events = [
      { id: 17, source: 'OLYMPIAD', start_at: `${date}T08:00:00+03:00`, finish_at: `${date}T09:00:00+03:00` },
      { id: 18, source: 'PLAN', start_at: `${date}T10:00:00+03:00`, finish_at: `${date}T10:45:00+03:00`,
        subject_id: 2, subject_name: 'Математика', homework: { total_count: 1, descriptions: ['homework'] } },
    ]
    const calls = []
    const adapter = { scheduleCache: new Map([[date, events]]), async getLessonDetails(event) {
      calls.push(event.source)
      if (event.source === 'OLYMPIAD') throw new Error('calendar must not reach lesson API')
      return { lesson_homeworks: [{ homework_id: 2, homework: 'homework' }] }
    } }
    const result = await MeshDiaryAdapter.prototype.getAssignments.call(adapter, date)
    expect(calls).toEqual(['PLAN'])
    expect(result.map(({ sourceItemId }) => sourceItemId)).toEqual(['18'])
  })

  it('classifies only overlapping lesson-free OLYMPIAD intervals as calendar-only', () => {
    const olympiad = { source: 'OLYMPIAD', start_at: '2026-10-12T09:00:00+03:00', finish_at: '2026-10-15T21:30:00+03:00' }
    for (const date of ['2026-10-13', '2026-10-14', '2026-10-15']) expect(isCalendarOnlyEvent(olympiad, date)).toBe(true)
    expect(isCalendarOnlyEvent(olympiad, '2026-10-16')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, finish_at: '2026-10-16T00:00:00+03:00' }, '2026-10-15')).toBe(true)
    const utcBoundary = { source: 'OLYMPIAD', start_at: '2026-10-12T21:00:00Z', finish_at: '2026-10-13T21:00:00Z' }
    expect(isCalendarOnlyEvent(utcBoundary, '2026-10-13')).toBe(true)
    expect(isCalendarOnlyEvent(utcBoundary, '2026-10-14')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, finish_at: '2026-10-16T00:00:00+03:00' }, '2026-10-16')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, finish_at: '2026-10-12T08:00:00+03:00' }, '2026-10-12')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, finish_at: 'invalid' }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, start_at: '2026-02-30T09:00:00Z', finish_at: '2026-03-02T09:00:00Z' }, '2026-03-01')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, subject_id: 1 }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, subject_id: 0 }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, subject: { id: 0 } }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, homework: { total_count: 1 } }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, homework: { descriptions: ['задание'] } }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, lesson_type: 'lesson' }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, course_lesson_type: 'lesson' }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, source: 'PLAN' }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, source: 'UNKNOWN' }, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent(null, '2026-10-13')).toBe(false)
    expect(isCalendarOnlyEvent(olympiad, '2026-02-30')).toBe(false)
    expect(isCalendarOnlyEvent({ ...olympiad, start_at: '2026-10-12T09:00:00' }, '2026-10-13')).toBe(false)
  })

  it('читает максимум три карточки одновременно и сохраняет порядок уроков', async () => {
    const data = fixture(7)
    let active = 0, peak = 0
    const adapter = { scheduleCache: data.scheduleCache, getLessonDetails: async (event) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - Number(event.id))))
      active--
      return { lesson_homeworks: [{ homework_id: event.id, homework: `Подробно ${event.id}` }] }
    } }
    const result = await MeshDiaryAdapter.prototype.getAssignments.call(adapter, data.date)
    expect(result.map((item) => item.sourceItemId)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(peak).toBe(3)
    expect(active).toBe(0)
  })

  it('не считает пропавшее подробное задание удалённым даже при параллельном чтении', async () => {
    const data = fixture(3)
    const adapter = { scheduleCache: data.scheduleCache, getLessonDetails: async (event) => {
      if (event.id === 2) throw new Error('МЭШ временно недоступен')
      return { lesson_homeworks: [{ homework_id: event.id, homework: `Подробно ${event.id}` }] }
    } }
    await expect(MeshDiaryAdapter.prototype.getAssignments.call(adapter, data.date,
      [{ sourceItemId: '2', homeworkEntries: [{ id: 'old', description: 'Прежнее задание' }] }]))
      .rejects.toMatchObject({ code: 'INCOMPLETE_DETAIL',
        incompleteDetails: [{ lessonId: '2', reason: 'МЭШ временно недоступен' }],
        partialResult: expect.arrayContaining([expect.objectContaining({ sourceItemId: '2', detailStatus: 'unavailable' })]) })
  })
})
