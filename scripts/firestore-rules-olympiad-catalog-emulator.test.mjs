import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, getDocs, collection, getFirestore, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore as adminDb } from 'firebase-admin/firestore'

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && /^demo-/.test(process.env.GCLOUD_PROJECT || ''))
describe.skipIf(!enabled)('shared olympiad catalog access', () => {
  const clients = [], token = 'a'.repeat(43), family = `catalog${Date.now()}`
  let admin, store, parent, student, outsider
  async function client(name) {
    const app = clientApp({ apiKey: 'fake', projectId: process.env.GCLOUD_PROJECT }, `${family}-${name}`); clients.push(app)
    const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
    const uid = (await signInAnonymously(auth)).user.uid, db = getFirestore(app)
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':'); connectFirestoreEmulator(db, host, Number(port))
    return { uid, db }
  }
  beforeAll(async () => {
    admin = adminApp({ projectId: process.env.GCLOUD_PROJECT }, family); store = adminDb(admin)
    ;[parent, student, outsider] = await Promise.all(['parent','student','outsider'].map(client))
    await Promise.all([
      store.doc(`families/${family}/children/c`).set({olympiadEligibility:{verified:true,grade:6}}),
      store.doc(`families/${family}/members/parent`).set({active:true,role:'parent',childIds:['c']}),
      store.doc(`families/${family}/members/student`).set({active:true,role:'student',childIds:['c']}),
      store.doc('publicOlympiadCatalog/other-grade').set({status:'published',title:'Другая группа',deadline:null,gradeLevels:[10]}),
      store.doc(`families/${family}/children/other`).set({olympiadEligibility:{verified:true,grade:6}}),
      store.doc('publicOlympiadCatalog/catalog-fixture').set({ status:'published', title:'Общая олимпиада', deadline:null, gradeLevels:[5,6,7] }),
      store.doc('olympiadCatalog/catalog-fixture').set({ status:'published', privateKey:'secret' }),
      ...[parent,student].flatMap((actor, index) => {
        const link = index ? 'b'.repeat(43) : token
        return [store.doc(`deviceSessions/${actor.uid}`).set({linkToken:link}), store.doc(`accessLinks/${link}`).set({active:true,personId:index ? 'student' : 'parent'})]
      }),
    ])
  })
  afterAll(async () => { await Promise.all(clients.map(deleteClientApp)); if (admin) await deleteAdminApp(admin) })
  it.each(['parent','student'])('allows %s to read only the shared projection', async role => {
    const actor = role === 'parent' ? parent : student
    expect((await getDoc(doc(actor.db, 'publicOlympiadCatalog/catalog-fixture'))).data().title).toBe('Общая олимпиада')
    expect((await getDocs(collection(actor.db, 'publicOlympiadCatalog'))).docs.length).toBeGreaterThan(0)
    await expect(getDoc(doc(actor.db, 'olympiadCatalog/catalog-fixture'))).rejects.toMatchObject({code:'permission-denied'})
    await expect(setDoc(doc(actor.db, 'publicOlympiadCatalog/catalog-fixture'), {title:'forged'})).rejects.toMatchObject({code:'permission-denied'})
  })
  it('saves parent selection and student inbox notice atomically and rejects student writes', async () => {
    const eventId=randomUUID(), selection=`families/${family}/children/c/olympiadSelections/catalog-fixture`
    const body={enabled:true,actorPersonId:'parent',deviceUid:parent.uid,eventId,changedAt:serverTimestamp()}
    const notice={familyId:family,childId:'c',type:'olympiad_enabled',entityId:'catalog-fixture',eventId,sourceRevision:1,createdAt:serverTimestamp()}
    const batch=writeBatch(parent.db);batch.set(doc(parent.db,selection),body);batch.set(doc(parent.db,`users/student/inbox/${eventId}`),notice);await batch.commit()
    expect((await getDoc(doc(student.db,selection))).data().enabled).toBe(true)
    expect((await getDoc(doc(student.db,`users/student/inbox/${eventId}`))).data().type).toBe('olympiad_enabled')
    await expect(setDoc(doc(parent.db,`families/${family}/children/c/olympiadSelections/other-grade`), {...body,eventId:randomUUID(),changedAt:serverTimestamp()})).rejects.toMatchObject({code:'permission-denied'})
    await expect(setDoc(doc(parent.db,`families/${family}/children/other/olympiadSelections/catalog-fixture`), {...body,eventId:randomUUID(),changedAt:serverTimestamp()})).rejects.toMatchObject({code:'permission-denied'})
    await expect(setDoc(doc(student.db,selection), {...body,actorPersonId:'student',deviceUid:student.uid,eventId:randomUUID(),changedAt:serverTimestamp()})).rejects.toMatchObject({code:'permission-denied'})
    const forged=randomUUID()
    await expect(setDoc(doc(parent.db,`users/student/inbox/${forged}`),{...notice,eventId:forged,createdAt:serverTimestamp()})).rejects.toMatchObject({code:'permission-denied'})
    await expect(getDoc(doc(outsider.db,selection))).rejects.toMatchObject({code:'permission-denied'})
  })
  it('denies an authenticated device without a personal session', async () => {
    await expect(getDoc(doc(outsider.db, 'publicOlympiadCatalog/catalog-fixture'))).rejects.toMatchObject({code:'permission-denied'})
  })
})
