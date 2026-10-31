import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { matchesPhoto, validPhotoRequest, workPath } from './direct-upload.mjs'
import { workFileTypes } from './work-file-types.mjs'

function zip(files, compressed = false) {
  const locals = [], central = []; let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const path = Buffer.from(name), data = Buffer.from(text), body = compressed ? deflateRawSync(data) : data
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4)
    header.writeUInt16LE(compressed ? 8 : 0, 8); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(path.length, 26)
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(compressed ? 8 : 0, 10)
    entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(path.length, 28); entry.writeUInt32LE(offset, 42)
    central.push(entry, path); locals.push(header, path, body); offset += header.length + path.length + body.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
const metadata = (bytes, type) => ({ contentType: type, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), taskId: 'task', deviceUid: 'd'.repeat(24), planRevision: 1, originalName: 'Решение' })
const page = { kind: 'student', taskIds: ['task'], planRevision: 1 }

describe('original solution validation', () => {
  const officePaths = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }
  it.each(Object.entries(workFileTypes).filter(([, [ext]]) => ext in officePaths))('verifies the Office package, not just PK bytes: %s', (type, [ext]) => {
    const bytes = zip({ '[Content_Types].xml': '<Types/>', [officePaths[ext]]: '<document/>' }, true)
    expect(validPhotoRequest(metadata(bytes, type), page)).toBe(true)
    expect(matchesPhoto(bytes, metadata(bytes, type))).toBe(true)
    const wrong = zip({ 'run.exe': 'binary' })
    expect(matchesPhoto(wrong, metadata(wrong, type))).toBe(false)
    expect(matchesPhoto(bytes.subarray(0, 10), metadata(bytes.subarray(0, 10), type))).toBe(false)
  })
  it.each(Object.entries(workFileTypes).filter(([type]) => type.includes('opendocument')))('verifies OpenDocument MIME and package: %s', (type) => {
    for (const compress of [false, true]) {
      const bytes = zip({ mimetype: type, 'content.xml': '<document/>' }, compress)
      expect(matchesPhoto(bytes, metadata(bytes, type))).toBe(true)
      expect(matchesPhoto(bytes, metadata(bytes, 'application/vnd.oasis.opendocument.presentation' === type ? 'application/vnd.oasis.opendocument.text' : 'application/vnd.oasis.opendocument.presentation'))).toBe(false)
    }
  })
  it.each(['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'])('checks legacy Office compound signatures: %s', (type) => {
    const bytes = Buffer.from('d0cf11e0a1b11ae100000000', 'hex')
    expect(matchesPhoto(bytes, metadata(bytes, type))).toBe(true)
    const executable = Buffer.from('MZ executable')
    expect(matchesPhoto(executable, metadata(executable, type))).toBe(false)
  })
  it('rejects binary disguised as text, prototype keys and oversized names', () => {
    const bytes = Buffer.from([0, 1, 2, 3])
    expect(matchesPhoto(bytes, metadata(bytes, 'text/plain'))).toBe(false)
    expect(matchesPhoto(Buffer.from([255]), metadata(Buffer.from([255]), 'text/plain'))).toBe(false)
    expect(validPhotoRequest({ ...metadata(bytes, 'application/pdf'), originalName: 'a'.repeat(161) }, page)).toBe(false)
    expect(validPhotoRequest(metadata(bytes, 'toString'), page)).toBe(false)
    expect(() => workPath({ date: '2026-10-31', familyId: 'f'.repeat(24), childId: 'c'.repeat(24) }, 's'.repeat(24), 'u'.repeat(24), 'constructor')).toThrow()
  })
})
