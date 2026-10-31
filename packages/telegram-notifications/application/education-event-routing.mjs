import { EDUCATION_EVENT_TYPES } from '../../education-runtime/event-queue.mjs'

/** @see ../../../docs/modules/synchronization/event-queue.md#маршрутизация-и-готовое-задание */
export const EDUCATION_ACTION_TYPES = Object.freeze([
  'material.read_requested',
  'help.requested', 'upload.confirmed', 'upload.transfer_requested', 'upload.bytes_uploaded', 'upload.delete_requested', 'quiz.submitted',
  'quiz.followup_requested', 'quiz.requirement_changed', 'parent.guidance_sent', 'parent.decision',
  'material.upload_requested', 'material.bytes_uploaded', 'material.ready', 'material.requirement_changed', 'review.published',
])

const MESH_NOTIFICATION_TYPES = new Set([
  'schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed',
  'homework.cancelled', 'grade.created', 'grade.changed', 'upload.confirmed', 'quiz.started', 'quiz.submitted', 'review.changed', 'technical.probe',
])
const MESH_EDUCATION_SYNC_TYPES = new Set([
  'schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed',
  'homework.cancelled', 'grade.created', 'grade.changed',
])
const ACTION_DISPATCH_TYPES = new Set([
  'help.requested', 'quiz.followup_requested', 'quiz.submitted', 'upload.confirmed', 'material.ready',
])
const PERMANENT_SOURCE_CODES = new Set(['task_source_missing', 'task_source_not_reviewable', 'task_owner_mismatch',
  'task_owner_unavailable', 'task_source_superseded', 'task_context_missing', 'task_actor_unavailable', 'task_source_path_invalid', 'unsupported_task_artifact'])

