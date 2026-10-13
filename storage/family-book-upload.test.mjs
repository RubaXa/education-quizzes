import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { familyBookPath, matchesFamilyBook, validFamilyBookRequest } from './family-book-upload.mjs'

const familyId = 'family01234567890123'
const childId = 'child012345678901234'
const uploadId = 'upload01234567890123'
const bytes = Buffer.from('%PDF-1.7\nexample')
const request = { subjectKey: 'математика', originalName: 'Учебник.pdf',
  contentType: 'application/pdf', size: bytes.length, deviceUid: 'device01234567890123',
  sha256: createHash('sha256').update(bytes).digest('hex') }

describe('family PDF upload contract', () => {
  it('uses the child from the Firestore path, without requiring an extra client field', () => {
    expect(validFamilyBookRequest(request, childId)).toBe(true)
    expect(validFamilyBookRequest(request, '../other')).toBe(false)
    expect(validFamilyBookRequest({ ...request, contentType: 'image/jpeg' }, childId)).toBe(false)
  })

  it('keeps files isolated and verifies PDF bytes', () => {
    expect(familyBookPath(familyId, childId, uploadId, request.contentType))
      .toBe(`app:/PETR/Учебники/Загрузки/${familyId}/${childId}/${uploadId}.pdf`)
    expect(matchesFamilyBook(bytes, request)).toBe(true)
    expect(matchesFamilyBook(Buffer.from('%PDF-other'), request)).toBe(false)
  })
})
