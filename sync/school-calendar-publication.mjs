/** Addressed patch for existing pupil dashboards; never rebuild or erase unrelated work.
 * @see ../docs/modules/school-diary/school-calendar.md */
import { isDeepStrictEqual } from 'node:util'
import { applySchoolCalendar, publicSchoolCalendar, validSchoolCalendar } from '../day/school-calendar.mjs'

export async function publishSchoolCalendar({ db, tokens, owner, calendar, today }) {
  if (!tokens?.student || !tokens?.parent || tokens.student === tokens.parent) throw Error('calendar_dashboards_required')
  const projection = publicSchoolCalendar(calendar, owner), roles = ['student', 'parent']
  const refs = roles.map(role => db.doc(`dayDashboards/${tokens[role]}`))
  const patches = await db.runTransaction(async transaction => {
    const snapshots = await transaction.getAll(...refs)
    const updates = []
    for (let i = 0; i < snapshots.length; i++) {
      const before = snapshots[i].data()
      if (!snapshots[i].exists || before?.kind !== roles[i] || before.familyId !== owner.familyId || before.childId !== owner.childId
        || !Array.isArray(before.days)) throw Error('school_calendar_owner_mismatch')
      // A recheck of identical source content is not a reason to rewrite both documents.
      const unchanged = validSchoolCalendar(before.schoolCalendar) && before.schoolCalendar.revision === projection.revision
        && isDeepStrictEqual({ ...before.schoolCalendar, checkedAt: projection.checkedAt }, projection)
      const retained = unchanged ? before.schoolCalendar : projection
      const after = applySchoolCalendar(before, retained, today)
      const patch = { schoolCalendar: after.schoolCalendar, days: after.days }
      if (!isDeepStrictEqual(patch.schoolCalendar, before.schoolCalendar) || !isDeepStrictEqual(patch.days, before.days)) updates.push({ ref: refs[i], patch })
    }
    for (const { ref, patch } of updates) transaction.update(ref, patch)
    return updates
  })
  if (patches.length) {
    const live = await db.getAll(...patches.map(item => item.ref))
    if (live.some((snapshot, index) => !isDeepStrictEqual(snapshot.data()?.schoolCalendar, patches[index].patch.schoolCalendar)
      || !isDeepStrictEqual(snapshot.data()?.days, patches[index].patch.days))) throw Error('school_calendar_readback_failed')
  }
  return { writes: patches.length, verified: true, vacations: projection.vacations }
}
