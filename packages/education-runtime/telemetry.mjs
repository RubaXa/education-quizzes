/** Shared, dependency-free telemetry primitives for server and operator runtimes.
 * @see ../../docs/shared/server-runtime.md#телеметрия
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

const ID_RE = /^[a-f0-9]{32}$/i
const HASH_RE = /^(?:sha256:)?[a-f0-9]{32,64}$/i
const NAME_RE = /^[a-z][A-Za-z0-9_.:-]{0,95}$/
const ALLOWED_TEXT = new Set(['operation', 'stage', 'consumer', 'source', 'outcome', 'status', 'errorCode', 'reasonCode', 'method'])
const ALLOWED_HASH = /(?:Hash|Fingerprint)$/
const ALLOWED_NUMBER = new Set(['attempt', 'page', 'durationMs', 'waitMs', 'documents', 'requests', 'bytes', 'size', 'parallelism'])
const ALLOWED_BOOL = new Set(['cacheHit', 'complete', 'reused'])

const safeName = (value) => typeof value === 'string' && NAME_RE.test(value) ? value : undefined
const safeAttributes = (attributes = {}) => {
  const output = {}
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return output
  for (const [key, value] of Object.entries(attributes).slice(0, 32)) {
    if (ALLOWED_TEXT.has(key)) {
      const normalized = safeName(value)
      if (normalized) output[key] = normalized
    } else if (ALLOWED_HASH.test(key) && typeof value === 'string' && HASH_RE.test(value)) {
      output[key] = value.toLowerCase()
    } else if (['eventId', 'jobId'].includes(key) && typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)) {
      output[key] = value.toLowerCase()
    } else if (ALLOWED_NUMBER.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      output[key] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, value))
    } else if (ALLOWED_BOOL.has(key) && typeof value === 'boolean') output[key] = value
  }
  return output
}

function validContext(context) {
  if (!context || !ID_RE.test(context.traceId || '') || !ID_RE.test(context.spanId || '')) return null
  return { traceId: context.traceId.toLowerCase(), spanId: context.spanId.toLowerCase() }
}

/** Create a telemetry port. Sink exceptions are contained and counted. */
export function createTelemetry({ sink = null, traceId = null, parentSpanId = null, maxSpans = 10000 } = {}) {
  const storage = new AsyncLocalStorage()
  const configuredTraceId = ID_RE.test(traceId || '') ? traceId.toLowerCase() : null
  const rootTraceId = configuredTraceId || randomUUID().replaceAll('-', '')
  const rootParentSpanId = ID_RE.test(parentSpanId || '') ? parentSpanId.toLowerCase() : null
  const counters = Object.create(null)
  const spans = []
  const wallSamples = []
  const activeWall = new Map()
  let totalSpans = 0
  let wallTraceCount = 0
  let totalWallMs = 0
  let tracesStarted = configuredTraceId ? 1 : 0
  let lastTraceId = configuredTraceId || rootTraceId
  let exporterErrors = 0
  const noteExporterError = () => {
    exporterErrors++
    counters['telemetry.exporter.errors'] = (counters['telemetry.exporter.errors'] || 0) + 1
  }

  const emit = (event) => {
    if (!sink) return
    try {
      const result = typeof sink === 'function' ? sink(event) : sink.write?.(event)
      if (result && typeof result.then === 'function') result.catch(noteExporterError)
    } catch { noteExporterError() }
  }

  const count = (name, n = 1, attributes = {}) => {
    const key = safeName(name)
    if (!key || typeof n !== 'number' || !Number.isFinite(n) || n < 0) return
    counters[key] = (counters[key] || 0) + n
    emit({ kind: 'counter', traceId: storage.getStore()?.traceId || rootTraceId,
      name: key, value: n, attributes: safeAttributes(attributes) })
  }

  const makeSpan = (operation, work, attributes = {}, traceOverride = null, parentOverride = undefined, recordWall = false) => {
    if (typeof work !== 'function') throw new TypeError('span requires a work function')
    const op = safeName(operation) || 'operation.unknown'
    const parent = storage.getStore()
    const spanId = randomUUID().replaceAll('-', '')
    const context = { traceId: parent?.traceId || traceOverride || rootTraceId, spanId,
      parentSpanId: parent?.spanId || (parentOverride === undefined ? rootParentSpanId : parentOverride),
      rootSpanId: parent?.rootSpanId || (recordWall ? spanId : null) }
    const started = performance.now()
    if (recordWall) activeWall.set(spanId, { started, operation: op })
    const base = { kind: 'span', ...context, operation: op, attributes: safeAttributes(attributes) }
    const finish = (outcome) => {
      const durationMs = Math.max(0, performance.now() - started)
      const event = { ...base, outcome, durationMs }
      totalSpans++
      if (spans.length < maxSpans) spans.push(event)
      else counters['telemetry.spans.dropped'] = (counters['telemetry.spans.dropped'] || 0) + 1
      if (recordWall) {
        wallTraceCount++
        totalWallMs += durationMs
        activeWall.delete(spanId)
        if (wallSamples.length < maxSpans) wallSamples.push(durationMs)
      }
      emit(event)
    }
    return storage.run(context, () => {
      let result
      try { result = work() } catch (error) { finish('error'); throw error }
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then((value) => { finish('ok'); return value }, (error) => { finish('error'); throw error })
      }
      finish('ok')
      return result
    })
  }

  const span = (operation, work, attributes = {}) => makeSpan(operation, work, attributes)
  const trace = (operation, work, attributes = {}) => {
    if (storage.getStore()) return makeSpan(operation, work, attributes)
    if (configuredTraceId) return makeSpan(operation, work, attributes, null, undefined, true)
    const id = randomUUID().replaceAll('-', '')
    tracesStarted++
    lastTraceId = id
    return makeSpan(operation, work, attributes, id, null, true)
  }

  const current = () => {
    const context = storage.getStore()
    return context ? { traceId: context.traceId, spanId: context.spanId, parentSpanId: context.parentSpanId || null }
      : { traceId: rootTraceId, spanId: null, parentSpanId: rootParentSpanId }
  }

  const snapshot = () => {
    const active = storage.getStore()?.rootSpanId ? activeWall.get(storage.getStore().rootSpanId) : null
    const activeDuration = active ? Math.max(0, performance.now() - active.started) : 0
    const wallValues = active ? [...wallSamples, activeDuration] : wallSamples
    return { traceId: storage.getStore()?.traceId || lastTraceId || rootTraceId,
    traceCount: tracesStarted, counters: { ...counters }, exporterErrors,
    spans: summarizeSpans(spans), spanCount: totalSpans, bufferedSpanCount: spans.length,
    droppedSpans: Math.max(0, totalSpans - spans.length),
    wall: { ...summarizeDurations(wallValues), count: wallTraceCount + (active ? 1 : 0),
      totalMs: totalWallMs + activeDuration, active: Boolean(active),
      droppedSamples: Math.max(0, wallTraceCount - wallSamples.length) } }
  }

  return { span, trace, count, current, snapshot,
    withContext(context, work) {
      const valid = validContext(context)
      if (!valid || typeof work !== 'function') return typeof work === 'function' ? work() : undefined
      return storage.run({ ...valid, parentSpanId: context.parentSpanId && ID_RE.test(context.parentSpanId)
        ? context.parentSpanId.toLowerCase() : null }, work)
    },
    serializeContext() { return JSON.stringify(current()) },
  }
}

