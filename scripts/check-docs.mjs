/** Fast deterministic documentation gate; no network, build or application tests.
 * @see ../docs/shared/specification-system.md
 */
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectRepository, root } from './spec-graph.mjs'

export function stagedSnapshot(repositoryRoot) {
  const git = (args, options = {}) => execFileSync('git', args, { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024, ...options })
  const records = git(['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^\d+ ([a-f0-9]+) (\d)\t([\s\S]+)$/)
    if (!match || match[2] !== '0') throw new Error('В индексе есть неразрешённый конфликт Git.')
    return { oid: match[1], path: match[3] }
  })
  const textFiles = records.filter(({ path }) => /\.(md|ts|tsx|js|mjs|css|rules)$/.test(path))
  const oids = [...new Set(textFiles.map(({ oid }) => oid))]
  const buffer = git(['cat-file', '--batch'], { input: `${oids.join('\n')}\n` })
  let offset = 0
  const blobs = new Map()
  for (const oid of oids) {
    const end = buffer.indexOf(10, offset)
    const header = buffer.subarray(offset, end).toString().match(/^([a-f0-9]+) blob (\d+)$/)
    if (!header || header[1] !== oid) throw new Error(`Не удалось прочесть Git blob ${oid}.`)
    const size = Number(header[2])
    blobs.set(oid, buffer.subarray(end + 1, end + 1 + size).toString('utf8'))
    offset = end + size + 2
  }
  const paths = records.map(({ path }) => path)
  const content = new Map(textFiles.map(({ oid, path }) => [path, blobs.get(oid)]))
  const existing = new Set(paths)
  for (const path of paths) {
    const pieces = path.split('/')
    while (pieces.length > 1) { pieces.pop(); existing.add(pieces.join('/')) }
  }
  const normalize = (path) => relative(repositoryRoot, resolve(repositoryRoot, path)).replaceAll('\\', '/')
  return {
    paths,
    read: (path) => {
      const key = normalize(path)
      if (!content.has(key)) throw new Error(`Файл отсутствует в снимке текста индекса: ${key}`)
      return content.get(key)
    },
    exists: (path) => existing.has(normalize(path)),
  }
}

export function checkDocs(repositoryRoot = root, { staged = false } = {}) {
  const start = performance.now()
  const result = inspectRepository(repositoryRoot, staged ? stagedSnapshot(repositoryRoot) : undefined)
  return { ...result, elapsedMs: Math.round(performance.now() - start) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const staged = process.argv.includes('--staged')
    if (staged && !execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root }).length) {
      console.log('Документы: нет подготовленных изменений.')
    } else {
      const result = checkDocs(root, { staged })
      if (result.problems.length) {
        console.error(result.problems.join('\n'))
        process.exitCode = 1
      } else console.log(`Документы (${staged ? 'Git index' : 'рабочая папка'}): ${result.documents.length} спецификаций; структура, ссылки, якоря и карта файлов проверены за ${result.elapsedMs} мс.`)
    }
  } catch (error) { console.error(`Проверка документов: ${error.message}`); process.exitCode = 1 }
}
