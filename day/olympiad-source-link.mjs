/** Addressed provenance link for an operator-verified duplicate.
 * @see ../docs/modules/assessments/olympiad-preparation.md#свои-листы-и-происхождение
 */
import { mergeFamilyAssignments, stableFamilyProjectionJson } from './family-assignment.mjs'
import { validateTaskArtifact } from '../sync/event-task-artifact.mjs'
import { isActiveFamilyChild } from '../packages/education-runtime/identity.mjs'

const segment = value => /^[A-Za-z0-9_-]{1,128}$/.test(value ?? '')
const hash = value => /^[a-f0-9]{64}$/.test(value ?? '')
const normal = value => typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : ''
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }) }

/** A link is evidence, never a solution upload. No task text, status, review,
 * result, upload or source revision is changed. Exact conditions and figures
 * must have been reviewed by the operator before calling this function. */
export async function linkOlympiadSource(db, request, { familyId, childId, studentToken, parentToken, sourceDate, now = new Date().toISOString() } = {}) {
  const { eventId, artifactId, taskId, condition, figuresVerified } = request ?? {}
  if (!hash(eventId) || !hash(artifactId) || ![familyId, childId, studentToken, parentToken, taskId].every(segment)
    || studentToken === parentToken || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate ?? '')
    || !normal(condition) || figuresVerified !== true || !Number.isFinite(Date.parse(now))) fail('source_link_invalid')
  const result = await db.runTransaction(async tx => {
    const eventRef = db.doc(`educationEvents/${eventId}`), artifactRef = db.doc(`operatorSyncTaskArtifacts/${artifactId}`)
    const [eventSnap, artifactSnap] = await Promise.all([tx.get(eventRef), tx.get(artifactRef)])
    const event = eventSnap.data(), artifact = artifactSnap.data(), source = event?.sourceRef
    if (!eventSnap.exists || !artifactSnap.exists || event.eventId !== eventId || event.eventType !== 'upload.confirmed'
      || event.familyId !== familyId || event.childId !== childId || source?.dayToken !== studentToken
      || source.documentPath !== `dayUploads/${studentToken}/files/${source.recordId}` || !segment(source.recordId)
      || artifact.eventId !== eventId || artifact.artifactId !== artifactId
      || validateTaskArtifact(artifact, { eventId, now: artifact.verifiedAt }).state !== 'ready'
      || artifact.inputs?.route?.next !== 'ingest-olympiad-sheet') fail('source_link_event_invalid')
    const intakeId = source.taskId
    if (!segment(intakeId) || artifact.inputs?.context?.task?.id !== intakeId) fail('source_link_intake_invalid')
    const taskRef = db.doc(`families/${familyId}/children/${childId}/tasks/${taskId}`)
    const intakeRef = db.doc(`families/${familyId}/children/${childId}/tasks/${intakeId}`)
    const photoRef = db.doc(source.documentPath), ownerRef = db.doc(`dayOwners/${studentToken}`)
    const studentRef = db.doc(`dayPages/${studentToken}`), parentRef = db.doc(`dayPages/${parentToken}`)
    const [taskSnap, intakeSnap, photoSnap, ownerSnap, studentSnap, parentSnap] = await Promise.all(
      [taskRef, intakeRef, photoRef, ownerRef, studentRef, parentRef].map(ref => tx.get(ref)))
    const [familySnap, childSnap] = await Promise.all([tx.get(db.doc(`families/${familyId}`)), tx.get(db.doc(`families/${familyId}/children/${childId}`))])
    if (!familySnap.exists || !childSnap.exists || !isActiveFamilyChild({ familyId, childId, family: familySnap.data(), child: childSnap.data() })) fail('source_link_owner_inactive')
    if (event.actor?.type === 'user') {
      const session = await tx.get(db.doc(`deviceSessions/${event.actor.uid}`))
      const token = session.data()?.linkToken
      if (!session.exists || !segment(token)) fail('source_link_actor_inactive')
      const access = await tx.get(db.doc(`accessLinks/${token}`))
      const person = access.data()?.personId
      if (!access.exists || access.data()?.active !== true || !segment(person)) fail('source_link_actor_inactive')
      const member = await tx.get(db.doc(`families/${familyId}/members/${person}`))
      if (!member.exists || member.data()?.active !== true || !['student', 'parent'].includes(member.data()?.role) || !member.data()?.childIds?.includes(childId)) fail('source_link_actor_inactive')
    }
    const task = taskSnap.data(), intake = intakeSnap.data(), photo = photoSnap.data(), owner = ownerSnap.data()
    if (!taskSnap.exists || !intakeSnap.exists || !photoSnap.exists || !ownerSnap.exists
      || task.familyId !== familyId || task.childId !== childId || task.sourceSystem !== 'family'
      || task.sourceIntake || task.optional !== true || task.learningContext?.kind !== 'olympiad'
      || intake.familyId !== familyId || intake.childId !== childId || intake.sourceIntake?.kind !== 'olympiad-sheet'
      || intake.learningContext?.id !== task.learningContext.id || intake.projectionSourceDate !== sourceDate
      || task.projectionSourceDate !== sourceDate || task.dueDate !== intake.dueDate
      || owner.familyId !== familyId || owner.childId !== childId || owner.date !== sourceDate
      || photo.taskId !== intakeId || !['pending', 'reviewed'].includes(photo.status) || photo.storage?.state !== 'stored'
      || !hash(photo.storage?.sha256) || photo.storage.sha256 !== artifact.inputs?.source?.storage?.sha256
      || normal(task.originalText) !== normal(condition)) fail('source_link_evidence_mismatch')
    const pages = [studentSnap.data(), parentSnap.data()]
    if (!pages.every((page, i) => page && page.kind === ['student', 'parent'][i] && page.familyId === familyId
      && page.childId === childId && page.date === sourceDate && page.targetDate === task.dueDate
      && page.subjects?.some(subject => subject.tasks?.some(item => item.id === taskId && item.familyOrigin?.sourceId === taskId)))) fail('source_link_pages_invalid')
    const link = { intakeTaskId: intakeId, uploadIds: [source.recordId] }
    const links = [...(task.learnerSources ?? [])]
    const origin = task.learnerOrigin
    const present = [origin, ...links].some(item => item?.intakeTaskId === intakeId && item.uploadIds?.includes(source.recordId))
    if (present) return { unchanged: true, link }
    links.push(link)
    const updated = { ...task, learnerSources: links }
    const projected = pages.map(page => mergeFamilyAssignments(page, [updated]))
    tx.update(taskRef, { learnerSources: links })
    tx.set(studentRef, projected[0]); tx.set(parentRef, projected[1])
    return { unchanged: false, link }
  })
  const [task, student, parent] = await Promise.all([
    db.doc(`families/${familyId}/children/${childId}/tasks/${taskId}`).get(), db.doc(`dayPages/${studentToken}`).get(), db.doc(`dayPages/${parentToken}`).get(),
  ])
  const hasLink = item => [item?.learnerOrigin, ...(item?.learnerSources ?? [])].some(link => stableFamilyProjectionJson(link) === stableFamilyProjectionJson(result.link)
    || link?.intakeTaskId === result.link.intakeTaskId && link.uploadIds?.includes(result.link.uploadIds[0]))
  if (!hasLink(task.data()) || ![student, parent].every(snapshot => hasLink(snapshot.data()?.subjects?.flatMap(s => s.tasks ?? []).find(t => t.id === taskId)))) fail('source_link_readback_failed')
  return { taskId, eventId, verified: true, unchanged: result.unchanged }
}
