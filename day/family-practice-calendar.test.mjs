import { expect, it } from 'vitest'
import { projectFamilyAssignment, familyAssignmentProjectionSignature, mergeFamilyAssignments } from './family-assignment.mjs'
/** @see ../docs/decisions/olympiad-calendar-2026-10-31.md */
it('does not resurrect historical competition fields in confirmed home practice', () => {
  const task = { id: 'archive-task', sourceId: 'archive-task', sourceRevision: 4, subjectId: 'math', practiceMode: 'home', competitionUntil: '2026-11-05T23:59:59Z', competitionNumber: 4, learnerOrigin: { crop: { x: 10 } } }
  const current = { ...projectFamilyAssignment(task), competitionUntil: task.competitionUntil, competitionNumber: 4, status: 'verified' }
  const page = mergeFamilyAssignments({ planRevision: 1, subjects: [{ id: 'math', tasks: [current] }] }, [task])
  const actual = page.subjects[0].tasks[0]
  expect(actual.competitionUntil).toBeUndefined()
  expect(actual.competitionNumber).toBeUndefined()
  expect(actual.status).toBe('verified')
  expect(actual.learnerOrigin).toEqual(task.learnerOrigin)
  expect(familyAssignmentProjectionSignature(actual)).toEqual(familyAssignmentProjectionSignature(task))
  expect(projectFamilyAssignment({ ...task, practiceMode: 'competition' }).competitionUntil).toBe(task.competitionUntil)
})
