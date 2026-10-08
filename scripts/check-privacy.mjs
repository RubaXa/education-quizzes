import { execFileSync } from 'node:child_process'

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
const forbiddenText = new RegExp([
  'Пет' + '(?:я|и|р|ька)',
  'Лебе' + 'дев',
  'РМГ' + '\\s*' + '6р',
  'y0' + '__[A-Za-z0-9_-]{20,}',
  '-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
].join('|'), 'iu')
const violations = []

for (const { path, object } of changed) {
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
