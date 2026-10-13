import { createHash } from 'node:crypto'

/** @see ../docs/product/family-library.md#upload */
const identifier = /^[A-Za-z0-9_-]{20,80}$/
const extensions = Object.freeze({ 'application/pdf': 'pdf' })

export function familyBookPath(familyId, childId, uploadId, contentType) {
  if (![familyId, childId, uploadId].every((value) => identifier.test(value)) || !extensions[contentType]) {
    throw new Error('Некорректная связь книги с семьёй или тип файла.')
  }
  return `app:/PETR/Учебники/Загрузки/${familyId}/${childId}/${uploadId}.${extensions[contentType]}`
}

export function validFamilyBookRequest(request, childId) {
  // childId is the verified Firestore path segment, not a writable field in the request.
  return identifier.test(childId ?? '')
    && identifier.test(request?.deviceUid ?? '')
    && typeof request?.subjectKey === 'string' && request.subjectKey.length > 0 && request.subjectKey.length <= 100
    && typeof request?.originalName === 'string' && request.originalName.length > 0 && request.originalName.length <= 160
    && Boolean(extensions[request?.contentType])
    && Number.isInteger(request?.size) && request.size > 0 && request.size <= 100_000_000
    && /^[a-f0-9]{64}$/.test(request?.sha256 ?? '')
}

export function matchesFamilyBook(bytes, request) {
  if (bytes.length !== request.size) return false
  return bytes.toString('ascii', 0, 5) === '%PDF-'
    && createHash('sha256').update(bytes).digest('hex') === request.sha256
}
