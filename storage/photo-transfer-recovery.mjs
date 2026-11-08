/** @see ../docs/decisions/photo-auth-resume-2026-11-08.md */
/** @see ../docs/decisions/photo-outbox-route-recovery-2026-11-07.md */
/** @see ../docs/decisions/photo-transfer-revision-race-2026-11-07.md */
/** Exact-source recovery of an admitted upload; never edits bytes or grades.
 * @see ../docs/services/upload-worker/README.md#photo-recovery
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { stageEducationEvent } from '../packages/education-runtime/event-queue.mjs'
import { authorizedPhoto, photoAuthorizedInTransaction } from '../packages/education-runtime/upload-broker.mjs'
import { workPath } from './direct-upload.mjs'
import { stageFamilyNotice, taskContext } from './inbox-notifications.mjs'

const idPattern = /^[A-Za-z0-9_-]{20,80}$/
export async function inspectPhotoTransfer({ db, disk, dayToken, uploadId }) {
  if (!idPattern.test(dayToken) || !idPattern.test(uploadId)) throw new Error('invalid_photo_identity')
  const sourceRef = { kind: 'upload', documentPath: `dayUploads/${dayToken}/files/${uploadId}`, dayToken, recordId: uploadId }
  const [ownerSnap, pageSnap, uploadSnap] = await Promise.all([
    db.doc(`dayOwners/${dayToken}`).get(), db.doc(`dayPages/${dayToken}`).get(), db.doc(sourceRef.documentPath).get(),
  ])
  if (!ownerSnap.exists || !pageSnap.exists || !uploadSnap.exists) throw new Error('photo_source_missing')
  const owner = ownerSnap.data(), page = pageSnap.data(), upload = uploadSnap.data()
  const allowed = await authorizedPhoto(db, owner, page, upload)
  const path = workPath(owner, dayToken, uploadId, upload.contentType)
  const remote = await disk.head(path)
  return { owner, page, upload, sourceRef: { ...sourceRef, taskId: upload.taskId },
    summary: { status: upload.status, requestRevision: upload.planRevision, pageRevision: page.planRevision,
      revisionChanged: upload.planRevision !== page.planRevision, authorizedNow: allowed,
      taskPresent: page.taskIds?.includes(upload.taskId) === true,
      storageConfirmed: upload.storage?.state === 'stored', remoteFilePresent: remote?.type === 'file',
      originalError: upload.error ?? null,
      clientTransfer: upload.clientTransfer ? {
        phase: upload.clientTransfer.phase, stage: upload.clientTransfer.stage, code: upload.clientTransfer.code,
        attempt: upload.clientTransfer.attempt, httpStatus: upload.clientTransfer.httpStatus,
        at: upload.clientTransfer.at?.toDate?.().toISOString() ?? null,
      } : { phase: 'client-not-observed' },
      linkIssuedAt: upload.upload?.issuedAt?.toDate?.().toISOString() ?? null,
      serverStage: upload.status === 'awaiting-upload' && upload.upload?.href ? 'link-ready' : upload.status,
      clientObservedAfterLink: upload.upload?.issuedAt && upload.clientTransfer?.at
        ? upload.clientTransfer.at.toDate().getTime() >= upload.upload.issuedAt.toDate().getTime() : null,
      deliveryStage: upload.status === 'awaiting-upload' && upload.upload?.href
        && (!upload.clientTransfer?.at || upload.clientTransfer.at.toDate().getTime() < (upload.upload.issuedAt?.toDate?.().getTime() ?? 0))
        ? 'client-not-observed-after-link' : upload.clientTransfer?.phase ?? 'client-not-observed' } }
}

export async function recoverPhotoTransfer(deps) {
  const { db, dayToken, uploadId } = deps
  const { owner, page, upload, sourceRef, summary } = await inspectPhotoTransfer(deps)
  if (!summary.authorizedNow) throw new Error('photo_current_authorization_required')
  if (!['upload-error', 'requested', 'awaiting-upload', 'uploaded', 'pending', 'reviewed'].includes(upload.status)) throw new Error('photo_not_recoverable')
  // New operation ID: replaying the failed transfer event would remain done.
  const operationId = `upload-recovery:${uploadId}:${page.planRevision}`
  const event = { eventType: 'upload.transfer_requested', familyId: owner.familyId, childId: owner.childId,
    source: 'firestore', sourceRef, operationId, actor: { type: 'system', id: 'operator' } }
  const result = await db.runTransaction(async tx => {
    const ref = db.doc(sourceRef.documentPath), currentSnap = await tx.get(ref)
    if (!currentSnap.exists) throw new Error('photo_source_missing')
    const current = currentSnap.data()
    if (['pending', 'reviewed'].includes(current.status)) return { resumed: false, stored: true }
    if (!['upload-error', 'requested', 'awaiting-upload', 'uploaded'].includes(current.status)) throw new Error('photo_not_recoverable')
    if (current.sha256 !== upload.sha256 || current.deviceUid !== upload.deviceUid
      || current.planRevision !== upload.planRevision || current.taskId !== upload.taskId) throw new Error('photo_source_changed')
    if (!(await photoAuthorizedInTransaction(tx, db, event, current))) throw new Error('photo_current_authorization_required')
    const staged = await stageEducationEvent(tx, db, event)
    if (current.recoveryOperationId !== operationId) tx.update(ref, {
      status: current.status === 'upload-error' ? 'requested' : current.status,
      error: FieldValue.delete(), recoveryOperationId: operationId, recoveredAt: Timestamp.now(),
    })
    return { resumed: true, eventId: staged.eventId }
  })
  // Idempotent, addressed in-app request; never asks for rewriting the work.
  const batch = db.batch(), context = taskContext(page, upload.taskId)
  const recipients = result.stored ? 0 : await stageFamilyNotice(db, batch, {
    familyId: owner.familyId, childId: owner.childId, roles: ['student', 'parent'],
    key: `photo-recovery:${dayToken}:${uploadId}`, mode: 'create',
    data: { type: 'product_update', entityId: upload.taskId, taskId: upload.taskId, date: page.targetDate ?? owner.date,
      subject: context.subject, title: 'Нужно завершить передачу фото',
      body: `${context.title}: открой карточку на устройстве, с которого отправлял фото. Сохранённый снимок попробует отправиться автоматически. Если он не передался, выбери тот же снимок через «Загрузить решение». Переписывать работу не нужно.`,
      sourceRevision: 1 },
  })
  if (recipients) await batch.commit()
  const after = (await db.doc(sourceRef.documentPath).get()).data()
  return { ...result, recipients, readbackVerified: result.stored || after?.recoveryOperationId === operationId,
    status: after?.status, originalRevisionPreserved: after?.planRevision === upload.planRevision }
}
