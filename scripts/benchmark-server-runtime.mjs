#!/usr/bin/env node
/** Synthetic capacity benchmark over the real shared graph, coordinator, pipeline and memory outbox.
 * @see ../docs/shared/server-runtime.md#проверка-и-эксплуатация
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createFamilyGraphRepository } from '../packages/education-runtime/family-graph.mjs'
import { createTelemetry } from '../packages/education-runtime/telemetry.mjs'
import { SourceCoordinator } from '../packages/telegram-notifications/adapters/source-coordinator.mjs'
import { createMemoryStore } from '../packages/telegram-notifications/adapters/memory.mjs'
import { SourcePipeline } from '../packages/telegram-notifications/application/source-pipeline.mjs'
import { NotificationService } from '../packages/telegram-notifications/application/notifications.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const nowIso = () => new Date().toISOString()

export async function runServerRuntimeBenchmark({ familyCounts = [1, 100, 1000], concurrency = 8,
  childrenPerFamily = 2, scopesPerChild = 1,
  densityScenarios = [{ families: 50, scopesPerChild: 85 }],
  injectTransientError = true, duplicateSignals = 2 } = {}) {
  validateCounts(familyCounts)
  if (![concurrency, childrenPerFamily, scopesPerChild, duplicateSignals].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('concurrency, childrenPerFamily, scopesPerChild, and duplicateSignals must be positive safe integers')
  }
  if (!Array.isArray(densityScenarios) || densityScenarios.some(({ families, scopesPerChild: density }) =>
    !Number.isSafeInteger(families) || families < 1 || !Number.isSafeInteger(density) || density < 1)) {
    throw new TypeError('densityScenarios must contain positive safe integer families and scopesPerChild values')
  }
  const scenarios = []
  for (const families of familyCounts) scenarios.push(await runScenario({ families, concurrency, childrenPerFamily,
    scopesPerChild, injectTransientError, duplicateSignals, scenarioType: 'family_scale' }))
  for (const density of densityScenarios) scenarios.push(await runScenario({ ...density, concurrency,
    childrenPerFamily, injectTransientError, duplicateSignals, scenarioType: 'scope_density' }))
  return { schemaVersion: 1, benchmark: 'education.server-runtime.synthetic', generatedAt: nowIso(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    configuration: { familyCounts, childrenPerFamily, scopesPerChild, densityScenarios, concurrency,
      duplicateSignals, injectTransientError },
    source: sourceFingerprint(),
    measurementNotes: { billing: 'not_measured', firestore: 'in_memory_firestore_double_sdk_operation_counts',
      telegram: 'memory_outbox_only_no_network_delivery', network: 'no_real_sdk_or_network', quota: 'not_measured',
      scopeUnit: 'one synthetic mesh child-scope processed by the shared coordinator and pipeline', caps: 'none' }, scenarios }
}

async function runScenario({ families, concurrency, childrenPerFamily, scopesPerChild, injectTransientError, duplicateSignals, scenarioType }) {
  const startedAt = performance.now()
  const initialHeap = process.memoryUsage()
  const peak = { heapUsed: initialHeap.heapUsed, rss: initialHeap.rss }
  const telemetry = createTelemetry({ maxSpans: 10_000 })
  const db = createFakeFirestore(families, childrenPerFamily)
  const repo = createFamilyGraphRepository(db, { pageSize: 200, telemetry })
  const graphStarted = performance.now()
  const graph = await telemetry.span('benchmark.family-graph', () => repo.enumerate())
  const familyGraphMs = performance.now() - graphStarted
  if (!graph.complete) throw new Error('synthetic_family_graph_incomplete')
  const scopes = graph.families.flatMap((family) => graph.children.filter((child) => child.familyId === family.id)
    .flatMap((child) => Array.from({ length: scopesPerChild }, (_, scopeIndex) => ({
      source: 'mesh', familyId: family.id, childId: child.id,
      kind: scopeKind(scopeIndex),
      scopeHash: sha(`${family.id}:${child.id}:${scopeIndex}`),
    }))))
  const sourceStats = { observeCalls: 0, transientErrors: 0, updatedScopes: new Set(), completedAtByScope: new Map(),
    acceptedEvents: 0, duplicateEvents: 0, acceptedByKind: Object.create(null) }
  const failScope = injectTransientError && scopes.length ? scopes[0].scopeHash : null
  const source = {
    kind: 'mesh',
    scopeKey: (scope) => scope.scopeHash,
    validateScope: async (scope) => scopes.some((candidate) => candidate.scopeHash === scope.scopeHash),
    subscribe({ scopes: subscribed, onSignal, onError }) {
      sourceStats.subscriber = { onSignal, onError, scopes: subscribed }
      return async () => { if (sourceStats.subscriber?.onSignal === onSignal) sourceStats.subscriber = null }
    },
    async observe(scope) {
      sourceStats.observeCalls++
      if (scope.scopeHash === failScope && sourceStats.transientErrors === 0) {
        sourceStats.transientErrors++
        const error = new Error('synthetic_transport_unavailable')
        error.safeCode = 'network_unavailable'
        throw error
      }
      const value = sourceStats.updatedScopes.has(scope.scopeHash) ? '4' : '5'
      const kind = scope.kind
      const eventType = kind === 'grade' ? 'grade.changed' : kind === 'schedule' ? 'schedule.changed' : 'homework.changed'
      const fields = kind === 'grade'
        ? { childName: 'Ученик А', subject: 'Математика', value, occurredLabel: 'Сегодня' }
        : { childName: 'Ученик А', subject: 'Математика',
          title: `${kind === 'schedule' ? 'Synthetic schedule' : 'Synthetic homework'} ${value}`, occurredLabel: 'Сегодня' }
      return { source: 'mesh', scopeKey: scope.scopeHash, familyId: scope.familyId, childId: scope.childId,
        completeness: 'complete', records: [{ recordKey: sha(`${scope.scopeHash}:${kind}`), kind, eventType, fields }] }
    },
  }
  const checkpoint = createMemoryCheckpoints()
  const memory = createMemoryStore()
  const outboxOperations = countOperations(memory.outbox)
  const notificationService = new NotificationService({
    eventLedger: memory.eventLedger,
    outbox: outboxOperations.port,
    recipients: { async resolveVerified(event) { return [{ type: 'family-link', linkId: 'synthetic-link',
      familyId: event.familyId, personId: `parent_${event.familyId}`, childId: event.childId, telegramUserId: '1234567' }] } },
    membership: { async isActiveMember() { return true } },
    renderer: () => ['Изменение в синтетическом учебном источнике'],
    delivery: { async send() { return { messageId: 1 } } },
    clock: () => new Date(), workerId: 'synthetic-worker', recoveryIntervalMs: Number.MAX_SAFE_INTEGER,
  })
  const pipeline = new SourcePipeline({ source, checkpoints: checkpoint, mode: 'notify', workerId: 'synthetic-worker',
    leaseMs: 60000, accept: async (event) => {
      const result = await notificationService.accept(event)
      if (result.created) sourceStats.acceptedEvents++
      else sourceStats.duplicateEvents++
      if (result.created) sourceStats.acceptedByKind[event.eventType] = (sourceStats.acceptedByKind[event.eventType] || 0) + 1
      return result
    } })
  const pipelineDurations = []
  const processPipeline = pipeline.process.bind(pipeline)
  pipeline.process = (scope, options) => telemetry.span('benchmark.source-pipeline.process', async () => {
    const begin = performance.now()
    try { return await processPipeline(scope, options) }
    finally {
      const duration = performance.now() - begin
      pipelineDurations.push(duration)
      sourceStats.completedAtByScope.set(scope.scopeHash, performance.now())
      peakMemory(peak)
    }
  }, { source: 'mesh', scopeHash: scope.scopeHash })

  const coordinator = new SourceCoordinator({ sources: [source], pipelines: { mesh: pipeline },
    enumerate: async () => ({ complete: true,
      families: graph.families.map(({ id }) => ({ familyId: id })),
    scopes: scopes.map((scope) => ({ source: 'mesh', scope, origin: 'bootstrap' })) }),
    concurrency, reconcileMs: 1_000_000, random: () => 0 })
  const coordinatorStarted = performance.now()
  await telemetry.span('benchmark.coordinator.start', () => coordinator.start(), { source: 'mesh' })
  await waitFor(() => allSequencesAtLeast(checkpoint.rows, scopes, 1) && coordinator.active === 0 && coordinator.pending.size === 0)
  const initialWaveMs = performance.now() - coordinatorStarted
  const updateStarted = performance.now()
  let acceptedSignals = 0
  for (const scope of scopes) {
    sourceStats.updatedScopes.add(scope.scopeHash)
    for (let i = 0; i < duplicateSignals; i++) if (coordinator.signal('mesh', scope, { origin: 'live' })) acceptedSignals++
  }
  await waitFor(() => allSequencesAtLeast(checkpoint.rows, scopes, 2) && coordinator.active === 0 && coordinator.pending.size === 0)
  const updateWaveMs = performance.now() - updateStarted
  const notificationStarted = performance.now()
  let delivered = 0
  while (await notificationService.runOne()) delivered++
  const notificationDrainMs = performance.now() - notificationStarted
  await coordinator.close()
  const finalMemory = process.memoryUsage()
  peakMemory(peak)
  const scopeMs = [...pipelineDurations].sort((a, b) => a - b)
  const percentile = (p) => scopeMs[Math.max(0, Math.ceil(scopeMs.length * p) - 1)] ?? 0
  const completed = [...sourceStats.completedAtByScope.values()]
  const firstCompleted = completed.length ? Math.min(...completed) : 0
  const lastCompleted = completed.length ? Math.max(...completed) : 0
  const updatedScopes = scopes.filter((scope) => checkpoint.rows.get(`${scope.scopeHash}:notify`)?.sequence >= 2).length
  const uniqueEventIds = new Set([...memory.events.values()].map((event) => event.eventId)).size
  const undeliveredJobs = [...memory.jobs.values()].filter((job) => job.state !== 'sent').length
  const fullCoverage = scopes.length > 0 && updatedScopes === scopes.length
  const exactlyOnce = memory.events.size === scopes.length && uniqueEventIds === scopes.length
    && sourceStats.acceptedEvents === scopes.length && sourceStats.duplicateEvents === 0
  const queueDrained = delivered === scopes.length && undeliveredJobs === 0
  if (!fullCoverage || !exactlyOnce || !queueDrained || acceptedSignals !== scopes.length * duplicateSignals) {
    throw new Error('synthetic_benchmark_assertion_failed')
  }
  const summary = telemetry.snapshot()
  const expectedKinds = expectedScopeKinds(scopesPerChild, graph.children.length)
  const allKindsCovered = Object.entries(expectedKinds).every(([kind, count]) => sourceStats.acceptedByKind[kind] === count)
  if (!allKindsCovered) throw new Error('synthetic_benchmark_scope_kind_coverage_failed')
  return {
    scenarioType, families, childrenPerFamily, scopesPerChild, children: graph.children.length, scopes: scopes.length,
    scopeUnits: scopes.length, concurrency,
    duplicateSignalsPerScope: duplicateSignals, duplicateSignalsAccepted: acceptedSignals,
    transientSourceErrors: sourceStats.transientErrors,
    completed: fullCoverage && exactlyOnce && queueDrained,
    assertions: { allScopesUpdated: fullCoverage, outboxExactlyOnce: exactlyOnce, outboxDrained: queueDrained,
      allScopeKindsCovered: allKindsCovered },
    durations: { elapsedMs: performance.now() - startedAt, familyGraphMs, initialWaveMs, updateWaveMs,
      notificationDrainMs, pipeline: { count: scopeMs.length, totalMs: scopeMs.reduce((sum, item) => sum + item, 0),
        p50Ms: percentile(.5), p95Ms: percentile(.95) },
      completionSpreadMs: lastCompleted - firstCompleted },
    memoryBytes: { initialHeapUsed: initialHeap.heapUsed, initialRss: initialHeap.rss,
      finalHeapUsed: finalMemory.heapUsed, finalRss: finalMemory.rss,
      peakHeapUsedObserved: peak.heapUsed, peakRssObserved: peak.rss },
    firestoreSynthetic: { queryCalls: db.stats.queryCalls, documentsReturned: db.stats.documentsReturned,
      sdkOperations: db.stats.queryCalls, billedReads: 'not_measured' },
    source: { observeCalls: sourceStats.observeCalls, updatedScopes,
      retryRecoveredTransientErrors: sourceStats.transientErrors,
      cache: { hits: 0, misses: sourceStats.observeCalls, policy: 'source_adapter_does_not_cache_observations' } },
    telegramMemoryOutbox: { events: memory.events.size, uniqueEventIds, duplicateAccepts: sourceStats.duplicateEvents,
      jobs: memory.jobs.size, deliveredJobs: delivered, undeliveredJobs,
      operations: outboxOperations.counts },
    fairness: { totalScopes: scopes.length, updatedScopes,
      coverage: scopes.length ? updatedScopes / scopes.length : 1,
      completionSpreadMs: lastCompleted - firstCompleted,
      queueCoverageByScopeKind: Object.fromEntries(Object.entries(expectedKinds).map(([kind, expected]) => [kind,
        { expected, accepted: sourceStats.acceptedByKind[kind] || 0 }])) },
    telemetry: { spanCount: summary.spanCount, droppedSpans: summary.droppedSpans,
      counters: summary.counters, spans: summary.spans },
  }
}

function createFakeFirestore(families, childrenPerFamily) {
  const documents = new Map()
  const add = (path, rows) => documents.set(path, rows.map(({ id, ...fields }) => ({ id, fields })))
  const familyRows = []
  const accountRows = []
  const identityRows = []
  for (let index = 0; index < families; index++) {
    const familyId = `family_${String(index).padStart(5, '0')}`
    const personId = `parent_${String(index).padStart(5, '0')}`
    familyRows.push({ id: familyId, active: true })
    const childRows = Array.from({ length: childrenPerFamily }, (_, childIndex) => ({
      id: `child_${String(index).padStart(5, '0')}_${String(childIndex).padStart(3, '0')}`,
      active: true,
    }))
    add(`families/${familyId}/children`, childRows)
    add(`families/${familyId}/members`, [{ id: personId, active: true, role: 'parent', displayName: 'Parent A' }])
    accountRows.push({ id: `account_${String(index).padStart(5, '0')}`, familyId,
      source: 'mesh', personId, sourcePersonId: `actor_${String(index).padStart(5, '0')}` })
    for (const { id: childId } of childRows) identityRows.push({ id: `identity_${childId}`, familyId,
      childId, source: 'mesh', sourcePersonId: `actor_${String(index).padStart(5, '0')}` })
  }
  add('families', familyRows)
  add('sourceAccounts', accountRows)
  add('sourceIdentities', identityRows)
  const stats = { queryCalls: 0, documentsReturned: 0 }
  return { stats, collection: (path) => queryFor(path, null) }

  function queryFor(path, filters) {
    const query = { path, filters: filters ?? [], pageSize: Infinity, cursor: null }
    const chain = {
      orderBy() { return chain },
      where(field, operator, value) { return queryFor(path, [...query.filters, { field, operator, value }]) },
      startAfter(doc) { query.cursor = doc?.id ?? null; return chain },
      limit(value) { query.pageSize = value; return chain },
      async get() {
        stats.queryCalls++
        let rows = documents.get(path) ?? []
        for (const filter of query.filters) rows = rows.filter((row) => filter.operator === '==' && row.fields[filter.field] === filter.value)
        rows = [...rows].sort((a, b) => a.id.localeCompare(b.id))
        if (query.cursor) rows = rows.filter((row) => row.id > query.cursor)
        const selected = rows.slice(0, query.pageSize)
        stats.documentsReturned += selected.length
        const docs = selected.map((row) => ({ id: row.id, exists: true, data: () => ({ ...row.fields }) }))
        return { docs, size: docs.length, empty: docs.length === 0 }
      },
    }
    return chain
  }
}

function createMemoryCheckpoints() {
  const rows = new Map()
  const get = (scopeKey, namespace) => {
    const key = `${scopeKey}:${namespace}`
    let row = rows.get(key)
    if (!row) { row = { key, sequence: 0, baseline: null, pending: null, lease: null, version: 0 }; rows.set(key, row) }
    return row
  }
  const owns = ({ scopeKey, namespace, leaseToken, version }) => {
    const row = get(scopeKey, namespace)
    if (!row.lease || row.lease !== leaseToken || row.version !== version) throw Object.assign(new Error('stale_lease'), { safeCode: 'stale_lease' })
    return row
  }
  return { rows,
    async acquire({ scopeKey, namespace, workerId, ownerBinding, now, leaseMs }) {
      const row = get(scopeKey, namespace)
      if (row.lease) return { acquired: false }
      row.version++
      row.lease = `${workerId}:${row.version}`
      row.leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
      row.ownerBinding = ownerBinding
      return { acquired: true, leaseToken: row.lease, version: row.version, sequence: row.sequence,
        baseline: row.baseline, pending: row.pending }
    },
    async savePending(args) { owns(args).pending = structuredClone(args.pending) },
    async advance(args) { const row = owns(args); row.sequence = args.sequence; row.baseline = structuredClone(args.baseline); row.pending = null },
    async renew(args) { owns(args).leaseUntil = new Date(Date.parse(args.now) + args.leaseMs).toISOString() },
    async release(args) { const row = get(args.scopeKey, args.namespace); if (row.lease === args.leaseToken) row.lease = null },
    async invalidateOwner(args) { const row = owns(args); row.baseline = null; row.pending = null; row.sequence = 0; row.lease = null },
  }
}

function countOperations(port) {
  const counts = Object.create(null)
  const wrapped = Object.fromEntries(Object.entries(port).map(([name, method]) => [name, async (...args) => {
    counts[name] = (counts[name] || 0) + 1
    return method(...args)
  }]))
  return { port: wrapped, counts }
}

function scopeKind(index) {
  if (index < 42) return 'schedule'
  if (index < 84) return 'assignment'
  return 'grade'
}

function expectedScopeKinds(scopesPerChild, children) {
  const schedule = Math.min(scopesPerChild, 42) * children
  const assignment = Math.min(Math.max(0, scopesPerChild - 42), 42) * children
  const grade = Math.max(0, scopesPerChild - 84) * children
  return Object.fromEntries([
    ['schedule.changed', schedule], ['homework.changed', assignment], ['grade.changed', grade],
  ].filter(([, count]) => count > 0))
}

function allSequencesAtLeast(rows, scopes, sequence) {
  return scopes.every((scope) => (rows.get(`${scope.scopeHash}:notify`)?.sequence ?? 0) >= sequence)
}

async function waitFor(predicate, timeoutMs = 60_000) {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error('synthetic_benchmark_did_not_drain')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function peakMemory(peak) {
  const current = process.memoryUsage()
  peak.heapUsed = Math.max(peak.heapUsed, current.heapUsed)
  peak.rss = Math.max(peak.rss, current.rss)
}

function validateCounts(values) {
  if (!Array.isArray(values) || !values.length || values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError('familyCounts must be a non-empty list of positive safe integers')
  }
}

function sourceFingerprint() {
  const repository = resolve(import.meta.dirname, '..')
  const files = [
    'packages/education-runtime/family-graph.mjs',
    'packages/education-runtime/telemetry.mjs',
    'packages/telegram-notifications/adapters/source-coordinator.mjs',
    'packages/telegram-notifications/adapters/memory.mjs',
    'packages/telegram-notifications/application/source-pipeline.mjs',
    'packages/telegram-notifications/application/notifications.mjs',
    'scripts/benchmark-server-runtime.mjs',
  ]
  const sha256 = Object.fromEntries(files.map((file) => [file,
    createHash('sha256').update(readFileSync(resolve(repository, file))).digest('hex')]))
  const git = (args) => {
    try { return execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null }
    catch { return null }
  }
  const baseCommit = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain'])
  return { baseCommit, dirty: Boolean(dirty), sha256 }
}

function parseArgs(argv) {
  const index = argv.findIndex((arg) => arg === '--families' || arg.startsWith('--families='))
  if (index < 0) return {}
  const value = argv[index] === '--families' ? argv[index + 1] : argv[index].slice('--families='.length)
  if (!value) throw new Error('--families requires a comma-separated list')
  return { familyCounts: value.split(',').map((item) => Number(item)) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(await runServerRuntimeBenchmark(parseArgs(process.argv.slice(2))), null, 2)}\n`) }
  catch (error) { process.stderr.write(`${error?.message || 'benchmark_failed'}\n`); process.exitCode = 1 }
}
