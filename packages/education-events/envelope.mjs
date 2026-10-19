/** Portable identity helpers for the shared educationEvents queue. @see ../../docs/modules/synchronization/event-queue.md#конверт-и-идентичность */

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500

export function canonicalEducationEventSourceRef(sourceRef) {
  const allowedKeys = new Set(['kind', 'documentPath', 'dayToken', 'recordId', 'quizToken', 'taskId'])
  const kinds = new Set(['help', 'quiz', 'guidance', 'parent-decision', 'upload', 'material', 'review', 'mesh'])
  if (!sourceRef || typeof sourceRef !== 'object' || Array.isArray(sourceRef)
    || Object.keys(sourceRef).some((key) => !allowedKeys.has(key))
    || !validId(sourceRef.kind) || !kinds.has(sourceRef.kind) || !validId(sourceRef.documentPath)
    || Object.entries(sourceRef).some(([key, value]) => key !== 'kind' && key !== 'documentPath' && !validId(value))) {
    throw new TypeError('Invalid education event source reference.')
  }
  const parts = sourceRef.documentPath.split('/')
  const matches = {
    help: parts.length === 4 && parts[0] === 'dayHelp' && parts[2] === 'items'
      && sourceRef.dayToken === parts[1] && sourceRef.taskId === parts[3],
    quiz: parts.length === 2 && parts[0] === 'assignments' && sourceRef.quizToken === parts[1],
    guidance: parts.length === 4 && parts[0] === 'dayGuidance' && parts[2] === 'items'
      && sourceRef.dayToken === parts[1] && Boolean(sourceRef.taskId),
    'parent-decision': parts.length === 4 && parts[0] === 'dayParentDecisions' && parts[2] === 'events'
      && sourceRef.dayToken === parts[1] && Boolean(sourceRef.taskId),
    upload: parts.length === 4 && parts[0] === 'dayUploads' && parts[2] === 'files'
      && sourceRef.dayToken === parts[1] && sourceRef.recordId === parts[3] && Boolean(sourceRef.taskId),
    material: parts.length === 6 && parts[0] === 'families' && parts[2] === 'children'
      && ['bookUploads', 'bookRequirements'].includes(parts[4]) && sourceRef.recordId === parts[5],
    review: parts.length === 4 && parts[0] === 'dayProgress' && parts[2] === 'items'
      && sourceRef.dayToken === parts[1] && sourceRef.taskId === parts[3],
    mesh: parts.length === 3 && parts[0] === 'meshEvents' && /^[a-f0-9]{64}$/.test(parts[1]) && /^[a-f0-9]{64}$/.test(parts[2]),
  }[sourceRef.kind]
  if (!matches || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Education event source reference does not match its kind.')
  }
  return Object.fromEntries(Object.keys(sourceRef).sort().map((key) => [key, sourceRef[key]]))
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Stable queue document ID for one source action/revision. The operationId is
 * part of the digest, so later actions against the same source can enqueue
 * independently while retries of one action converge on the same document.
 * @param {{eventType:string,familyId:string,childId:string,source:'firestore'|'mesh',sourceRef:object,operationId:string}} input
 */
export async function createEducationEventId(input) {
  if (!input || !validId(input.eventType) || !validId(input.familyId) || !validId(input.childId)
    || !['firestore', 'mesh'].includes(input.source) || !validId(input.operationId)
    || !input.sourceRef || typeof input.sourceRef !== 'object' || Array.isArray(input.sourceRef)
    || !validId(input.sourceRef.kind) || !validId(input.sourceRef.documentPath)) {
    throw new TypeError('Invalid education event identity.')
  }
  const bytes = new TextEncoder().encode(canonical({
    eventType: input.eventType,
    familyId: input.familyId,
    childId: input.childId,
    source: input.source,
    sourceRef: canonicalEducationEventSourceRef(input.sourceRef),
    operationId: input.operationId,
  }))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compose the common Firestore envelope. Timestamp values come from the adapter. */
export async function createEducationEvent(input, timestamp) {
  if (!timestamp) throw new TypeError('A server timestamp sentinel is required.')
  const actor = input?.actor
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)
    || (actor.type === 'user'
      ? Object.keys(actor).some((key) => !['type', 'uid'].includes(key)) || !validId(actor.uid)
      : actor.type === 'system'
        ? Object.keys(actor).some((key) => !['type', 'id'].includes(key)) || !validId(actor.id)
        : true)) throw new TypeError('Invalid education event actor.')
  const eventId = await createEducationEventId(input)
  return {
    schemaVersion: 1,
    eventId,
    eventType: input.eventType,
    familyId: input.familyId,
    childId: input.childId,
    source: input.source,
    sourceRef: canonicalEducationEventSourceRef(input.sourceRef),
    operationId: input.operationId,
    actor,
    createdAt: timestamp,
    state: 'pending',
    availableAt: timestamp,
    attempts: 0,
  }
}
