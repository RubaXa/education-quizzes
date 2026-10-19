import { createHash } from 'node:crypto'
import { taskContext } from '../../education-runtime/task-context.mjs'
import { learningRouteIdentity } from '../../../day/learning-route-identity.mjs'

/** @see ../../../docs/services/telegram-bot/adapters/firestore.md#области-данных-для-валидации @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-observation */
export function createFirestoreSourceAdapter(db, { baseBackoffMs = 1_000, maxBackoffMs = 60_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const scopeKey = (scope) => createHash('sha256').update(JSON.stringify(binding(scope))).digest('hex')
  const ownerRef = (scope) => db.doc(`dayOwners/${scope.dayToken}`)
  const getMasked = async (ref, fieldMask) => {
    const [snapshot] = await db.getAll(ref, { fieldMask })
    return snapshot
  }
  const recordRef = (scope) => scope.kind === 'quiz'
    ? db.doc(`assignments/${scope.quizToken}`)
    : scope.kind === 'upload'
      ? db.doc(`dayUploads/${scope.dayToken}/files/${scope.recordId}`)
      : db.doc(`dayProgress/${scope.dayToken}/items/${scope.recordId}`)

  function validDescriptor(scope) {
    return Boolean(scope && validRefId(scope.familyId) && validRefId(scope.childId)
      && (scope.kind === 'quiz' ? validRefId(scope.quizToken) && !scope.dayToken && !scope.recordId
        : ['upload', 'progress'].includes(scope.kind) && validRefId(scope.dayToken) && validRefId(scope.recordId) && !scope.quizToken))
  }

  async function validateScope(scope) {
    if (!validDescriptor(scope)) return false
    const [family, child] = await Promise.all([
      db.doc(`families/${scope.familyId}`).get(),
      db.doc(`families/${scope.familyId}/children/${scope.childId}`).get(),
    ])
    if (!family.exists || !child.exists || family.data()?.active === false || child.data()?.active === false) return false
    if (scope.kind === 'quiz') {
      const snap = await getMasked(recordRef(scope), ['familyId', 'childId'])
      if (!snap.exists) return true
      const assignment = snap.data()
      return assignment.familyId === scope.familyId && assignment.childId === scope.childId
    }
    const snap = await getMasked(ownerRef(scope), ['familyId', 'childId', 'date', 'targetDate'])
    const owner = snap.data()
    return snap.exists && owner.familyId === scope.familyId && owner.childId === scope.childId
      && validDay(owner.date) && (owner.targetDate === undefined || validDay(owner.targetDate))
  }

  async function observe(scope) {
    const key = validDescriptor(scope) ? scopeKey(scope) : null
    const base = { source: 'firestore', scopeKey: key, familyId: scope?.familyId, childId: scope?.childId }
    if (!key) return { ...base, completeness: 'partial', records: [] }
    try {
      if (!await validateScope(scope)) return { ...base, completeness: 'partial', records: [] }
      const child = await getMasked(db.doc(`families/${scope.familyId}/children/${scope.childId}`), ['displayName'])
      if (!child.exists) return { ...base, completeness: 'partial', records: [] }
      const childName = safeLabel(child.data()?.displayName)
      const snap = await getMasked(recordRef(scope), fieldMask(scope.kind))
      if (!snap.exists) return { ...base, completeness: 'complete', observedAt: new Date().toISOString(), records: [] }
      const data = snap.data()
      if (scope.kind === 'quiz' && (data.familyId !== scope.familyId || data.childId !== scope.childId)) return { ...base, completeness: 'partial', records: [] }
      const record = scope.kind === 'upload'
        ? await projectUpload(scope, data, childName)
        : scope.kind === 'progress' ? await projectReview(scope, data, childName) : project(scope, data, childName)
      if (record === INVALID_SOURCE_STATE) return { ...base, completeness: 'partial', records: [] }
      return { ...base, completeness: 'complete', observedAt: new Date().toISOString(), records: record ? [record] : [] }
    } catch {
      return { ...base, completeness: 'partial', records: [] }
    }
  }

  async function inspectUpload(scope) {
    if (!validDescriptor(scope) || scope.kind !== 'upload') return { completeness: 'partial', state: 'invalid_scope' }
    try {
      if (!await validateScope(scope)) return { completeness: 'partial', state: 'owner_unverified' }
      const snapshot = await getMasked(recordRef(scope), fieldMask('upload'))
      if (!snapshot.exists) return { completeness: 'complete', state: 'missing' }
      const data = snapshot.data() ?? {}
      const occurredAt = canonicalTime(data.storage?.syncedAt)
      const stored = data.storage?.provider === 'yandex-disk' && data.storage?.state === 'stored' && occurredAt !== null
      const state = (data.status === 'pending' || data.status === 'reviewed') && stored ? 'confirmed'
        : data.status === 'uploaded' ? 'uploading'
          : ['requested', 'awaiting-upload'].includes(data.status) ? 'awaiting_transfer'
            : data.status === 'pending' ? 'awaiting_storage_confirmation' : 'ignored'
      return { completeness: 'complete', state, ...(occurredAt ? { occurredAt } : {}) }
    } catch { return { completeness: 'partial', state: 'observation_failed' } }
  }

  async function inspectReview(scope) {
    if (!validDescriptor(scope) || scope.kind !== 'progress') return { completeness: 'partial', state: 'invalid_scope', contextState: 'invalid' }
    try {
      if (!await validateScope(scope)) return { completeness: 'partial', state: 'owner_unverified', contextState: 'invalid' }
      const snapshot = await getMasked(recordRef(scope), fieldMask('progress'))
      if (!snapshot.exists) return { completeness: 'complete', state: 'missing', contextState: 'missing', checkedAtPresent: false }
      const data = snapshot.data() ?? {}
      if (data.purpose === 'source-material') return { completeness: 'complete', state: 'ignored', contextState: 'not_applicable', checkedAtPresent: canonicalTime(data.checkedAt) !== null }
      const validStatus = ['verified', 'needs-fix', 'partial', 'cannot-assess'].includes(data.status)
      const resolved = await reviewContext(scope, data)
      return { completeness: resolved.context ? 'complete' : 'partial', state: validStatus ? data.status : 'invalid',
        contextState: resolved.context ? 'exact' : 'missing', contextReason: resolved.reason, checkedAtPresent: canonicalTime(data.checkedAt) !== null }
    } catch { return { completeness: 'partial', state: 'observation_failed', contextState: 'missing' } }
  }

  async function projectUpload(scope, data, childName) {
    const record = project(scope, data, childName)
    if (!record) return null
    const ownerSnapshot = await getMasked(ownerRef(scope), ['familyId', 'childId', 'date', 'targetDate'])
    const owner = ownerSnapshot.data() ?? {}
    if (!ownerSnapshot.exists || owner.familyId !== scope.familyId || owner.childId !== scope.childId || !validDay(owner.date)) return INVALID_SOURCE_STATE
    const pageSnapshot = await getMasked(db.doc(`dayPages/${scope.dayToken}`), ['kind', 'familyId', 'childId', 'date', 'targetDate', 'taskIds', 'subjects', 'viewTokens'])
    if (!pageSnapshot.exists) return INVALID_SOURCE_STATE
    const page = pageSnapshot.data() ?? {}
    if (page.kind !== 'student' || page.familyId !== scope.familyId || page.childId !== scope.childId || page.date !== owner.date
      || !Array.isArray(page.taskIds) || !page.taskIds.includes(data.taskId)
      || !Array.isArray(page.subjects)) return INVALID_SOURCE_STATE
    const task = taskContext({ subjects: page.subjects }, data.taskId)
    const subject = safeLabel(task?.subject)
    const title = safeLabel(task?.title)
    if (!subject || !title) return INVALID_SOURCE_STATE
    const dueDate = page.targetDate ?? owner.targetDate
    if (dueDate !== undefined && !validDay(dueDate)) return INVALID_SOURCE_STATE
    const navigationContext = safeDayNavigationContext(page, scope)
    return {
      ...record,
      workRef: dayTaskWorkRef(scope, data.taskId),
      fields: { ...record.fields, subject, title,
        ...(dueDate ? { occurredLabel: `Задание к ${dueDate}` } : {}) },
      ...(navigationContext ? { navigationContext } : {}),
    }
  }

  async function reviewContext(scope, data) {
    if (typeof data.taskId !== 'string' || !data.taskId) return { context: null, reason: 'task_id_missing' }
    if (data.taskId !== scope.recordId) return { context: null, reason: 'task_id_mismatch' }
    const [ownerSnapshot, pageSnapshot] = await Promise.all([
      getMasked(ownerRef(scope), ['familyId', 'childId', 'date', 'targetDate']),
      getMasked(db.doc(`dayPages/${scope.dayToken}`), ['kind', 'familyId', 'childId', 'date', 'targetDate', 'taskIds', 'subjects']),
    ])
    if (!pageSnapshot.exists) return { context: null, reason: 'page_missing' }
    const owner = ownerSnapshot.data() ?? {}
    const page = pageSnapshot.data() ?? {}
    if (!ownerSnapshot.exists || owner.familyId !== scope.familyId || owner.childId !== scope.childId || !validDay(owner.date)
      || page.familyId !== scope.familyId || page.childId !== scope.childId) return { context: null, reason: 'owner_mismatch' }
    if (page.kind !== 'student') return { context: null, reason: 'page_kind' }
    if (page.date !== owner.date) return { context: null, reason: 'date_mismatch' }
    if (!Array.isArray(page.taskIds) || !page.taskIds.includes(scope.recordId)) return { context: null, reason: 'task_not_in_page' }
    if (!Array.isArray(page.subjects)) return { context: null, reason: 'task_context_missing' }
    const exactTask = taskContext({ subjects: page.subjects }, scope.recordId)
    const subject = safeLabel(exactTask?.subject)
    const title = safeLabel(exactTask?.title)
    const dueDate = page.targetDate ?? owner.targetDate
    if (dueDate !== undefined && !validDay(dueDate)) return { context: null, reason: 'task_context_missing' }
    const resolvedContext = subject && title ? { subject, title, ...(dueDate ? { occurredLabel: `Задание к ${dueDate}` } : {}) } : null
    return resolvedContext ? { context: resolvedContext, reason: 'exact' } : { context: null, reason: 'task_context_missing' }
  }

  async function projectReview(scope, data, childName) {
    if (data.purpose === 'source-material') return null
    if (!['verified', 'needs-fix', 'partial', 'cannot-assess'].includes(data.status)) return null
    const resolved = await reviewContext(scope, data)
    if (!resolved.context) return INVALID_SOURCE_STATE
    const semanticHash = reviewFingerprint(data)
    if (!semanticHash) return INVALID_SOURCE_STATE
    return { recordKey: sourceRecordKey('review', scope.dayToken, scope.recordId), kind: 'review', eventType: 'review.changed', semanticHash,
      workRef: dayTaskWorkRef(scope),
      fields: { ...(childName ? { childName } : {}), ...resolved.context, status: data.status,
        ...(publicDetail(data.summary) ? { summary: publicDetail(data.summary) } : {}),
        ...(publicDetail(data.nextStep) ? { nextStep: publicDetail(data.nextStep) } : {}) } }
  }

  function subscribe({ scopes, onSignal, onError = () => {} } = {}) {
    if (!Array.isArray(scopes) || scopes.some((scope) => !validDescriptor(scope))) throw new Error('invalid_source_scopes')
    if (typeof onSignal !== 'function') throw new Error('source_signal_handler_required')
    const normalized = [...new Map(scopes.map((scope) => [scopeKey(scope), Object.freeze({ ...scope })])).values()]
    let disposed = false, timer = null, delay = baseBackoffMs, unsubs = []
    const stop = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe() } catch { /* best-effort disposal */ } } }
    const signal = (scope) => { if (!disposed) Promise.resolve(onSignal(scope)).catch(() => onError({ code: 'source_signal_handler_failed' })) }
    const fail = () => {
      if (disposed || timer) return
      stop()
      onError({ code: 'source_listener_unavailable' })
      timer = setTimer(() => { timer = null; reconnect(); delay = Math.min(maxBackoffMs, delay * 2) }, delay)
    }
    const reconnect = () => {
      if (disposed) return
      stop()
      try {
        const refsByPath = new Map()
        for (const scope of normalized) {
          const refs = [db.doc(`families/${scope.familyId}`), db.doc(`families/${scope.familyId}/children/${scope.childId}`),
            ...(scope.kind === 'quiz' ? [] : [ownerRef(scope)]), recordRef(scope)]
          for (const ref of refs) {
            const entry = refsByPath.get(ref.path) ?? { ref, scopes: [] }
            entry.scopes.push(scope)
            refsByPath.set(ref.path, entry)
          }
          signal(scope) // Reconcile from authoritative reads after every reconnect.
        }
        for (const { ref, scopes } of refsByPath.values()) unsubs.push(ref.onSnapshot(() => {
          delay = baseBackoffMs
          for (const scope of scopes) signal(scope)
        }, fail))
      } catch { fail() }
    }
    reconnect()
    return async () => { disposed = true; if (timer) clearTimer(timer); timer = null; stop() }
  }

  function subscribeDiscovery({ targets, onCandidate, onInventoryChange = () => {}, onError = () => {}, onReady = () => {} } = {}) {
    if (!Array.isArray(targets) || typeof onCandidate !== 'function') throw new Error('invalid_source_discovery_targets')
    const normalized = [...new Map(targets.map((target) => [JSON.stringify(target), Object.freeze({ ...target })])).values()]
    if (normalized.some((target) => !validDiscoveryTarget(target))) throw new Error('invalid_source_discovery_targets')
    let disposed = false, timer = null, delay = baseBackoffMs, unsubs = [], generation = 0
    const stop = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe() } catch { /* best-effort disposal */ } } }
    const fail = () => {
      if (disposed || timer) return
      generation++
      stop()
      onError({ code: 'source_listener_unavailable' })
      timer = setTimer(() => { timer = null; reconnect(); delay = Math.min(maxBackoffMs, delay * 2) }, delay)
    }
    const reconnect = () => {
      if (disposed) return
      stop()
      const currentGeneration = ++generation
      const pendingReady = new Set(normalized.map((target) => JSON.stringify(target)))
      let readyPublished = false
      try {
        for (const target of normalized) {
          const query = target.kind === 'assignments'
            ? db.collection('assignments').where('familyId', '==', target.familyId)
            : target.kind === 'dayOwners'
              ? db.collection('dayOwners').where('familyId', '==', target.familyId)
              : db.collection(target.kind === 'uploads'
                ? `dayUploads/${target.dayToken}/files` : `dayProgress/${target.dayToken}/items`)
          let initial = true
          unsubs.push(query.onSnapshot((snapshot) => {
            if (disposed || generation !== currentGeneration) return
            delay = baseBackoffMs
            if (initial) {
              pendingReady.delete(JSON.stringify(target))
              if (!pendingReady.size && !readyPublished) {
                readyPublished = true
                onReady({ targetCount: normalized.length })
              }
            }
            const changes = typeof snapshot?.docChanges === 'function'
              ? snapshot.docChanges() : (snapshot?.docs ?? []).map((doc) => ({ type: 'added', doc }))
            for (const change of changes) {
              const data = change.doc?.data?.() ?? {}
              if (target.kind === 'dayOwners') {
                const isKnownOwner = Array.isArray(target.ownerIds) && target.ownerIds.includes(change.doc.id)
                const validOwnerCandidate = data.familyId === target.familyId && validRefId(data.childId) && validDay(data.date)
                if (!initial && (change.type === 'removed' || validOwnerCandidate)
                  || initial && !isKnownOwner && validOwnerCandidate) {
                  Promise.resolve(onInventoryChange(target.familyId)).catch(() => onError({ code: 'source_signal_handler_failed' }))
                }
                continue
              }
              if (change.type === 'removed') continue
              if (target.kind === 'assignments') {
                if (data.familyId !== target.familyId || !validRefId(data.childId)) continue
                Promise.resolve(onCandidate({ familyId: target.familyId, childId: data.childId,
                  kind: 'quiz', quizToken: change.doc.id })).catch(() => onError({ code: 'source_signal_handler_failed' }))
              } else {
                Promise.resolve(onCandidate({ familyId: target.familyId, childId: target.childId,
                  kind: target.kind === 'uploads' ? 'upload' : 'progress', dayToken: target.dayToken,
                  recordId: change.doc.id })).catch(() => onError({ code: 'source_signal_handler_failed' }))
              }
            }
            initial = false
          }, () => { if (!disposed && generation === currentGeneration) fail() }))
        }
        if (!pendingReady.size && !readyPublished) {
          readyPublished = true
          onReady({ targetCount: normalized.length })
        }
      } catch { fail() }
    }
    reconnect()
    return async () => { disposed = true; if (timer) clearTimer(timer); timer = null; stop() }
  }

  return Object.freeze({ kind: 'firestore', scopeKey, validateScope, observe, inspectUpload, inspectReview, subscribe, subscribeDiscovery })
}

