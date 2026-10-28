import { describe, expect, it } from 'vitest'
import { createOlympiadHttpHandler } from './http-handler.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const token = 'a'.repeat(43)
const base = 'families/f/children/c/olympiads/o'
const scope = { familyId: 'f', childId: 'c', olympiadId: 'o', attemptId: 'a' }
const lesson = { id: 'lesson', version: '1', topicId: 't', title: 'Учимся', steps: [{ id: 's', prompt: 'Вопрос', options: [{ id: 'a', text: 'А' }, { id: 'b', text: 'Б' }], correctOptionIds: ['b'], correctExplanation: 'Верно', incorrectHint: 'Подумай' }] }
function setup(photoStorage) {
  const docs = new Map([
    ['deviceSessions/student', { linkToken: token }], ['accessLinks/' + token, { active: true, personId: 'p' }],
    ['families/f', { active: true }], ['families/f/children/c', { active: true, olympiadEligibility: { verified: true, grade: 5 } }],
    ['families/f/members/p', { active: true, role: 'student', childIds: ['c'] }],
    ['olympiadCatalog/o', { status: 'published', practiceOnly: true, title: 'Олимпиада', gradeLevels: [5], allowedProblemIds: [], lessonRefs: [{ lessonId: 'lesson', version: '1' }], sources: [{ title: 'Source', url: 'https://example.org/source' }] }],
    [base, { active: true, participationEnabled: true, title: 'Олимпиада', allowedLessonIds: ['lesson'], lessonRefs: [{ lessonId: 'lesson', version: '1' }] }],
    ['olympiadMaterials/o/lessons/lesson/versions/1', { status: 'published', practiceOnly: true, lesson }],
  ])
  const snap = (path) => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) })
  let beforeTransaction = null
  const db = {
    doc: (path) => ({ path, get: async () => snap(path) }),
    collection: (path) => ({ get: async () => ({ docs: [...docs.keys()].filter((key) => key.startsWith(path + '/') && key.slice(path.length + 1).indexOf('/') === -1).map(snap) }) }),
    runTransaction: async (fn) => { if (beforeTransaction) beforeTransaction(); return fn({ get: async (ref) => snap(ref.path), set: (ref, value) => docs.set(ref.path, value), update: (ref, value) => docs.set(ref.path, { ...docs.get(ref.path), ...value }) }) },
  }
  const handle = createOlympiadHttpHandler({ db, photoStorage, auth: { verifyIdToken: async (t, check) => { if (t !== 'valid' || check !== true) throw Error(); return { uid: 'student' } } } })
  const call = (body) => handle({ method: 'POST', authorization: 'Bearer valid', body })
  return { docs, call, handle, beforeTransaction: (fn) => { beforeTransaction = fn } }
}

