import { describe, expect, it, vi } from 'vitest'
import { SourcePipeline } from './application/source-pipeline.mjs'
import { createFirestoreSourceAdapter } from './adapters/source-firestore.mjs'
import { createFirestoreSourceCheckpointStore } from './adapters/source-checkpoint-firestore.mjs'
import { NotificationService } from './application/notifications.mjs'
import { createMemoryStore } from './adapters/memory.mjs'
import { renderEvent, renderNotificationParts } from './domain/renderer.mjs'
import { createDomainEvent } from './domain/events.mjs'

/** @see ../../docs/services/telegram-bot/ports-and-events.md#контракт-observation @see ../../docs/services/telegram-bot/adapters/firestore.md#области-данных-для-валидации */
const now = '2026-10-17T12:00:00.000Z'
const scope = { familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizToken: 'quiz-a' }
const quizStarted = { recordKey: 'a'.repeat(64), kind: 'quiz', eventType: 'quiz.started', fields: { status: 'started', title: 'Проверочная' } }

describe('source observation pipeline', () => {
  it('does not advance or accept an observation that finishes after shutdown begins', async () => {
    const checkpoints = new MemoryCheckpoints()
    let resolveObservation
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true },
      observe() { return new Promise((resolve) => { resolveObservation = resolve }) } }
    const accept = vi.fn()
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a',
      clock: () => new Date(now), accept })
    const controller = new AbortController()
    const processing = pipeline.process(scope, { origin: 'live', signal: controller.signal })
    await vi.waitFor(() => expect(resolveObservation).toBeTypeOf('function'))
    controller.abort()
    resolveObservation({ source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId,
      completeness: 'complete', records: [quizStarted] })
    await expect(processing).rejects.toThrow('worker_shutdown')
    expect(accept).not.toHaveBeenCalled()
    expect(checkpoints.row('scope-a', 'notify').sequence).toBe(0)
    expect(checkpoints.row('scope-a', 'notify').pending).toBeNull()
  })

  it('renews a long observation lease serially and drains heartbeat before advancing', async () => {
    vi.useFakeTimers()
    try {
      const checkpoints = new MemoryCheckpoints()
      const renew = checkpoints.renew.bind(checkpoints)
      let resolveRenew
      let activeRenewals = 0
      let maxConcurrentRenewals = 0
      checkpoints.renew = vi.fn(async (...args) => {
        activeRenewals += 1
        maxConcurrentRenewals = Math.max(maxConcurrentRenewals, activeRenewals)
        await new Promise((resolve) => { resolveRenew = resolve })
        activeRenewals -= 1
        return renew(...args)
      })
      let resolveObservation
      const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true },
        observe() { return new Promise((resolve) => { resolveObservation = resolve }) } }
      const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', leaseMs: 90,
        clock: () => new Date(now), accept: async () => {} })
      const processing = pipeline.process(scope)
      await vi.waitFor(() => expect(resolveObservation).toBeTypeOf('function'))
      await vi.advanceTimersByTimeAsync(30)
      expect(checkpoints.renew).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(300)
      expect(checkpoints.renew).toHaveBeenCalledTimes(1)
      resolveObservation({ source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records: [] })
      await vi.advanceTimersByTimeAsync(0)
      expect(activeRenewals).toBe(1) // process is waiting for the in-flight renew before advance/release
      resolveRenew()
      await expect(processing).resolves.toMatchObject({ status: 'advanced', sequence: 1 })
      expect(maxConcurrentRenewals).toBe(1)
      const renewCount = checkpoints.renew.mock.calls.length
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(300)
      expect(checkpoints.renew).toHaveBeenCalledTimes(renewCount)
    } finally { vi.useRealTimers() }
  })

  it('stops before accepting when the observation heartbeat loses its lease', async () => {
    vi.useFakeTimers()
    try {
      const checkpoints = new MemoryCheckpoints()
      checkpoints.renew = vi.fn(async () => { throw new Error('checkpoint_stale_lease') })
      let resolveObservation
      const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true },
        observe() { return new Promise((resolve) => { resolveObservation = resolve }) } }
      const accepted = []
      const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', leaseMs: 90,
        clock: () => new Date(now), accept: async (event) => accepted.push(event) })
      const processing = pipeline.process(scope, { origin: 'live' })
      await vi.waitFor(() => expect(resolveObservation).toBeTypeOf('function'))
      await vi.advanceTimersByTimeAsync(30)
      resolveObservation({ source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId,
        completeness: 'complete', records: [quizStarted] })
      await expect(processing).rejects.toThrow('checkpoint_stale_lease')
      expect(accepted).toEqual([])
      expect(checkpoints.row('scope-a', 'notify').sequence).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('saves pending events before accept and replays the same event before advancing baseline', async () => {
    const checkpoints = new MemoryCheckpoints()
    let observation = { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records: [] }
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return observation } }
    let failOnce = true
    const accepted = []
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async (event) => {
      expect(checkpoints.row('scope-a', 'notify').pending).toBeTruthy()
      accepted.push(event.eventId)
      if (failOnce) { failOnce = false; throw new Error('ledger unavailable') }
    } })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', sequence: 1, events: 0 })
    observation = { ...observation, records: [quizStarted] }
    await expect(pipeline.process(scope)).rejects.toThrow('ledger unavailable')
    const pending = structuredClone(checkpoints.row('scope-a', 'notify').pending)
    expect(checkpoints.row('scope-a', 'notify')).toMatchObject({ sequence: 1, baseline: { records: [] } })
    const restarted = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-b', clock: () => new Date(now), accept: async (event) => accepted.push(event.eventId) })
    await expect(restarted.process(scope)).resolves.toMatchObject({ status: 'replayed', sequence: 2, events: 1 })
    expect(accepted).toEqual([pending.events[0].eventId, pending.events[0].eventId])
    expect(checkpoints.row('scope-a', 'notify')).toMatchObject({ sequence: 2, pending: null, baseline: { records: [quizStarted] } })
  })

  it('keeps observe-only state in a separate namespace and never accepts events', async () => {
    const checkpoints = new MemoryCheckpoints()
    let records = []
    let accepts = 0
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records } } }
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'shadow', workerId: 'shadow', clock: () => new Date(now), accept: async () => { accepts += 1 } })
    await pipeline.process(scope)
    records = [quizStarted]
    await pipeline.process(scope)
    expect(accepts).toBe(0)
    expect(checkpoints.row('scope-a', 'shadow').baseline.records).toEqual([quizStarted])
    expect(checkpoints.row('scope-a', 'notify')).toBeUndefined()
  })

  it('keeps bootstrap first-seen history silent but emits a first live record with an explicit event type', async () => {
    const checkpoints = new MemoryCheckpoints()
    let records = [quizStarted]
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records } } }
    const accepted = []
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async (event) => accepted.push(event) })
    await pipeline.process(scope, { origin: 'bootstrap' })
    expect(accepted).toHaveLength(0)
    const liveScope = { ...scope, quizToken: 'quiz-b' }
    const liveSource = { ...source, scopeKey() { return 'scope-b' }, async observe() { return { source: 'firestore', scopeKey: 'scope-b', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records } } }
    const livePipeline = new SourcePipeline({ source: liveSource, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async (event) => accepted.push(event) })
    await livePipeline.process(liveScope, { origin: 'live' })
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({ eventType: 'quiz.started', source: 'firestore' })
  })

  it('invalidates a pending batch before accept when authoritative ownership changes', async () => {
    const checkpoints = new MemoryCheckpoints()
    const row = checkpoints.ensure('scope-a', 'notify')
    row.sequence = 1
    row.baseline = { complete: true, observationSequence: 1, records: [] }
    row.pending = { sequence: 2, events: [quizStarted], candidateBaseline: { complete: true, observationSequence: 2, records: [quizStarted] } }
    let accepts = 0
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return false }, async observe() { throw new Error('must not observe') } }
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async () => { accepts += 1 } })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'owner_changed' })
    expect(accepts).toBe(0)
    expect(checkpoints.row('scope-a', 'notify')).toMatchObject({ baseline: null, pending: null })
  })

  it('retains last-known records when a complete observation omits them and rejects incomplete or oversized state', async () => {
    const checkpoints = new MemoryCheckpoints()
    let observation = { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records: [quizStarted] }
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return observation } }
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async () => {} })
    await pipeline.process(scope)
    observation = { ...observation, records: [] }
    await pipeline.process(scope)
    expect(checkpoints.row('scope-a', 'notify').baseline.records).toEqual([quizStarted])
    observation = { ...observation, completeness: 'partial', records: [] }
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', sequence: 2, reasonCode: 'source_snapshot_incomplete' })
  })

  it('returns finite reasons for incomplete and oversized observations without advancing', async () => {
    const checkpoints = new MemoryCheckpoints()
    let observation = { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId,
      completeness: 'complete', records: [quizStarted] }
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return observation } }
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker', clock: () => new Date(now),
      maxRecords: 1, maxPendingBytes: 512_000, accept: async () => {} })
    await pipeline.process(scope, { origin: 'bootstrap' })
    observation = { ...observation, completeness: 'partial' }
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', reasonCode: 'source_snapshot_incomplete' })
    observation = { ...observation, completeness: 'complete', records: [{ ...quizStarted, recordKey: 'b'.repeat(64) }] }
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', reasonCode: 'source_snapshot_too_large' })
    expect(checkpoints.row('scope-a', 'notify').baseline.records).toEqual([quizStarted])

    const oversizedCheckpoints = new MemoryCheckpoints()
    const twoRecords = [quizStarted, { ...quizStarted, recordKey: 'b'.repeat(64) }]
    const oversizedSource = { ...source, scopeKey() { return 'scope-b' }, async observe() {
      return { ...observation, scopeKey: 'scope-b', completeness: 'complete', records: twoRecords }
    } }
    const oversizedPipeline = new SourcePipeline({ source: oversizedSource, checkpoints: oversizedCheckpoints, mode: 'notify',
      workerId: 'worker', clock: () => new Date(now), maxRecords: 1, accept: async () => {} })
    await expect(oversizedPipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', reasonCode: 'source_snapshot_too_large' })

    const pendingCheckpoints = new MemoryCheckpoints()
    const pendingPipeline = new SourcePipeline({ source: { ...source, async observe() { return { ...observation, completeness: 'complete', records: [quizStarted] } } },
      checkpoints: pendingCheckpoints, mode: 'notify', workerId: 'worker', clock: () => new Date(now), maxPendingBytes: 1,
      accept: async () => {} })
    await expect(pendingPipeline.process(scope, { origin: 'live' })).resolves.toMatchObject({ status: 'incomplete', reasonCode: 'source_snapshot_too_large' })
    expect(pendingCheckpoints.row('scope-a', 'notify')).toMatchObject({ sequence: 0, baseline: null, pending: null })
  })

  it('projects one allowlisted Firestore document and derives ownership from trusted docs', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', { familyId: 'family-a' })
    db.set('families/family-a/children/child-a', { displayName: 'Ученик A' })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-21', targetDate: '2026-10-22' })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', viewTokens: { student: 'day-a', parent: 'parent-day-a' }, date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task:a.v1'], subjects: [{ id: 'math', name: 'Математика', tasks: [{ id: 'task:a.v1', title: 'Пример' }] }] })
    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task:a.v1', status: 'pending', sha256: 'private-hash', deviceUid: 'private-device',
      storage: { provider: 'yandex-disk', state: 'stored', path: 'private-path', publicUrl: 'https://private.example/photo', syncedAt: new Date(now) } })
    db.set('dayUploads/day-a/files/upload-b', { taskId: 'task:a.v1', status: 'pending', sha256: 'private-hash', deviceUid: 'private-device' })
    db.set('dayProgress/day-a/items/task:a.v1', { taskId: 'task:a.v1', status: 'verified', checkedAt: new Date(now), summary: 'private review', history: [{ answer: 'private' }] })
    db.set('dayReviewPrivate/day-a/items/task:a.v1', { status: 'verified', answer: 'secret' })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'submitted', startedAt: new Date(now), submittedAt: new Date(now), answers: { q: 'secret' }, questions: [{ prompt: 'secret' }], title: 'Проверочная', subject: 'Математика' })
    const uploadScope = { familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }
    const adapter = createFirestoreSourceAdapter(db)
    const observation = await adapter.observe(uploadScope)
    expect(observation).toMatchObject({ completeness: 'complete', familyId: 'family-a', childId: 'child-a' })
    expect(observation.records).toEqual([expect.objectContaining({ kind: 'upload', eventType: 'upload.confirmed',
      occurredAt: now, fields: { childName: 'Ученик A', subject: 'Математика', title: 'Пример', status: 'confirmed', occurredLabel: 'Задание к 2026-10-22' } })])
    expect(observation.records[0].navigationContext).toEqual({ kind: 'day', dayToken: 'day-a' })
    expect(JSON.stringify(observation.records)).not.toMatch(/private-hash|private-device|private-path|private\.example|private review|secret|answers|history|upload-a/)
    const review = await adapter.observe({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task:a.v1' })
    expect(review.records).toEqual([expect.objectContaining({ kind: 'review', fields: { childName: 'Ученик A', subject: 'Математика', title: 'Пример', occurredLabel: 'Задание к 2026-10-22', status: 'verified' } })])
    expect(db.reads.some((read) => read.includes('dayReviewPrivate'))).toBe(false)
    expect(db.reads).toContain('dayOwners/day-a')
    expect(db.reads).toContain('dayUploads/day-a/files/upload-a')
    expect(db.reads).toContain('fieldMask:dayUploads/day-a/files/upload-a:status,taskId,storage.provider,storage.state,storage.syncedAt')
    expect(db.reads).toContain('fieldMask:dayPages/day-a:kind,familyId,childId,date,targetDate,taskIds,subjects,viewTokens')
    expect(db.reads.some((read) => read.startsWith('dayUploads/day-a/files/') && read.endsWith('upload-b'))).toBe(false)
    const pending = await adapter.observe({ ...uploadScope, recordId: 'upload-b' })
    expect(pending).toMatchObject({ completeness: 'complete', records: [] })
    const quiz = await adapter.observe({ familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizToken: 'quiz-a' })
    expect(quiz.records).toEqual([expect.objectContaining({ kind: 'quiz', eventType: 'quiz.submitted' })])
    expect(JSON.stringify(quiz.records)).not.toMatch(/secret|answers/)
    expect(db.reads).toContain('fieldMask:assignments/quiz-a:familyId,childId,status,startedAt,submittedAt,title,subject')
  })

  it('omits education navigation for legacy or mismatched day aliases without dropping a verified upload', async () => {
    const pages = [
      { kind: 'student', date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение' }] }] },
      { kind: 'student', familyId: 'family-a', childId: 'child-a', viewTokens: { student: 'another-day', parent: 'parent-day-a' }, date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение' }] }] },
      { kind: 'student', familyId: 'family-b', childId: 'child-b', viewTokens: { student: 'day-a', parent: 'parent-day-a' }, date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение' }] }] },
      { kind: 'student', familyId: 'family-a', childId: 'child-a', viewTokens: { student: 'day-a', parent: 'https://unsafe.example/path' }, date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение' }] }] },
    ]
    for (const page of pages) {
      const db = new FakeFirestore()
      db.set('families/family-a', {})
      db.set('families/family-a/children/child-a', { displayName: 'Ученик A' })
      db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-21', targetDate: '2026-10-22' })
      db.set('dayPages/day-a', page)
      db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', syncedAt: new Date(now) } })

      const observation = await createFirestoreSourceAdapter(db).observe({ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' })
      expect(observation.completeness).toBe('complete')
      expect(observation.records).toEqual([expect.objectContaining({ kind: 'upload', eventType: 'upload.confirmed', fields: expect.objectContaining({ status: 'confirmed' }) })])
      expect(observation.records[0]).not.toHaveProperty('navigationContext')
    }
  })

  it('does not infer quiz transitions from first-seen snapshots, jitter, rollback, or foreign owners', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', { familyId: 'family-a' })
    db.set('families/family-a/children/child-a', {})
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', subjects: [] })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: null, updatedAt: new Date(now), answers: { secret: 'x' } })
    const quizScope = { familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizToken: 'quiz-a' }
    const adapter = createFirestoreSourceAdapter(db)
    const first = await adapter.observe(quizScope)
    expect(first.records).toEqual([expect.objectContaining({ kind: 'quiz', fields: { status: 'not_started' } })])
    expect(first.records[0].eventType).toBeUndefined()
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: new Date(now), updatedAt: new Date(Date.parse(now) + 10_000), answers: { secret: 'x' } })
    const started = await adapter.observe(quizScope)
    expect(started.records[0]).toMatchObject({ kind: 'quiz', eventType: 'quiz.started', fields: { status: 'started' } })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: null, answers: {} })
    // The stateless adapter projects source state; the pipeline retains the monotonic phase.
    expect((await adapter.observe(quizScope)).records[0].fields.status).toBe('not_started')
    db.set('assignments/quiz-a', { familyId: 'family-b', childId: 'child-b', status: 'open', startedAt: new Date(now) })
    expect(await adapter.observe(quizScope)).toMatchObject({ completeness: 'partial', records: [] })
  })

  it('projects only allowlisted progress status and rejects malformed descriptors without reading private documents', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', {})
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-17', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение № 3' }] }] })
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', status: 'verified', checkedAt: new Date(now), uploadIds: ['upload-z', 'upload-a'],
      summary: 'Подтверждённый вывод', nextStep: 'Проверь запись', history: [{ answer: 'secret' }] })
    db.set('dayReviewPrivate/day-a/items/task-a', { answer: 'secret' })
    const adapter = createFirestoreSourceAdapter(db)
    const progressScope = { familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }
    const observation = await adapter.observe(progressScope)
    expect(observation.records).toEqual([expect.objectContaining({ kind: 'review', eventType: 'review.changed', fields: { subject: 'Математика', title: 'Упражнение № 3', status: 'verified' } })])
    expect(JSON.stringify(observation.records)).not.toMatch(/private|secret|history/)
    expect(db.reads).toContain('dayProgress/day-a/items/task-a')
    expect(db.reads).toContain('fieldMask:dayProgress/day-a/items/task-a:status,checkedAt,taskId,purpose,uploadIds,summary,nextStep')
    expect(db.reads.some((path) => path.includes('dayReviewPrivate'))).toBe(false)
    const firstHash = observation.records[0].semanticHash
    expect(JSON.stringify(observation.records)).not.toMatch(/upload-a|upload-z|Подтверждённый вывод|Проверь запись/)
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', status: 'verified', checkedAt: now, uploadIds: ['upload-a', 'upload-z'],
      summary: 'Подтверждённый вывод', nextStep: 'Проверь запись', history: [] })
    expect((await adapter.observe(progressScope)).records[0].semanticHash).toBe(firstHash)
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-17', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Обновлённое название' }] }] })
    const contextOnly = await adapter.observe(progressScope)
    expect(contextOnly.records[0].fields.title).toBe('Обновлённое название')
    expect(contextOnly.records[0].semanticHash).toBe(firstHash)
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', status: 'verified', checkedAt: new Date(Date.parse(now) + 1000),
      uploadIds: ['upload-a', 'upload-z'], summary: 'Изменённый вывод', nextStep: 'Проверь запись', history: [] })
    const newSummary = await adapter.observe(progressScope)
    expect(newSummary.records[0].semanticHash).not.toBe(firstHash)
    expect(JSON.stringify(newSummary.records)).not.toMatch(/upload-a|upload-z|Изменённый вывод|Проверь запись/)
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', status: 'verified', checkedAt: now,
      uploadIds: ['upload-b', 'upload-z'], summary: 'Подтверждённый вывод', nextStep: 'Проверь запись', history: [] })
    expect((await adapter.observe(progressScope)).records[0].semanticHash).not.toBe(firstHash)
    expect(await adapter.observe({ ...progressScope, familyId: 'family-b' })).toMatchObject({ completeness: 'partial', records: [] })
    expect(await adapter.validateScope({ ...progressScope, kind: 'assignment' })).toBe(false)
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', purpose: 'source-material', status: 'verified', checkedAt: now })
    expect(await adapter.observe(progressScope)).toMatchObject({ completeness: 'complete', records: [] })
    expect(await adapter.inspectReview(progressScope)).toMatchObject({ completeness: 'complete', state: 'ignored', contextState: 'not_applicable' })
  })

  it('keeps review observation partial until exact day page and task context are available', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', { displayName: 'Ученик A' })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    db.set('dayProgress/day-a/items/task-a', { taskId: 'task-a', status: 'needs-fix' })
    const adapter = createFirestoreSourceAdapter(db)
    const progressScope = { familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }
    expect(await adapter.observe(progressScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-16', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: '№ 3' }] }] })
    expect(await adapter.observe(progressScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-17', taskIds: ['task-b'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: '№ 3' }] }] })
    expect(await adapter.observe(progressScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('dayPages/day-a', { kind: 'student', familyId: 'family-a', childId: 'child-a', date: '2026-10-17', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: '№ 3' }] }] })
    expect(await adapter.observe(progressScope)).toMatchObject({ completeness: 'complete', records: [{ fields: { subject: 'Математика', title: '№ 3', status: 'needs-fix' } }] })
    expect(await adapter.inspectReview(progressScope)).toMatchObject({ completeness: 'complete', contextState: 'exact', state: 'needs-fix' })
  })

  it('does not emit a review again for checkedAt-only changes or quiet context enrichment', async () => {
    const checkpoints = new MemoryCheckpoints()
    const reviewKey = 'c'.repeat(64)
    const baseline = { complete: true, observationSequence: 1, sourceProjectionVersion: 2, records: [{ recordKey: reviewKey, kind: 'review',
      eventType: 'review.changed', semanticHash: 'a'.repeat(64), fields: { childName: 'Ученик A', status: 'verified' } }] }
    checkpoints.ensure('scope-a', 'notify').sequence = 1
    checkpoints.ensure('scope-a', 'notify').baseline = baseline
    let reviewedRecord = {
        recordKey: reviewKey, kind: 'review', eventType: 'review.changed', semanticHash: 'b'.repeat(64),
        fields: { childName: 'Ученик A', subject: 'Математика', title: '№ 3', occurredLabel: 'К пятнице', status: 'verified' },
    }
    const source = { kind: 'firestore', scopeKey: () => 'scope-a', async validateScope() { return true }, async observe() { return {
      source: 'firestore', scopeKey: 'scope-a', familyId: 'family-a', childId: 'child-a', completeness: 'complete', records: [reviewedRecord],
    } } }
    const accept = vi.fn()
    const pipeline = new SourcePipeline({ source, checkpoints, accept, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now) })
    const outcome = await pipeline.process({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }, { origin: 'live' })
    expect(outcome).toMatchObject({ status: 'advanced', events: 0, scopeKey: 'scope-a', sequence: 2 })
    expect(accept).not.toHaveBeenCalled()
    expect(checkpoints.row('scope-a', 'notify').baseline).toMatchObject({ reviewProjectionVersion: 2,
      records: [expect.objectContaining({ semanticHash: 'b'.repeat(64) })] })
    reviewedRecord = { ...reviewedRecord, semanticHash: 'c'.repeat(64), fields: { ...reviewedRecord.fields, status: 'needs-fix' } }
    await expect(pipeline.process({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept.mock.calls[0][0].fields.status).toBe('needs-fix')
    expect(accept.mock.calls[0][0].fields.changeKind).toBeUndefined()
    expect(renderNotificationParts(accept.mock.calls[0][0], 'family')[0].plaintext).toContain('🟠 № 3 — нужна правка')
  })

  it('emits a same-status review fingerprint change, persists it, and stays quiet after restart', async () => {
    const checkpoints = new MemoryCheckpoints()
    const reviewKey = 'e'.repeat(64)
    const row = checkpoints.ensure('scope-a', 'notify')
    row.sequence = 1
    row.baseline = { complete: true, observationSequence: 1, sourceProjectionVersion: 2, reviewProjectionVersion: 2,
      records: [{ recordKey: reviewKey, kind: 'review', eventType: 'review.changed', semanticHash: 'a'.repeat(64),
        fields: { childName: 'Ученик A', subject: 'Математика', title: '№ 3', status: 'verified' } }] }
    const record = { recordKey: reviewKey, kind: 'review', eventType: 'review.changed', semanticHash: 'b'.repeat(64),
      fields: { childName: 'Ученик A', subject: 'Математика', title: '№ 3', status: 'verified' } }
    const source = { kind: 'firestore', scopeKey: () => 'scope-a', async validateScope() { return true }, async observe() { return {
      source: 'firestore', scopeKey: 'scope-a', familyId: 'family-a', childId: 'child-a', completeness: 'complete', records: [record],
    } } }
    const accepted = []
    const makePipeline = (workerId) => new SourcePipeline({ source, checkpoints, mode: 'notify', workerId,
      clock: () => new Date(now), accept: async (event) => accepted.push(event) })
    await expect(makePipeline('worker-a').process({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(accepted).toHaveLength(1)
    expect(accepted[0].fields).toEqual({ ...record.fields, changeKind: 'updated' })
    expect(renderNotificationParts(accepted[0], 'family')[0].plaintext).toContain('🟢 № 3 — разбор обновлён · проверено')
    expect(checkpoints.row('scope-a', 'notify').baseline.records[0].semanticHash).toBe('b'.repeat(64))

    await expect(makePipeline('worker-b').process({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(accepted).toHaveLength(1)

    record.semanticHash = 'c'.repeat(64)
    await expect(makePipeline('worker-c').process({ familyId: 'family-a', childId: 'child-a', kind: 'progress', dayToken: 'day-a', recordId: 'task-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(accepted).toHaveLength(2)
  })

  it('accepts only the updated review change marker and ignores it on other event types', () => {
    const common = { source: 'firestore', scopeKey: 'scope-a', familyId: 'family-a', childId: 'child-a',
      sourceEventKey: 'review-a', sourceRevision: 'r1', privacyClass: 'family-summary', detectedAt: now }
    expect(createDomainEvent({ ...common, eventType: 'review.changed', fields: { subject: 'Математика', title: '№ 3', status: 'verified', changeKind: 'updated' } }).fields.changeKind)
      .toBe('updated')
    expect(createDomainEvent({ ...common, eventType: 'review.changed', fields: { subject: 'Математика', title: '№ 3', status: 'verified', changeKind: 'invented' } }).fields)
      .not.toHaveProperty('changeKind')
    expect(createDomainEvent({ ...common, eventType: 'grade.changed', fields: { value: '5', changeKind: 'updated' } }).fields)
      .not.toHaveProperty('changeKind')
  })

  it('rejects Firestore scopes when the family or child is inactive', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', { active: true })
    db.set('families/family-a/children/child-a', { active: true })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    const adapter = createFirestoreSourceAdapter(db)
    const uploadScope = { familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }
    expect(await adapter.validateScope(uploadScope)).toBe(true)
    db.set('families/family-a', { active: false })
    expect(await adapter.validateScope(uploadScope)).toBe(false)
    expect(await adapter.observe(uploadScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('families/family-a', { active: true })
    db.set('families/family-a/children/child-a', { active: false })
    expect(await adapter.validateScope(uploadScope)).toBe(false)
    expect(await adapter.observe(uploadScope)).toMatchObject({ completeness: 'partial', records: [] })
  })

  it('projects only the exact child displayName into each Firestore observation', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', { displayName: 'Ученик A', privateNote: 'private A' })
    db.set('families/family-a/children/child-b', { displayName: 'Ученик B', privateNote: 'private B' })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    db.set('dayOwners/day-b', { familyId: 'family-a', childId: 'child-b', date: '2026-10-17' })
    db.set('dayPages/day-a', { kind: 'student', date: '2026-10-17', taskIds: ['task-a'], targetDate: '2026-10-18', subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Первое задание' }] }] })
    db.set('dayPages/day-b', { kind: 'student', date: '2026-10-17', taskIds: ['task-b'], targetDate: '2026-10-18', subjects: [{ name: 'Русский язык', tasks: [{ id: 'task-b', title: 'Второе задание' }] }] })
    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', syncedAt: new Date(now) } })
    db.set('dayUploads/day-b/files/upload-b', { taskId: 'task-b', status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', syncedAt: new Date(now) } })
    const adapter = createFirestoreSourceAdapter(db)
    const first = await adapter.observe({ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' })
    const second = await adapter.observe({ familyId: 'family-a', childId: 'child-b', kind: 'upload', dayToken: 'day-b', recordId: 'upload-b' })
    expect(first.records[0].fields.childName).toBe('Ученик A')
    expect(second.records[0].fields.childName).toBe('Ученик B')
    expect(first.records[0].fields).toMatchObject({ subject: 'Математика', title: 'Первое задание' })
    expect(second.records[0].fields).toMatchObject({ subject: 'Русский язык', title: 'Второе задание' })
    expect(JSON.stringify(first.records)).not.toContain('Ученик B')
    expect(JSON.stringify(second.records)).not.toContain('Ученик A')
    expect(JSON.stringify(first.records)).not.toContain('private')
    expect(JSON.stringify(second.records)).not.toContain('private')
    expect(db.reads).toContain('fieldMask:families/family-a/children/child-a:displayName')
    expect(db.reads).toContain('fieldMask:families/family-a/children/child-b:displayName')
  })

  it('uses Firestore listeners only as wakeup signals and disposes every listener', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', {})
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-17' })
    const signals = []
    const adapter = createFirestoreSourceAdapter(db)
    const dispose = adapter.subscribe({ scopes: [{ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }], onSignal: (descriptor) => signals.push(descriptor) })
    expect(signals).toHaveLength(1)
    expect(db.listenerCount).toBe(4)
    await dispose()
    expect(db.listenerCount).toBe(0)
  })

  it('subscribes to quiz identity paths without constructing a day owner path', async () => {
    const db = new FakeFirestore()
    const quizScope = { familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizToken: 'quiz-a' }
    const adapter = createFirestoreSourceAdapter(db)
    const dispose = adapter.subscribe({ scopes: [quizScope], onSignal: () => {} })
    expect(db.listenerPaths).toEqual(['families/family-a', 'families/family-a/children/child-a', 'assignments/quiz-a'])
    expect(db.listenerPaths).not.toContain('dayOwners/undefined')
    await dispose()
  })

  it('requires valid timestamps as proof of quiz start/submission', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', {})
    const quizScope = { familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizToken: 'quiz-a' }
    const adapter = createFirestoreSourceAdapter(db)
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: 'not-a-time' })
    expect(await adapter.observe(quizScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: true })
    expect(await adapter.observe(quizScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: new Date(now) })
    expect((await adapter.observe(quizScope)).records[0]).toMatchObject({ eventType: 'quiz.started', fields: { status: 'started' } })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'submitted', startedAt: new Date(now), submittedAt: null })
    expect(await adapter.observe(quizScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'submitted', startedAt: new Date(now), submittedAt: [] })
    expect(await adapter.observe(quizScope)).toMatchObject({ completeness: 'partial', records: [] })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'submitted', startedAt: new Date(now), submittedAt: new Date(now) })
    expect((await adapter.observe(quizScope)).records[0]).toMatchObject({ eventType: 'quiz.submitted', fields: { status: 'submitted' } })
  })

  it('advances quiet quiz metadata changes and emits only strict phase advances', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', {})
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: null, title: 'Draft A' })
    const source = createFirestoreSourceAdapter(db)
    const checkpoints = new MemoryCheckpoints()
    const accepted = []
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker', clock: () => new Date(now), accept: async (event) => accepted.push(event.eventType) })
    await pipeline.process(scope, { origin: 'bootstrap' })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: null, title: 'Draft B' })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', events: 0 })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: new Date(now), title: 'Started A' })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', events: 1 })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: new Date(now), title: 'Started B' })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', events: 0 })
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'submitted', startedAt: new Date(now), submittedAt: new Date(now), title: 'Submitted' })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(accepted).toEqual(['quiz.started', 'quiz.submitted'])
  })

  it('fences Firestore checkpoint leases and namespaces shadow from notify state', async () => {
    const db = new FakeFirestore()
    const checkpoints = createFirestoreSourceCheckpointStore(db)
    const binding = { source: 'firestore', familyId: 'family-a', childId: 'child-a', kind: 'quiz', dayTokenHash: null, recordIdHash: null, quizTokenHash: 'c'.repeat(64) }
    const first = await checkpoints.acquire({ scopeKey: 'same-scope', namespace: 'notify', ownerBinding: binding, workerId: 'one', now, leaseMs: 100 })
    const busy = await checkpoints.acquire({ scopeKey: 'same-scope', namespace: 'notify', ownerBinding: binding, workerId: 'two', now, leaseMs: 100 })
    expect(first.acquired).toBe(true)
    expect(busy.acquired).toBe(false)
    const expired = new Date(Date.parse(now) + 101).toISOString()
    const second = await checkpoints.acquire({ scopeKey: 'same-scope', namespace: 'notify', ownerBinding: binding, workerId: 'two', now: expired, leaseMs: 100 })
    await expect(checkpoints.savePending({ scopeKey: 'same-scope', namespace: 'notify', leaseToken: first.leaseToken, version: first.version, now, pending: {} })).rejects.toMatchObject({ safeCode: 'checkpoint_stale_lease' })
    await checkpoints.advance({ scopeKey: 'same-scope', namespace: 'notify', leaseToken: second.leaseToken, version: second.version, now: expired, sequence: 1, baseline: { complete: true, observationSequence: 1, records: [] } })
    const shadow = await checkpoints.acquire({ scopeKey: 'same-scope', namespace: 'shadow', ownerBinding: binding, workerId: 'shadow', now: expired, leaseMs: 100 })
    expect(shadow.sequence).toBe(0)
  })

  it('rejects checkpoint mutations after lease expiry even before another worker acquires it', async () => {
    const checkpoints = createFirestoreSourceCheckpointStore(new FakeFirestore())
    const ownerBinding = { source: 'firestore', familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizTokenHash: 'b'.repeat(64) }
    const lease = await checkpoints.acquire({ scopeKey: 'expiry-scope', namespace: 'notify', ownerBinding, workerId: 'worker', now, leaseMs: 100 })
    const expired = new Date(Date.parse(now) + 101).toISOString()
    await expect(checkpoints.savePending({ scopeKey: 'expiry-scope', namespace: 'notify', leaseToken: lease.leaseToken, version: lease.version, now: expired, pending: {} })).rejects.toMatchObject({ safeCode: 'checkpoint_stale_lease' })
    await expect(checkpoints.advance({ scopeKey: 'expiry-scope', namespace: 'notify', leaseToken: lease.leaseToken, version: lease.version, now: expired, sequence: 1, baseline: { complete: true, observationSequence: 1, records: [] } })).rejects.toMatchObject({ safeCode: 'checkpoint_stale_lease' })
  })

  it('keeps baseline, pending, and checkpoint envelope under the Firestore document budget', async () => {
    const db = new FakeFirestore()
    const ownerBinding = { source: 'firestore', familyId: 'family-a', childId: 'child-a', kind: 'quiz', quizTokenHash: 'c'.repeat(64) }
    const checkpoints = createFirestoreSourceCheckpointStore(db, { maxDocumentBytes: 900 })
    const lease = await checkpoints.acquire({ scopeKey: 'budget-scope', namespace: 'notify', ownerBinding, workerId: 'worker', now, leaseMs: 100_000 })
    const largeRecord = { ...quizStarted, fields: { title: 'x'.repeat(650), status: 'started' } }
    await expect(checkpoints.savePending({ scopeKey: 'budget-scope', namespace: 'notify', leaseToken: lease.leaseToken,
      version: lease.version, now, pending: { sequence: 1, events: [], candidateBaseline: { complete: true, observationSequence: 1, records: [largeRecord] } } }))
      .rejects.toMatchObject({ safeCode: 'checkpoint_too_large' })
    await expect(checkpoints.advance({ scopeKey: 'budget-scope', namespace: 'notify', leaseToken: lease.leaseToken,
      version: lease.version, now, sequence: 1, baseline: { complete: true, observationSequence: 1, records: [largeRecord] } }))
      .rejects.toMatchObject({ safeCode: 'checkpoint_too_large' })
    await checkpoints.release({ scopeKey: 'budget-scope', namespace: 'notify', leaseToken: lease.leaseToken })
    const larger = createFirestoreSourceCheckpointStore(db, { maxDocumentBytes: 2_000 })
    const seeded = await larger.acquire({ scopeKey: 'budget-scope', namespace: 'notify', ownerBinding, workerId: 'seed', now, leaseMs: 100_000 })
    await larger.advance({ scopeKey: 'budget-scope', namespace: 'notify', leaseToken: seeded.leaseToken, version: seeded.version,
      now, sequence: 1, baseline: { complete: true, observationSequence: 1, records: [largeRecord] } })
    await larger.release({ scopeKey: 'budget-scope', namespace: 'notify', leaseToken: seeded.leaseToken })
    await expect(checkpoints.acquire({ scopeKey: 'budget-scope', namespace: 'notify', ownerBinding, workerId: 'next', now, leaseMs: 100_000 }))
      .rejects.toMatchObject({ safeCode: 'checkpoint_too_large' })
  })

  it('stores only hashed scope identifiers and rejects malformed safe projections without advancing', async () => {
    const checkpoints = new MemoryCheckpoints()
    let records = [quizStarted, quizStarted]
    const source = { kind: 'firestore', scopeKey() { return 'scope-a' }, async validateScope() { return true }, async observe() { return { source: 'firestore', scopeKey: 'scope-a', familyId: scope.familyId, childId: scope.childId, completeness: 'complete', records } } }
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-a', clock: () => new Date(now), accept: async () => {} })
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', sequence: 0 })
    expect(checkpoints.row('scope-a', 'notify').baseline).toBeNull()
    records = [quizStarted]
    await pipeline.process(scope)
    expect(checkpoints.row('scope-a', 'notify').ownerBinding).not.toContain('quiz-a')
    records = [{ ...quizStarted, fields: { status: 'started', title: 'https://private.example/x token=secret' } }]
    await pipeline.process(scope)
    expect(JSON.stringify(checkpoints.row('scope-a', 'notify'))).not.toMatch(/private\.example|token=secret/)
    const before = checkpoints.row('scope-a', 'notify').sequence
    records = [{ ...quizStarted, eventType: 'unknown.event' }]
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'incomplete', sequence: before })
    expect(checkpoints.row('scope-a', 'notify').sequence).toBe(before)
  })

  it('replays a Firestore-checkpointed event after process restart with the same event identity', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', {})
    db.set('assignments/quiz-a', { familyId: 'family-a', childId: 'child-a', status: 'open', startedAt: new Date(now), title: 'Тест' })
    const source = createFirestoreSourceAdapter(db)
    const checkpoints = createFirestoreSourceCheckpointStore(db)
    let fail = true
    const accepted = []
    const first = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-1', clock: () => new Date(now), accept: async (event) => {
      accepted.push(event.eventId)
      if (fail) { fail = false; throw new Error('ledger unavailable') }
    } })
    await first.process(scope, { origin: 'live' }).then(() => { throw new Error('expected injected accept failure') }, (error) => expect(error.message).toBe('ledger unavailable'))
    const second = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'worker-2', clock: () => new Date(now), accept: async (event) => accepted.push(event.eventId) })
    await expect(second.process(scope, { origin: 'bootstrap' })).resolves.toMatchObject({ status: 'replayed', sequence: 1, events: 1 })
    expect(accepted).toHaveLength(2)
    expect(accepted[0]).toBe(accepted[1])
    const stored = [...db.records.entries()].find(([path]) => path.startsWith('telegramNotificationSourceCheckpoints/'))?.[1]
    expect(stored.pending).toBeNull()
    expect(stored.baseline.records[0]).toMatchObject({ kind: 'quiz', eventType: 'quiz.started' })
    expect(JSON.stringify(stored)).not.toContain('quiz-a')
  })

  it('quietly upgrades legacy bootstrap upload baselines but accepts live uploads', async () => {
    const record = { recordKey: 'b'.repeat(64), kind: 'upload', eventType: 'upload.confirmed', occurredAt: now,
      fields: { childName: 'Ученик', subject: 'Математика', title: 'Задание', status: 'confirmed', occurredLabel: '2026-10-17' } }
    const source = { kind: 'firestore', scopeKey() { return 'upload-scope' }, async validateScope() { return true },
      async observe() { return { source: 'firestore', scopeKey: 'upload-scope', familyId: 'family-a', childId: 'child-a', completeness: 'complete', records: [record] } } }
    const migrated = new MemoryCheckpoints()
    const legacy = migrated.ensure('upload-scope', 'notify')
    legacy.sequence = 4
    legacy.baseline = { complete: true, observationSequence: 4, records: [] }
    const bootstrapAccept = vi.fn()
    const bootstrap = new SourcePipeline({ source, checkpoints: migrated, accept: bootstrapAccept, mode: 'notify', workerId: 'worker', clock: () => new Date(now) })
    await expect(bootstrap.process({ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }, { origin: 'bootstrap' }))
      .resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(bootstrapAccept).not.toHaveBeenCalled()
    expect(migrated.row('upload-scope', 'notify').baseline.sourceProjectionVersion).toBe(2)

    const fresh = new MemoryCheckpoints()
    const liveAccept = vi.fn()
    const live = new SourcePipeline({ source, checkpoints: fresh, accept: liveAccept, mode: 'notify', workerId: 'worker', clock: () => new Date(now) })
    await expect(live.process({ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(liveAccept).toHaveBeenCalledTimes(1)
  })

  it('enriches an existing upload baseline with task context without re-notifying', async () => {
    const record = { recordKey: 'c'.repeat(64), kind: 'upload', eventType: 'upload.confirmed', occurredAt: now,
      semanticHash: 'd'.repeat(64), fields: { childName: 'Ученик', subject: 'Математика', title: 'Новое название', status: 'confirmed', occurredLabel: '2026-10-17' } }
    const source = { kind: 'firestore', scopeKey() { return 'upload-scope' }, async validateScope() { return true },
      async observe() { return { source: 'firestore', scopeKey: 'upload-scope', familyId: 'family-a', childId: 'child-a', completeness: 'complete', records: [record] } } }
    const checkpoints = new MemoryCheckpoints()
    const prior = checkpoints.ensure('upload-scope', 'notify')
    prior.sequence = 3
    prior.baseline = { complete: true, observationSequence: 3, records: [{ recordKey: record.recordKey, kind: 'upload', eventType: 'upload.confirmed', fields: { childName: 'Ученик', status: 'confirmed' } }] }
    const accept = vi.fn()
    const pipeline = new SourcePipeline({ source, checkpoints, accept, mode: 'notify', workerId: 'worker', clock: () => new Date(now) })
    await expect(pipeline.process({ familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }, { origin: 'live' }))
      .resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(accept).not.toHaveBeenCalled()
  })

  it('bounds long linked task titles before the real upload source reaches safeRecords', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', { displayName: 'Ученик A' })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-21', targetDate: '2026-10-22' })
    const longTitle = 'Задание '.repeat(100)
    db.set('dayPages/day-a', { kind: 'student', date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'],
      subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: longTitle }] }] })
    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'pending',
      storage: { provider: 'yandex-disk', state: 'stored', syncedAt: new Date(now) } })
    const uploadScope = { familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }
    const source = createFirestoreSourceAdapter(db)
    const checkpoints = new MemoryCheckpoints()
    const accept = vi.fn(async () => {})
    const pipeline = new SourcePipeline({ source, checkpoints, accept, mode: 'notify', workerId: 'long-title-worker',
      clock: () => new Date(now) })

    const observation = await source.observe(uploadScope)
    expect(observation.completeness).toBe('complete')
    expect(observation.records[0].fields.title).toHaveLength(160)
    await expect(pipeline.process(uploadScope, { origin: 'live' })).resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept.mock.calls[0][0].fields.title.length).toBeLessThanOrEqual(160)
    expect(checkpoints.row(source.scopeKey(uploadScope), 'notify').baseline.sourceProjectionVersion).toBe(2)
  })

  it('connects a confirmed Firestore upload through the ledger/outbox and sends one structured fake delivery after crash replay', async () => {
    const db = new FakeFirestore()
    db.set('families/family-a', {})
    db.set('families/family-a/children/child-a', { displayName: 'Ученик A' })
    db.set('dayOwners/day-a', { familyId: 'family-a', childId: 'child-a', date: '2026-10-21', targetDate: '2026-10-22' })
    db.set('dayPages/day-a', { kind: 'student', date: '2026-10-21', targetDate: '2026-10-22', taskIds: ['task-a'], subjects: [{ name: 'Математика', tasks: [{ id: 'task-a', title: 'Упражнение № 2' }] }] })
    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'requested' })
    const uploadScope = { familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }
    const source = createFirestoreSourceAdapter(db)
    const checkpoints = createFirestoreSourceCheckpointStore(db)
    const store = createMemoryStore()
    const deliveries = []
    const service = new NotificationService({
      eventLedger: store.eventLedger,
      outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'parent-a', childId: 'child-a', telegramUserId: '55' }] } },
      membership: { async isActiveMember() { return true } },
      renderer: renderEvent,
      delivery: { async send(message) { deliveries.push(message); return { messageId: 901 } } },
      clock: () => new Date(now), workerId: 'delivery-worker', logger: { info() {}, error() {} },
    })
    let failAfterAccept = false
    const sourceEventIds = []
    const accepted = async (event) => {
      sourceEventIds.push(event.eventId)
      const result = await service.accept(event)
      if (failAfterAccept) { failAfterAccept = false; throw new Error('simulated_process_crash') }
      return result
    }
    const pipeline = new SourcePipeline({ source, checkpoints, accept: accepted, mode: 'notify', workerId: 'source-worker', clock: () => new Date(now) })
    await expect(pipeline.process(uploadScope, { origin: 'bootstrap' })).resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(store.jobs.size).toBe(0)

    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', path: 'private-path', publicUrl: 'https://private.example/photo', syncedAt: new Date(now) } })
    failAfterAccept = true
    await expect(pipeline.process(uploadScope)).rejects.toThrow('simulated_process_crash')
    expect(store.jobs.size).toBe(1)
    const resumed = new SourcePipeline({ source, checkpoints, accept: async (event) => { sourceEventIds.push(event.eventId); return service.accept(event) }, mode: 'notify', workerId: 'source-worker-restarted', clock: () => new Date(now) })
    await expect(resumed.process(uploadScope)).resolves.toMatchObject({ status: 'replayed', events: 1 })
    expect(sourceEventIds).toHaveLength(2)
    expect(sourceEventIds[0]).toBe(sourceEventIds[1])
    expect(store.jobs.size).toBe(1)
    await expect(service.runOne()).resolves.toBe(true)
    expect(deliveries).toEqual([{ chatId: '55', text: '📚 Изменения Education\n\nУченик A\n• Загружено фото работы: Математика\n  Упражнение № 2\n  Задание к 2026-10-22' }])
    expect(JSON.stringify(deliveries)).not.toMatch(/private-path|private\.example|upload-a|task-a/)
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'sent', partReceipts: [{ messageId: 901 }] })
    db.set('dayUploads/day-a/files/upload-a', { taskId: 'task-a', status: 'reviewed', storage: { provider: 'yandex-disk', state: 'stored', path: 'private-path', publicUrl: 'https://private.example/photo', syncedAt: new Date(now) } })
    await expect(pipeline.process(uploadScope)).resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(store.events.size).toBe(1)
    expect(store.jobs.size).toBe(1)
  })
})