/** Returns deterministic per-event fanout phases. Each phase must be idempotent by queue eventId. */
export function createEducationEventHandlers({ firestorePipeline = null, notificationService = null, educationSyncDispatcher = null,
  actionHandlers = {}, onDeliveryQueued = () => {}, onEducationSyncQueued = () => {} } = {}) {
  const routes = {}
  const phase = (name, handle) => ({ phase: name, handle })
  for (const eventType of EDUCATION_EVENT_TYPES) {
    routes[eventType] = []
    const phases = routes[eventType]
    if (eventType === 'upload.confirmed' || eventType === 'quiz.started' || eventType === 'quiz.submitted' || eventType === 'review.published') {
      phases.push(phase('source-observation', async (event, { signal } = {}) => {
        if (event.source !== 'firestore') return { state: 'complete' }
        const scope = sourceScope(event)
        if (!scope || !firestorePipeline) return { state: 'blocked', safeErrorCode: 'source_reference_invalid' }
        const result = await firestorePipeline.process(scope, { origin: 'live', ...(signal ? { signal } : {}) })
        if (result.status === 'owner_changed') return { state: 'blocked', safeErrorCode: 'source_owner_changed' }
        if (!['advanced', 'replayed'].includes(result.status)) throw retryable('source_observation_incomplete')
        return { state: 'complete' }
      }))
    }
    if (ACTION_DISPATCH_TYPES.has(eventType)) {
      phases.push(phase('education-sync-action', async (event) => {
        if (event.source !== 'firestore') return { state: 'complete' }
        if (!educationSyncDispatcher || typeof educationSyncDispatcher.enqueueAction !== 'function') {
          return { state: 'blocked', safeErrorCode: 'education_sync_action_handler_unavailable' }
        }
        let result
        try { result = await educationSyncDispatcher.enqueueAction(event) }
        catch (error) {
          if (PERMANENT_SOURCE_CODES.has(error?.safeCode)) return { state: 'blocked', safeErrorCode: error.safeCode }
          throw error
        }
        if (result?.status === 'blocked') return { state: 'blocked', safeErrorCode: result.safeErrorCode ?? 'education_action_blocked' }
        if (!['accepted', 'duplicate', 'completed'].includes(result?.status)) throw retryable('education_sync_action_unavailable')
        if (result?.nextDueAt) onEducationSyncQueued(result.nextDueAt)
        return { state: 'complete', receipt: { eventId: event.eventId, jobId: result?.jobId,
          artifactId: result?.artifactId, generation: result?.generation } }
      }))
    }
    if (eventType === 'upload.transfer_requested' || eventType === 'upload.bytes_uploaded' || eventType === 'upload.delete_requested'
      || eventType === 'material.upload_requested' || eventType === 'material.bytes_uploaded' || eventType === 'material.read_requested') {
      phases.push(phase('server-action', async (event, context) => {
        const handler = actionHandlers[eventType]
        if (typeof handler !== 'function') return { state: 'blocked', safeErrorCode: 'server_action_handler_unavailable' }
        return handler(event, context)
      }))
    }
    if (eventType === 'material.ready') {
      phases.push(phase('material-ready', async (event, context) => {
        if (typeof actionHandlers['material.ready'] === 'function') return actionHandlers['material.ready'](event, context)
        return { state: 'complete' }
      }))
    }
    if (eventType === 'review.published' || eventType === 'parent.guidance_sent'
      || eventType === 'quiz.requirement_changed' || eventType === 'material.requirement_changed' || eventType === 'parent.decision') {
      phases.push(phase('completed-action-receipt', async () => ({ state: 'complete' })))
    }
    if (MESH_NOTIFICATION_TYPES.has(eventType)) {
      phases.push(phase('telegram-notification', async (event) => {
        if (event.source !== 'mesh') return { state: 'complete' }
        if (!notificationService) return { state: 'blocked', safeErrorCode: 'notification_service_unavailable' }
        const payload = event.payload ?? {}
        const accepted = await notificationService.accept({ ...payload, source: 'mesh', eventType: event.eventType,
          familyId: event.familyId, childId: event.childId,
          scopeKey: payload.scopeKey, sourceEventKey: payload.sourceEventKey, sourceRevision: payload.sourceRevision,
          detectedAt: payload.detectedAt, privacyClass: payload.privacyClass })
        if (accepted?.created && accepted.queued > 0 && accepted.nextDueAt) onDeliveryQueued(accepted.nextDueAt)
        return { state: 'complete' }
      }))
    }
    if (MESH_EDUCATION_SYNC_TYPES.has(eventType)) {
      phases.push(phase('mesh-education-sync', async (event) => {
        if (event.source !== 'mesh') return { state: 'complete' }
        if (!educationSyncDispatcher || typeof educationSyncDispatcher.enqueueMeshChange !== 'function') {
          return { state: 'blocked', safeErrorCode: 'education_sync_mesh_handler_unavailable' }
        }
        // Retain the pre-queue domain identity across migration/replay so an
        // already accepted natural change cannot launch a second workflow.
        const sourceEventId = /^[a-f0-9]{64}$/.test(event.payload?.eventId ?? '') ? event.payload.eventId : event.eventId
        const result = await educationSyncDispatcher.enqueueMeshChange(sourceEventId)
        if (!['accepted', 'duplicate'].includes(result?.status)) throw retryable('education_sync_mesh_unavailable')
        if (result?.nextDueAt) onEducationSyncQueued(result.nextDueAt)
        return { state: 'complete', receipt: { generation: result?.generation, requestId: result?.requestId } }
      }))
    }
    if (eventType === 'upload.confirmed' || eventType === 'quiz.submitted') {
      phases.push(phase('firestore-notification', async (event) => {
        if (event.source !== 'firestore') return { state: 'complete' }
        // The exact source pipeline invokes the existing normalizer and NotificationService.
        return { state: 'complete' }
      }))
    }
  }
  return routes
}

function sourceScope(event) {
  const ref = event.sourceRef
  const path = ref?.documentPath
  if (typeof path !== 'string') return null
  const upload = /^dayUploads\/([^/]+)\/files\/([^/]+)$/.exec(path)
  const review = /^dayProgress\/([^/]+)\/items\/([^/]+)$/.exec(path)
  const quiz = /^assignments\/([^/]+)$/.exec(path)
  if (event.eventType === 'upload.confirmed' && ref.kind === 'upload' && upload
    && (ref.dayToken === undefined || ref.dayToken === upload[1]) && (ref.recordId === undefined || ref.recordId === upload[2])) {
    return { kind: 'upload', familyId: event.familyId, childId: event.childId, dayToken: upload[1], recordId: upload[2] }
  }
  if (event.eventType === 'review.published' && ['review', 'progress'].includes(ref.kind) && review
    && (ref.dayToken === undefined || ref.dayToken === review[1]) && (ref.recordId === undefined || ref.recordId === review[2])) {
    return { kind: 'progress', familyId: event.familyId, childId: event.childId, dayToken: review[1], recordId: review[2] }
  }
  if (['quiz.started', 'quiz.submitted'].includes(event.eventType) && ref.kind === 'quiz' && quiz
    && (ref.quizToken === undefined || ref.quizToken === quiz[1])) {
    return { kind: 'quiz', familyId: event.familyId, childId: event.childId, quizToken: quiz[1] }
  }
  return null
}

function retryable(safeCode) { const error = new Error(safeCode); error.safeCode = safeCode; return error }