describe('family lesson storage and HTTP boundary', () => {
  it('lists, starts, stores, resumes and preserves answer confidentiality', async () => {
    const f = setup()
    const list = await f.call({ action: 'list', familyId: 'f', childId: 'c' })
    expect(list.status).toBe(200)
    expect(list.body.result[0].lessons[0].id).toBe('lesson')
    const start = await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })
    expect(start.status).toBe(200)
    expect(JSON.stringify(start)).not.toContain('correctOptionIds')
    const command = { id: 'cmd', at: '2026-10-27T12:00:00Z', type: 'answer', optionId: 'a' }
    expect((await f.call({ action: 'act', scope, command })).status).toBe(200)
    expect((await f.call({ action: 'act', scope, command })).status).toBe(200)
    expect(f.docs.get(base + '/attempts/a').attempt.events).toHaveLength(1)
    expect((await f.call({ action: 'view', scope })).body.result.feedback.text).toBe('Подумай')
    const attempts = await f.call({ action: 'list-attempts', scope })
    expect(attempts.body.result).toEqual([{ attemptId: 'a', lessonId: 'lesson', lessonVersion: '1', status: 'active' }])
    expect(JSON.stringify(attempts)).not.toContain('optionId')
    expect((await f.call({ action: 'parent-detail', scope })).status).toBe(404)
  })
  it('rejects strangers, revoked sessions, disallowed material and client parent claims', async () => {
    const f = setup()
    expect((await f.handle({ method: 'POST', authorization: 'Bearer bad', body: { action: 'view', scope } })).status).toBe(401)
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'other' })).status).toBe(404)
    expect((await f.call({ action: 'participation', scope, enabled: false, role: 'parent' })).status).toBe(404)
    f.docs.get('olympiadMaterials/o/lessons/lesson/versions/1').practiceOnly = false
    expect((await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })).status).toBe(404)
    f.docs.get('accessLinks/' + token).active = false
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).status).toBe(404)
  })
  it('lets parent read details and pause without erasing history; student cannot act while paused', async () => {
    const f = setup()
    await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })
    f.docs.get('families/f/members/p').role = 'parent'
    expect((await f.call({ action: 'parent-detail', scope })).body.result.steps[0].correctOptionIds).toEqual(['b'])
    expect((await f.call({ action: 'participation', scope, enabled: false })).status).toBe(200)
    f.docs.get('families/f/members/p').role = 'student'
    expect((await f.call({ action: 'act', scope, command: { id: 'cmd', at: '2026-10-27T12:00:00Z', type: 'answer', optionId: 'b' } })).status).toBe(404)
    expect((await f.call({ action: 'view', scope })).status).toBe(200)
    expect(f.docs.has(base + '/attempts/a')).toBe(true)
  })
  it('checks revoked membership again in the atomic write', async () => {
    const f = setup()
    f.beforeTransaction(() => { f.docs.get('families/f/members/p').active = false })
    expect((await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })).status).toBe(404)
    expect(f.docs.has(base + '/attempts/a')).toBe(false)
  })
  it('explicitly denies direct clients for private lessons and attempts', () => {
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
    expect(rules).toMatch(/match \/olympiadMaterials\/\{document=\*\*\} \{\s*allow read, write: if false;/)
    expect(rules).toMatch(/match \/olympiads\/\{document=\*\*\} \{\s*allow read, write: if false;/)
  })

  it('filters disabled olympiads from students but not parents', async () => {
    const f = setup()
    f.docs.get(base).participationEnabled = false
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).body.result).toEqual([])
    f.docs.get('families/f/members/p').role = 'parent'
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).body.result).toHaveLength(1)
  })

  it('submits help using authenticated uid rather than the supplied uid', async () => {
    const f = setup()
    f.docs.get(base).allowedProblemIds = ['problem']
    f.docs.get('olympiadCatalog/o').allowedProblemIds = ['problem']
    f.docs.set('olympiadMaterials/o/problems/problem', { status: 'published', practiceOnly: true })
    f.docs.set(base + '/photos/photo', { status: 'stored', problemId: 'problem', personId: 'p' })
    const request = { familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'problem', requestId: 'request', operationId: 'operation', photoIds: ['photo'], uid: 'stranger' }
    expect((await f.call({ action: 'submit-help', request })).status).toBe(200)
    expect(f.docs.get(base + '/helpRequests/request').personId).toBe('p')
  })
  it('transfers and privately reads a photo through the authenticated binary handler', async () => {
    const files = new Map()
    const storage = { putAt: async (path, bytes) => { files.set(path, bytes); return { provider: 'yandex-disk', path, size: bytes.length } },
      head: async path => ({ type: 'file', size: files.get(path).length, md5: createHash('md5').update(files.get(path)).digest('hex') }),
      getAt: async path => files.get(path) }
    const f = setup(storage)
    f.docs.get(base).allowedProblemIds = ['problem']
    f.docs.get('olympiadCatalog/o').allowedProblemIds = ['problem']
    f.docs.set('olympiadMaterials/o/problems/problem', { status: 'published', practiceOnly: true })
    const request = { familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'problem', receiptId: 'photo', mime: 'image/jpeg', uid: 'stranger' }
    const bytes = Buffer.from([255, 216, 255, 1])
    const invoke = (body, data = bytes) => f.handle({ method: 'POST', authorization: 'Bearer valid', body, transport: 'binary', bytes: data })
    const upload = await invoke({ action: 'photo-upload', request })
    expect(upload.status).toBe(200)
    expect(f.docs.get(base + '/photos/photo').personId).toBe('p')
    expect(JSON.stringify(upload)).not.toContain('app:/')
    const read = await invoke({ action: 'photo-read', request: { ...request, photoId: 'photo' } }, Buffer.alloc(0))
    expect(read).toMatchObject({ status: 200, binary: bytes, contentType: 'image/jpeg' })
    f.docs.get('families/f/members/p').active = false
    expect((await invoke({ action: 'photo-read', request: { ...request, photoId: 'photo' } }, Buffer.alloc(0))).status).toBe(404)
    expect((await f.handle({ method: 'POST', authorization: 'Bearer valid', body: { action: 'photo-read', request } })).status).toBe(400)
  })

  it('returns resume candidates in deterministic attempt id order', async () => {
    const f = setup()
    for (const attemptId of ['z', 'a']) {
      expect((await f.call({ action: 'start', scope: { ...scope, attemptId }, lessonRef: { lessonId: 'lesson', version: '1' } })).status).toBe(200)
    }
    const listed = await f.call({ action: 'list-attempts', scope })
    expect(listed.body.result.map(item => item.attemptId)).toEqual(['a', 'z'])
  })

  it('parent sees eligible catalog before selection and can create assignment atomically', async () => {
    const f = setup()
    f.docs.delete(base)
    f.docs.get('families/f/members/p').role = 'parent'
    const list = await f.call({ action: 'list', familyId: 'f', childId: 'c' })
    expect(list.body.result).toMatchObject([{ id: 'o', eligibility: 'eligible', participationEnabled: false }])
    expect((await f.call({ action: 'participation', scope, enabled: true })).status).toBe(200)
    expect(f.docs.get(base)).toMatchObject({ active: true, participationEnabled: true, allowedLessonIds: ['lesson'], lessonRefs: [{ lessonId: 'lesson', version: '1' }] })
    expect((await f.call({ action: 'participation', scope: { ...scope, childId: 'stranger' }, enabled: true })).status).toBe(404)
  })
  it('never assumes an unverified or incompatible grade', async () => {
    const f = setup()
    f.docs.delete(base)
    f.docs.get('families/f/members/p').role = 'parent'
    delete f.docs.get('families/f/children/c').olympiadEligibility
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).body.result[0].eligibility).toBe('unknown')
    expect((await f.call({ action: 'participation', scope, enabled: true })).status).toBe(404)
    f.docs.get('families/f/children/c').olympiadEligibility = { grade: 6, verified: true }
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).body.result).toEqual([])
    expect((await f.call({ action: 'participation', scope, enabled: true })).status).toBe(404)
  })

  it('rejects missing sources and withdrawn catalog, even after prior assignment', async () => {
    const f = setup()
    const catalog = f.docs.get('olympiadCatalog/o')
    catalog.sources = []
    expect((await f.call({ action: 'list', familyId: 'f', childId: 'c' })).body.result).toEqual([])
    expect((await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })).status).toBe(404)
    catalog.sources = [{ title: 'Source', url: 'https://example.org/source' }]
    catalog.status = 'withdrawn'
    expect((await f.call({ action: 'start', scope, lessonRef: { lessonId: 'lesson', version: '1' } })).status).toBe(404)
  })

})
