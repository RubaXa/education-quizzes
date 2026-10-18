import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов @see ../../../docs/services/telegram-bot/adapters/firestore.md#масштабирование */
/**
 * Owns dynamic source inventories and listeners. Inventories are supplied by
 * source-specific adapters and must represent a complete reconciliation.
 * A failed/partial reconciliation leaves the last confirmed listener set live.
 */
export class SourceCoordinator {
  constructor({ sources, pipelines, enumerate, discoveryStore = null, onHealth = () => {}, clock = () => Date.now(),
    reconcileMs = 30_000, concurrency = 4, maxLiveBurst = 8, setTimer = setTimeout, clearTimer = clearTimeout,
    random = Math.random }) {
    if (!Array.isArray(sources) || !sources.length || typeof enumerate !== 'function'
      || !Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxLiveBurst) || maxLiveBurst < 1
      || !Number.isFinite(reconcileMs) || reconcileMs < 1_000) {
      throw new Error('invalid_source_coordinator_config')
    }
    this.sources = new Map(sources.map((source) => [source.kind, source]))
    this.pipelines = pipelines
    this.enumerate = enumerate
    this.discoveryStore = discoveryStore
    this.onHealth = onHealth
    this.clock = clock
    this.reconcileMs = reconcileMs
    this.concurrency = concurrency
    this.maxLiveBurst = maxLiveBurst
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.random = random
    this.listeners = new Map()
    this.known = new Map()
    this.pending = new Map()
    this.activeKeys = new Set()
    this.active = 0
    this.cursor = 0
    this.liveDispatchBurst = 0
    this.running = false
    this.closed = false
    this.timer = null
    this.inflight = new Set()
    this.reconciles = new Set()
    this.reconcilePromise = null
    this.retryTimers = new Map()
    this.retryAttempts = new Map()
    this.childHealth = new Map()
    this.startPromise = null
    this.closePromise = null
    this.abortController = new AbortController()
    this.abortSignal = this.abortController.signal
  }

  start() {
    if (this.closed) return Promise.reject(new Error('source_coordinator_closed'))
    if (this.startPromise) return this.startPromise
    this.running = true
    this.startPromise = (async () => {
      await this.reconcile()
      if (this.running) this.#scheduleReconcile()
    })()
    return this.startPromise
  }

  async reconcile() {
    if (!this.running || this.closed) return { status: 'closed' }
    if (this.reconcilePromise) return this.reconcilePromise
    const task = Promise.resolve().then(() => this.#reconcile())
    this.reconcilePromise = task
    this.reconciles.add(task)
    try { return await task } finally {
      this.reconciles.delete(task)
      if (this.reconcilePromise === task) this.reconcilePromise = null
    }
  }

  async #reconcile() {
    if (!this.running || this.closed) return
    let inventory
    try {
      inventory = await this.enumerate({ signal: this.abortSignal })
      if (this.abortSignal.aborted || this.closed) return { status: 'closed' }
      if (!inventory || !Array.isArray(inventory.scopes) || !Array.isArray(inventory.families)) throw new Error('inventory_incomplete')
    } catch (error) {
      if (this.abortSignal.aborted || this.closed) return { status: 'closed' }
      this.#health('inventory_unavailable', { source: safeSource(error?.source) })
      return { status: 'incomplete' }
    }
    const partial = inventory.complete !== true
    let retainedPartialScopes = []
    if (partial) this.#health('inventory_partial', { source: 'firestore', failedFamilies: Number.isInteger(inventory.failedFamilyCount) ? inventory.failedFamilyCount : 1 })
    if (partial) {
      const goodFamilies = new Set(inventory.families.map(({ familyId }) => familyId))
      const failedContexts = Array.isArray(inventory.failedContexts) ? inventory.failedContexts : []
      const prior = [...this.known].flatMap(([kind, scopes]) => [...scopes].map(([key, value]) => ({ kind, key, value })))
      const retained = prior.filter(({ kind, value }) => !goodFamilies.has(value.scope.familyId)
        || isFailedContext(kind, value.scope, failedContexts))
      retainedPartialScopes = retained.map(({ kind, value }) => ({ source: kind, scope: value.scope, origin: value.origin }))
      const additions = inventory.scopes.filter((item) => !isFailedContext(item.source, item.scope, failedContexts))
        .map((item) => ({ ...item, origin: 'bootstrap' }))
      const merged = new Map([...retained.map((row) => [`${row.kind}:${row.key}`, row]),
        ...additions.map((item) => {
          const kind = item.source, key = this.sources.get(kind)?.scopeKey(item.scope)
          return [`${kind}:${key}`, { kind, key, value: { scope: item.scope, origin: item.origin } }]
        })])
      inventory = { ...inventory, scopes: [...merged.values()].map(({ kind, value }) => ({ source: kind, scope: value.scope, origin: value.origin })) }
    }
    let prepared = null
    if (this.discoveryStore) {
      try {
        const goodFamilies = partial ? new Set(inventory.families.map(({ familyId }) => familyId)) : null
        const discoveryInventory = partial ? { ...inventory,
          contexts: (inventory.contexts ?? []).filter((item) => goodFamilies.has(item.scope.familyId)
            && !isFailedContext(item.source, item.scope, inventory.failedContexts ?? [])),
          scopes: inventory.scopes.filter((item) => goodFamilies.has(item.scope.familyId)
            && !isFailedContext(item.source, item.scope, inventory.failedContexts ?? [])) } : inventory
        prepared = await this.discoveryStore.prepare(discoveryInventory, { signal: this.abortSignal })
        inventory = { ...inventory, scopes: [...prepared.scopes, ...retainedPartialScopes] }
      } catch {
        if (this.abortSignal.aborted || this.closed) return { status: 'closed' }
        this.#health('inventory_unavailable', { source: 'firestore' })
        return { status: 'incomplete' }
      }
    }
    if (!this.running || this.closed || this.abortSignal.aborted) return { status: 'closed' }

    const nextBySource = new Map([...this.sources.keys()].map((kind) => [kind, new Map()]))
    for (const item of inventory.scopes) {
      const source = this.sources.get(item?.source)
      if (!source || !item.scope || typeof source.scopeKey !== 'function') continue
      const key = source.scopeKey(item.scope)
      if (typeof key !== 'string' || !key) continue
      nextBySource.get(item.source).set(key, { scope: item.scope, origin: item.origin === 'live' ? 'live' : 'bootstrap' })
    }
    // Subscribe replacements before detaching prior listeners. If any new
    // listener installation fails, preserve the last confirmed watch graph.
    const additions = []
    try {
      for (const [kind, scopes] of nextBySource) {
        const previous = this.listeners.get(kind)
        if (sameKeys(previous?.scopes, scopes)) continue
        const source = this.sources.get(kind)
        const unsubscribe = scopes.size ? source.subscribe({
          scopes: [...scopes.values()].map((value) => value.scope),
          onSignal: (scope) => this.signal(kind, scope),
          onError: (error) => this.#health('source_listener_unavailable', { source: safeSource(kind), errorCode: safeCode(error?.code) }),
        }) : async () => {}
        additions.push({ kind, scopes, unsubscribe })
      }
    } catch {
      for (const item of additions) await bestEffort(item.unsubscribe)
      this.#health('source_listener_unavailable', { source: 'unknown' })
      return { status: 'listener_error' }
    }
    if (!this.running || this.closed || this.abortSignal.aborted) {
      for (const item of additions) await bestEffort(item.unsubscribe)
      return { status: 'closed' }
    }
    if (prepared) {
      try {
        const confirmed = await this.discoveryStore.confirm(prepared, { signal: this.abortSignal })
        const originByKey = new Map(confirmed.scopes.map((item) => [
          `${item.source}:${this.sources.get(item.source).scopeKey(item.scope)}`, item.origin,
        ]))
        for (const [kind, scopes] of nextBySource) for (const [key, value] of scopes) {
          value.origin = originByKey.get(`${kind}:${key}`) ?? value.origin
        }
      }
      catch {
        for (const item of additions) await bestEffort(item.unsubscribe)
        if (this.abortSignal.aborted || this.closed) return { status: 'closed' }
        this.#health('inventory_unavailable', { source: 'firestore' })
        return { status: 'incomplete' }
      }
    }
    if (!this.running || this.closed || this.abortSignal.aborted) {
      for (const item of additions) await bestEffort(item.unsubscribe)
      return { status: 'closed' }
    }
    for (const item of additions) {
      const previous = this.listeners.get(item.kind)
      this.listeners.set(item.kind, item)
      if (previous) await bestEffort(previous.unsubscribe)
    }
    for (const [kind, scopes] of nextBySource) {
      const previous = this.known.get(kind) ?? new Map()
      this.known.set(kind, scopes)
      // A newly discovered scope needs one baseline read. Existing scopes are
      // woken by their document listeners or by the adapter's reconnect pass.
      for (const [key, value] of scopes) if (!previous.has(key)) this.#enqueue(kind, value.scope, value.origin)
    }
    this.#pruneRemovedScopes()
    this.#publishChildHealth(inventory.registeredChildren ?? [], inventory.complete === true)
    this.#pump()
    return { status: partial ? 'partial' : 'complete', scopes: inventory.scopes.length }
  }

  signal(kind, scope, { origin } = {}) {
    if (!this.running || this.closed || !this.sources.has(kind)) return false
    const source = this.sources.get(kind)
    const key = source.scopeKey(scope)
    if (!this.known.get(kind)?.has(key)) return false
    const queueKey = `${kind}:${key}`
    const retryTimer = this.retryTimers.get(queueKey)
    if (retryTimer) this.clearTimer(retryTimer)
    this.retryTimers.delete(queueKey)
    this.retryAttempts.delete(queueKey)
    this.#enqueue(kind, scope, origin === 'live' ? 'live' : this.known.get(kind).get(key).origin)
    this.#pump()
    return true
  }

  async close() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.running = false
    this.abortController.abort()
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    for (const timer of this.retryTimers.values()) this.clearTimer(timer)
    this.retryTimers.clear()
    this.pending.clear()
    this.closePromise = (async () => {
      const listeners = [...this.listeners.values()]
      this.listeners.clear()
      const unsubscribeResults = await Promise.allSettled(listeners.map(({ unsubscribe }) => unsubscribe?.()))
      await Promise.allSettled([...(this.startPromise ? [this.startPromise] : []), ...this.reconciles, ...this.inflight])
      if (unsubscribeResults.some((result) => result.status === 'rejected')) throw new Error('source_stop_failed')
    })()
    return this.closePromise
  }

  #enqueue(kind, scope, origin) {
    const key = this.sources.get(kind).scopeKey(scope)
    const queueKey = `${kind}:${key}`
    const old = this.pending.get(queueKey)
    this.pending.set(queueKey, { kind, scope, origin: old?.origin === 'live' || origin === 'live' ? 'live' : 'bootstrap', queuedAt: this.clock() })
  }

  #pump() {
    while (this.running && this.active < this.concurrency && this.pending.size) {
      const entries = [...this.pending.entries()]
      const available = entries.map(([key, item], index) => ({ key, item, index }))
        .filter(({ key }) => !this.activeKeys.has(key))
      if (!available.length) return
      const bootstrapAvailable = available.some(({ item }) => item.origin !== 'live')
      const preferBootstrap = bootstrapAvailable && this.liveDispatchBurst >= this.maxLiveBurst
      const desiredOrigin = preferBootstrap ? 'bootstrap'
        : available.some(({ item }) => item.origin === 'live') ? 'live' : 'bootstrap'
      const candidates = available.filter(({ item }) => (item.origin === 'live' ? 'live' : 'bootstrap') === desiredOrigin)
      const selected = candidates.reduce((best, candidate) => {
        const distance = (candidate.index - this.cursor + entries.length) % entries.length
        const bestDistance = best ? (best.index - this.cursor + entries.length) % entries.length : Infinity
        return distance < bestDistance ? candidate : best
      }, null)
      const selectedIndex = selected.index
      const entry = entries[selectedIndex]
      // After removal, the following entry occupies this index. Keep the cursor
      // there so items within each origin class retain cyclic fairness.
      this.cursor = selectedIndex % Math.max(entries.length - 1, 1)
      if (desiredOrigin === 'live') this.liveDispatchBurst = Math.min(this.maxLiveBurst, this.liveDispatchBurst + 1)
      else this.liveDispatchBurst = 0
      this.pending.delete(entry[0])
      const item = entry[1]
      this.activeKeys.add(entry[0])
      this.active++
      let task
      task = Promise.resolve().then(async () => {
        try {
          const pipeline = this.pipelines?.[item.kind]
          if (!pipeline || typeof pipeline.process !== 'function') throw new Error('source_pipeline_unavailable')
          const result = await pipeline.process(item.scope, { origin: item.origin, signal: this.abortSignal })
          if (this.abortSignal.aborted || this.closed) return
          if (result?.status === 'incomplete') {
            const reasonCode = ['source_snapshot_incomplete', 'source_snapshot_too_large'].includes(result.reasonCode) ? result.reasonCode : undefined
            this.#health('source_observation_blocked', { source: safeSource(item.kind),
              scopeKey: scopeKeyForHealth(this.sources.get(item.kind), item.scope), ...(reasonCode ? { reasonCode } : {}) })
            this.#scheduleRetry(entry[0], item)
          } else if (result?.status === 'busy') this.#scheduleRetry(entry[0], item)
          else this.retryAttempts.delete(entry[0])
        } catch (error) {
          if (this.abortSignal.aborted || this.closed) return
          this.#health('source_observation_failed', { source: safeSource(item.kind), scopeKey: scopeKeyForHealth(this.sources.get(item.kind), item.scope), errorCode: safeCode(error?.message) })
          this.#scheduleRetry(entry[0], item)
        } finally {
          this.active--
          this.activeKeys.delete(entry[0])
          this.inflight.delete(task)
          this.#pump()
        }
      })
      this.inflight.add(task)
    }
  }

  #scheduleReconcile() {
    if (!this.running || this.closed || this.timer) return
    const jitter = Math.floor(this.random() * Math.max(1, this.reconcileMs / 10))
    this.timer = this.setTimer(async () => {
      this.timer = null
      await this.reconcile()
      this.#scheduleReconcile()
    }, this.reconcileMs + jitter)
    this.timer?.unref?.()
  }

  #scheduleRetry(queueKey, item) {
    if (!this.running || this.closed || this.retryTimers.has(queueKey)) return
    const attempt = (this.retryAttempts.get(queueKey) ?? 0) + 1
    this.retryAttempts.set(queueKey, attempt)
    const base = Math.min(60_000, 1_000 * (2 ** Math.min(attempt - 1, 6)))
    const jitter = Math.floor(this.random() * Math.max(1, base / 5))
    const timer = this.setTimer(() => {
      this.retryTimers.delete(queueKey)
      if (!this.running || this.closed) return
      if (!this.known.get(item.kind)?.has(this.sources.get(item.kind).scopeKey(item.scope))) {
        this.retryAttempts.delete(queueKey)
        return
      }
      this.#enqueue(item.kind, item.scope, item.origin)
      this.#pump()
    }, base + jitter)
    timer?.unref?.()
    this.retryTimers.set(queueKey, timer)
  }

  #pruneRemovedScopes() {
    const isKnown = (queueKey) => {
      const separator = queueKey.indexOf(':')
      const kind = queueKey.slice(0, separator)
      const key = queueKey.slice(separator + 1)
      return this.known.get(kind)?.has(key) === true
    }
    for (const key of this.pending.keys()) if (!isKnown(key)) this.pending.delete(key)
    for (const [key, timer] of this.retryTimers) if (!isKnown(key)) {
      this.clearTimer(timer)
      this.retryTimers.delete(key)
      this.retryAttempts.delete(key)
    }
  }

  #health(code, fields = {}) {
    try { this.onHealth({ code, ...fields }) } catch { /* health reporting must not stop observation */ }
  }

  #publishChildHealth(children, complete) {
    const current = new Map()
    for (const child of children) {
      const key = createHash('sha256').update(JSON.stringify([child.familyId, child.childId])).digest('hex')
      const status = { hasMeshIdentity: child.hasMeshIdentity === true, hasMeshAccount: child.hasMeshAccount === true }
      current.set(key, status)
      if (JSON.stringify(this.childHealth.get(key)) !== JSON.stringify(status)) {
        this.#health('registered_child_inventory', { source: 'firestore', scopeKey: key, ...status })
      }
    }
    if (complete) for (const key of this.childHealth.keys()) if (!current.has(key)) {
      this.#health('registered_child_removed', { source: 'firestore', scopeKey: key })
    }
    this.childHealth = complete ? current : new Map([...this.childHealth, ...current])
  }
}