/** Initialize telemetry using validated operator-to-child trace context. */
export function createTelemetryFromEnvironment(options = {}) {
  const context = parseTraceContext(process.env.EDUCATION_TRACE_CONTEXT)
  return createTelemetry({ ...options, traceId: options.traceId ?? context?.traceId,
    parentSpanId: options.parentSpanId ?? context?.spanId })
}

/** Safe aggregate: no event attributes or payloads are exported. */
export function summarizeSpans(spans = []) {
  const byOperation = Object.create(null)
  for (const span of spans) {
    if (span?.kind !== 'span' || !safeName(span.operation) || !Number.isFinite(span.durationMs)) continue
    const group = byOperation[span.operation] ||= []
    group.push(span.durationMs)
  }
  return Object.fromEntries(Object.entries(byOperation).map(([operation, values]) => {
    values.sort((a, b) => a - b)
    const percentile = (p) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0
    return [operation, { count: values.length, totalMs: values.reduce((sum, n) => sum + n, 0),
      p50Ms: percentile(.5), p95Ms: percentile(.95) }]
  }))
}

function summarizeDurations(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0
  return { p50Ms: percentile(.5), p95Ms: percentile(.95) }
}

/** Local JSONL exporter with size-based rotation and private file permissions. */
export function createRotatingJsonlSink(path, { maxBytes = 5 * 1024 * 1024, maxFiles = 3 } = {}) {
  const target = resolve(path)
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new TypeError('maxBytes must be at least 1024')
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20) throw new TypeError('maxFiles must be between 1 and 20')
  return {
    write(event) {
      const line = `${JSON.stringify(safeExportEvent(event))}\n`
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      const currentBytes = existsSync(target) ? statSync(target).size : 0
      if (currentBytes + Buffer.byteLength(line) > maxBytes) {
        for (let index = maxFiles - 1; index >= 1; index--) {
          const from = `${target}.${index}`
          const to = `${target}.${index + 1}`
          if (existsSync(from)) { renameSync(from, to); chmodSync(to, 0o600) }
        }
        if (existsSync(target)) { renameSync(target, `${target}.1`); chmodSync(`${target}.1`, 0o600) }
      }
      // appendFileSync's mode applies to creation; chmod also tightens pre-existing files.
      appendFileSync(target, line, { mode: 0o600 })
      chmodSync(target, 0o600)
      chmodSync(dirname(target), 0o700)
    },
  }
}

function safeExportEvent(event) {
  if (event?.kind === 'counter') {
    if (!safeName(event.name) || !Number.isFinite(event.value)) return { kind: 'counter', name: 'telemetry.invalid-event', value: 0 }
    return { kind: 'counter', ...(ID_RE.test(event.traceId || '') ? { traceId: event.traceId.toLowerCase() } : {}),
      name: safeName(event.name), value: event.value, attributes: safeAttributes(event.attributes) }
  }
  if (event?.kind === 'span') {
    const safe = { kind: 'span', ...(ID_RE.test(event.traceId || '') ? { traceId: event.traceId.toLowerCase() } : {}),
      ...(ID_RE.test(event.spanId || '') ? { spanId: event.spanId.toLowerCase() } : {}),
      ...(ID_RE.test(event.parentSpanId || '') ? { parentSpanId: event.parentSpanId.toLowerCase() } : {}),
      operation: safeName(event.operation) || 'operation.unknown',
      outcome: event.outcome === 'error' ? 'error' : 'ok',
      durationMs: Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : 0,
      attributes: safeAttributes(event.attributes) }
    return safe
  }
  return { kind: 'counter', name: 'telemetry.invalid-event', value: 1 }
}

/** Trace context for subprocess environment propagation; malformed input is ignored. */
export function parseTraceContext(value) {
  try { return validContext(JSON.parse(value)) } catch { return null }
}
