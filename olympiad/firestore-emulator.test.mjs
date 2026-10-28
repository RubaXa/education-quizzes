import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app'
import { connectAuthEmulator, getAuth as clientAuth, signInAnonymously } from 'firebase/auth'
import { connectFirestoreEmulator, getDoc, setDoc, doc, getFirestore as clientDb } from 'firebase/firestore'
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore as adminDb } from 'firebase-admin/firestore'
import { getAuth as adminAuth } from 'firebase-admin/auth'
import { createOlympiadHttpHandler } from './http-handler.mjs'

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && /^demo-/.test(process.env.GCLOUD_PROJECT || ''))
describe.skipIf(!enabled)('olympiad Firestore and Auth emulator', () => {
  let ca, aa, auth, db, store, handle, uid
  const [fireHost, firePort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
  const familyId = `test${Date.now()}`
  const scope = { familyId, childId: 'c', olympiadId: 'o', attemptId: 'a' }
  const token = 'z'.repeat(43)
  beforeAll(async () => {
    ca = clientApp({ apiKey: 'fake', projectId: process.env.GCLOUD_PROJECT }, familyId)
    aa = adminApp({ projectId: process.env.GCLOUD_PROJECT }, familyId)
    auth = clientAuth(ca); connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
    db = clientDb(ca); connectFirestoreEmulator(db, fireHost, Number(firePort))
    store = adminDb(aa)
    uid = (await signInAnonymously(auth)).user.uid
    const lesson = { id: 'l', version: '1', title: 'Lesson', topicId: 'topic', steps: [{ id: 's', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: ['a'], correctExplanation: 'yes', incorrectHint: 'no' }] }
    const docs = {
      [`deviceSessions/${uid}`]: { linkToken: token }, [`accessLinks/${token}`]: { active: true, personId: 'p' },
      [`families/${familyId}`]: { active: true }, [`families/${familyId}/children/c`]: { active: true, olympiadEligibility: { grade: 5, verified: true } },
      [`families/${familyId}/members/p`]: { active: true, role: 'student', childIds: ['c'] },
      [`families/${familyId}/children/c/olympiads/o`]: { active: true, participationEnabled: true, allowedLessonIds: ['l'], allowedProblemIds: ['q'], lessonRefs: [{ lessonId: 'l', version: '1' }] },
      'olympiadCatalog/o': { status: 'published', practiceOnly: true, title: 'Olympiad', gradeLevels: [5], allowedProblemIds: ['q'], lessonRefs: [{ lessonId: 'l', version: '1' }], sources: [{ title: 'Source', url: 'https://example.org/source' }] },
      'olympiadMaterials/o/problems/q': { status: 'published', practiceOnly: true, title: 'Practice', statement: 'Practice question', secret: 'hidden' },
      [`families/${familyId}/children/c/olympiads/o/photos/photo`]: { status: 'stored', problemId: 'q', personId: 'p', storage: { path: 'private' } },
      'olympiadMaterials/o/lessons/l/versions/1': { status: 'published', practiceOnly: true, lesson },
    }
    await Promise.all(Object.entries(docs).map(([path, value]) => store.doc(path).set(value)))
    handle = createOlympiadHttpHandler({ db: store, auth: adminAuth(aa) })
  })
  afterAll(async () => { if (ca) await deleteClientApp(ca); if (aa) await deleteAdminApp(aa) })
  it('denies client reads and writes of definitions, assignment and attempts', async () => {
    for (const path of ['olympiadMaterials/o/lessons/l/versions/1', `families/${familyId}/children/c/olympiads/o`, `families/${familyId}/children/c/olympiads/o/attempts/a`]) {
      await expect(getDoc(doc(db, path))).rejects.toMatchObject({ code: 'permission-denied' })
      await expect(setDoc(doc(db, path), { injected: true })).rejects.toMatchObject({ code: 'permission-denied' })
    }
  })
  it('trusted handler persists, withholds private keys and rejects after revocation', async () => {
    const accessToken = await auth.currentUser.getIdToken()
    const call = (body) => handle({ method: 'POST', authorization: `Bearer ${accessToken}`, body })
    const problemScope = { familyId, childId: 'c', olympiadId: 'o', problemId: 'q' }
    const problems = await call({ action: 'list-problems', scope: problemScope })
    expect(problems.body.result).toEqual([{ id: 'q', title: 'Practice', statement: 'Practice question' }])
    const gallery = await call({ action: 'list-help', scope: problemScope })
    expect(gallery.body.result).toEqual({ photos: [{ id: 'photo' }], requests: [] })
    expect(JSON.stringify(gallery)).not.toContain('private')
    const start = await call({ action: 'start', scope, lessonRef: { lessonId: 'l', version: '1' } })
    expect(start.status).toBe(200)
    expect(JSON.stringify(start)).not.toContain('correctOptionIds')
    expect((await store.doc(`families/${familyId}/children/c/olympiads/o/attempts/a`).get()).exists).toBe(true)
    await store.doc(`families/${familyId}/members/p`).update({ active: false })
    expect((await call({ action: 'view', scope })).status).toBe(404)
    expect((await call({ action: 'list-help', scope: problemScope })).status).toBe(404)
  })
})
