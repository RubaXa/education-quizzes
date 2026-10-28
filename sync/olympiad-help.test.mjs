import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { submitOlympiadHelp, startOlympiadHelp, finishOlympiadHelp, registerOlympiadPhoto, readOlympiadHelp, transferOlympiadPhoto, readOlympiadPhoto, listOlympiadProblems, listOlympiadHelp } from './olympiad-help.mjs'

const base = 'families/f/children/c/olympiads/o'
function fixture() {
  const token = 'x'.repeat(43)
  const records = new Map(Object.entries({
    'deviceSessions/u': { linkToken: token }, [`accessLinks/${token}`]: { active: true, personId: 'p' },
    'families/f': { active: true }, 'families/f/children/c': { active: true, olympiadEligibility: { verified: true, grade: 6 } },
    'families/f/members/p': { active: true, role: 'student', childIds: ['c'] },
    [base]: { active: true, participationEnabled: true, allowedProblemIds: ['task'] },
    'olympiadCatalog/o': { status: 'published', practiceOnly: true, gradeLevels: [6], allowedProblemIds: ['task'] },
    'olympiadMaterials/o/problems/task': { status: 'published', practiceOnly: true, title: 'Задача', statement: 'Условие', secret: 'closed' },
    [`${base}/photos/a`]: { status: 'stored', problemId: 'task', personId: 'p' },
    [`${base}/photos/b`]: { status: 'stored', problemId: 'task', personId: 'p' },
  }))
  const db = { doc: path => ({ path, get: async () => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }) }),
    collection: path => ({ get: async () => ({ docs: [...records.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([key, value]) => ({ id: key.slice(path.length + 1), data: () => structuredClone(value) })) }) }), runTransaction: async run => {
    const staged = []
    const tx = { get: async ref => ({ exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) }),
      set: (ref, value) => staged.push([ref.path, value]),
      update: (ref, value) => staged.push([ref.path, { ...records.get(ref.path), ...value }]) }
    const result = await run(tx)
    for (const [path, value] of staged) records.set(path, structuredClone(value))
    return result
  } }
  return { db, records }
}
const baseArgs = { uid: 'u', familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'task', requestId: 'r' }

