import { describe, expect, it } from 'vitest'
import { backfillLearningContext } from './learning-context-backfill.mjs'

function fixture() {
  const data = new Map([
    ['assignments/student', { testId: 'test', slug: 'lesson', familyId: 'family', childId: 'child', answers: { q: 'keep' } }],
    ['previews/preview', { testId: 'test' }],
    ['dashboard/board/assignments/student', { testId: 'test', slug: 'lesson', previewToken: 'preview' }],
  ])
  const db = { doc: path => ({ path, get: async () => ({ exists: data.has(path), data: () => data.get(path) }) }),
    runTransaction: async fn => { const updates = []; await fn({ get: ref => ref.get(), update: (ref, fields) => updates.push([ref.path, fields]) }); for (const [path, fields] of updates) data.set(path, { ...data.get(path), ...fields }) } }
  const args = { owner: { familyId: 'family', childId: 'child' }, entries: [{ learnerToken: 'student', previewToken: 'preview', testId: 'test', slug: 'lesson', boardTokens: ['board'] }], context: { kind: 'olympiad', id: 'formulo' } }
  return { db, data, args }
}
describe('existing lesson context migration', () => {
  it('preserves answers and links, verifies readback and permits safe retry', async () => {
    const { db, data, args } = fixture()
    expect(await backfillLearningContext(db, args)).toEqual({ assignments: 1, documentsVerified: 3 })
    expect(data.get('assignments/student')).toMatchObject({ answers: { q: 'keep' }, learningContext: args.context })
    expect(data.get('dashboard/board/assignments/student')).toMatchObject({ previewToken: 'preview', learningContext: args.context })
    await expect(backfillLearningContext(db, args)).resolves.toEqual({ assignments: 1, documentsVerified: 3 })
  })
  it('rejects another owner or an existing conflicting context before writing', async () => {
    const { db, data, args } = fixture()
    args.owner.childId = 'other'
    await expect(backfillLearningContext(db, args)).rejects.toThrow()
    expect(data.get('assignments/student')).not.toHaveProperty('learningContext')
    args.owner.childId = 'child'
    data.get('dashboard/board/assignments/student').learningContext = { kind: 'course', id: 'other' }
    await expect(backfillLearningContext(db, args)).rejects.toThrow()
    expect(data.get('assignments/student')).not.toHaveProperty('learningContext')
  })
  it('marks untouched training optional without replacing an existing family choice', async () => {
    const { db, data, args } = fixture()
    await backfillLearningContext(db, { ...args, markOptional: true })
    expect(data.get('assignments/student')).toMatchObject({ familyOptional: true, answers: { q: 'keep' } })
    data.get('assignments/student').familyOptional = false
    data.get('assignments/student').familyChoiceAt = 'prior-choice'
    const result = await backfillLearningContext(db, { ...args, markOptional: true })
    expect(result.existingRequired).toBe(1)
    expect(data.get('assignments/student')).toMatchObject({ familyOptional: false, familyChoiceAt: 'prior-choice' })
  })
})
