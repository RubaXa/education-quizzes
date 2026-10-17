import { FieldPath } from '@google-cloud/firestore'
import { dateWindow } from '../../../sync/project-plan.mjs'
import { createFamilyGraphRepository } from '../../education-runtime/family-graph.mjs'
import { eligibleMeshAccounts, isActiveParentForChild, isRegisteredMeshChild,
  isRegisteredMeshParentAccount, meshChildIdentityId } from '../../education-runtime/identity.mjs'

/** @see ../../../docs/shared/server-runtime.md#границы-и-порты @see ../../../docs/services/telegram-bot/adapters/firestore.md#области-данных-для-валидации */
const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Enumerates the authoritative family graph with keyset pagination. The result
 * is complete only when every family and every scoped child collection drains;
 * callers must retain their last confirmed listener set on incomplete results.
 */
export function createFirestoreSourceInventory(db, { pageSize = 250, includeFirestore = true, includeMesh = false,
  now = () => new Date(), meshSource = null, telemetry = null } = {}) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000
    || includeMesh && typeof meshSource?.discoverGradeScopes !== 'function') throw new Error('invalid_source_inventory_config')
  const familyGraph = createFamilyGraphRepository(db, { pageSize, telemetry })

  async function enumerate({ signal = null } = {}) {
    const scopes = []
    const families = []
    const contexts = []
    const registeredChildren = []
    const sourceAccounts = []
    const failures = []
    const failedContexts = []
    if (signal?.aborted) throw Object.assign(new Error('worker_shutdown'), { code: 'worker_shutdown' })
    const graph = await familyGraph.enumerate({ includeInactiveFamilies: false, includeInactiveChildren: false, signal })
    failures.push(...graph.failures.map((failure) => ({ ...(failure.familyId ? { familyId: failure.familyId } : {}),
      ...(failure.source === 'children' || failure.source === 'members' || failure.source === 'accounts' || failure.source === 'identities'
        ? { source: 'firestore' } : {}), code: failure.code })))
    failedContexts.push(...graph.failures.filter((failure) => failure.familyId).map((failure) => ({
      source: 'firestore', familyId: failure.familyId })))
    const failedFamilies = new Set(graph.failures.map((failure) => failure.familyId).filter(Boolean))
    for (const family of graph.families) {
      if (signal?.aborted) throw Object.assign(new Error('worker_shutdown'), { code: 'worker_shutdown' })
      const familyId = family.id
      if (failedFamilies.has(familyId)) continue
      const children = new Map(graph.children.filter((child) => child.familyId === familyId && ID.test(child.id))
        .map((child) => [child.id, child]))
      const members = graph.members.filter((member) => member.familyId === familyId && ID.test(member.id))
      const accounts = graph.accounts.filter((account) => account.familyId === familyId)
      const identities = graph.identities.filter((identity) => identity.familyId === familyId)
      const familyScopes = []
      const childStatuses = []
      for (const [childId, child] of children) {
        const parentMembers = members.filter((member) => isActiveParentForChild(member, childId)).map((member) => member.id)
        const sourcePersonId = safeId(child.meshPersonId)
        const identity = sourcePersonId ? identities.find((item) => item.id === meshChildIdentityId(sourcePersonId)) : null
        const hasRegisteredIdentity = Boolean(sourcePersonId && isRegisteredMeshChild({ familyId, childId,
          family, child, identity }))
        const hasMeshLinkEvidence = Boolean(sourcePersonId || identities.some((item) => item.childId === childId && item.source === 'mesh'))
        childStatuses.push({ familyId, childId, child, identity, parentMembers,
          hasMeshIdentity: Boolean(sourcePersonId), hasRegisteredIdentity, hasMeshLinkEvidence })
      }
      const meshAccounts = []
      for (const account of accounts) {
        const member = members.find((item) => item.id === account.personId)
        if (!isRegisteredMeshParentAccount({ familyId, family, account, member })) continue
        sourceAccounts.push({ familyId, accountId: account.id, personId: account.personId, sourcePersonId: account.sourcePersonId })
        meshAccounts.push({ ...account, actorId: account.sourcePersonId })
      }
      for (const status of childStatuses) {
        const hasMeshAccount = status.hasRegisteredIdentity && eligibleMeshAccounts({ familyId, childId: status.childId,
          family, child: status.child, members, identities: [status.identity], accounts }).length > 0
        const meshStatus = !status.hasMeshLinkEvidence ? 'not-linked'
          : !status.hasRegisteredIdentity ? 'identity-unregistered'
            : !hasMeshAccount ? 'owner-unavailable' : 'eligible'
        registeredChildren.push({ familyId, childId: status.childId,
          hasMeshIdentity: status.hasMeshIdentity, hasMeshAccount, meshStatus })
      }
      if (includeFirestore) {
        try { await addFamilyScopes(db, familyId, children, familyScopes, pageSize) }
        catch (error) {
          failures.push({ familyId, source: 'firestore', code: safeErrorCode(error) })
          failedContexts.push({ source: 'firestore', familyId })
        }
      }
      if (includeMesh) {
        const result = await addMeshScopes(db, family, children, members, meshAccounts, identities, familyScopes, now, meshSource, signal)
        failures.push(...result.failures)
        failedContexts.push(...result.failedContexts)
      }
      scopes.push(...familyScopes)
      for (const childId of children.keys()) if (includeFirestore) contexts.push({ source: 'firestore', scope: { familyId, childId } })
      for (const { scope } of familyScopes) if (scope.source === 'mesh') contexts.push({ source: 'mesh',
        scope: { familyId: scope.familyId, childId: scope.childId, sourceAccountId: scope.sourceAccountId, sourcePersonId: scope.sourcePersonId } })
      families.push({ familyId })
    }
    const uniqueContexts = [...new Map(contexts.map((item) => [`${item.source}:${JSON.stringify(item.scope)}`, item])).values()]
    return Object.freeze({ complete: failures.length === 0, scopes: Object.freeze(scopes), contexts: Object.freeze(uniqueContexts),
      failedFamilyCount: new Set(failures.map(({ familyId }) => familyId).filter(Boolean)).size + failures.filter(({ familyId }) => !familyId).length,
      failedContexts: Object.freeze(failedContexts),
      families: Object.freeze(families), registeredChildren: Object.freeze(registeredChildren),
      sourceAccounts: Object.freeze(sourceAccounts), failures: Object.freeze(failures) })
  }
  return Object.freeze({ enumerate })
}

