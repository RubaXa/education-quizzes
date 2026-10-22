import { describe, expect, it } from 'vitest'
import { classifyMeshNotice, meshNoticeEntryErrors } from './mesh-notice.mjs'

const reason = 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.'
const noAssignmentReason = 'Точная отдельная отметка МЭШ «не задано»; в ней нет учебного действия.'
const entry = { kind: 'notice', id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!', reason }

describe('консервативная классификация информационной записи МЭШ', () => {
  it('recognizes the exact standalone greeting only', () => {
    expect(classifyMeshNotice('Всем хороших каникул!')).toEqual({ kind: 'notice', reason })
    expect(classifyMeshNotice('  Всем   хороших каникул… ')).toEqual({ kind: 'notice', reason })
    expect(classifyMeshNotice('Всем хороших каникул! Решить № 5.')).toBeNull()
    expect(classifyMeshNotice('Хороших каникул!')).toBeNull()
    expect(classifyMeshNotice('Всем хороших каникул!', { hasTeacherFiles: true })).toBeNull()
  })

  it('recognizes only the standalone no-assignment marker with normalized spaces and case', () => {
    expect(classifyMeshNotice('не задано')).toEqual({ kind: 'notice', reason: noAssignmentReason })
    expect(classifyMeshNotice('  НЕ   ЗАДАНО. ')).toEqual({ kind: 'notice', reason: noAssignmentReason })
    expect(classifyMeshNotice('не задано, но прочитать параграф')).toBeNull()
    expect(classifyMeshNotice('не задано по учебнику, сделать задания')).toBeNull()
    expect(classifyMeshNotice('не задано!', { hasTeacherFiles: true })).toBeNull()
    expect(classifyMeshNotice('задание не задано')).toBeNull()
  })

  it('requires an exact classified source entry without a task target', () => {
    const subject = { id: 'math', mesh: 'Урок. Всем хороших каникул!' }
    expect(meshNoticeEntryErrors(entry, { subject, tasks: [] })).toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, rawText: 'Всем хороших каникул! Решить № 5.' }, { subject })).not.toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, targetTaskId: 'mesh-task' }, { subject })).not.toEqual([])
    expect(meshNoticeEntryErrors(entry, { subject, tasks: [{ id: entry.id }] })).not.toEqual([])
    expect(meshNoticeEntryErrors({ ...entry, reason: 'Похоже на сообщение' }, { subject })).not.toEqual([])
    const noAssignment = { ...entry, rawText: 'НЕ ЗАДАНО.', reason: noAssignmentReason }
    expect(meshNoticeEntryErrors(noAssignment, { subject: { id: 'math', mesh: 'НЕ ЗАДАНО.' } })).toEqual([])
    expect(meshNoticeEntryErrors({ ...noAssignment, reason }, { subject: { id: 'math', mesh: 'НЕ ЗАДАНО.' } })).not.toEqual([])
  })
})
