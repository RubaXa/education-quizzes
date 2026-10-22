// @vitest-environment jsdom
// @see ../../docs/modules/materials/family-library.md#family-access
import { describe, expect, it, vi } from 'vitest'
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./dayDashboardStore', () => ({ watchDayDashboard: vi.fn() }))
vi.mock('./familyBookUpload', () => ({ resumeFamilyBookTransfer: vi.fn() }))
import { bookNeeds, uniqueFamilyBooks } from './familyLibrary'
import type { FamilyBook } from './familyLibrary'
import type { PersonalChild } from './personalAccess'

const child: PersonalChild = { familyId: 'family', childId: 'new-child', displayName: 'New child', role: 'parent' }
const book: FamilyBook = { id: 'book', childId: child.childId, bookId: 'book', title: 'Family book',
  subjectKey: 'математика', status: 'provisional', accessScope: 'family' }

describe('family book reading and school use are different', () => {
  it('does not request another upload for an inherited family book', () => {
    expect(bookNeeds([child], { [child.childId]: ['Математика'] }, [book], []))
      .toMatchObject([{ state: 'available', childId: child.childId }])
    expect(book.status).toBe('provisional')
    expect(bookNeeds([child], { [child.childId]: ['Математика'] }, [{ ...book, accessScope: undefined }], []))
      .toMatchObject([{ state: 'available' }])
  })
  it('retains a genuine missing book and does not infer needs from an absent schedule', () => {
    expect(bookNeeds([child], {}, [], [])).toEqual([])
    expect(bookNeeds([child], { [child.childId]: ['Математика'] }, [], []))
      .toMatchObject([{ state: 'missing' }])
  })
  it('counts the original once for siblings', () => {
    const original = { ...book, childId: 'older', accessScope: undefined, status: 'confirmed' as const }
    expect(uniqueFamilyBooks([book, original])).toEqual([original])
    expect(uniqueFamilyBooks([original, book])).toEqual([original])
    expect(uniqueFamilyBooks([book])).toEqual([book])
  })
})

it('does not turn a stray schedule into school book demands for an early child', () => {
  expect(bookNeeds([{ ...child, learningMode: 'early-development' }], { [child.childId]: ['Биология'] }, [], [])).toEqual([])
})
