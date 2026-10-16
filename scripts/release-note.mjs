import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** A release note is private operator input, never a file bundled into the PWA.
 * @see ../docs/modules/notifications/inbox.md#notification-producers
 */
export function loadReleaseNote(filename) {
  const local = resolve('.local')
  const path = resolve(filename ?? '')
  if (!path.startsWith(`${local}${sep}`) || !path.endsWith('.json') || !existsSync(path)) {
    throw new Error('Описание выпуска должно быть существующим JSON-файлом в .local/.')
  }
  const input = JSON.parse(readFileSync(path, 'utf8'))
  if (!/^[a-z0-9-]{8,80}$/.test(input.releaseId ?? '')
    || typeof input.title !== 'string' || input.title.trim().length < 8 || input.title.length > 100
    || typeof input.body !== 'string' || input.body.trim().length < 15 || input.body.length > 500
    || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 4
    || !input.changes.every((line) => typeof line === 'string' && line.trim().length >= 8 && line.length <= 180)
    || !['all', 'parent', 'student'].includes(input.audience)) {
    throw new Error('Нужны ID выпуска, заголовок, описание, 1–4 конкретных изменения и аудитория.')
  }
  return { path, input }
}
