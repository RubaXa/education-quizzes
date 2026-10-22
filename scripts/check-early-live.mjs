/** Isolated real Firebase permission/replication probe; never writes a family observation.
 * @see ../docs/modules/families/early-development.md */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInAnonymously, deleteUser } from 'firebase/auth'
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore, onSnapshot, serverTimestamp, Timestamp, writeBatch, deleteDoc, updateDoc, terminate } from 'firebase/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { program } from '../early-development/program.mjs'

const projectId = 'education-9d7c6'
const apiKey = readFileSync('src/lib/firebase.ts', 'utf8').match(/apiKey:\s*'([^']+)'/)[1]
const suffix = randomBytes(8).toString('hex'), familyId = `fixture-early-${suffix}`, otherFamily = `fixture-other-${suffix}`
const childId = 'fixture-baby', personId = `fixture-parent-${suffix}`
const base = `families/${familyId}/children/${childId}`, path = `${base}/earlyObservations/fixture-episode`
const admin = operatorFirestore(), clients = [], cleanup = [], checks = []
async function client(label, person, family, role) {
  const app = initializeApp({ projectId, apiKey, authDomain: `${projectId}.firebaseapp.com` }, `early-${label}-${suffix}`)
  const auth = getAuth(app), credential = await signInAnonymously(auth)
  const web = getFirestore(app), uid = credential.user.uid, token = randomBytes(32).toString('base64url')
  clients.push({ app, auth, web, user: credential.user })
  const docs = { [`accessLinks/${token}`]: { active: true, personId: person }, [`deviceSessions/${uid}`]: { linkToken: token },
    [`families/${family}/members/${person}`]: { role, active: true, childIds: role === 'student' ? [childId] : [], earlyChildIds: role === 'parent' ? [childId] : [] } }
  const batch = admin.batch(); for (const [p, value] of Object.entries(docs)) { batch.set(admin.doc(p), value); if (!p.startsWith('families/')) cleanup.push(p) }; await batch.commit()
  return web
}
async function denied(name, work) {
  try { await work(); throw new Error(`unexpected-allow:${name}`) } catch (error) { if (error.code !== 'permission-denied') throw error; checks.push(name) }
}
function value(revision, overrides = {}) {
  return { schemaVersion: 1, activityId: 'voice', activityTitle: 'Synthetic voice fixture', programVersion: program.version, observedAt: Timestamp.fromDate(new Date('2026-01-01T12:00:00.000Z')), reaction: 'Другое', note: 'Synthetic permission check; not a child observation', deleted: false, authorId: personId, createdAt: null, updatedAt: serverTimestamp(), updatedBy: personId, revision, revisionId: randomUUID(), ...overrides }
}
async function write(web, data) { const batch = writeBatch(web); batch.set(doc(web, path), data); batch.set(doc(web, path, 'history', data.revisionId), data); await batch.commit() }
try {
  await admin.doc(`families/${familyId}`).set({ fixture: true })
  await admin.doc(`families/${otherFamily}`).set({ fixture: true })
  await admin.doc(base).set({ displayName: 'Synthetic baby', learningMode: 'early-development', active: true })
  await admin.doc(`${base}/earlyDevelopment/current`).set({ schemaVersion: 1, birthDate: '2026-01-01', timezone: 'Europe/Moscow', programVersion: program.version, curriculum: program })
  const a = await client('a', personId, familyId, 'parent'), b = await client('b', personId, familyId, 'parent')
  const student = await client('student', `fixture-student-${suffix}`, familyId, 'student'), outsider = await client('outsider', `fixture-outsider-${suffix}`, otherFamily, 'parent')
  if (!(await getDocFromServer(doc(a, `${base}/earlyDevelopment/current`))).exists()) throw new Error('plan-missing')
  checks.push('parent-plan-read')
  let stop
  const replicated = new Promise((resolve, reject) => { const timer = setTimeout(() => { stop?.(); reject(new Error('replication-timeout')) }, 15000); stop = onSnapshot(doc(b, path), (snapshot) => { if (snapshot.metadata.fromCache || !snapshot.exists()) return; clearTimeout(timer); stop?.(); resolve(snapshot.data()) }, reject) })
  await write(a, value(1, { createdAt: serverTimestamp() }))
  const first = await replicated
  if (first.revision !== 1 || first.note !== 'Synthetic permission check; not a child observation') throw new Error('second-device-diff')
  checks.push('two-device-live-replication')
  await write(b, value(2, { createdAt: first.createdAt, note: 'Edited synthetic fixture' }))
  await denied('stale-revision-denied', () => write(a, value(2, { createdAt: first.createdAt })))
  await write(a, value(3, { createdAt: first.createdAt, deleted: true }))
  await write(b, value(4, { createdAt: first.createdAt, deleted: false }))
  if ((await getDocsFromServer(collection(a, path, 'history'))).size !== 4) throw new Error('audit-history-missing')
  checks.push('edit-soft-delete-restore-four-revisions')
  await denied('hard-delete-denied', () => deleteDoc(doc(a, path)))
  await denied('immutable-history-denied', () => updateDoc(doc(a, path, 'history', first.revisionId), { note: 'forged' }))
  await denied('student-journal-denied', () => getDocsFromServer(collection(student, base, 'earlyObservations')))
  await denied('student-plan-denied', () => getDocFromServer(doc(student, base, 'earlyDevelopment/current')))
  await denied('other-family-denied', () => getDocFromServer(doc(outsider, base, 'earlyDevelopment/current')))
  await denied('client-plan-mutation-denied', () => updateDoc(doc(a, base, 'earlyDevelopment/current'), { programVersion: 'forged' }))
  await admin.doc(`families/${familyId}/members/${personId}`).update({ earlyChildIds: [] })
  await denied('revoked-membership-denied', () => getDocFromServer(doc(b, path)))
  writeFileSync('.local/early-live-receipt.json', JSON.stringify({ verifiedAt: new Date().toISOString(), checks, passed: true, syntheticOnly: true }, null, 2))
  console.log(JSON.stringify({ passed: true, checks, syntheticOnly: true }))
} finally {
  for (const item of clients) { await terminate(item.web).catch(() => {}); await deleteUser(item.user).catch(() => {}); await deleteApp(item.app).catch(() => {}) }
  await admin.recursiveDelete(admin.doc(`families/${familyId}`))
  await admin.recursiveDelete(admin.doc(`families/${otherFamily}`))
  if (cleanup.length) { const batch = admin.batch(); for (const p of cleanup) batch.delete(admin.doc(p)); await batch.commit() }
  await admin.terminate()
}
