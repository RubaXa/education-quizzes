/** @see ../docs/modules/materials/storage-privacy.md */
/** @see ../docs/decisions/personal-tutoring-2026-10-30.md */
import { createHash } from 'node:crypto'

/** A consented historical blob is not a path-wide or text-pattern exemption. */
export function approvedHistoricalObject({ history, object, path, bytes, current = false }, entries) {
  if (!history || !/^[a-f0-9]{40}$/.test(object)) return false
  return entries.some(entry => entry.object === object && entry.paths.includes(path)
    && (!current || entry.kind === 'official-public-pdf')
    && entry.sha256 === createHash('sha256').update(bytes).digest('hex'))
}

/** Decode git cat-file --batch without changing bytes or invoking one process per object. */
export function batchObjects(output, requests) {
  const result = new Map(); let offset = 0
  for (const request of requests) {
    const end = output.indexOf(10, offset)
    if (end < 0) throw new Error('Invalid git object batch header')
    const header = output.subarray(offset, end).toString('utf8').split(' '), size = Number(header[2])
    if (header.length !== 3 || !Number.isSafeInteger(size) || size < 0 || end + size + 1 >= output.length) throw new Error('Invalid git object batch length')
    result.set(request, { type: header[1], bytes: output.subarray(end + 1, end + 1 + size) })
    offset = end + size + 2
  }
  if (offset !== output.length) throw new Error('Trailing git object batch data')
  return result
}

/** Match the personal name as a word, not an internal substring of a teaching term. */
export const privateNamePattern = '(?<![\\p{L}])' + 'Пет' + '(?:я|и|р(?:а|у|ом|е)?|ьк(?:а|и|е|у|ой))' + '(?![\\p{L}])'