function validDiscoveryTarget(target) {
  return Boolean(target && validRefId(target.familyId) && (target.kind === 'assignments'
    ? target.childId === undefined && target.dayToken === undefined
    : target.kind === 'dayOwners' ? target.childId === undefined && target.dayToken === undefined
      && Array.isArray(target.ownerIds) && target.ownerIds.every(validRefId)
    : ['uploads', 'progress'].includes(target.kind) && validRefId(target.childId) && validRefId(target.dayToken)))
}

function safeDayNavigationContext(page, scope) {
  if (page.familyId !== scope.familyId || page.childId !== scope.childId) return null
  const student = page.viewTokens?.student
  const parent = page.viewTokens?.parent
  if (!validRouteToken(student) || !validRouteToken(parent) || student !== scope.dayToken || student === parent) return null
  try {
    const identity = learningRouteIdentity({ student, parent }, { familyId: page.familyId, childId: page.childId })
    return identity.canonicalToken === scope.dayToken ? { kind: 'day', dayToken: identity.canonicalToken } : null
  } catch { return null }
}
function validRouteToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function validRefId(value) {
  // eslint-disable-next-line no-control-regex -- Reject control bytes in Firestore document IDs.
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value)
}

function binding(scope) {
  return { source: 'firestore', familyId: scope.familyId, childId: scope.childId, kind: scope.kind,
    dayToken: scope.dayToken ?? null, recordId: scope.recordId ?? null, quizToken: scope.quizToken ?? null }
}
function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
function sourceRecordKey(kind, scope, id) { return createHash('sha256').update(JSON.stringify([kind, scope, id])).digest('hex') }
function dayTaskWorkRef(scope, taskId = scope?.recordId) {
  if (!scope || !['upload', 'progress'].includes(scope.kind) || !validPathId(scope.familyId) || !validPathId(scope.childId)
    || !validDayToken(scope.dayToken) || !validPathId(taskId)) return null
  return { kind: 'day-task', id: createHash('sha256').update(JSON.stringify(['firestore-day-task-v1', scope.familyId, scope.childId, scope.dayToken, taskId])).digest('hex') }
}
function validPathId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !containsControlBytes(value) }
function containsControlBytes(value) {
  // eslint-disable-next-line no-control-regex -- Firestore document IDs cannot contain control bytes.
  return /[\u0000-\u001f\u007f]/.test(value)
}
function publicDetail(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 50_000) return ''
  // Only learner-facing summary/nextStep fields are projected. Strip link-like and credential-like text before persistence.
  // eslint-disable-next-line no-control-regex -- Remove control bytes from source-controlled public detail.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
    .replace(/\b(?:token|secret|password|answer|key|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').trim().slice(0, 300)
}
function validDayToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function fieldMask(kind) {
  if (kind === 'quiz') return ['familyId', 'childId', 'status', 'startedAt', 'submittedAt', 'title', 'subject']
  if (kind === 'upload') return ['status', 'taskId', 'storage.provider', 'storage.state', 'storage.syncedAt']
  return ['status', 'checkedAt', 'taskId', 'purpose', 'uploadIds', 'summary', 'nextStep']
}
function reviewFingerprint(data) {
  let uploadIds = []
  if (data.uploadIds !== undefined) {
    if (!Array.isArray(data.uploadIds) || data.uploadIds.length > 100
      || data.uploadIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256)) return null
    uploadIds = [...new Set(data.uploadIds.map((id) => createHash('sha256').update(id).digest('hex')))].sort()
  }
  const publicText = (value) => value === undefined || value === null
    ? ''
    : typeof value === 'string' && value.length <= 50_000 ? value.trim() : null
  const summary = publicText(data.summary)
  const nextStep = publicText(data.nextStep)
  if (summary === null || nextStep === null) return null
  return createHash('sha256').update(JSON.stringify({ version: 2, status: data.status, uploadIds, summary, nextStep })).digest('hex')
}
const INVALID_SOURCE_STATE = Symbol('invalid_source_state')
function project(scope, data, childName = '') {
  if (scope.kind === 'upload') {
    const syncedAt = canonicalTime(data.storage?.syncedAt)
    const stored = data.storage?.provider === 'yandex-disk' && data.storage?.state === 'stored' && syncedAt !== null
    if (!(data.status === 'pending' && stored) && !(data.status === 'reviewed' && stored)) return null
    return { recordKey: sourceRecordKey('upload', scope.dayToken, scope.recordId), kind: 'upload', eventType: 'upload.confirmed',
      semanticHash: createHash('sha256').update(JSON.stringify(['confirmed-upload-v1', scope.dayToken, scope.recordId])).digest('hex'),
      occurredAt: syncedAt, fields: { ...(childName ? { childName } : {}), status: 'confirmed' } }
  }
  let phase
  if (data.status === 'submitted') phase = canonicalTime(data.submittedAt) ? 'submitted' : INVALID_SOURCE_STATE
  else if (data.status === 'open' && (data.startedAt === undefined || data.startedAt === null)) phase = 'not_started'
  else if (data.status === 'open') phase = canonicalTime(data.startedAt) ? 'started' : INVALID_SOURCE_STATE
  else phase = INVALID_SOURCE_STATE
  if (phase === INVALID_SOURCE_STATE) return INVALID_SOURCE_STATE
  return { recordKey: sourceRecordKey('quiz', scope.quizToken, scope.quizToken), kind: 'quiz',
    ...(phase === 'submitted' ? { eventType: 'quiz.submitted' } : phase === 'started' ? { eventType: 'quiz.started' } : {}),
    fields: { ...(childName ? { childName } : {}), status: phase, ...(safeLabel(data.title) ? { title: safeLabel(data.title) } : {}), ...(safeLabel(data.subject) ? { subject: safeLabel(data.subject) } : {}) } }
}
// eslint-disable-next-line no-control-regex -- Strip untrusted control bytes from the allowlisted child label.
function safeLabel(value) { return typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 160) : '' }
function canonicalTime(value) {
  if (value === undefined || value === null) return null
  let date
  if (value instanceof Date) date = value
  else if (value && typeof value.toDate === 'function') date = value.toDate()
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) date = new Date(value)
  else return null
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}
