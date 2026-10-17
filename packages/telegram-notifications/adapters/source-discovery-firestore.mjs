import { FieldValue } from '@google-cloud/firestore'
import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов @see ../../../docs/services/telegram-bot/adapters/firestore.md#масштабирование */
const digest = (value) => createHash('sha256').update(value).digest('hex')

/** Durable bootstrap classification. Stored IDs are hashes of port keys only. */
export function createFirestoreSourceDiscoveryStore(db, { collection = 'telegramSourceDiscovery', namespace = 'notify',
  scopeKey = (source, scope) => digest(JSON.stringify([source, scope.familyId, scope.childId, scope.kind,
    scope.quizToken ?? null, scope.dayToken ?? null, scope.recordId ?? null])),
  clock = () => FieldValue.serverTimestamp() } = {}) {
  if (!db || typeof collection !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection)
    || !['notify', 'shadow'].includes(namespace) || typeof scopeKey !== 'function') throw new Error('invalid_source_discovery_store')
  const ref = (key) => db.doc(`${collection}/${namespace}_${key}`)
  const contextHash = (source, scope) => digest(JSON.stringify([namespace, source, scope.familyId, scope.childId, scope.sourceAccountId ?? null]))
  const scopeHash = (source, scope) => digest(JSON.stringify([namespace, source, scopeKey(source, scope)]))

  async function prepare(inventory) {
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
    const snapshots = await getInBatches([...contextRefs, ...scopeRefs], 200)
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

  async function confirm(prepared) {
    if (!prepared?.inventory || !Array.isArray(prepared.scopeContexts)) throw new Error('inventory_incomplete')
    const confirmedOrigins = new Map()
    for (const item of prepared.scopeContexts) {
      if (item.persisted) { confirmedOrigins.set(item.key, item.origin); continue }
      const scopeRef = ref(`scope_${item.key}`)
      await db.runTransaction(async (tx) => {
        const scopeDoc = await tx.get(scopeRef)
        if (scopeDoc.exists) {
          const origin = scopeDoc.data()?.origin
          confirmedOrigins.set(item.key, ['bootstrap', 'live'].includes(origin) ? origin : item.origin)
        } else {
          tx.create(scopeRef, { kind: 'scope', origin: item.origin, confirmedAt: clock() })
          confirmedOrigins.set(item.key, item.origin)
        }
      })
    }
    // Publish context completion only after every scope origin is durable.
    for (const context of prepared.contextHashes) {
      if (prepared.confirmedContextHashes?.includes(context)) continue
      const contextRef = ref(`context_${context}`)
      await db.runTransaction(async (tx) => {
        const contextDoc = await tx.get(contextRef)
        if (!contextDoc.exists) tx.create(contextRef, { kind: 'context', confirmedAt: clock() })
      })
    }
    const scopes = prepared.scopes.map((item) => ({ ...item,
      origin: confirmedOrigins.get(scopeHash(item.source, item.scope)) ?? item.origin }))
    return Object.freeze({ scopes: Object.freeze(scopes) })
  }

  return Object.freeze({ prepare, confirm })
}

async function getInBatches(refs, size) {
  const snapshots = []
  for (let offset = 0; offset < refs.length; offset += size) {
    const batch = refs.slice(offset, offset + size)
    if (batch.length) snapshots.push(...await Promise.all(batch.map((item) => item.get())))
  }
  return snapshots
}
