import { describe, expect, it } from 'vitest'
import { assertPublishedPageAligned, assertSourceAligned, sourcePlanFingerprint } from './pipeline-contract.mjs'
import { assertWeekendWorkRetention } from './dashboard-index.mjs'

const snapshot = { complete: true, date: '2026-10-15', assignments: [{ sourceItemId: '42', subject_name: 'Математика', detailStatus: 'loaded',
  homeworkEntries: [{ id: '99', description: 'Решить № 4.' }] }] }
const source = { targetDate: '2026-10-15', subjects: [{ tasks: [{ id: 'mesh-99', meshText: 'Решить № 4.' }] }] }

describe('барьер публикации плана', () => {
  it('останавливает выпуск при новом ДЗ в МЭШ без обновления источника', () => {
    expect(() => assertSourceAligned({ ...source, subjects: [] }, snapshot)).toThrow(/mesh-99/)
  })
  it('останавливает выпуск при неполном снимке', () => {
    expect(() => assertSourceAligned(source, { ...snapshot, complete: false })).toThrow(/полный снимок/)
  })
  it('разрешает точный план и связывает публикацию с его отпечатком', () => {
    expect(assertSourceAligned(source, snapshot)).toMatchObject({ legacy: false, count: 1 })
    const page = { kind: 'student', targetDate: source.targetDate, sourcePlanFingerprint: sourcePlanFingerprint(source) }
    expect(() => assertPublishedPageAligned(source, page, 'student')).not.toThrow()
    expect(() => assertPublishedPageAligned({ ...source, subjects: [] }, page, 'student')).toThrow(/отстаёт/)
  })
  it('не даёт молча убрать выходную карточку', () => {
    const previous = [{ lessonDate: '2026-10-15', taskIds: ['mesh-99'] }]
    expect(() => assertWeekendWorkRetention(previous, [])).toThrow(/исчезла/)
    expect(() => assertWeekendWorkRetention(previous, [], [{ lessonDate: '2026-10-15', taskIds: ['mesh-99'], reason: 'Задание отменено в МЭШ.' }])).not.toThrow()
  })
})