class MemoryCheckpoints {
  rows = new Map()
  key(scopeKey, namespace) { return `${namespace}:${scopeKey}` }
  ensure(scopeKey, namespace) { const key = this.key(scopeKey, namespace); if (!this.rows.has(key)) this.rows.set(key, { sequence: 0, baseline: null, pending: null, version: 0 }); return this.rows.get(key) }
  row(scopeKey, namespace) { return this.rows.get(this.key(scopeKey, namespace)) }
  async acquire({ scopeKey, namespace, ownerBinding, workerId }) { const row = this.ensure(scopeKey, namespace); if (row.ownerBinding && row.ownerBinding !== JSON.stringify(ownerBinding)) { row.sequence = 0; row.baseline = null; row.pending = null; row.version += 1 } row.ownerBinding = JSON.stringify(ownerBinding); row.leaseToken = `${workerId}-lease`; return structuredClone({ ...row, acquired: true, scopeKey, namespace }) }
  async savePending({ scopeKey, namespace, leaseToken, version, pending }) { const row = this.row(scopeKey, namespace); if (row.leaseToken !== leaseToken || row.version !== version) throw new Error('checkpoint_stale_lease'); row.pending = structuredClone(pending) }
  async advance({ scopeKey, namespace, leaseToken, version, sequence, baseline }) { const row = this.row(scopeKey, namespace); if (row.leaseToken !== leaseToken || row.version !== version) throw new Error('checkpoint_stale_lease'); row.sequence = sequence; row.baseline = structuredClone(baseline); row.pending = null; row.version += 1 }
  async renew({ scopeKey, namespace, leaseToken, version }) { const row = this.row(scopeKey, namespace); if (row.leaseToken !== leaseToken || row.version !== version) throw new Error('checkpoint_stale_lease') }
  async invalidateOwner({ scopeKey, namespace, leaseToken: _leaseToken }) { const row = this.row(scopeKey, namespace); row.baseline = null; row.pending = null; row.sequence = 0; row.version += 1; row.leaseToken = null }
  async release({ scopeKey, namespace, leaseToken }) { const row = this.row(scopeKey, namespace); if (row?.leaseToken === leaseToken) row.leaseToken = null }
}

