import { expect, it } from 'vitest'
import { publishOlympiadCalendar } from './publish-calendar.mjs'
it('updates only public facts, preserves family work and is idempotent', async () => {
  const state = new Map([['publicOlympiadCatalog/formulo-math-2026-2027', { extra: 'keep' }], ['families/f/children/c/tasks/t', { status: 'reviewed' }]])
  const db = { doc: path => ({ path, get: async () => ({ data: () => state.get(path) }) }), runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref,value) => state.set(ref.path, { ...state.get(ref.path), ...value }) }) }
  expect((await publishOlympiadCalendar(db)).mode).toBe('plan')
  expect(state.size).toBe(2)
  expect(await publishOlympiadCalendar(db, { apply: true })).toMatchObject({ verified: true, changed: 19 })
  expect(state.get('publicOlympiadCatalog/formulo-math-2026-2027').extra).toBe('keep')
  expect(state.get('families/f/children/c/tasks/t')).toEqual({ status: 'reviewed' })
  expect((await publishOlympiadCalendar(db, { apply: true })).changed).toBe(0)
})
