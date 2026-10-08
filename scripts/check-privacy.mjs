import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** @see ../docs/product/storage-privacy.md#privacy-boundary */
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
  'Пет' + '(?:я|и|р|ька)',
  'Лебе' + 'дев',
  'РМГ' + '\\s*' + '6р',
  'y0' + '__[A-Za-z0-9_-]{20,}',
  '-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
].join('|'), 'iu')
const violations = []

for (const { path, object } of changed) {
  const iconHash = publicIconHashes[path.replace(/^public\//, '')]
  if (iconHash) {
    const bytes = history
      ? execFileSync('git', ['cat-file', '-p', object], { maxBuffer: 20 * 1024 * 1024 })
      : execFileSync('git', ['show', object], { maxBuffer: 20 * 1024 * 1024 })
    if (createHash('sha256').update(bytes).digest('hex') !== iconHash) violations.push(`${path}: иконка не совпадает с проверенным файлом`)
    continue
  }
  if (forbiddenPath.test(path)) { violations.push(`${path}: закрытый файл или медиа`); continue }
  if (history && execFileSync('git', ['cat-file', '-t', object], { encoding: 'utf8' }).trim() !== 'blob') continue
  const content = history
    ? execFileSync('git', ['cat-file', '-p', object], { maxBuffer: 20 * 1024 * 1024 })
    : execFileSync('git', ['show', object], { maxBuffer: 20 * 1024 * 1024 })
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
