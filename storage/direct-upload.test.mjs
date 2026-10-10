import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { matchesPhoto, validPhotoRequest, validUploadHref, workPath } from './direct-upload.mjs'

const owner = { date: '2026-10-10', familyId: 'family01234567890123', childId: 'child012345678901234' }
const page = { kind: 'student', taskIds: ['task-1'], planRevision: 1 }
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const request = { taskId: 'task-1', deviceUid: 'device01234567890123', contentType: 'image/jpeg', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), planRevision: 1 }

describe('direct Disk upload contract', () => {
  it('isolates work by family, child, day and upload', () => {
    expect(workPath(owner, 'student0123456789012', 'upload01234567890123'))
      .toBe('app:/PETR/Работы/2026-10-10/family01234567890123-child012345678901234/student0123456789012-upload01234567890123.jpg')
    expect(() => workPath({ ...owner, familyId: '../other' }, 'student0123456789012', 'upload01234567890123')).toThrow()
  })

  it('accepts metadata only and checks the uploaded bytes', () => {
    expect(validPhotoRequest(request, page)).toBe(true)
    expect(validPhotoRequest({ ...request, size: 90_000_000 }, page)).toBe(false)
    expect(validPhotoRequest({ ...request, taskId: 'other' }, page)).toBe(false)
    expect(matchesPhoto(bytes, request)).toBe(true)
    expect(matchesPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00]), request)).toBe(false)
  })

  it('accepts only Yandex HTTPS upload capabilities', () => {
    expect(validUploadHref('https://uploader162vla.disk.yandex.net/upload?token=secret')).toBe(true)
    expect(validUploadHref('https://attacker.example/upload')).toBe(false)
    expect(validUploadHref('http://disk.yandex.net/upload')).toBe(false)
  })
})