class FakeFirestore {
  records = new Map()
  reads = []
  listenerCount = 0
  listenerPaths = []
  set(path, data) { this.records.set(path, structuredClone(data)) }
  doc(path) { return new FakeDocument(this, path) }
  collection(path) { return new FakeCollection(this, path) }
  async getAll(...refsAndOptions) {
    const options = refsAndOptions.at(-1)
    const refs = refsAndOptions.filter((entry) => entry instanceof FakeDocument)
    if (options?.fieldMask && refs.length !== 1) throw new Error('fake_field_mask_requires_one_ref')
    return refs.map((ref) => {
      this.reads.push(ref.path)
      if (!options?.fieldMask) return new FakeSnapshot(ref, this.records.get(ref.path))
      this.reads.push(`fieldMask:${ref.path}:${options.fieldMask.join(',')}`)
      const data = this.records.get(ref.path)
      if (data === undefined) return new FakeSnapshot(ref, undefined)
      const masked = {}
      for (const key of options.fieldMask) {
        const parts = key.split('.')
        let source = data, target = masked
        for (const part of parts.slice(0, -1)) {
          source = source?.[part]
          target[part] ??= {}
          target = target[part]
        }
        const leaf = parts.at(-1)
        if (source && Object.hasOwn(source, leaf)) target[leaf] = structuredClone(source[leaf])
      }
      return new FakeSnapshot(ref, masked)
    })
  }
  runTransaction(fn) { return fn({ get: (ref) => ref.get(), set: (ref, data, options) => ref.set(data, options), create: (ref, data) => ref.create(data), update: (ref, data) => ref.update(data) }) }
}
class FakeDocument {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1) }
  async get(...args) { if (args.length) throw new Error('DocumentReference.get takes no options'); this.db.reads.push(this.path); return new FakeSnapshot(this, this.db.records.get(this.path)) }
  onSnapshot(next, error) { this.db.listenerCount += 1; this.db.listenerPaths.push(this.path); this.next = next; this.error = error; return () => { this.db.listenerCount -= 1; this.db.listenerPaths.splice(this.db.listenerPaths.indexOf(this.path), 1) } }
  async set(data, options = {}) { this.db.records.set(this.path, options.merge ? { ...this.db.records.get(this.path), ...structuredClone(data) } : structuredClone(data)) }
  async create(data) { if (this.db.records.has(this.path)) throw new Error('already_exists'); this.db.set(this.path, data) }
  async update(data) { if (!this.db.records.has(this.path)) throw new Error('missing'); this.db.set(this.path, { ...this.db.records.get(this.path), ...structuredClone(data) }) }
}
class FakeSnapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data }
  data() { return this._data }
}
class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path }
  doc(id) { return new FakeDocument(this.db, `${this.path}/${id}`) }
  select() { return this }
  async get() { this.db.reads.push(this.path); const prefix = `${this.path}/`; const docs = [...this.db.records.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(([path, data]) => new FakeSnapshot(new FakeDocument(this.db, path), data)); return { docs, size: docs.length } }
}
