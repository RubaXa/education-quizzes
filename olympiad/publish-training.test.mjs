import { describe, expect, it } from 'vitest'
import { publishTraining, trainingPublicationPlan } from './publish-training.mjs'
import { getTrainingLesson } from './training-content.mjs'

function setup() {
  const docs = new Map()
  const receipts = trainingPublicationPlan().lessons.map(({ id }, i) => {
    const l = getTrainingLesson(id), learnerToken = String(i + 1).repeat(32), previewToken = String(i + 4).repeat(32), testId = `test-${i}`
    const questions = l.steps.map(s => ({ id: s.id, prompt: s.prompt, options: s.options.map(({ id, text }) => ({ id, label: text })) }))
    docs.set(`assignments/${learnerToken}`, { testId, slug: id, familyId: 'family', childId: 'child', questions })
    docs.set(`answerKeys/${learnerToken}`, { entries: Object.fromEntries(l.steps.map(s => [s.id, { correct: s.correctOptionIds[0] }])) })
    docs.set(`previews/${previewToken}`, { testId, questions })
    return { lessonId: id, learnerToken, previewToken, testId }
  })
  const snap = path => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) })
  const db = { doc(path) { return { path, get: async () => snap(path) } }, async runTransaction(fn) { const pending = []; await fn({ get: async ref => snap(ref.path), create(ref, value) { pending.push([ref.path, value]) } }); for (const [p, v] of pending) docs.set(p, structuredClone(v)) } }
  return { db, docs, receipts }
}
describe('reviewed olympiad publication', () => {
  it('requires published quizzes and safely publishes identical repeat with readback', async () => {
    const { db, docs, receipts } = setup()
    expect(await publishTraining(db, receipts)).toMatchObject({ lessonCount: 3, verifiedDocuments: 7 })
    expect(await publishTraining(db, receipts)).toMatchObject({ lessonCount: 3, verifiedDocuments: 7 })
    expect(docs.get('olympiadCatalog/formulo-math-2026-2027').allowedProblemIds).toContain('training-even-three-digit-v1')
    expect(docs.get('publicOlympiadCatalog/formulo-math-2026-2027')).toEqual({ status: 'published', title: trainingPublicationPlan().catalog.title, deadline: '2026-11-05', gradeLevels: [5,6,7,8,9,10,11], subject:'Математика' })
  })
  it('refuses a changed version without writing any new document', async () => {
    const { db, docs, receipts } = setup()
    docs.set('olympiadMaterials/formulo-math-2026-2027/lessons/training-parity-v1/versions/1', { changed: true })
    await expect(publishTraining(db, receipts)).rejects.toThrow('отличается')
    expect(docs.has('olympiadCatalog/formulo-math-2026-2027')).toBe(false)
  })
  it('rejects wrong owner, preview or answer key before writes', async () => {
    for (const type of ['owner', 'preview', 'key']) {
      const { db, docs, receipts } = setup(), r = receipts[1]
      if (type === 'owner') docs.get(`assignments/${r.learnerToken}`).childId = 'other'
      if (type === 'preview') docs.get(`previews/${r.previewToken}`).questions = []
      if (type === 'key') docs.get(`answerKeys/${r.learnerToken}`).entries.classify.correct = 'b'
      await expect(publishTraining(db, receipts)).rejects.toThrow()
      expect(docs.has('olympiadCatalog/formulo-math-2026-2027')).toBe(false)
    }
  })
  it('rejects incomplete receipts', async () => {
    const { db, receipts } = setup()
    await expect(publishTraining(db, receipts.slice(1))).rejects.toThrow('каждого урока')
  })
})
