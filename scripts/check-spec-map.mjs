import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mapPath = resolve(root, 'docs/file-map.md')
const mapDir = resolve(root, 'docs')
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
  if (!/^docs\/(product|services|modules|shared|operations|decisions|research|audits|plans)\/.+\.md$/.test(spec) || !existsSync(resolve(root, spec))) {
    problems.push(`У ${name} отсутствует действующая спецификация: ${specLink}`)
  }
  if (!purpose.trim() || !consumer.trim()) problems.push(`У ${name} не указаны назначение или потребитель.`)
}

const actual = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter((name) => name && existsSync(resolve(root, name))))
for (const name of actual) if (!files.has(name)) problems.push(`Файл без спецификации: ${name}`)
for (const name of files.keys()) if (!actual.has(name)) problems.push(`Устаревшая запись без файла: ${name}`)

// A file-map row states ownership; the local reference makes the reason visible
// while editing the component or its CSS. Keep media loading in one component.
// @see ../docs/shared/design/components.md#change-gates
for (const name of actual) {
  if (/^src\/components\/[^/]+\.(tsx|css)$/.test(name) && !name.endsWith('.test.tsx')) {
    const source = readFileSync(resolve(root, name), 'utf8')
    if (!/@see\s+\.\.\/\.\.\/docs\/(product|services|modules|shared)\//.test(source)) {
      problems.push(`У продуктового компонента нет ссылки @see на контракт: ${name}`)
    }
  }
  if (/^src\/.*\.tsx$/.test(name) && name !== 'src/components/EducationImage.tsx'
    && /<img\b/.test(readFileSync(resolve(root, name), 'utf8'))) {
    problems.push(`Изображение обходит EducationImage: ${name}`)
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
} else {
  console.log(`Карта спецификаций: ${files.size} файлов, все ссылки и потребители указаны.`)
}
