/** Shared paginated family graph; consumers derive separate projections.
 * @see ../../docs/shared/server-runtime.md#границы-и-порты
 */
import { FieldPath } from '@google-cloud/firestore'
import { validRuntimeId } from './identity.mjs'

/** Read a complete family graph in bounded keyset pages. Partial families are retained with safe failure codes. */
export function createFamilyGraphRepository(db, { pageSize = 250, telemetry = null, fieldPath = FieldPath.documentId() } = {}) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('invalid_family_graph_config')

  async function enumerate({ includeInactiveFamilies = true, includeInactiveChildren = true, signal } = {}) {
    throwIfAborted(signal)
    const graph = { complete: true, families: [], children: [], members: [], accounts: [], identities: [], failures: [] }
    let familyDocs
    try { familyDocs = await collect(db.collection('families'), 'families', signal) }
    catch (error) {
      throwIfAborted(signal)
      return Object.freeze({ ...graph, complete: false, failures: Object.freeze([{ code: safeErrorCode(error) }]) })
    }

    for (const familyDoc of familyDocs) {
      throwIfAborted(signal)
      const family = { ...data(familyDoc), id: familyDoc.id }
      if (!validRuntimeId(family.id) || (!includeInactiveFamilies && family.active === false)) continue
      const base = `families/${family.id}`
      const reads = await Promise.allSettled([
        collect(db.collection(`${base}/children`), 'family.children', signal),
        collect(db.collection(`${base}/members`), 'family.members', signal),
        collect(db.collection('sourceAccounts').where('familyId', '==', family.id), 'family.sourceAccounts', signal),
        collect(db.collection('sourceIdentities').where('familyId', '==', family.id), 'family.sourceIdentities', signal),
      ])
      throwIfAborted(signal)
      graph.families.push(family)
      let familyFailed = false
      const result = []
      for (let i = 0; i < reads.length; i++) {
        const settled = reads[i]
        if (settled.status === 'rejected') {
          graph.failures.push({ familyId: family.id, source: ['children', 'members', 'accounts', 'identities'][i], code: safeErrorCode(settled.reason) })
          familyFailed = true
          result[i] = []
        } else result[i] = settled.value
      }
      const [children, members, accounts, identities] = result
      graph.children.push(...children.map((doc) => ({ ...data(doc), id: doc.id, familyId: family.id }))
        .filter((child) => includeInactiveChildren || child.active !== false))
      graph.members.push(...members.map((doc) => ({ ...data(doc), id: doc.id, familyId: family.id })))
      graph.accounts.push(...accounts.map((doc) => ({ ...data(doc), id: doc.id, familyId: family.id })))
      graph.identities.push(...identities.map((doc) => ({ ...data(doc), id: doc.id, familyId: family.id })))
      if (familyFailed) graph.complete = false
    }

    return Object.freeze({ ...graph, complete: graph.complete && graph.failures.length === 0,
      families: Object.freeze(graph.families), children: Object.freeze(graph.children), members: Object.freeze(graph.members),
      accounts: Object.freeze(graph.accounts), identities: Object.freeze(graph.identities), failures: Object.freeze(graph.failures) })
  }

  async function collect(query, operation, signal) {
    return span(telemetry, `firestore.${operation}`, async () => {
      const docs = []
      let cursor = null
      while (true) {
        throwIfAborted(signal)
        let pageQuery = query.orderBy(fieldPath)
        if (cursor) pageQuery = pageQuery.startAfter(cursor)
        const page = await pageQuery.limit(pageSize).get()
        throwIfAborted(signal)
        if (!page || !Array.isArray(page.docs)) throw new Error('family_graph_page_invalid')
        telemetry?.count?.('firestore.graph.documents.projected', page.docs.length)
        telemetry?.count?.('firestore.graph.query.pages')
        docs.push(...page.docs)
        if (page.docs.length < pageSize) return docs
        cursor = page.docs.at(-1)
      }
    }, { source: 'firestore', consumer: 'family-graph' })
  }

  return Object.freeze({ enumerate })
}

function data(document) { return document.data?.() ?? {} }
function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('worker_shutdown')
  error.name = 'AbortError'
  error.code = 'worker_shutdown'
  throw error
}
function span(telemetry, operation, work, attributes) {
  return telemetry?.span ? telemetry.span(operation, work, attributes) : work()
}
function safeErrorCode(error) {
  const code = error?.code
  return ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'permission-denied', 'failed-precondition',
    'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal'].includes(code) ? code : 'family_graph_read_failed'
}
