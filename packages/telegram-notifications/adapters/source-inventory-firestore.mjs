import { FieldPath } from '@google-cloud/firestore'
import { createHash } from 'node:crypto'
import { dateWindow } from '../../../sync/project-plan.mjs'

/** @see ../../../docs/services/telegram-bot/adapters/firestore.md#области-данных-для-валидации */
const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Enumerates the authoritative family graph with keyset pagination. The result
 * is complete only when every family and every scoped child collection drains;
 * callers must retain their last confirmed listener set on incomplete results.
 */
export function createFirestoreSourceInventory(db, { pageSize = 250, includeFirestore = true, includeMesh = false,
  now = () => new Date(), meshSource = null } = {}) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000
    || includeMesh && typeof meshSource?.discoverGradeScopes !== 'function') throw new Error('invalid_source_inventory_config')

  async function enumerate() {
    const scopes = []
    const families = []
    const contexts = []
    const registeredChildren = []
    const sourceAccounts = []
    const failures = []
    const failedContexts = []
    try {
      for await (const familyDoc of pages(project(db.collection('families'), 'active'), pageSize)) {
        const familyId = familyDoc.id
        if (!ID.test(familyId) || familyDoc.data()?.active === false) continue
        const base = `families/${familyId}`
        try {
          const [memberDocs, childDocs, accountDocs] = await Promise.all([
            collect(project(db.collection(`${base}/members`), 'role', 'active', 'childIds'), pageSize),
            collect(project(db.collection(`${base}/children`), 'active', 'meshPersonId'), pageSize),
            collect(project(db.collection('sourceAccounts').where('familyId', '==', familyId), 'source', 'disconnectedAt', 'personId', 'sourcePersonId'), pageSize),
          ])
          const members = new Map(memberDocs.filter((doc) => ID.test(doc.id)).map((doc) => [doc.id, doc.data() ?? {}]))
          const children = new Map(childDocs.filter((doc) => ID.test(doc.id)).map((doc) => [doc.id, doc.data() ?? {}]))
          const familyScopes = []
          const childStatuses = []
          for (const [childId, child] of children) {
            if (child.active === false) continue
            const parentMembers = [...members].filter(([, member]) => member.role === 'parent' && member.active === true
              && Array.isArray(member.childIds) && member.childIds.includes(childId)).map(([personId]) => personId)
            childStatuses.push({ familyId, childId, parentMembers, hasMeshIdentity: Boolean(safeId(child.meshPersonId)) })
          }
          const accountParents = new Set()
          const meshAccounts = []
          for (const doc of accountDocs) {
            const account = doc.data() ?? {}
            const member = members.get(account.personId)
            if (account.source !== 'mesh' || account.disconnectedAt || !ID.test(account.personId) || !member
              || member.role !== 'parent' || member.active !== true || !ID.test(doc.id)
              || !safeId(account.sourcePersonId) || accountIdForActor(account.sourcePersonId) !== doc.id) continue
            sourceAccounts.push({ familyId, accountId: doc.id, personId: account.personId,
              sourcePersonId: safeId(account.sourcePersonId) })
            meshAccounts.push({ accountId: doc.id, personId: account.personId, actorId: safeId(account.sourcePersonId) })
            accountParents.add(account.personId)
          }
          for (const status of childStatuses) registeredChildren.push({ familyId: status.familyId, childId: status.childId,
            hasMeshIdentity: status.hasMeshIdentity, hasMeshAccount: status.parentMembers.some((personId) => accountParents.has(personId)) })
          if (includeFirestore) {
            try { await addFamilyScopes(db, familyId, children, familyScopes, pageSize) }
            catch (error) {
              failures.push({ familyId, source: 'firestore', code: safeErrorCode(error) })
              failedContexts.push({ source: 'firestore', familyId })
            }
          }
          if (includeMesh) {
            const result = await addMeshScopes(db, familyId, children, members, meshAccounts, familyScopes, now, meshSource)
            failures.push(...result.failures)
            failedContexts.push(...result.failedContexts)
          }
          scopes.push(...familyScopes)
          for (const [childId, child] of children) if (child.active !== false) {
            if (includeFirestore) contexts.push({ source: 'firestore', scope: { familyId, childId } })
          }
          for (const { scope } of familyScopes) if (scope.source === 'mesh') contexts.push({ source: 'mesh',
            scope: { familyId: scope.familyId, childId: scope.childId, sourceAccountId: scope.sourceAccountId, sourcePersonId: scope.sourcePersonId } })
          families.push({ familyId })
        } catch (error) {
          failures.push({ code: safeErrorCode(error) })
        }
      }
    } catch (error) {
      failures.push({ code: safeErrorCode(error) })
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

async function addMeshScopes(db, familyId, children, members, accounts, output, now, meshSource) {
  const today = formatMoscowDate(now())
  const dates = dateWindow(today)
  const failedContexts = []
  const failures = []
  for (const [childId, child] of children) {
    const sourcePersonId = safeId(child.meshPersonId)
    if (child.active === false || !sourcePersonId) continue
    const identityId = createHash('sha256').update(`mesh-child:${sourcePersonId}`).digest('hex')
    let identity
    try { identity = await db.doc(`sourceIdentities/${identityId}`).get() }
    catch (error) {
      failures.push({ familyId, source: 'mesh', code: safeErrorCode(error) })
      failedContexts.push({ source: 'mesh', familyId, childId })
      continue
    }
    if (!identity?.exists) continue
    const identityData = identity.data() ?? {}
    if (identityData.source !== 'mesh' || identityData.familyId !== familyId || identityData.childId !== childId
      || identityData.sourcePersonId !== sourcePersonId) continue
    const eligibleAccounts = accounts.filter((account) => {
      const member = members.get(account.personId)
      return Boolean(account.actorId && member?.active === true && member.role === 'parent'
        && Array.isArray(member.childIds) && member.childIds.includes(childId))
    }).sort((left, right) => left.accountId.localeCompare(right.accountId))
    const account = eligibleAccounts[0]
    if (account) {
      const descriptor = { source: 'mesh', familyId, childId, sourceAccountId: account.accountId, sourcePersonId }
      let contextReady = true
      try {
        const gradeScopes = await meshSource.discoverGradeScopes({ ...descriptor, kind: 'grades' })
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
function accountIdForActor(actorId) { return createHash('sha256').update(`mesh-parent:${actorId}`).digest('hex') }
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
