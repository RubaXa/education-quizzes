import { createHash } from 'node:crypto'
/** @see ../docs/decisions/sync-task-routing-2026-10-23.md */
/** @see ../docs/modules/synchronization/task-routing.md */
import { isActiveFamilyChild } from '../packages/education-runtime/identity.mjs'
import { legacyHelpOperationId } from './legacy-help-identity.mjs'
import { eventTaskRoute } from './task-route.mjs'

/** Private, immutable inputs for a precisely addressed event task.
 * @see ../docs/modules/synchronization/execution-artifact.md
 * @see ../docs/modules/synchronization/event-queue.md
 */
const ID = /^[A-Za-z0-9_-]{1,128}$/
const validSegment = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500
  // eslint-disable-next-line no-control-regex -- Reject control characters in source document segments.
  && !['.', '..'].includes(value) && !/[\\/\u0000-\u001f\u007f]/u.test(value)
const HASH = /^[a-f0-9]{64}$/
const TYPES = new Set(['upload.confirmed', 'help.requested', 'quiz.submitted', 'quiz.followup_requested', 'material.ready'])
const instructions = {
  'upload.confirmed': 'Проверить только указанную работу по сохранённому условию. Использовать подтверждённый оригинал файла; не выполнять работу за ученика. Опубликовать ролевой разбор штатным инструментом и подтвердить readback той же работы и владельца.',
  'help.requested': 'Разобрать только указанный запрос помощи по сохранённому условию и точному тексту запроса. Подготовить адресный следующий шаг по учебной политике и опубликовать его штатным инструментом с readback.',
  'quiz.submitted': 'Проверить только указанную отправленную попытку, включая открытые ответы и технические нули. Публиковать подтверждённую проверку штатным quiz CLI, проверить readback и обновить траекторию по доказательствам.',
  'quiz.followup_requested': 'Подготовить запрошенное продолжение указанного теста по всей его цепочке и графу учебных проверок. Сначала проверить незакрытые открытые ответы. Использовать штатные history/create/revise команды и подтвердить readback новой попытки.',
  'material.ready': 'Идентифицировать только указанный подтверждённый материал, сверить оригинал и его хэш. Повторно использовать точное совпадение каталога; опубликовать семейную связь штатными средствами и подтвердить readback.',
}

function canonical(value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}
export function taskArtifactFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function fail(code) { throw Object.assign(new Error(code), { safeCode: code }) }
function validate(event) {
  if (!event || !HASH.test(event.eventId ?? '') || !ID.test(event.familyId ?? '') || !ID.test(event.childId ?? '')
    || event.source !== 'firestore' || !TYPES.has(event.eventType)) fail('unsupported_task_artifact')
  const source = event.sourceRef ?? {}
  const dayType = ['upload.confirmed', 'help.requested'].includes(event.eventType)
  const expected = dayType && ID.test(source.dayToken ?? '') && validSegment(source.recordId ?? source.taskId)
    ? `${event.eventType === 'upload.confirmed' ? 'dayUploads' : 'dayHelp'}/${source.dayToken}/${event.eventType === 'upload.confirmed' ? 'files' : 'items'}/${source.recordId ?? source.taskId}`
    : event.eventType.startsWith('quiz.') && ID.test(source.quizToken ?? '') ? `assignments/${source.quizToken}`
      : event.eventType === 'material.ready' && ID.test(source.recordId ?? '')
        ? `families/${event.familyId}/children/${event.childId}/bookUploads/${source.recordId}` : null
  if (!expected || source.documentPath !== expected) fail('task_source_path_invalid')
}

