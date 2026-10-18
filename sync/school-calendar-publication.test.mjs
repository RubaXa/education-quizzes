/** @see ../docs/modules/school-diary/school-calendar.md */
import { expect, it } from 'vitest'
import { publishSchoolCalendar } from './school-calendar-publication.mjs'
const owner = { familyId: 'family', childId: 'child' }
const calendar = { schemaVersion: 1, source: 'mesh', owner, from: '2026-09-01', to: '2027-08-31', checkedAt: '2026-10-19T00:00:00Z', revision: 'a'.repeat(64), vacations: [{ from: '2026-10-24', to: '2026-11-01', title: 'Каникулы' }] }
function scene() {
  const docs = new Map(['student', 'parent'].map(kind => [`dayDashboards/${kind}`, { ...owner, schemaVersion: 1, kind, today: '2026-10-19', days: [{ date: '2026-10-24', complete: true, schedule: [], homework: [{ text: 'Остаётся' }], homeworkDayToken: 'saved', homeworkUpdate: { at: 'saved' } }], weekendWork: [{ title: 'Сохранить' }], customField: 'Сохранить' }]))
  const snapshot = ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) })
  let writes = 0
  const db = { doc: path => ({ path }), getAll: async (...refs) => refs.map(snapshot), runTransaction: async run => {
    const pending = []
    const result = await run({ getAll: async (...refs) => refs.map(snapshot), update: (ref, patch) => pending.push({ ref, patch }) })
    for (const { ref, patch } of pending) { docs.set(ref.path, { ...docs.get(ref.path), ...patch }); writes++ }
    return result
  } }
  return { db, docs, writes: () => writes }
}
const publish = (s, model = calendar) => publishSchoolCalendar({ db: s.db, tokens: { student: 'student', parent: 'parent' }, owner, calendar: model, today: '2026-10-19' })
it('patches both owned roles and rereads them, preserving work, pointers and all unrelated fields', async () => {
  const s = scene(), result = await publish(s)
  expect(result).toMatchObject({ writes: 2, verified: true })
  for (const doc of s.docs.values()) {
    expect(doc.schoolCalendar.vacations).toEqual(calendar.vacations)
    expect(doc).toMatchObject({ customField: 'Сохранить', weekendWork: [{ title: 'Сохранить' }] })
    expect(doc.days.find(day => day.date === '2026-10-24')).toMatchObject({ homeworkDayToken: 'saved', homework: [{ text: 'Остаётся' }], homeworkUpdate: { at: 'saved' } })
    expect(doc.days.at(-1).date).toBe('2026-11-29')
  }
})
it('writes nothing on an identical source recheck, but applies a real source correction', async () => {
  const s = scene(); await publish(s)
  expect(await publish(s, { ...calendar, checkedAt: '2026-10-20T00:00:00Z' })).toMatchObject({ writes: 0, verified: true })
  expect(s.writes()).toBe(2)
  await publish(s, { ...calendar, revision: 'b'.repeat(64), vacations: [] })
  expect(s.docs.get('dayDashboards/parent').schoolCalendar.vacations).toEqual([])
})
it('atomically refuses a wrong child or swapped role before any write', async () => {
  for (const patch of [{ childId: 'other' }, { kind: 'student' }]) {
    const s = scene(); Object.assign(s.docs.get('dayDashboards/parent'), patch)
    await expect(publish(s)).rejects.toThrow('school_calendar_owner_mismatch')
    expect(s.writes()).toBe(0)
  }
})
it('does not report publication verified when the addressed readback differs', async () => {
  const s = scene()
  s.db.getAll = async (...refs) => refs.map(() => ({ exists: true, data: () => ({ days: [] }) }))
  await expect(publish(s)).rejects.toThrow('school_calendar_readback_failed')
})
