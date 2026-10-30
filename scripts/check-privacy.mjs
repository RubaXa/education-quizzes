import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { approvedHistoricalObject, batchObjects, privateNamePattern } from './privacy-exceptions.mjs'
/** @see ../docs/decisions/personal-tutoring-2026-10-30.md */

/** @see ../docs/modules/materials/storage-privacy.md#privacy-boundary */
const history = process.argv.includes('--history')
const staged = execFileSync('git', ['diff', '--cached', '--diff-filter=ACMR', '--name-only', '-z'])
  .toString('utf8').split('\0').filter(Boolean).map((path) => ({ path, object: `:${path}` }))
const committed = history ? execFileSync('git', ['rev-list', '--objects', 'HEAD']).toString('utf8')
  .split('\n').filter(Boolean).flatMap((line) => {
    const separator = line.indexOf(' ')
    return separator < 0 ? [] : [{ path: line.slice(separator + 1), object: line.slice(0, separator) }]
  }) : []
const changed = history ? committed : staged
const forbiddenPath = /(^|\/)(\.local|public\/materials|materials|current-material-pages\.json|[^/]*\.(?:png|jpe?g|webp|gif|pdf|docx?|env(?:\.local)?))(?=\/|$)/i
// These three generated, generic app icons are the only binary media allowed.
// Exact hashes make it impossible to replace an icon with a personal image unnoticed.
const publicIconHashes = {
  'icons/education-180.png': 'c9b927decad18c5f2a4ea232c7c0cacc1c11060869f6f57031d7f1819b0ffd64',
  'icons/education-192.png': '22c126087f6dd6c0c35118319b84de5ab70d5c7f7d5c3319d2fe0d26ff944733',
  'icons/education-512.png': 'ca2de8f4f699520f8cf07a987d249bca21a5cc5f0dbcf617029f98126c909d57',
}
const forbiddenText = new RegExp([
  privateNamePattern,
  'Лебе' + 'дев',
  'РМГ' + '\\s*' + '6р',
  'y0' + '__[A-Za-z0-9_-]{20,}',
  '-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
].join('|'), 'iu')
const violations = []
const exceptions = JSON.parse(readFileSync(new URL('./privacy-history-exceptions.json', import.meta.url), 'utf8')).entries
const requests = [...new Set(changed.map(row => row.object))]
const objects = new Map(requests.length ? batchObjects(execFileSync('git', ['cat-file', '--batch'], { input: `${requests.join('\n')}\n`, maxBuffer: 256 * 1024 * 1024 }), requests) : [])
const currentObjects = history ? new Set(execFileSync('git', ['ls-tree', '-r', '--format=%(objectname) %(path)', 'HEAD'], { encoding: 'utf8' }).trim().split('\n')) : new Set()


for (const { path, object } of changed) {
  const record = objects.get(object)
  if (record?.type !== 'blob') continue
  const content = record.bytes
  if (approvedHistoricalObject({ history, object, path, bytes: content, current: currentObjects.has(`${object} ${path}`) }, exceptions)) continue
  const iconHash = publicIconHashes[path.replace(/^public\//, '')]
  if (iconHash) {
    const bytes = content
    if (createHash('sha256').update(bytes).digest('hex') !== iconHash) violations.push(`${path}: иконка не совпадает с проверенным файлом`)
    continue
  }
  // Only normative Markdown in this exact docs directory may use the name materials.
  // Media, .local, secrets and content scanning retain their existing checks.
  const materialSpecification = /^docs\/modules\/materials\/[a-z0-9-]+\.md$/i.test(path)
  if (forbiddenPath.test(path) && !materialSpecification) { violations.push(`${path}: закрытый файл или медиа`); continue }

  if (content.includes(0) && !/\.(?:woff2?|ttf|ico)$/i.test(path) || forbiddenText.test(content.toString('utf8'))) {
    violations.push(`${path}: возможные персональные данные или секрет`)
  }
}

if (violations.length) {
  console.error(`Коммит остановлен проверкой приватности:\n${violations.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Проверка приватности: ${changed.length} ${history ? 'объектов истории' : 'подготовленных файлов'}, нарушений нет.`)
}
