/** Pure inventory and scheduling rules for one global Education run.
 * @see ../docs/product/global-sync.md#inventory
 * @see ../docs/product/global-sync.md#dag
 */
const idPattern = /^[A-Za-z0-9_-]{1,120}$/

export function projectTargets({ families, children, accounts, identities, members, localAccounts, legacy }) {
  const familyIds = new Set(families.map((item) => item.id))
  const identityByChild = new Map()
  for (const identity of identities) {
    if (!familyIds.has(identity.familyId) || !idPattern.test(identity.childId ?? '')) continue
    const key = `${identity.familyId}/${identity.childId}`
    if (identityByChild.has(key)) throw new Error(`У ребёнка ${key} несколько исходных идентичностей МЭШ.`)
    identityByChild.set(key, identity)
  }
  const memberByKey = new Map(members.map((item) => [`${item.familyId}/${item.id}`, item]))
  const local = new Set(localAccounts)
  const targets = []
  for (const child of children) {
    if (!familyIds.has(child.familyId) || !idPattern.test(child.familyId) || !idPattern.test(child.id)) throw new Error('Недействительная семейная связь ребёнка.')
    const key = `${child.familyId}/${child.id}`
    const identity = identityByChild.get(key)
    if (!identity?.sourcePersonId) {
      targets.push({ familyId: child.familyId, childId: child.id, state: 'blocked', reason: 'source-identity-required' })
      continue
    }
    const candidates = accounts.filter((account) => account.familyId === child.familyId && account.source === 'mesh' && !account.disconnectedAt)
      .filter((account) => {
        const member = memberByKey.get(`${account.familyId}/${account.personId}`)
        return member?.active === true && member.role === 'parent' && member.childIds?.includes(child.id)
      }).sort((a, b) => a.id.localeCompare(b.id))
    const available = candidates.filter((account) => local.has(account.id) || legacy?.accountId === account.id && legacy.familyId === child.familyId && legacy.childId === child.id)
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