/** Reads only the event source and its precise context. Never discovers global inbox work. */
export async function captureEventTaskInputs(db, event) {
  validate(event)
  const sourceSnap = await db.doc(event.sourceRef.documentPath).get()
  if (!sourceSnap.exists) fail('task_source_missing')
  const source = sourceSnap.data()
  const [familySnap, childSnap] = await Promise.all([
    db.doc(`families/${event.familyId}`).get(), db.doc(`families/${event.familyId}/children/${event.childId}`).get(),
  ])
  if (!familySnap.exists || !childSnap.exists || !isActiveFamilyChild({ familyId: event.familyId, childId: event.childId,
    family: familySnap.data(), child: childSnap.data() })) fail('task_owner_unavailable')
  if (event.actor?.type === 'user') {
    const session = await db.doc(`deviceSessions/${event.actor.uid}`).get()
    const token = session.data()?.linkToken
    if (!session.exists || !ID.test(token ?? '')) fail('task_actor_unavailable')
    const link = await db.doc(`accessLinks/${token}`).get()
    const personId = link.data()?.personId
    if (!link.exists || link.data().active !== true || !ID.test(personId ?? '')) fail('task_actor_unavailable')
    const member = await db.doc(`families/${event.familyId}/members/${personId}`).get()
    const value = member.data()
    if (!member.exists || value.active !== true || !['student', 'parent'].includes(value.role)
      || !value.childIds?.includes(event.childId)) fail('task_actor_unavailable')
  }
  // Expiring upload transport credentials are not task evidence.
  const { upload: _transport, ...sourceEvidence } = source
  const inputs = { source: canonical(sourceEvidence), child: { displayName: childSnap.data()?.displayName ?? null }, sourcePath: event.sourceRef.documentPath }
  if (event.sourceRef.dayToken) {
    const ownerSnap = await db.doc(`dayOwners/${event.sourceRef.dayToken}`).get()
    const owner = ownerSnap.data()
    if (!ownerSnap.exists || owner.familyId !== event.familyId || owner.childId !== event.childId) fail('task_owner_mismatch')
    const pageSnap = await db.doc(`dayPages/${event.sourceRef.dayToken}`).get()
    const page = pageSnap.data()
    if (!pageSnap.exists || page.kind !== 'student' || page.date !== owner.date) fail('task_context_missing')
    const taskId = source.taskId ?? event.sourceRef.taskId
    const subject = page.subjects?.find((subject) => subject.tasks?.some((task) => task.id === taskId || task.problems?.some((problem) => problem.id === taskId)))
    const task = subject?.tasks.find((task) => task.id === taskId || task.problems?.some((problem) => problem.id === taskId))
    if (!task) fail('task_context_missing')
    inputs.context = canonical({ dayToken: event.sourceRef.dayToken, date: page.date, dueDate: page.targetDate,
      planRevision: page.planRevision ?? null, subject: subject.name, task,
      materialLinks: page.materialLinks?.[task.id] ?? [], taskPageRefs: page.taskPageRefs?.[task.id] ?? [] })
    if (event.eventType === 'upload.confirmed' && (source.status !== 'pending' || source.storage?.state !== 'stored'
      || !source.storage?.path || !HASH.test(source.storage?.sha256 ?? ''))) fail('task_source_not_reviewable')
    if (event.eventType === 'help.requested' && source.eventReceiptId && source.eventReceiptId !== event.eventId) {
      const requestTime = typeof source.requestedAt?.toMillis === 'function' ? source.requestedAt.toMillis() : Date.parse(source.requestedAt ?? '')
      const legacyMatches = event.actor?.type === 'system' && event.actor.id === 'server'
        && event.operationId === legacyHelpOperationId({ dayToken: event.sourceRef.dayToken, taskId,
          revision: source.revision, requestedAtMs: requestTime })
      if (!legacyMatches) fail('task_source_superseded')
    }
  } else if (event.eventType.startsWith('quiz.')) {
    if (source.familyId !== event.familyId || source.childId !== event.childId) fail('task_owner_mismatch')
    if (source.status !== 'submitted') fail('task_source_not_reviewable')
    if (event.eventType === 'quiz.followup_requested' && !source.followupRequestedAt) fail('task_source_not_reviewable')
    const keySnap = await db.doc(`answerKeys/${event.sourceRef.quizToken}`).get()
    inputs.answerKey = keySnap.exists ? canonical(keySnap.data()) : null
  } else if (source.status !== 'needs-identification' || source.storage?.state !== 'stored' || !source.storage?.path) fail('task_source_not_reviewable')
  inputs.route = eventTaskRoute(event.eventType, inputs)
  return inputs
}

/** Capture before dispatch; retry reuses an identical immutable artifact. */
export async function prepareEventTaskArtifact(db, event, { now = new Date().toISOString() } = {}) {
  const inputs = await captureEventTaskInputs(db, event)
  const fingerprint = taskArtifactFingerprint({ eventId: event.eventId, inputs })
  const artifactId = taskArtifactFingerprint([event.eventId, fingerprint])
  const artifact = { schemaVersion: 1, artifactId, eventId: event.eventId, eventType: event.eventType,
    familyId: event.familyId, childId: event.childId, sourceRef: event.sourceRef, operationId: event.operationId,
    source: event.source, actor: event.actor ?? { type: 'system', id: 'server' }, fingerprint,
    verifiedAt: now, state: 'ready', instruction: inputs.route.next === 'review-source-material'
      ? 'Прочитать запрошенный источник, не оценивать выполнение ДЗ. Использовать source-material/sourceAnalysis штатного submissions CLI; затем разрешить запрос только по доказательствам, пересмотреть точное назначение и подтвердить ролевой readback. Получение страницы не означает выполненное ДЗ.'
      : instructions[event.eventType], inputs }
  if (Buffer.byteLength(JSON.stringify(artifact)) > 700_000) fail('task_artifact_too_large')
  const ref = db.doc(`operatorSyncTaskArtifacts/${artifactId}`)
  const observationRef = db.doc(`operatorSyncTaskObservations/${event.eventId}`)
  await db.runTransaction(async (tx) => {
    const previous = await tx.get(ref)
    if (previous.exists) {
      if (previous.data().fingerprint !== fingerprint) fail('task_artifact_identity_mismatch')
    } else tx.create(ref, artifact)
    tx.set(observationRef, { eventId: event.eventId, artifactId, fingerprint, verifiedAt: now })
  })
  return { artifactId, artifactPath: ref.path, observationPath: observationRef.path, fingerprint, instruction: artifact.instruction }
}

/** Freshness is mechanical; stale inputs require an exact source refresh, never a global scan. */
export function validateTaskArtifact(artifact, { eventId, observation = null, now = new Date().toISOString(), maxAgeMs = 5 * 60_000 } = {}) {
  if (!artifact || artifact.schemaVersion !== 1 || artifact.state !== 'ready' || artifact.eventId !== eventId
    || !HASH.test(artifact.artifactId ?? '') || !TYPES.has(artifact.eventType)) fail('task_artifact_invalid')
  validate(artifact)
  const fingerprint = taskArtifactFingerprint({ eventId, inputs: artifact.inputs })
  if (fingerprint !== artifact.fingerprint || taskArtifactFingerprint([eventId, fingerprint]) !== artifact.artifactId) fail('task_artifact_invalid')
  if (observation && (observation.eventId !== eventId || observation.artifactId !== artifact.artifactId || observation.fingerprint !== fingerprint)) fail('task_artifact_superseded')
  const age = Date.parse(now) - Date.parse(observation?.verifiedAt ?? artifact.verifiedAt)
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return { state: 'stale', reason: 'task_artifact_expired' }
  return { state: 'ready', artifactId: artifact.artifactId, fingerprint }
}