async function addFamilyScopes(db, familyId, children, output, pageSize) {
  // Assignments are read only from this family's projection. Every candidate
  // must carry the exact family/child pair and refer to a registered child.
  for await (const doc of pages(project(db.collection('assignments').where('familyId', '==', familyId), 'familyId', 'childId'), pageSize)) {
    const data = doc.data() ?? {}
    if (!ID.test(doc.id) || data.familyId !== familyId || !children.has(data.childId) || children.get(data.childId)?.active === false) continue
    output.push({ source: 'firestore', scope: { familyId, childId: data.childId, kind: 'quiz', quizToken: doc.id }, origin: 'bootstrap' })
  }
  // The legacy owner token is usable only for an exact canonical owner pair.
  for await (const doc of pages(project(db.collection('dayOwners').where('familyId', '==', familyId), 'familyId', 'childId', 'date'), pageSize)) {
    const owner = doc.data() ?? {}
    if (!ID.test(doc.id) || owner.familyId !== familyId || !children.has(owner.childId)
      || children.get(owner.childId)?.active === false || !validDay(owner.date)) continue
    const dayToken = doc.id
    const [uploads, progress] = await Promise.all([
      collect(project(db.collection(`dayUploads/${dayToken}/files`)), pageSize), collect(project(db.collection(`dayProgress/${dayToken}/items`)), pageSize),
    ])
    for (const file of uploads) if (ID.test(file.id)) output.push({ source: 'firestore',
      scope: { familyId, childId: owner.childId, kind: 'upload', dayToken, recordId: file.id }, origin: 'bootstrap' })
    for (const item of progress) if (ID.test(item.id)) output.push({ source: 'firestore',
      scope: { familyId, childId: owner.childId, kind: 'progress', dayToken, recordId: item.id }, origin: 'bootstrap' })
  }
}

