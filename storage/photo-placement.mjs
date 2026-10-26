/** @see ../docs/decisions/reviewed-photo-placement-2026-10-26.md */
/** @see ../docs/modules/materials/storage-privacy.md#multi-task-photo */
export function photoPlacementPatch(photo, { fromTaskId, toTaskId, taskIds, planRevision, reason, now, reviewComplete = false }) {
  if (!taskIds?.includes(toTaskId) || !taskIds.includes(fromTaskId) || fromTaskId === toTaskId
    || photo.planRevision !== planRevision || photo.storage?.state !== 'stored'
    || !(photo.status === 'reviewed' || reviewComplete && photo.status === 'pending')
    || !Array.isArray(photo.coveredTaskIds) || photo.coveredTaskIds.length !== 1 || photo.coveredTaskIds[0] !== toTaskId
    || typeof reason !== 'string' || reason.trim().length < 12 || reason.length > 600 || !now) {
    throw new Error('photo_placement_unproven')
  }
  if (photo.taskId === toTaskId && photo.placementHistory?.some(row => row.fromTaskId === fromTaskId && row.toTaskId === toTaskId)) return null
  if (photo.taskId !== fromTaskId) throw new Error('photo_placement_changed')
  return { taskId: toTaskId, originalTaskId: photo.originalTaskId ?? fromTaskId,
    placementHistory: [...(photo.placementHistory ?? []).slice(-9), { fromTaskId, toTaskId, reason: reason.trim(), correctedAt: now }] }
}

/** Correct placement within one owned day; preserve bytes, upload ID, review and source history. */
export async function relocateReviewedPhoto(db, request, now) {
  if (!/^[A-Za-z0-9_-]{20,120}$/.test(request?.dayToken ?? '')
    || !/^[A-Za-z0-9_-]{20,120}$/.test(request?.uploadId ?? '')) throw new Error('photo_placement_invalid_request')
  const ref = db.doc(`dayUploads/${request.dayToken}/files/${request.uploadId}`)
  const result = await db.runTransaction(async tx => {
    const [owner, page, upload] = await Promise.all([
      tx.get(db.doc(`dayOwners/${request.dayToken}`)), tx.get(db.doc(`dayPages/${request.dayToken}`)), tx.get(ref),
    ])
    if (!owner.exists || !owner.data()?.familyId || !owner.data()?.childId || !upload.exists
      || owner.data().date !== request.date || page.data()?.kind !== 'student'
      || page.data().planRevision !== request.planRevision) throw new Error('photo_placement_owner_or_revision_mismatch')
    const patch = photoPlacementPatch(upload.data(), { ...request, taskIds: page.data().taskIds, now })
    if (patch) tx.update(ref, patch)
    return { changed: Boolean(patch) }
  })
  const saved = (await ref.get()).data()
  if (saved?.taskId !== request.toTaskId || saved.status !== 'reviewed') throw new Error('photo_placement_readback_failed')
  return { ...result, verified: true }
}
