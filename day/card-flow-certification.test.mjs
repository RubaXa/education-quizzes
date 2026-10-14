import { describe, expect, it } from 'vitest'
import { teacherAttachmentOwnershipErrors } from './assignment-structure.mjs'
import { practiceVariantErrors, sourceInventoryErrors } from './card-policy.mjs'
import { assertPublishedPageAligned, assertSourceAligned, sourcePlanFingerprint } from './pipeline-contract.mjs'
import { publicPageSubjects } from './public-projection.mjs'
import { reviewCoverage } from '../storage/review-coverage.mjs'

const sha = (letter) => letter.repeat(64)
const link = (id, letter) => ({ sourceType: 'teacher-attachment', sourceRef: `mesh-attachment:${id}`,
  sourceSha256: sha(letter), title: id, url: `https://example.org/${id}.pdf` })
const geometry = link('geometry', 'a')
const practice = link('practice', 'b')
const extra = link('practice-extra', 'c')
const sheet = (attachment, groups) => ({ sourceRef: attachment.sourceRef, sourceSha256: attachment.sourceSha256,
  evidenceRef: `work/${attachment.title}/source.md`, groups })

const source = { targetDate: '2026-10-15', subjects: [{ id: 'math', tasks: [
  { id: 'mesh-101', meshText: 'Геометрия: решить задачи из файла', kind: 'written', outputKind: 'worked-solution',
    mathRoutePolicyVersion: 2, instructionStatus: { state: 'reviewed' },
    sourceInventory: { resultMode: 'written', sources: [sheet(geometry, [{ numbers: [3, 4, 6, 7] }])] },
    problems: [3, 4, 6, 7].map((number) => ({ id: `mesh-101-p${number}`, number })),
  },
  { id: 'mesh-102', meshText: 'Подготовиться по двум вариантам', kind: 'check',
    mathRoutePolicyVersion: 2, instructionStatus: { state: 'reviewed' },
    practiceVariants: [{ id: 'mesh-102-v1', title: 'Вариант 1' }, { id: 'mesh-102-v2', title: 'Вариант 2' }],
    sourceInventory: { resultMode: 'optional-practice', sources: [
      sheet(practice, [{ variantId: 'mesh-102-v1', numbers: [1, 2] }]),
      sheet(extra, [{ variantId: 'mesh-102-v2', numbers: [1, 2] }]),
    ] },
    problems: ['v1', 'v2'].flatMap((variant) => [1, 2].map((number) => ({
      id: `mesh-102-p-${variant}-${number}`, variantId: `mesh-102-${variant}`, number,
    }))),
  },
] }], materialLinks: { 'mesh-101': [geometry], 'mesh-102': [practice, extra] } }
const snapshot = { complete: true, date: source.targetDate, assignments: [{ sourceItemId: 'lesson', subjectName: 'Математика', detailStatus: 'loaded',
  homeworkEntries: [{ id: '101', description: source.subjects[0].tasks[0].meshText },
    { id: '102', description: source.subjects[0].tasks[1].meshText }],
}] }

describe('card flow: assignment → owned files → variants → photo → role readback', () => {
  it('accounts for two assignments, three files and repeated printed numbers across variants', () => {
    expect(assertSourceAligned(source, snapshot)).toMatchObject({ count: 2 })
    expect(teacherAttachmentOwnershipErrors(source)).toEqual([])
    for (const task of source.subjects[0].tasks) {
      expect(practiceVariantErrors(task)).toEqual([])
      expect(sourceInventoryErrors(task, source.materialLinks[task.id])).toEqual([])
    }
    const page = { kind: 'student', targetDate: source.targetDate,
      sourcePlanFingerprint: sourcePlanFingerprint(source), subjects: publicPageSubjects(source.subjects) }
    expect(() => assertPublishedPageAligned(source, page, 'student')).not.toThrow()
    const secondVariant = page.subjects[0].tasks[1].problems.filter((problem) => problem.variantId === 'mesh-102-v2')
    expect(secondVariant.map((problem) => problem.number)).toEqual([1, 2])
    expect(page.subjects[0].tasks[1].sourceInventory).toBeUndefined()
  })

  it('fails each broken edge rather than publishing a plausible but incomplete card', () => {
    const omittedAssignment = structuredClone(source)
    omittedAssignment.subjects[0].tasks.pop()
    expect(() => assertSourceAligned(omittedAssignment, snapshot)).toThrow(/mesh-102/)

    const mixedFiles = structuredClone(source)
    mixedFiles.materialLinks['mesh-101'].push(practice)
    expect(teacherAttachmentOwnershipErrors(mixedFiles)).not.toEqual([])

    const missingFileInventory = structuredClone(source)
    missingFileInventory.subjects[0].tasks[1].sourceInventory.sources.pop()
    expect(sourceInventoryErrors(missingFileInventory.subjects[0].tasks[1], missingFileInventory.materialLinks['mesh-102'])).not.toEqual([])

    const missingProblem = structuredClone(source)
    missingProblem.subjects[0].tasks[1].problems.pop()
    expect(sourceInventoryErrors(missingProblem.subjects[0].tasks[1], missingProblem.materialLinks['mesh-102'])).not.toEqual([])

    const wrongAction = structuredClone(source)
    wrongAction.subjects[0].tasks[0].kind = 'check'
    expect(sourceInventoryErrors(wrongAction.subjects[0].tasks[0], wrongAction.materialLinks['mesh-101'])).not.toEqual([])

    const page = { kind: 'parent', targetDate: source.targetDate,
      sourcePlanFingerprint: sourcePlanFingerprint(source), subjects: publicPageSubjects(source.subjects) }
    page.subjects[0].tasks[1].problems.pop()
    expect(() => assertPublishedPageAligned(source, page, 'parent')).toThrow(/потеряла/)
  })

  it('credits one photographed sheet only to its actually reviewed numbers', () => {
    const uploadId = 'u'.repeat(24)
    const first = 'mesh-102-p-v2-1', second = 'mesh-102-p-v2-2'
    const batch = { uploadIds: [uploadId], reviews: [{ taskId: first, uploadIds: [uploadId] },
      { taskId: second, uploadIds: [uploadId] }],
    photoCoverage: [{ uploadId, taskIds: [first, second], observed: 'Оба решения видны на одном листе.' }] }
    expect(reviewCoverage(batch).get(uploadId).taskIds).toEqual([first, second])
    expect(() => reviewCoverage({ ...batch, photoCoverage: [{ ...batch.photoCoverage[0], taskIds: [first] }] })).toThrow(/не совпадают/)
  })
})
