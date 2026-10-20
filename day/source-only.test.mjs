import { describe, expect, it } from 'vitest'
import { sourceOnlyPublicationErrors, taskMaterialPublicationError } from './source-only.mjs'

const sourceOnlyTask = (overrides = {}) => ({
  id: 'mesh-352561461',
  meshText: 'Решить задачи из файла',
  detail: 'Решить задачи из файла',
  kind: 'check',
  status: 'unknown',
  instructionStatus: { state: 'needs-review', message: 'Пока показана точная запись МЭШ.' },
  materialStatus: { state: 'teacher-attachment-needed', message: 'Файл ещё не сопоставлен.' },
  sourceOnly: true,
  platformResult: { state: 'completed', points: 8, maxPoints: 8 },
  ...overrides,
})

describe('точная запись МЭШ с неразобранным источником', () => {
  it('разрешает только явно отмеченный raw task, оставляя прикреплённый результат', () => {
    const task = sourceOnlyTask()
    expect(sourceOnlyPublicationErrors(task)).toEqual([])
    expect(taskMaterialPublicationError(task)).toBeNull()
    expect(task.platformResult).toEqual({ state: 'completed', points: 8, maxPoints: 8 })
  })

  it('не позволяет добавлять интерпретацию, фотоинструкции или тесты в raw mode', () => {
    for (const field of [
      { steps: [{ text: 'Реши по образцу' }] },
      { submission: { items: [{ text: 'Пришли фото' }] } },
      { parentGuide: { stages: [] } },
      { testToken: 'test-token-1234567890123456' },
    ]) expect(sourceOnlyPublicationErrors(sourceOnlyTask(field)).length).toBeGreaterThan(0)
    expect(sourceOnlyPublicationErrors(sourceOnlyTask({ detail: 'Пересказ задания' })).length).toBeGreaterThan(0)
    expect(sourceOnlyPublicationErrors(sourceOnlyTask({ sourceOnly: false })).length).toBeGreaterThan(0)
    expect(sourceOnlyPublicationErrors(sourceOnlyTask({ cardPolicyVersion: 1, mathRoutePolicyVersion: 2 }))).toEqual([])
    expect(sourceOnlyPublicationErrors(sourceOnlyTask({ cardPolicyVersion: 3 })).length).toBeGreaterThan(0)
  })

  it('разрешает source-only запись отдельно, не скрывая ошибку у другой карточки', () => {
    const sourceOnly = sourceOnlyTask()
    const ready = { id: 'mesh-ready', materialStatus: { state: 'textbook-page-linked' } }
    const incomplete = { id: 'mesh-incomplete', materialStatus: { state: 'textbook-page-needed' } }
    expect([sourceOnly, ready].map((task) => taskMaterialPublicationError(task, { hasPages: task === ready })))
      .toEqual([null, null])
    expect(taskMaterialPublicationError(incomplete)).toMatch(/ещё не сверён/)
    expect(taskMaterialPublicationError(incomplete, { hasPages: true })).toMatch(/ещё не сверён/)
    expect(taskMaterialPublicationError({ id: 'mesh-attachment', materialStatus: { state: 'teacher-attachment-needed' } }, { hasTeacherFile: true }))
      .toMatch(/не сопоставлены/)
  })
})
