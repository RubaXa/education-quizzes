/** @see ../../docs/modules/families/early-development.md */
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../storage/family-book-inheritance.mjs', () => ({ inheritFamilyBooks: async () => ({ shared: 12 }) }))
import { enableEarlyDevelopment } from './early-development.mjs'
const familyId = 'family', childId = 'baby', base = `families/${familyId}/children/${childId}`
const registry = { families: { family: { childIds: ['school', 'baby'] } }, people: { adult: { familyId, role: 'parent' } } }
let rows
const snap = (path) => ({ ref: db.doc(path), id: path.split('/').at(-1), exists: rows.has(path), data: () => rows.get(path) })
const db = {
  doc: (path) => ({ path, get: async () => snap(path) }),
  collection: (path) => ({ get: async () => ({ docs: [...rows.keys()].filter((key) => key.startsWith(path + '/') && key.slice(path.length + 1).split('/').length === 1).map(snap) }),
    where: (field, _op, value) => ({ get: async () => ({ docs: [...rows.keys()].filter((key) => key.startsWith(path + '/') && rows.get(key)[field] === value).map(snap) }) }) }),
  runTransaction: async (work) => { const writes = []; await work({ getAll: async (...refs) => refs.map((ref) => snap(ref.path)), update: (ref, value) => writes.push([ref.path, { ...rows.get(ref.path), ...value }]), set: (ref, value) => writes.push([ref.path, value]) }); for (const [path, value] of writes) rows.set(path, value) },
}
beforeEach(() => { rows = new Map([
  [base, { displayName: 'Малыш', active: false, createdAt: 'ORIGINAL' }],
  ['families/family/members/adult', { role: 'parent', active: true, childIds: ['school'] }],
  ['families/family/members/former-student', { role: 'student', active: false, childIds: ['baby'] }],
  ['accessLinks/former', { personId: 'former-student', active: false }],
  [`${base}/earlyObservations/existing`, { note: 'Preserve me' }],
]) })
const input = { familyId, childId, birthDate: '2026-01-01', parentIds: ['adult'] }
it('reuses the infant identity and keeps school scope and the diary unchanged on repeated provisioning', async () => {
  const first = await enableEarlyDevelopment(db, registry, input)
  await enableEarlyDevelopment(db, registry, input)
  expect(first).toMatchObject({ learningMode: 'early-development', booksShared: 12, verified: true })
  expect(rows.get(base)).toMatchObject({ active: true, displayName: 'Малыш', createdAt: 'ORIGINAL' })
  expect(rows.get('families/family/members/adult')).toMatchObject({ childIds: ['school'], earlyChildIds: ['baby'] })
  expect(rows.get('families/family/members/former-student')).toMatchObject({ active: false, childIds: [] })
  expect(rows.get(`${base}/earlyObservations/existing`)).toEqual({ note: 'Preserve me' })
  expect([...rows.keys()].some((key) => key.startsWith('users/'))).toBe(false)
})
it('does not revoke a shared student identity that still owns another child', async () => {
  rows.set('families/family/members/former-student', { role: 'student', active: true, childIds: ['baby', 'other-child'] })
  rows.set('accessLinks/former', { personId: 'former-student', active: true })
  await enableEarlyDevelopment(db, registry, input)
  expect(rows.get('accessLinks/former').active).toBe(true)
  expect(rows.get('families/family/members/former-student')).toMatchObject({ active: true, childIds: ['other-child'] })
})
it('rejects an unknown parent, malformed birth date and an active school source before mutation', async () => {
  await expect(enableEarlyDevelopment(db, registry, { ...input, parentIds: ['outsider'] })).rejects.toThrow()
  await expect(enableEarlyDevelopment(db, registry, { ...input, birthDate: '2026-02-30' })).rejects.toThrow()
  rows.set(base, { meshPersonId: 'school-source' })
  await expect(enableEarlyDevelopment(db, registry, input)).rejects.toThrow('школьного')
  expect(rows.get('families/family/members/adult').earlyChildIds).toBeUndefined()
})
