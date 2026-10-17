import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/adapters/mesh.md#контракт-снимка @see ../../../docs/services/telegram-bot/adapters/mesh.md#ошибки-и-восстановление */
/** Pure projection of complete Mesh adapter results; never accepts or returns credentials/raw payloads. */
export function normalizeMeshObservation({ scope, schedule, assignments, marks, childName = '', source = 'mesh', observedAt = new Date().toISOString() }) {
  if (source !== 'mesh' || !validScopeShape(scope) || !validInstant(observedAt)) return null
  if (scope.kind === 'grades' ? !Array.isArray(marks)
    : !Array.isArray(schedule) || (scope.kind === 'homework' && !Array.isArray(assignments))) return null
  const records = []
  if (scope.kind === 'grades') {
    for (const subject of marks) {
      if (!safeDate(subject?.start)) return null
      if (scope.periodKey && subject.start !== scope.periodKey) continue
      if (scope.subjectId !== undefined && String(subject.subject_id) !== String(scope.subjectId)) continue
      if (!subject || !stableId(subject.subject_id) || !Array.isArray(subject.marks)
        || !Number.isInteger(subject.count) || subject.count !== subject.marks.length) return null
      for (const mark of subject.marks) {
        const value = gradeValue(mark?.value)
        if (!stableId(mark?.id) || value === null) return null
        const date = safeDate(mark.date)
        const subjectName = safeText(subject.subject_name, 120)
        const key = digest(['mesh-grade-v1', scope.sourceAccountId, scope.sourcePersonId, scope.childId,
          String(subject.subject_id), String(subject.start), String(mark.id)])
        const semanticHash = digest(['mesh-grade-content-v1', String(value), date, mark.weight ?? null,
          safeText(mark.control_form_name, 160)])
        const partitionKey = digest([String(subject.subject_id), String(subject.start)])
        records.push({ recordKey: key, kind: 'grade', partitionKey, semanticHash, ...(date ? { occurredAt: `${date}T12:00:00.000Z` } : {}),
          fields: { ...(childName ? { childName: safeText(childName, 120) } : {}), ...(subjectName ? { subject: subjectName } : {}), value: String(value), ...(date ? { occurredLabel: date } : {}) } })
      }
    }
  } else if (scope.kind === 'schedule') {
    const lessons = new Map()
    for (const lesson of schedule) {
      if (!stableId(lesson?.id) || !canonicalTime(lesson.start_at) || !canonicalTime(lesson.finish_at)
        || safeDate(lesson.start_at) !== scope.date) return null
      const lessonId = String(lesson.id)
      lessons.set(lessonId, lesson)
      const subject = safeText(lesson.subject_name, 120)
      const title = safeText(`${lesson.subject_name || 'Урок'} · ${moscowTime(lesson.start_at)}–${moscowTime(lesson.finish_at)}`, 160)
      const date = safeDate(lesson.start_at)
      const values = [canonicalTime(lesson.start_at), canonicalTime(lesson.finish_at), lesson.subject_id ?? null,
        subject, lesson.cancelled === true, lesson.replaced === true]
      records.push({ recordKey: digest(['mesh-schedule-v1', scope.sourceAccountId, scope.sourcePersonId, scope.childId, lessonId]),
        kind: 'schedule', ...(lesson.cancelled === true ? { eventType: 'schedule.cancelled' } : {}),
        semanticHash: digest(['mesh-schedule-content-v1', ...values]), ...(date ? { occurredAt: `${date}T12:00:00.000Z` } : {}),
        fields: { ...(childName ? { childName: safeText(childName, 120) } : {}), ...(subject ? { subject } : {}), ...(title ? { title } : {}), ...(date ? { occurredLabel: date } : {}) } })
    }
  } else {
    const lessons = new Map(schedule.map((lesson) => [String(lesson?.id ?? ''), lesson]))
    for (const item of assignments) {
      if (!item || !stableId(item.sourceItemId) || item.detailStatus !== 'loaded' || !Array.isArray(item.homeworkEntries) || !Array.isArray(item.teacherFiles)) return null
      const lesson = lessons.get(String(item.sourceItemId))
      if (!lesson || !canonicalTime(lesson.start_at) || !canonicalTime(lesson.finish_at) || safeDate(lesson.start_at) !== scope.date) return null
      const subject = safeText(item.subjectName || lesson.subject_name, 120)
      const descriptions = (Array.isArray(item.descriptions) ? item.descriptions : []).map(canonicalText).filter(Boolean).sort()
      const entries = item.homeworkEntries.map((entry) => {
        if (!entry || typeof entry.description !== 'string') return null
        const idValue = String(entry.id ?? '')
        const positionalFallback = idValue.startsWith(`${item.sourceItemId}-`) && /^\d+$/.test(idValue.slice(String(item.sourceItemId).length + 1))
        return [positionalFallback || !stableId(entry.id) ? null : idValue, canonicalText(entry.description), safeDate(entry.updatedAt)]
      })
      if (entries.some((entry) => !entry)) return null
      entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      const files = item.teacherFiles.map((file) => file && stableId(file.id) ? [String(file.id), canonicalText(file.title)] : null).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      if (files.includes(null)) return null
      const date = safeDate(item.lessonDate || lesson.start_at)
      if (date !== scope.date) return null
      const body = [...descriptions, ...entries.map((entry) => entry[1])].filter(Boolean).join('; ')
      records.push({ recordKey: digest(['mesh-homework-v1', scope.sourceAccountId, scope.sourcePersonId, scope.childId, String(item.sourceItemId)]),
        kind: 'assignment', semanticHash: digest(['mesh-homework-content-v1', date, descriptions, entries, files]),
        ...(date ? { occurredAt: `${date}T12:00:00.000Z` } : {}),
        fields: { ...(childName ? { childName: safeText(childName, 120) } : {}), ...(subject ? { subject } : {}),
          ...(body ? { title: safeText(body, 500) } : {}), ...(date ? { occurredLabel: date } : {}) } })
    }
  }
  return { source, scopeKey: meshScopeKey(scope), familyId: scope.familyId, childId: scope.childId,
    completeness: 'complete', observedAt: new Date(observedAt).toISOString(), records }
}