async function addMeshScopes(db, family, children, members, accounts, identities, output, now, meshSource, signal = null) {
  const familyId = family.id
  const today = formatMoscowDate(now())
  const dates = dateWindow(today)
  const failedContexts = []
  const failures = []
  for (const [childId, child] of children) {
    if (signal?.aborted) throw Object.assign(new Error('worker_shutdown'), { code: 'worker_shutdown' })
    const sourcePersonId = safeId(child.meshPersonId)
    if (!sourcePersonId) continue
    const identity = identities.find((item) => item.id === meshChildIdentityId(sourcePersonId))
    if (!isRegisteredMeshChild({ familyId, childId, family, child, identity })) continue
    const eligibleAccounts = eligibleMeshAccounts({ familyId, childId, family, child,
      members: members.filter((member) => member.familyId === familyId), identities: [identity], accounts })
      .map((account) => ({ accountId: account.id, personId: account.personId, actorId: account.sourcePersonId }))
    const account = eligibleAccounts[0]
    if (account) {
      const descriptor = { source: 'mesh', familyId, childId, sourceAccountId: account.accountId, sourcePersonId }
      let contextReady = true
      try {
        const gradeScopes = await meshSource.discoverGradeScopes({ ...descriptor, kind: 'grades' }, { signal })
        if (!Array.isArray(gradeScopes)) throw new Error('source_grade_inventory_invalid')
        const validated = gradeScopes.map((scope) => {
          if (scope.source !== 'mesh' || scope.familyId !== familyId || scope.childId !== childId
            || scope.sourceAccountId !== account.accountId || scope.sourcePersonId !== sourcePersonId
            || scope.kind !== 'grades' || !safeId(scope.subjectId) || !validDay(scope.periodKey)) throw new Error('source_grade_inventory_invalid')
          return scope
        })
        for (const scope of validated) output.push({ source: 'mesh', scope, origin: 'bootstrap' })
      } catch (error) {
        contextReady = false
        failures.push({ familyId, source: 'mesh', code: safeMeshErrorCode(error) })
        failedContexts.push({ source: 'mesh', familyId, childId, sourceAccountId: account.accountId })
      }
      if (contextReady) {
        for (const date of dates) {
          output.push({ source: 'mesh', scope: { ...descriptor, kind: 'schedule', date }, origin: 'bootstrap' })
          output.push({ source: 'mesh', scope: { ...descriptor, kind: 'homework', date }, origin: 'bootstrap' })
        }
      }
    }
  }
  return { failures, failedContexts }
}

async function collect(query, pageSize) {
  const docs = []
  for await (const doc of pages(query, pageSize)) docs.push(doc)
  return docs
}

function project(query, ...fields) { return query.select(...fields) }

async function* pages(query, pageSize) {
  let cursor = null
  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId())
    if (cursor) pageQuery = pageQuery.startAfter(cursor)
    pageQuery = pageQuery.limit(pageSize)
    const page = await pageQuery.get()
    if (!page || !Array.isArray(page.docs)) throw new Error('source_inventory_page_invalid')
    for (const doc of page.docs) yield doc
    if (page.docs.length < pageSize) return
    cursor = page.docs.at(-1)
  }
}

function safeId(value) { return typeof value === 'string' && ID.test(value) ? value : null }
function formatMoscowDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new Error('source_clock_invalid')
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
function safeErrorCode(error) {
  const code = error?.code
  const allowed = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'permission-denied',
    'failed-precondition', 'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal',
    'scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable', 'mesh_incomplete',
    'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid', 'credential_refresh_persist_failed'])
  return allowed.has(code) ? code : 'inventory_read_failed'
}
function safeMeshErrorCode(error) {
  const code = error?.code ?? error?.message
  const allowed = new Set(['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable',
    'mesh_incomplete', 'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed',
    'credential_refresh_invalid', 'credential_refresh_persist_failed', 'source_grade_inventory_invalid'])
  return allowed.has(code) ? code : 'mesh_unavailable'
}
