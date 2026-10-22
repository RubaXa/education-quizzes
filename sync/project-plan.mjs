/** @see ../docs/modules/families/early-development.md */
import { eligibleMeshAccounts, isRegisteredMeshChild, meshParentAccountId } from '../packages/education-runtime/identity.mjs'

/** Pure inventory and scheduling rules for one global Education run.
 * @see ../docs/modules/synchronization/global-sync.md#inventory
 * @see ../docs/modules/synchronization/global-sync.md#dag
 */
const idPattern = /^[A-Za-z0-9_-]{1,120}$/

export function projectTargets({ families, children, accounts, identities, members, localAccounts, legacy }) {
  const familyById = new Map(families.filter((item) => item.active !== false).map((item) => [item.id, item]))
  const familyIds = new Set(familyById.keys())
  const identityByChild = new Map()
  for (const identity of identities) {
    if (!familyIds.has(identity.familyId) || !idPattern.test(identity.childId ?? '') || identity.source !== 'mesh') continue
    const key = `${identity.familyId}/${identity.childId}`
    if (identityByChild.has(key)) throw new Error(`У ребёнка ${key} несколько исходных идентичностей МЭШ.`)
    identityByChild.set(key, identity)
  }
  const local = new Set(localAccounts)
  const targets = []
  for (const child of children) {
    if (!familyIds.has(child.familyId) || !idPattern.test(child.familyId) || !idPattern.test(child.id)) continue
    if (child.active === false || child.learningMode === 'early-development') continue
    const key = `${child.familyId}/${child.id}`
    const identity = identityByChild.get(key)
    const family = familyById.get(child.familyId)
    if (!identity?.sourcePersonId || !isRegisteredMeshChild({ familyId: child.familyId, childId: child.id, family, child, identity })) {
      targets.push({ familyId: child.familyId, childId: child.id, state: 'blocked', reason: 'source-identity-required' })
      continue
    }
    const familyAccounts = accounts.filter((account) => account.familyId === child.familyId)
    const familyMembers = members.filter((member) => member.familyId === child.familyId)
    const candidates = eligibleMeshAccounts({ familyId: child.familyId, childId: child.id, family, child,
      members: familyMembers, identities: [identity], accounts: familyAccounts })
    const available = candidates.filter((account) => local.has(account.id)
      || legacy?.kind === 'legacy' && legacy.accountId === account.id
        && legacy.familyId === child.familyId && legacy.childId === child.id
        && meshParentAccountId(legacy.actorPersonId) === account.id)
    const selected = available[0]
    targets.push(selected
      ? { familyId: child.familyId, childId: child.id, sourceAccountId: selected.id,
          sourcePersonId: String(identity.sourcePersonId), credentialKind: local.has(selected.id) ? 'connection' : 'legacy', state: 'queued' }
      : { familyId: child.familyId, childId: child.id, state: 'blocked', reason: candidates.length ? 'auth-required' : 'source-account-required' })
  }
  return targets.sort((a, b) => `${a.familyId}/${a.childId}`.localeCompare(`${b.familyId}/${b.childId}`))
}

export function dateWindow(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('Нужна дата YYYY-MM-DD.')
  const day = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== today) throw new Error('Неверная дата.')
  const weekday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - weekday)
  // Always inspect six complete weeks from this Monday. A holiday or an empty
  // future week is not evidence that MESH has no later lessons.
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(day)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

/** Source collection counts only. Publication and readback require separate evidence.
 * @see ../docs/modules/synchronization/global-sync.md#report
 */
export function collectedProjectSummary(manifest) {
  const jobs = manifest.jobs ?? []
  const checked = jobs.filter((job) => Number.isInteger(job.checkedDates) && job.checkedDates > 0)
  const changed = checked.filter((job) => Object.values(job.changes ?? {}).some((count) => count > 0))
  const familyCount = (items) => new Set(items.map((job) => job.familyId)).size
  const allByFamily = Map.groupBy(jobs, (job) => job.familyId)
  const sum = (items, key) => items.reduce((total, job) => total + (job.changes?.[key] ?? 0), 0)
  return {
    familiesDiscovered: manifest.inventory?.families ?? null,
    childrenDiscovered: manifest.inventory?.children ?? null,
    sourceAccountsDiscovered: manifest.inventory?.sourceAccounts ?? null,
    familiesSourceChecked: [...allByFamily.values()].filter((children) => children.every((job) => checked.includes(job))).length,
    childrenSourceChecked: checked.length,
    familiesWithSourceChanges: familyCount(changed),
    childrenWithSourceChanges: changed.length,
    sourceChanges: {
      lessons: sum(checked, 'lessons'),
      assignments: sum(checked, 'assignments'),
      grades: sum(checked, 'grades'),
    },
    checkedDates: checked.reduce((total, job) => total + job.checkedDates, 0),
    pendingPublicationDays: checked.reduce((total, job) => total + (job.pendingPublicationDates?.length ?? 0), 0),
    blockedChildren: jobs.filter((job) => job.state === 'blocked').length,
  }
}

export async function mapBounded(items, limit, run) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Лимит параллельности должен быть положительным.')
  const results = Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      try { results[index] = { status: 'fulfilled', value: await run(items[index], index) } }
      catch (error) { results[index] = { status: 'rejected', reason: error } }
    }
  }))
  return results
}
