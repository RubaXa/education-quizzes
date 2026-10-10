import { createHash } from 'node:crypto'

const idPattern = /^[A-Za-z0-9_-]{20,80}$/

export const photoExtensions = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })

export function workPath(owner, studentToken, uploadId, contentType = 'image/jpeg') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(owner?.date ?? '')
    || !idPattern.test(owner?.familyId ?? '') || !idPattern.test(owner?.childId ?? '')
    || !idPattern.test(studentToken) || !idPattern.test(uploadId) || !photoExtensions[contentType]) {
    throw new Error('Некорректная связь файла с семьёй и учебным днём.')
  }
  return `app:/PETR/Работы/${owner.date}/${owner.familyId}-${owner.childId}/${studentToken}-${uploadId}.${photoExtensions[contentType]}`
}

export function validPhotoRequest(request, page) {
  return page?.kind === 'student'
    && Array.isArray(page.taskIds) && page.taskIds.includes(request?.taskId)
    && idPattern.test(request?.deviceUid ?? '')
    && Boolean(photoExtensions[request?.contentType])
    && Number.isInteger(request?.size) && request.size > 0 && request.size <= 25_000_000
    && /^[a-f0-9]{64}$/.test(request?.sha256 ?? '')
    && Number.isInteger(request?.planRevision) && request.planRevision === page.planRevision
}

export function matchesPhoto(bytes, request) {
  const type = request.contentType
  const signature = type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : bytes.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|hevc|heif|mif1/.test(bytes.toString('ascii', 8, 20))
  return bytes.length === request.size && signature && createHash('sha256').update(bytes).digest('hex') === request.sha256
}

export function validUploadHref(href) {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && /(^|\.)yandex\.(net|ru)$/.test(url.hostname)
  } catch { return false }
}