function sameKeys(left, right) {
  if (!left || left.size !== right.size) return false
  for (const key of right.keys()) if (!left.has(key)) return false
  return true
}
function isFailedContext(source, scope, contexts) {
  return contexts.some((context) => context.source === source && context.familyId === scope.familyId
    && (context.childId === undefined || context.childId === scope.childId)
    && (context.sourceAccountId === undefined || context.sourceAccountId === scope.sourceAccountId))
}
function safeSource(value) { return ['firestore', 'mesh'].includes(value) ? value : 'unknown' }
function safeScopeKey(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : undefined }
function scopeKeyForHealth(source, scope) { try { return safeScopeKey(source?.scopeKey?.(scope)) } catch { return undefined } }
function safeCode(value) {
  const allowed = new Set(['source_port_unavailable', 'source_pipeline_unavailable', 'checkpoint_port_unavailable',
    'invalid_source_pipeline_config', 'invalid_source_origin', 'source_signal_handler_failed', 'source_listener_unavailable',
    'source_observation_failed', 'dependency_unavailable', 'unavailable', 'deadline-exceeded', 'resource-exhausted',
    'permission-denied', 'failed-precondition', 'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal'])
  return allowed.has(value) ? value : 'source_error'
}
async function bestEffort(fn) { try { await fn?.() } catch { /* best-effort listener cleanup */ } }
