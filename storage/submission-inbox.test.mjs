import { describe, expect, it } from 'vitest'
import { resolveSubmission } from './submission-inbox.mjs'

const owner = { familyId: 'family', childId: 'child', date: '2026-10-08', targetDate: '2026-10-09' }
const page = {
  kind: 'student', date: owner.date, targetDate: owner.targetDate, taskIds: ['task-1'],
  subjects: [{ name: 'Математика', tasks: [{ id: 'task-1', title: 'Упражнение 42',
    meshText: 'Упр. 42 письменно.', submission: { description: 'Фото тетради' } }] }],
}
const upload = { taskId: 'task-1', status: 'pending', createdAt: '2026-10-08T14:00:00Z',
  storage: { state: 'stored', path: 'app:/PETR/example.jpg' } }

describe('private submission inbox', () => {
  it('links a pending photo to the exact owner and task', () => {
    const result = resolveSubmission({ owner, page, childName: 'Ученик', uploadId: 'photo', upload })
    expect(result).toMatchObject({ childName: 'Ученик', childId: 'child', taskId: 'task-1',
      assignmentText: 'Упр. 42 письменно.', subject: 'Математика', resolution: 'linked',
      fileState: 'on-disk', reviewStatus: 'pending' })
  })
  it('keeps an orphaned upload visible for manual linking', () => {
    const result = resolveSubmission({ owner, page, uploadId: 'photo', upload: { ...upload, taskId: 'removed' } })
    expect(result).toMatchObject({ taskId: 'removed', resolution: 'needs-manual-link', taskTitle: null })
  })
  it('shows sibling problem IDs without assuming they are on the photo', () => {
    const withProblems = { ...page, taskIds: ['task-1', 'task-1-p01', 'task-1-p02'], subjects: [{ name: 'Математика', tasks: [{ ...page.subjects[0].tasks[0], problems: [
      { id: 'task-1-p01', number: 1, title: 'Площадь' }, { id: 'task-1-p02', number: 2, title: 'Числа' },
    ] }] }] }
    const result = resolveSubmission({ owner, page: withProblems, uploadId: 'photo', upload: { ...upload, taskId: 'task-1-p01' } })
    expect(result.relatedTasks).toEqual([
      { taskId: 'task-1-p01', title: '№ 1. Площадь' },
      { taskId: 'task-1-p02', title: '№ 2. Числа' },
    ])
  })
  it('flags a task condition changed after upload', () => {
    const changed = { ...page, changes: [{ at: '2026-10-08T15:00:00Z', changed: ['task-1'] }] }
    expect(resolveSubmission({ owner, page: changed, uploadId: 'photo', upload }).conditionChangedAfterUpload).toBe(true)
  })
  it('distinguishes temporary Firestore bytes from missing file', () => {
    const temporary = { ...upload, storage: undefined, dataUrl: 'data:image/png;base64,AA==' }
    expect(resolveSubmission({ owner, page, uploadId: 'photo', upload: temporary }).fileState).toBe('awaiting-disk')
    expect(resolveSubmission({ owner, page, uploadId: 'photo', upload: { ...temporary, dataUrl: undefined } }).fileState).toBe('missing-file')
  })
})