export function meshScopeKey(scope) {
  if (!validScopeShape(scope)) return null
  return digest(['mesh-v1', scope.familyId, scope.childId, digest(scope.sourceAccountId), digest(scope.sourcePersonId), scope.kind,
    scope.kind === 'grades' ? [scope.subjectId ?? null, scope.periodKey ?? null] : scope.date])
}

/** @see ../../../docs/services/telegram-bot/adapters/mesh.md#ответственность-и-режим @see ../../../docs/services/telegram-bot/adapters/mesh.md#ошибки-и-восстановление */
export function createMeshSourceAdapter({ resolver, now = () => new Date(), random = Math.random,
  pollMs = 15 * 60_000, jitterMs = 60_000, setTimer = setTimeout, clearTimer = clearTimeout, pollConcurrency = 4, onHealth = () => {}, projectionCache = new Map() } = {}) {
  if (!resolver || typeof resolver.validateScope !== 'function' || typeof resolver.withChildAdapter !== 'function'
    || pollMs < 1_000 || jitterMs < 0 || !Number.isInteger(pollConcurrency) || pollConcurrency < 1) throw new Error('invalid_mesh_source_config')
  async function validateScope(scope) { return Boolean(meshScopeKey(scope) && await resolver.validateScope(scope)) }
  if (!(projectionCache instanceof Map)) throw new Error('invalid_mesh_projection_cache')
  const gradeCache = projectionCache, gradeInflight = new Map()
  async function getGradeProjection(baseScope) {
    const key = meshScopeKey({ ...baseScope, periodKey: undefined, subjectId: undefined })
    const nowMs = now().valueOf()
    for (const [cacheKey, value] of gradeCache) {
      if (value.expiresAt <= nowMs) gradeCache.delete(cacheKey)
    }
    const cached = gradeCache.get(key)
    if (cached && cached.expiresAt > nowMs) return cached
    if (gradeInflight.has(key)) return gradeInflight.get(key)
    const task = (async () => {
      if (!await validateScope(baseScope)) throw sourceError('scope_unavailable')
      const result = await resolver.withChildAdapter(baseScope, async (adapter, context = {}) => ({
        marks: await adapter.getMarks(), childName: context.childName ?? '',
      }))
      const { marks, childName } = result ?? {}
      const normalized = normalizeMeshObservation({ scope: { ...baseScope, periodKey: undefined, subjectId: undefined }, marks, childName, observedAt: now().toISOString() })
      if (!normalized) throw sourceError('mesh_incomplete')
      const scopes = [...new Map(marks.map((subject) => [`${subject.subject_id}:${subject.start}`, {
        ...baseScope, subjectId: String(subject.subject_id), periodKey: subject.start,
      }])).values()].sort((a, b) => `${a.subjectId}/${a.periodKey}`.localeCompare(`${b.subjectId}/${b.periodKey}`))
      const value = { scopes, records: normalized.records, expiresAt: now().valueOf() + 60_000 }
      gradeCache.set(key, value)
      return value
    })()
    gradeInflight.set(key, task)
    try { return await task } finally { if (gradeInflight.get(key) === task) gradeInflight.delete(key) }
  }
  async function discoverGradeScopes(baseScope) {
    if (!validScopeShape(baseScope) || baseScope.kind !== 'grades' || baseScope.periodKey !== undefined) throw new Error('invalid_mesh_grade_scope')
    const key = meshScopeKey(baseScope)
    try {
      const result = await getGradeProjection(baseScope)
      return result.scopes.map((scope) => ({ ...scope }))
    } catch (error) {
      const code = safeErrorCode(error?.code)
      try { onHealth({ source: 'mesh', scopeKey: key, code }) } catch { /* health reporting must not hide source failure */ }
      throw sourceError(code)
    }
  }
  async function observe(scope) {
    const scopeKey = meshScopeKey(scope)
    const base = { source: 'mesh', scopeKey, familyId: scope?.familyId, childId: scope?.childId }
    if (!scopeKey || (scope?.kind === 'grades' && (!scope.periodKey || !scope.subjectId))) return { ...base, completeness: 'partial', errorCode: 'invalid_scope', records: [] }
    try {
      if (!await validateScope(scope)) return { ...base, completeness: 'partial', records: [] }
      if (scope.kind === 'grades') {
        const projection = await getGradeProjection({ ...scope, periodKey: undefined, subjectId: undefined })
        if (!await validateScope(scope)) return { ...base, completeness: 'partial', records: [] }
        const partitionKey = digest([String(scope.subjectId), String(scope.periodKey)])
        return { ...base, completeness: 'complete', observedAt: now().toISOString(),
          records: projection.records.filter((record) => record.partitionKey === partitionKey) }
      }
      const projected = await resolver.withChildAdapter(scope, async (adapter, context = {}) => {
        const childName = context.childName ?? ''
        const schedule = await adapter.getSchedule(scope.date)
        if (!Array.isArray(schedule)) return null
        if (scope.kind === 'schedule') return normalizeMeshObservation({ scope, schedule, childName, observedAt: now().toISOString() })
        const assignments = await adapter.getAssignments(scope.date)
        if (!Array.isArray(assignments)) return null
        return normalizeMeshObservation({ scope, schedule, assignments, childName, observedAt: now().toISOString() })
      })
      if (!projected || !await validateScope(scope)) return { ...base, completeness: 'partial', records: [] }
      return projected
    } catch (error) {
      const code = safeErrorCode(error?.code)
      try { onHealth({ source: 'mesh', scopeKey, code }) } catch { /* health reporting must not hide source failure */ }
      return { ...base, completeness: 'partial', errorCode: code, records: [] }
    }
  }
  function subscribe({ scopes, onSignal, onError = () => {} } = {}) {
    if (!Array.isArray(scopes) || scopes.some((scope) => !meshScopeKey(scope)) || typeof onSignal !== 'function') throw new Error('invalid_mesh_source_scopes')
    const normalized = [...new Map(scopes.map((scope) => [meshScopeKey(scope), Object.freeze({ ...scope })])).values()]
    let stopped = false, timer = null, active = null
    const notifyError = (code) => { try { onError({ code }) } catch { /* errors must not escape timer */ } }
    const schedule = () => {
      if (stopped) return
      const jitter = jitterMs ? Math.floor(Math.max(0, Math.min(0.999999, random())) * jitterMs) : 0
      timer = setTimer(() => { timer = null; active = poll().finally(schedule) }, pollMs + jitter)
    }
    const poll = async () => {
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(pollConcurrency, normalized.length) }, async () => {
        while (!stopped && cursor < normalized.length) {
          const scope = normalized[cursor++]
          try {
            if (!await validateScope(scope)) { notifyError('mesh_scope_unavailable'); continue }
            await onSignal(scope)
          } catch { notifyError('mesh_poll_failed') }
        }
      }))
    }
    schedule()
    return async () => {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
      if (active) await active.catch(() => {})
    }
  }
  return Object.freeze({ kind: 'mesh', scopeKey: meshScopeKey, validateScope, observe, subscribe, discoverGradeScopes })
}

