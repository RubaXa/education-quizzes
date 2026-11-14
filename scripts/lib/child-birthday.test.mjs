/** @see ../../docs/modules/families/README.md#birthday */
import { expect, it } from 'vitest'
import { setChildBirthday } from './child-birthday.mjs'
const registry = { families: { family: { childIds: ['child'] } } }
it('preserves identity and unrelated data when saving the confirmed birthday', async () => {
  let row = { displayName: 'Саша', timezone: 'Europe/Moscow', source: 'preserve' }
  const ref = { get: async () => ({ data: () => row }) }
  const db = { doc: () => ref, runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => row }), update: (_, patch) => { row = { ...row, ...patch } } }) }
  expect(await setChildBirthday(db, registry, { familyId: 'family', childId: 'child', birthday: '11-15' })).toMatchObject({ birthday: '11-15', verified: true })
  expect(row).toMatchObject({ displayName: 'Саша', source: 'preserve', timezone: 'Europe/Moscow' })
})
it('rejects foreign scope and impossible dates before any read', async () => {
  for (const input of [{ familyId: 'other', childId: 'child', birthday: '11-15' }, { familyId: 'family', childId: 'child', birthday: '02-31' }]) await expect(setChildBirthday({}, registry, input)).rejects.toThrow()
})
