import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { projectPublishedBookToFamily, validFamilyBookManifest } from '../storage/family-book-projection.mjs'

/** One-time additive migration. Old bookPages rows and old clients stay valid.
 * @see ../docs/modules/materials/family-library.md#full-book-reader
 * @see ../docs/plans/local-first-release-plan-2026-10-12.md */
const apply = process.argv.includes('--apply')
const audit = process.argv.includes('--audit')
if (apply && audit || process.argv.some((arg) => arg.startsWith('--') && !['--apply', '--audit'].includes(arg))) {
  throw new Error('Используйте без флагов для просмотра, --apply для записи либо --audit для проверки.')
}
const credentials = resolve('.local/adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = credentials
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('Нет локального доступа Google Cloud.')
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const bindings = (await db.collectionGroup('books').get()).docs.filter((snapshot) => {
  const child = snapshot.ref.parent.parent
  const family = child?.parent.parent
  return child && family && family.parent.id === 'families'
    && ['confirmed', 'provisional'].includes(snapshot.data().status)
    && snapshot.data().pagesPublishedAt
})
const pending = bindings.filter((snapshot) => snapshot.data().pagesManifestSha256 !== snapshot.data().pagesPublishedSha256)
if (audit) {
  const result = { mode: 'audit', bindings: bindings.length, validManifests: 0, validLegacyPageCounts: 0, invalid: 0 }
  for (const snapshot of bindings) {
    const pageCollection = snapshot.ref.parent.parent.collection('bookPages')
    const [manifest, oldCount] = await Promise.all([
      pageCollection.doc(`${snapshot.id}#manifest`).get(),
      pageCollection.where('bookId', '==', snapshot.id).count().get(),
    ])
    if (validFamilyBookManifest(manifest.data(), snapshot.data())) result.validManifests += 1
    else result.invalid += 1
    if (oldCount.data().count === snapshot.data().pdfPageCount) result.validLegacyPageCounts += 1
    else result.invalid += 1
  }
  console.log(JSON.stringify(result))
  if (result.invalid) process.exitCode = 1
} else if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', bindings: bindings.length, pending: pending.length,
    existing: bindings.length - pending.length, next: pending.length ? 'Run with --apply to write family manifests after count validation.' : 'No migration needed.' }))
} else {
  const result = { mode: 'apply', bindings: bindings.length, pending: pending.length, published: 0, tooLarge: 0, projectedPages: 0, blocked: 0 }
  for (const snapshot of pending) {
    const update = await projectPublishedBookToFamily(db, snapshot.ref, { verifyCount: true, ensureManifest: true })
    if (update.status !== 'ready') { result.blocked += 1; continue }
    if (update.manifest === 'published') result.published += 1
    if (update.manifest === 'too-large') result.tooLarge += 1
    result.projectedPages += update.projected
  }
  console.log(JSON.stringify(result))
  if (result.blocked || result.projectedPages) process.exitCode = 1
}
