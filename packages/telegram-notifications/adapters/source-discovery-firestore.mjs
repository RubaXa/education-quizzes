import { FieldValue } from '@google-cloud/firestore'
import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов @see ../../../docs/services/telegram-bot/adapters/firestore.md#масштабирование */
const digest = (value) => createHash('sha256').update(value).digest('hex')

/** Durable bootstrap classification. Stored IDs are hashes of port keys only. */
export function createFirestoreSourceDiscoveryStore(db, { collection = 'telegramSourceDiscovery', namespace = 'notify',
  confirmConcurrency = 8,
  scopeKey = (source, scope) => digest(JSON.stringify([source, scope.familyId, scope.childId, scope.kind,
    scope.quizToken ?? null, scope.dayToken ?? null, scope.recordId ?? null])),
  clock = () => FieldValue.serverTimestamp() } = {}) {
  if (!db || typeof collection !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection)
    || !['notify', 'shadow'].includes(namespace) || typeof scopeKey !== 'function'
    || !Number.isInteger(confirmConcurrency) || confirmConcurrency < 1 || confirmConcurrency > 64) {
    throw new Error('invalid_source_discovery_store')
  }
  const ref = (key) => db.doc(`${collection}/${namespace}_${key}`)
  const contextHash = (source, scope) => digest(JSON.stringify([namespace, source, scope.familyId, scope.childId, scope.sourceAccountId ?? null]))
  const scopeHash = (source, scope) => digest(JSON.stringify([namespace, source, scopeKey(source, scope)]))

  async function prepare(inventory, { signal } = {}) {
    throwIfAborted(signal)
    if (!inventory || !Array.isArray(inventory.scopes) || !Array.isArray(inventory.families)) throw new Error('inventory_incomplete')
    const contexts = new Map()
    for (const item of inventory.contexts ?? []) contexts.set(contextHash(item.source, item.scope), item)
    const scopeRows = inventory.scopes.map((item) => {
      const context = contextHash(item.source, item.scope)
      contexts.set(context, { source: item.source, scope: item.scope })
      return { ...item, context, key: scopeHash(item.source, item.scope) }
    })
    const contextRefs = [...contexts.keys()].map((key) => ref(`context_${key}`))
    const scopeRefs = scopeRows.map(({ key }) => ref(`scope_${key}`))
    const snapshots = await getInBatches([...contextRefs, ...scopeRefs], 200, signal)
    throwIfAborted(signal)
    const exists = new Set(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.ref.path.split('/').at(-1)))
    const contextKnown = new Set([...contexts.keys()].filter((key) => exists.has(`${namespace}_context_${key}`)))
    const origins = new Map()
    scopeRows.forEach((row, index) => {
      const snapshot = snapshots[contextRefs.length + index]
      const storedOrigin = snapshot?.exists ? snapshot.data()?.origin : null
      origins.set(row.key, ['bootstrap', 'live'].includes(storedOrigin) ? storedOrigin
        : contextKnown.has(row.context) && row.source !== 'mesh' ? 'live' : 'bootstrap')
    })
    const scopes = scopeRows.map((row) => ({ source: row.source, scope: row.scope, origin: origins.get(row.key) }))
    return Object.freeze({ inventory, scopes: Object.freeze(scopes),
      contextHashes: Object.freeze([...contexts.keys()]), confirmedContextHashes: Object.freeze([...contextKnown]),
      scopeHashes: Object.freeze(scopeRows.map(({ key }) => key)),
      scopeContexts: Object.freeze(scopeRows.map(({ key, context }, index) => ({ key, context, origin: origins.get(key),
        persisted: snapshots[contextRefs.length + index]?.exists === true }))) })
  }

  async function confirm(prepared, { signal } = {}) {
    throwIfAborted(signal)
    if (!prepared?.inventory || !Array.isArray(prepared.scopeContexts)) throw new Error('inventory_incomplete')
    const confirmedOrigins = new Map()
    let cursor = 0
    let failure = null
    const confirmScope = async (item) => {
      throwIfAborted(signal)
      if (item.persisted) { confirmedOrigins.set(item.key, item.origin); return }
      const scopeRef = ref(`scope_${item.key}`)
      await db.runTransaction(async (tx) => {
        const scopeDoc = await tx.get(scopeRef)
        throwIfAborted(signal)
        if (scopeDoc.exists) {
          const origin = scopeDoc.data()?.origin
          confirmedOrigins.set(item.key, ['bootstrap', 'live'].includes(origin) ? origin : item.origin)
        } else {
          tx.create(scopeRef, { kind: 'scope', origin: item.origin, confirmedAt: clock() })
          confirmedOrigins.set(item.key, item.origin)
        }
      })
    }
    const worker = async () => {
      while (!failure && cursor < prepared.scopeContexts.length) {
        throwIfAborted(signal)
        const item = prepared.scopeContexts[cursor++]
        try { await confirmScope(item) } catch (error) { failure ??= error; return }
      }
    }
    const workers = Array.from({ length: Math.min(confirmConcurrency, prepared.scopeContexts.length) }, () => worker())
    const settled = await Promise.allSettled(workers)
    const rejected = settled.find((result) => result.status === 'rejected')
    if (failure) throw failure
    if (rejected) throw rejected.reason
    throwIfAborted(signal)
    // Publish context completion only after every scope origin is durable.
    for (const context of prepared.contextHashes) {
      throwIfAborted(signal)
      if (prepared.confirmedContextHashes?.includes(context)) continue
      const contextRef = ref(`context_${context}`)
      await db.runTransaction(async (tx) => {
        const contextDoc = await tx.get(contextRef)
        throwIfAborted(signal)
        if (!contextDoc.exists) tx.create(contextRef, { kind: 'context', confirmedAt: clock() })
      })
    }
    const scopes = prepared.scopes.map((item) => ({ ...item,
      origin: confirmedOrigins.get(scopeHash(item.source, item.scope)) ?? item.origin }))
    return Object.freeze({ scopes: Object.freeze(scopes) })
  }

  async function confirmCandidate(source, scope, { signal } = {}) {
    throwIfAborted(signal)
    if (source !== 'firestore' || !scope?.familyId || !scope?.childId) return { status: 'invalid' }
    const context = contextHash(source, scope)
    const key = scopeHash(source, scope)
    const contextRef = ref(`context_${context}`)
    const scopeRef = ref(`scope_${key}`)
    const origin = await db.runTransaction(async (tx) => {
      throwIfAborted(signal)
      const contextDoc = await tx.get(contextRef)
      throwIfAborted(signal)
      if (!contextDoc.exists) return null
      const scopeDoc = await tx.get(scopeRef)
      throwIfAborted(signal)
      if (scopeDoc.exists) {
        const persistedOrigin = scopeDoc.data()?.origin
        return ['bootstrap', 'live'].includes(persistedOrigin) ? persistedOrigin : 'live'
      } else {
        tx.create(scopeRef, { kind: 'scope', origin: 'live', confirmedAt: clock() })
        return 'live'
      }
    })
    throwIfAborted(signal)
    return origin ? { status: 'confirmed', origin } : { status: 'context_unconfirmed' }
  }

  return Object.freeze({ prepare, confirm, confirmCandidate })
}

async function getInBatches(refs, size, signal) {
  const snapshots = []
  for (let offset = 0; offset < refs.length; offset += size) {
    throwIfAborted(signal)
    const batch = refs.slice(offset, offset + size)
    if (batch.length) snapshots.push(...await Promise.all(batch.map((item) => item.get())))
  }
  throwIfAborted(signal)
  return snapshots
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('source_discovery_aborted')
  error.name = 'AbortError'
  error.code = 'source_discovery_aborted'
  throw error
}
