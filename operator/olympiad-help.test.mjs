import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { beginHelpReview, captureHelpPhotos, completeHelpReview } from './olympiad-help.mjs'
import { operationCommand } from './operation-contract.mjs'
const base = 'families/f/children/c/olympiads/o', scope = { familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'p', requestId: 'r', operationId: 'op' }
function fixture() {
  const bytes = Buffer.from([255,216,255,1]), sha = createHash('sha256').update(bytes).digest('hex')
  const path = `app:/PETR/Олимпиады/${'a'.repeat(64)}/${sha}.jpg`
  const docs = new Map(Object.entries({ 'families/f': { active: true }, 'families/f/children/c': { active: true, olympiadEligibility: { verified: true, grade: 6 } },
    [base]: { active: true, participationEnabled: true, allowedProblemIds: ['p'] }, 'olympiadCatalog/o': { status: 'published', practiceOnly: true, gradeLevels: [6], allowedProblemIds: ['p'] },
    'olympiadMaterials/o/problems/p': { status: 'published', practiceOnly: true, title: 'Задача', statement: 'Условие' },
    [`${base}/helpRequests/r`]: { problemId: 'p', personId: 's', status: 'requested', revision: 1, revisions: [{ revision: 1, photoIds: ['a'], note: 'Попытка' }], answers: [] },
    [`${base}/photos/a`]: { status: 'stored', problemId: 'p', personId: 's', receiptId: 'a', storage: { path, sha256: sha } },
    'olympiadPhotoReceipts/a': { status: 'stored', familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'p', personId: 's', mime: 'image/jpeg', storage: { path, sha256: sha } } }))
  const db = { doc: path => ({ path, get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }) }), runTransaction: async run => {
    const writes = []
    const result = await run({ get: async ref => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }), update: (ref, value) => writes.push([ref.path, value]) })
    for (const [key, value] of writes) docs.set(key, { ...docs.get(key), ...value })
    return result
  } }
  const storage = { head: async () => ({ type: 'file', size: bytes.length }), getAt: async () => bytes }
  return { db, docs, storage, bytes }
}
describe('operator olympiad help', () => {
  it('freezes input, verifies private image, publishes answer, reads back and retries idempotently', async () => {
    const { db, storage, docs, bytes } = fixture()
    const frozen = await beginHelpReview(db, scope)
    expect(frozen).toMatchObject({ verified: true, revision: 1, revisions: [{ photoIds: ['a'], note: 'Попытка' }] })
    expect((await captureHelpPhotos(db, storage, scope, frozen))[0].bytes).toEqual(bytes)
    const req = docs.get(`${base}/helpRequests/r`)
    docs.set(`${base}/helpRequests/r`, { ...req, revision: 2, revisions: [...req.revisions, { revision: 2, photoIds: [], note: 'Дополнение' }] })
    expect(await completeHelpReview(db, scope, 'Следующий шаг')).toEqual({ verified: true, revision: 1, reused: false, status: 'requested' })
    expect(await completeHelpReview(db, scope, 'Следующий шаг')).toMatchObject({ verified: true, reused: true })
    await expect(completeHelpReview(db, scope, 'Другой ответ')).rejects.toThrow('operation-conflict')
  })
  it('fails closed on public or corrupted photos', async () => {
    const { db, storage } = fixture(), frozen = await beginHelpReview(db, scope)
    await expect(captureHelpPhotos(db, { ...storage, head: async () => ({ type: 'file', size: 4, public_url: 'public' }) }, scope, frozen)).rejects.toThrow('photo-not-private')
    await expect(captureHelpPhotos(db, { ...storage, getAt: async () => Buffer.from([1,2,3,4]) }, scope, frozen)).rejects.toThrow('photo-integrity-failed')
  })
  it('requires apply and complete typed scope', () => {
    const request = { schemaVersion: 1, operation: 'olympiad.help-start', input: scope }
    expect(() => operationCommand(request, false)).toThrow('requires --apply')
    expect(operationCommand(request, true).argv).toEqual(['start', 'f', 'c', 'o', 'p', 'r', 'op'])
    expect(() => operationCommand({ ...request, input: { ...scope, operationId: undefined } }, true)).toThrow('invalid input.operationId')
  })
})
