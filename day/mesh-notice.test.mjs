import { describe, expect, it } from 'vitest'
import { classifyMeshNotice, meshNoticeEntryErrors } from './mesh-notice.mjs'

const reason = 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.'
const entry = { kind: 'notice', id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!', reason }

describe('консервативная классификация информационной записи МЭШ', () => {
  it('recognizes the exact standalone greeting only', () => {
    expect(classifyMeshNotice('Всем хороших каникул!')).toEqual({ kind: 'notice', reason })
    expect(classifyMeshNotice('  Всем   хороших каникул… ')).toEqual({ kind: 'notice', reason })
    expect(classifyMeshNotice('Всем хороших каникул! Решить № 5.')).toBeNull()
    expect(classifyMeshNotice('Хороших каникул!')).toBeNull()
    expect(classifyMeshNotice('Всем хороших каникул!', { hasTeacherFiles: true })).toBeNull()
  })

  it('requires an exact classified source entry without a task target', () => {
    const subject = { id: 'math', mesh: 'Урок. Всем хороших каникул!' }
    expect(meshNoticeEntryErrors(entry, { subject, tasks: [] })).toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, rawText: 'Всем хороших каникул! Решить № 5.' }, { subject })).not.toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, targetTaskId: 'mesh-task' }, { subject })).not.toEqual([])
    expect(meshNoticeEntryErrors(entry, { subject, tasks: [{ id: entry.id }] })).not.toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, reason: 'Похоже на сообщение' }, { subject })).not.toEqual([])
  })
})
