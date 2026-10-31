/** Content checks for original solution documents. No active document content is rendered in the app.
 * @see ../docs/shared/media-storage.md */
import { inflateRawSync } from 'node:zlib'
import { workFileTypes } from './work-file-types.mjs'

function textDocument(bytes) {
  try {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
    const text = new TextDecoder(utf16, { fatal: true }).decode(bytes)
    return !/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)
  } catch { return false }
}

// Walk the central directory instead of accepting an arbitrary ZIP renamed as Office.
function archiveEntries(bytes) {
  if (bytes.readUInt32LE(0) !== 0x04034b50) return null
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break
  }
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt32LE(end + 4) !== 0) return null
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12)
  if (count > 10000 || start + size !== end || bytes.readUInt16LE(end + 8) !== count) return null
  const entries = new Map()
  let offset = start
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return null
    const length = bytes.readUInt16LE(offset + 28)
    const next = offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
    const local = bytes.readUInt32LE(offset + 42)
    if (next > end || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) return null
    const name = bytes.toString('utf8', offset + 46, offset + 46 + length)
    if (entries.has(name) || bytes.readUInt16LE(offset + 8) & 1) return null
    entries.set(name, { local, size: bytes.readUInt32LE(offset + 20), method: bytes.readUInt16LE(offset + 10) })
    offset = next
  }
  return offset === end ? entries : null
}
export function matchesWorkDocument(bytes, type) {
  if (!Object.hasOwn(workFileTypes, type)) return false
  if (type === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-'
  if (['text/plain', 'text/csv', 'text/markdown'].includes(type)) return textDocument(bytes)
  if (type === 'application/rtf') return bytes.toString('ascii', 0, 5) === '{\\rtf'
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(type)) {
    return bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))
  }
  try {
    if (bytes.length < 22) return false
    const entries = archiveEntries(bytes)
    if (!entries) return false
    const required = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[workFileTypes[type][0]]
    if (required) return entries.has('[Content_Types].xml') && entries.has(required)
    const mime = entries.get('mimetype')
    if (!mime || !entries.has('content.xml') || mime.size > 1024) return false
    const start = mime.local + 30 + bytes.readUInt16LE(mime.local + 26) + bytes.readUInt16LE(mime.local + 28)
    const raw = bytes.subarray(start, start + mime.size)
    const decoded = mime.method === 0 ? raw : mime.method === 8 ? inflateRawSync(raw, { maxOutputLength: 256 }) : null
    return decoded?.toString('utf8') === type
  } catch { return false }
}
