import { createHash } from 'node:crypto'

/** Addressed, read-only identity audit; never return bearer tokens or lesson content.
 * @see ../../docs/modules/families/access-and-state.md#access-diagnostics
 * @see ../../docs/decisions/personal-identity-transition-2026-10-18.md */
export async function inspectFamilyAccess(db, registry, personId) {
  const expected = registry.people?.[personId]
  if (!expected?.familyId) throw new Error('Профиль не найден в локальном реестре.')
  const familyId = expected.familyId
  const issues = []
  const refs = new Map()
  const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12)
  async function read(path) {
    if (!refs.has(path)) refs.set(path, db.doc(path).get())
    const doc = await refs.get(path)
    return doc.exists ? doc.data() : null
  }
  const [person, member, pointer] = await Promise.all([
    read(`users/${personId}`), read(`families/${familyId}/members/${personId}`),
    read(`users/${personId}/families/${familyId}`),
  ])
  if (!person || !pointer) issues.push('profile-family-link-missing')
  if (!member?.active || member.role !== expected.role) issues.push('membership-role-mismatch')
  if (!Array.isArray(member?.childIds)) issues.push('membership-child-list-invalid')
  const known = registry.families?.[familyId]?.childIds ?? []
  const children = []
  for (const childId of [...new Set(Array.isArray(member?.childIds) ? member.childIds : [])]) {
    if (!known.includes(childId)) { issues.push('membership-child-outside-family'); continue }
    const [child, shortcut] = await Promise.all([
      read(`families/${familyId}/children/${childId}`),
      read(`users/${personId}/families/${familyId}/shortcuts/${childId}`),
    ])
    if (!child || !shortcut) { issues.push('child-shortcut-missing'); continue }
    const projections = []
    for (const [collection, field, aliases] of [
      ['dayDashboards', 'dashboardToken', 'dashboardTokens'], ['dayPages', 'dayToken', 'dayTokens'],
    ]) {
      const tokens = shortcut[aliases] ?? { [member.role]: shortcut[field] }
      if (!tokens[member.role]) issues.push(`${collection}-role-token-missing`)
      if (tokens.student && tokens.student === tokens.parent) issues.push(`${collection}-role-token-collision`)
      if (shortcut[field] !== tokens[member.role]) issues.push(`${collection}-primary-role-mismatch`)
      for (const role of ['parent', 'student']) {
        const token = tokens[role]
        if (!token) continue
        const page = await read(`${collection}/${token}`)
        const ownerMatches = page?.familyId === familyId && page?.childId === childId
        if (!ownerMatches || page?.kind !== role) issues.push(`${collection}-${role}-identity-mismatch`)
        const slots = []
        for (const slot of page?.weekendWork ?? []) {
          const source = await read(`dayPages/${slot.dayToken}`)
          const matches = source?.familyId === familyId && source?.childId === childId && source?.kind === role
          if (!matches) issues.push(`weekend-${role}-identity-mismatch`)
          slots.push({ page: digest(slot.dayToken), role: source?.kind ?? null, ownerMatches: matches,
            tasksPresent: slot.taskIds.every((id) => source?.subjects?.some((subject) => subject.tasks?.some((task) => task.id === id))) })
          if (!slots.at(-1).tasksPresent) issues.push('weekend-task-missing')
        }
        projections.push({ collection, role, page: digest(token), actualRole: page?.kind ?? null, ownerMatches, slots })
      }
    }
    children.push({ child: digest(childId), projections })
  }
  const links = []
  for (const token of registry.links?.[personId] ?? []) {
    const grant = await read(`accessLinks/${token}`)
    if (grant?.personId !== personId) issues.push('grant-person-mismatch')
    links.push({ grant: digest(token), active: grant?.active === true, ownerMatches: grant?.personId === personId })
  }
  return { schemaVersion: 1, readOnly: true, expectedRole: expected.role, serverRole: member?.role ?? null,
    memberActive: member?.active === true, children, links, documentsRead: refs.size, issues: [...new Set(issues)] }
}