describe('olympiad help synchronization boundary', () => {
  it('lists only authorized published practice and projects photo and request indexes without secrets', async () => {
    const { db, records } = fixture()
    expect(await listOlympiadProblems(db, baseArgs)).toEqual([{ id: 'task', title: 'Задача', statement: 'Условие' }])
    await submitOlympiadHelp(db, { ...baseArgs, operationId: 'send', photoIds: ['a'] })
    records.set(`${base}/photos/other`, { status: 'stored', problemId: 'task', personId: 'other', storage: { path: 'private' } })
    expect(await listOlympiadHelp(db, baseArgs)).toEqual({ photos: [{ id: 'a' }, { id: 'b' }], requests: [{ requestId: 'r', status: 'requested', revision: 1 }] })
    records.get('families/f/members/p').active = false
    await expect(listOlympiadHelp(db, baseArgs)).rejects.toThrow('permission-denied')
    await expect(listOlympiadProblems(db, baseArgs)).rejects.toThrow('permission-denied')
  })
  it('freezes evidence during processing, queues additions, and is idempotent', async () => {
    const { db, records } = fixture()
    const first = { ...baseArgs, operationId: 'send1', photoIds: ['a'], note: '' }
    expect(await submitOlympiadHelp(db, first)).toEqual({ revision: 1, reused: false })
    expect(await submitOlympiadHelp(db, first)).toEqual({ revision: 1, reused: true })
    const operation = { ...baseArgs, operationId: 'review1' }
    expect(await startOlympiadHelp(db, operation)).toMatchObject({ revision: 1 })
    await submitOlympiadHelp(db, { ...baseArgs, operationId: 'send2', photoIds: ['b'], note: 'добавление' })
    await submitOlympiadHelp(db, { ...baseArgs, operationId: 'note', photoIds: [], note: 'Ещё пояснение' })
    expect(await finishOlympiadHelp(db, { ...operation, answer: 'Следующий шаг' })).toEqual({ revision: 1, reused: false })
    const saved = records.get(`${base}/helpRequests/r`)
    expect(saved.status).toBe('requested')
    expect(saved.answers[0].revisions).toEqual([1])
    expect(await finishOlympiadHelp(db, { ...operation, answer: 'Следующий шаг' })).toEqual({ revision: 1, reused: true })
    await startOlympiadHelp(db, { ...baseArgs, operationId: 'review2' })
    await finishOlympiadHelp(db, { ...baseArgs, operationId: 'review2', answer: 'Продолжение' })
    await expect(submitOlympiadHelp(db, { ...baseArgs, operationId: 'send3', photoIds: ['a'] })).rejects.toThrow('new-photo-required')
  })
  it('rejects unauthorized members, unverified material, missing photos and conflicting retry', async () => {
    const { db, records } = fixture()
    const args = { ...baseArgs, operationId: 'send', photoIds: ['a'] }
    records.get('families/f/members/p').role = 'parent'
    await expect(submitOlympiadHelp(db, args)).rejects.toThrow('permission-denied')
    records.get('families/f/members/p').role = 'student'
    records.get('olympiadMaterials/o/problems/task').practiceOnly = false
    await expect(submitOlympiadHelp(db, args)).rejects.toThrow('practice-not-verified')
    records.get('olympiadMaterials/o/problems/task').practiceOnly = true
    await expect(submitOlympiadHelp(db, { ...args, photoIds: ['missing'] })).rejects.toThrow('photo-not-available')
    await submitOlympiadHelp(db, args)
    await expect(submitOlympiadHelp(db, { ...args, note: 'другое' })).rejects.toThrow('operation-conflict')
  })
  it('registers only matching trusted receipts and projects the same help history to family roles without storage secrets', async () => {
    const { db, records } = fixture()
    const scoped = createHash('sha256').update(JSON.stringify(['f','c','o','task','receipt'])).digest('hex')
    const receipt = { familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'task', personId: 'p', status: 'stored', mime: 'image/jpeg',
      storage: { provider: 'yandex-disk', state: 'stored', path: `app:/PETR/Олимпиады/${scoped}/${'a'.repeat(64)}.jpg`, sha256: 'a'.repeat(64) } }
    records.set('olympiadPhotoReceipts/receipt', receipt)
    const args = { ...baseArgs, receiptId: 'receipt' }
    expect(await registerOlympiadPhoto(db, args)).toEqual({ photoId: 'receipt', status: 'stored', reused: false })
    expect(await registerOlympiadPhoto(db, args)).toEqual({ photoId: 'receipt', status: 'stored', reused: true })
    await submitOlympiadHelp(db, { ...baseArgs, operationId: 'send', photoIds: ['receipt'], note: 'Помоги' })
    await startOlympiadHelp(db, { ...baseArgs, operationId: 'review' })
    await finishOlympiadHelp(db, { ...baseArgs, operationId: 'review', answer: 'Далее' })
    const student = await readOlympiadHelp(db, baseArgs)
    expect(student).toMatchObject({ status: 'answered', revisions: [{ photoIds: ['receipt'], note: 'Помоги' }], answers: [{ text: 'Далее' }] })
    expect(JSON.stringify(student)).not.toMatch(/private|storage|sha256|fingerprint|personId/)
    const parentToken = 'y'.repeat(43)
    records.set('deviceSessions/parent-device', { linkToken: parentToken })
    records.set(`accessLinks/${parentToken}`, { active: true, personId: 'parent' })
    records.set('families/f/members/parent', { active: true, role: 'parent', childIds: ['c'] })
    expect(await readOlympiadHelp(db, { ...baseArgs, uid: 'parent-device' })).toEqual(student)
    records.get('families/f/members/parent').childIds = []
    await expect(readOlympiadHelp(db, { ...baseArgs, uid: 'parent-device' })).rejects.toThrow('permission-denied')
    records.set('olympiadPhotoReceipts/other', { ...receipt, childId: 'other' })
    await expect(registerOlympiadPhoto(db, { ...args, receiptId: 'other' })).rejects.toThrow('receipt-not-authorized')
    records.get('olympiadCatalog/o').gradeLevels = [7]
    await expect(readOlympiadHelp(db, baseArgs)).rejects.toThrow('practice-not-verified')
    await expect(registerOlympiadPhoto(db, args)).rejects.toThrow('practice-not-verified')
    records.get('olympiadCatalog/o').gradeLevels = [6]
    records.get(base).participationEnabled = false
    await expect(readOlympiadHelp(db, baseArgs)).rejects.toThrow('practice-not-verified')
  })
  it('stores a private image using the existing Disk port and rereads it only while authorized', async () => {
    const { db, records } = fixture(), files = new Map()
    const disk = { putAt: async (path, bytes) => { files.set(path, Buffer.from(bytes)); return { provider: 'yandex-disk', path, size: bytes.length } },
      head: async path => ({ type: 'file', size: files.get(path).length, md5: createHash('md5').update(files.get(path)).digest('hex') }),
      getAt: async path => Buffer.from(files.get(path)) }
    const bytes = Buffer.from([0xff,0xd8,0xff,1,2,3]), args = { ...baseArgs, receiptId: 'uploaded', mime: 'image/jpeg' }
    expect(await transferOlympiadPhoto(db, disk, args, bytes)).toMatchObject({ photoId: 'uploaded', status: 'stored' })
    expect((await readOlympiadPhoto(db, disk, { ...baseArgs, photoId: 'uploaded' })).bytes).toEqual(bytes)
    expect([...files.keys()][0]).toMatch(/^app:\/PETR\/Олимпиады\//)
    expect(JSON.stringify(await readOlympiadHelp(db, { ...baseArgs, requestId: 'missing' }).catch(() => null))).not.toContain('app:/')
    expect((await transferOlympiadPhoto(db, disk, args, bytes)).reused).toBe(true)
    await expect(transferOlympiadPhoto(db, disk, args, Buffer.from([0xff,0xd8,0xff,4]))).rejects.toThrow('receipt-conflict')
    records.get('families/f/members/p').active = false
    await expect(readOlympiadPhoto(db, disk, { ...baseArgs, photoId: 'uploaded' })).rejects.toThrow('permission-denied')
    records.get('families/f/members/p').active = true
    files.set([...files.keys()][0], Buffer.from([0xff,0xd8,0xff,9]))
    await expect(readOlympiadPhoto(db, disk, { ...baseArgs, photoId: 'uploaded' })).rejects.toThrow('photo-integrity-failed')
  })
})
