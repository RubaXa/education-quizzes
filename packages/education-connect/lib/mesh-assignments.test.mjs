import { describe, expect, it } from 'vitest'
import { MeshDiaryAdapter } from './mesh.mjs'

function fixture(count) {
  const date = '2026-10-15'
  const events = Array.from({ length: count }, (_, index) => ({
    id: index + 1, start_at: `${date}T09:00:00`, subject_name: `Предмет ${index + 1}`,
    homework: { total_count: 1, descriptions: [`Задание ${index + 1}`] },
  }))
  return { date, events, scheduleCache: new Map([[date, events]]) }
}

describe('подробные карточки МЭШ', () => {
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
