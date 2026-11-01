/** @see ../docs/services/operator-cli/README.md#operation-contract */
/** @see ../docs/decisions/olympiad-family-storage-2026-10-27.md */
import { startOlympiadHelp, finishOlympiadHelp } from '../sync/olympiad-help.mjs'
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
function refs(db, scope) {
  if (!['familyId', 'childId', 'olympiadId', 'problemId', 'requestId', 'operationId'].every(key => id(scope[key]))) throw new Error('invalid-identity')
  const base = `families/${scope.familyId}/children/${scope.childId}/olympiads/${scope.olympiadId}`
  return { request: db.doc(`${base}/helpRequests/${scope.requestId}`), problem: db.doc(`olympiadMaterials/${scope.olympiadId}/problems/${scope.problemId}`) }
}
/** Start and read back the frozen revision. Notes are kept only in the private operation receipt. */
export async function beginHelpReview(db, scope) {
  const r = refs(db, scope)
  const frozen = await startOlympiadHelp(db, scope)
  const [request, problem] = await Promise.all([r.request.get(), r.problem.get()])
  const value = request.data(), p = problem.data()
  if (!request.exists || !problem.exists || value?.problemId !== scope.problemId || value.processing?.operationId !== scope.operationId
    || value.processing?.revision !== frozen.revision || !Array.isArray(value.revisions) || !Array.isArray(frozen.revisions)
    || typeof p?.statement !== 'string' || p.status !== 'published' || p.practiceOnly !== true) throw new Error('frozen-readback-failed')
  const revisions = value.revisions.filter(item => frozen.revisions.includes(item.revision)).map(({ revision, photoIds, note }) => ({ revision, photoIds, note }))
  if (revisions.length !== frozen.revisions.length) throw new Error('frozen-readback-failed')
  return { verified: true, revision: frozen.revision, revisions, problem: { title: p.title ?? '', statement: p.statement } }
}
/** Publish a real operator-authored answer and read the exact committed revision back. */
export async function completeHelpReview(db, scope, answer, presentation) {
  const r = refs(db, scope)
  const result = await finishOlympiadHelp(db, { ...scope, answer,...(presentation?{presentation}:{}) })
  const snap = await r.request.get(), value = snap.data()
  const saved = value?.answers?.find(item => item.operationId === scope.operationId)
  if (!snap.exists || value.problemId !== scope.problemId || !saved || saved.revision !== result.revision || saved.text !== answer||JSON.stringify(saved.presentation)!==JSON.stringify(presentation)) throw new Error('answer-readback-failed')
  return { verified: true, revision: result.revision, reused: result.reused, status: value.status }
}

/** Pull exact frozen photos to a trusted caller; never publish a Disk URL. */
export async function captureHelpPhotos(db, storage, scope, frozen) {
  const r = refs(db, scope)
  if (typeof storage?.head !== 'function' || typeof storage?.getAt !== 'function' || !Array.isArray(frozen.revisions)) throw new Error('photo-storage-unavailable')
  const snap = await r.request.get(), request = snap.data()
  if (!snap.exists || request?.processing?.operationId !== scope.operationId || request.processing.revision !== frozen.revision) throw new Error('frozen-readback-failed')
  const ids = [...new Set(frozen.revisions.flatMap(item => item.photoIds ?? []))]
  if (!ids.length || !ids.every(id)) throw new Error('frozen-photos-missing')
  const base = `families/${scope.familyId}/children/${scope.childId}/olympiads/${scope.olympiadId}`
  const photos = []
  for (const photoId of ids) {
    const p = (await db.doc(`${base}/photos/${photoId}`).get()).data()
    const receipt = (await db.doc(`olympiadPhotoReceipts/${photoId}`).get()).data()
    const path = p?.storage?.path, sha = p?.storage?.sha256
    if (p?.status !== 'stored' || p.problemId !== scope.problemId || p.personId !== request.personId || p.receiptId !== photoId
      || !/^app:\/PETR\/Олимпиады\/[a-f0-9]{64}\/[a-f0-9]{64}\.(jpg|png|webp|heic|heif)$/.test(path ?? '') || !/^[a-f0-9]{64}$/.test(sha ?? '')
      || receipt?.status !== 'stored' || receipt.familyId !== scope.familyId || receipt.childId !== scope.childId || receipt.olympiadId !== scope.olympiadId
      || receipt.problemId !== scope.problemId || receipt.personId !== p.personId || receipt.storage?.path !== path || receipt.storage?.sha256 !== sha
      || !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(receipt.mime)) throw new Error('photo-evidence-invalid')
    const remote = await storage.head(path)
    if (remote?.type !== 'file' || remote.public_url || !Number.isInteger(remote.size) || remote.size < 1 || remote.size > 25_000_000) throw new Error('photo-not-private')
    const bytes = await storage.getAt(path)
    const { createHash } = await import('node:crypto')
    if (!Buffer.isBuffer(bytes) || bytes.length !== remote.size || createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('photo-integrity-failed')
    photos.push({ photoId, mime: receipt.mime, bytes })
  }
  const again = await startOlympiadHelp(db, scope)
  if (again.revision !== frozen.revision) throw new Error('frozen-readback-failed')
  return photos
}