function validScopeShape(scope) {
  return scope?.source === 'mesh' && id(scope.familyId) && id(scope.childId) && id(scope.sourceAccountId)
    && id(scope.sourcePersonId) && (scope.kind === 'grades' ? (scope.periodKey === undefined && scope.subjectId === undefined)
      || (/^\d{4}-\d{2}-\d{2}$/.test(scope.periodKey ?? '') && id(String(scope.subjectId ?? '')))
      : ['schedule', 'homework'].includes(scope.kind) && /^\d{4}-\d{2}-\d{2}$/.test(scope.date ?? ''))
}
function canonicalText(value) {
  if (typeof value !== 'string') return ''
  // Intentionally strips control bytes from user-visible source text.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+/gi, '').trim()
}
function safeText(value, max) { return canonicalText(value).slice(0, max) }
function safeDate(value) { const date = typeof value === 'string' ? value.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null }
function canonicalTime(value) { const parsed = value == null ? null : new Date(value); return parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : null }
function moscowTime(value) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) }
function validInstant(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
function stableId(value) { return (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) || (Number.isSafeInteger(value) && value >= 0) }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function gradeValue(value) { const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN; return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null }
function digest(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex') }
function safeErrorCode(value) { return ['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable', 'mesh_incomplete', 'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid', 'credential_refresh_persist_failed'].includes(value) ? value : 'mesh_unavailable' }
function sourceError(code) { const error = new Error(code); error.code = code; return error }
