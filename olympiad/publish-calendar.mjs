import { isDeepStrictEqual } from 'node:util'
import { seasonCalendarCatalog } from './season-calendar.mjs'
/** Only allowlisted public metadata; preserve family selections, work, keys and materials.
 * @see ../docs/decisions/olympiad-calendar-2026-10-31.md */
export async function publishOlympiadCalendar(db, { apply = false } = {}) {
  const items = seasonCalendarCatalog()
  const refs = items.map(item => db.doc(`publicOlympiadCatalog/${item.id}`))
  const fields = items.map(({ id: _id, ...value }) => value)
  const changed = await db.runTransaction(async tx => {
    const previous = await Promise.all(refs.map(ref => tx.get(ref)))
    const changed = previous.map((snapshot, i) => !Object.entries(fields[i]).every(([key,value]) => isDeepStrictEqual(snapshot.data()?.[key], value)))
    if (apply) refs.forEach((ref,i) => { if (changed[i]) tx.set(ref, fields[i], { merge: true }) })
    return changed
  })
  if (!apply) return { mode: 'plan', items: items.map((item,i) => ({ id: item.id, changed: changed[i] })) }
  const saved = await Promise.all(refs.map(ref => ref.get()))
  if (saved.some((snapshot,i) => !Object.entries(fields[i]).every(([key,value]) => isDeepStrictEqual(snapshot.data()?.[key],value)))) throw Error('olympiad_calendar_readback_failed')
  return { mode: 'apply', verified: true, count: items.length, changed: changed.filter(Boolean).length }
}
