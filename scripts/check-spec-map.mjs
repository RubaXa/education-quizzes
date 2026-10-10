import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mapPath = resolve(root, 'docs/product/file-map.md')
const mapDir = resolve(root, 'docs/product')
const lines = readFileSync(mapPath, 'utf8').split(/\r?\n/)
const files = new Map()
const problems = []

for (const [index, line] of lines.entries()) {
  if (!line.startsWith('| [')) continue
  const match = line.match(/^\| \[([^\]]+)\]\(([^)]+)\) \| \[[^\]]+\]\(([^)]+)\) \| ([^|]+) \| ([^|]+) \|$/)
  if (!match) {
    problems.push(`Строка ${index + 1}: неверный формат записи файла.`)
    continue
  }
  const [, name, fileLink, specLink, purpose, consumer] = match
  if (files.has(name)) problems.push(`Повтор файла: ${name}`)
  files.set(name, index + 1)
  if (relative(root, resolve(mapDir, fileLink)).split(sep).join('/') !== name) {
    problems.push(`Неверная ссылка на файл ${name}: ${fileLink}`)
  }
  const spec = relative(root, resolve(mapDir, specLink)).split(sep).join('/')
  if (!/^docs\/(product|architecture)\/.+\.md$/.test(spec) || !existsSync(resolve(root, spec))) {
    problems.push(`У ${name} отсутствует действующая спецификация: ${specLink}`)
  }
  if (!purpose.trim() || !consumer.trim()) problems.push(`У ${name} не указаны назначение или потребитель.`)
}

const actual = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean))
for (const name of actual) if (!files.has(name)) problems.push(`Файл без спецификации: ${name}`)
for (const name of files.keys()) if (!actual.has(name)) problems.push(`Устаревшая запись без файла: ${name}`)

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
} else {
  console.log(`Карта спецификаций: ${files.size} файлов, все ссылки и потребители указаны.`)
}
