/** Detect unreviewed changes to the existing Education interface.
 * @see ../docs/product/ui-change-control.md#mechanical-gate
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baselinePath = resolve(root, 'docs/product/ui-contract-baseline.json')
const decisionsPath = resolve(root, 'docs/product/ui-change-decisions.json')

// This seal makes the initial inventory immutable. New/changed UI files go into
// ui-change-decisions.json with a review record; do not regenerate the baseline.
const BASELINE_SHA256 = '06906431b44f867c6973cef128fa878e814d0f2de629fc1b7c7bcae041337192'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const isProductUiFile = (path) => /^(src|day|storage|diary|assessment|packages|pwa|sync|scripts|operator)\/.*\.(mjs|js|ts|tsx|css)$/.test(path)
  && !/\.test\.[^.]+$/.test(path) && !path.endsWith('.d.ts') && path !== 'scripts/check-ui-contract.mjs'

export function checkUiContracts({ paths, baseline, decisions, read, exists }) {
  const problems = []
  const actual = new Set(paths.filter(isProductUiFile))
  for (const path of Object.keys(baseline.files)) {
    if (!actual.has(path)) problems.push(`Удалён защищённый UI-файл ${path}: нужна запись о решении и миграции.`)
  }
  for (const path of actual) {
    const digest = sha256(read(path))
    if (baseline.files[path] === digest) continue
    const decision = decisions.files[path]
    if (!decision) {
      problems.push(`Продуктовый код изменён без решения: ${path}. Запиши «было → стало», основание, спецификацию и проверки в ui-change-decisions.json.`)
      continue
    }
    if (decision.sha256 !== digest) problems.push(`Устарел отпечаток решения для ${path}.`)
    if (!/^docs\/decisions\/[a-z0-9-]+\.md$/.test(decision.record ?? '') || !exists(decision.record)) {
      problems.push(`Нет записи о согласованном решении для ${path}.`)
    } else {
      const record = read(decision.record)
      for (const heading of ['## Основание', '## Было → стало', '## Действия и роли', '## Проверки', '## Согласование']) {
        if (!record.includes(heading)) problems.push(`${decision.record}: нет раздела «${heading}».`)
      }
      if (!record.includes(path)) problems.push(`${decision.record}: не назван затронутый файл ${path}.`)
    }
    if (!Array.isArray(decision.specs) || decision.specs.length === 0 || decision.specs.some((spec) => !/^docs\/(product|services|modules|shared|operations)\/.+\.md$/.test(spec) || !exists(spec))) {
      problems.push(`${path}: нужна ссылка на действующую спецификацию.`)
    }
    if (!Array.isArray(decision.tests) || decision.tests.length === 0 || decision.tests.some((test) => !/^(src|scripts|day|storage|diary|assessment|packages|pwa|sync|operator)\/.+\.test\.(tsx|ts|mjs|js)$/.test(test) || !exists(test))) {
      problems.push(`${path}: нужны существующие регрессионные тесты.`)
    }
    if (!['direct-request', 'approved-mockup'].includes(decision.authorization?.status) || typeof decision.authorization?.evidence !== 'string' || decision.authorization.evidence.trim().length < 20) {
      problems.push(`${path}: укажи прямой запрос пользователя или утверждённый макет с конкретным свидетельством.`)
    }
  }
  for (const path of Object.keys(decisions.files)) {
    if (!actual.has(path)) problems.push(`Устаревшее решение для отсутствующего UI-файла ${path}.`)
    else if (baseline.files[path] === sha256(read(path))) problems.push(`Лишняя запись решения для неизменённого ${path}.`)
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const baselineRaw = readFileSync(baselinePath, 'utf8')
  const problems = []
  if (sha256(baselineRaw) !== BASELINE_SHA256) problems.push('Исходный UI-реестр изменён. Не обновляй baseline: новое решение записывается отдельно.')
  const baseline = JSON.parse(baselineRaw)
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf8'))
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  problems.push(...checkUiContracts({
    paths, baseline, decisions,
    read: (path) => readFileSync(resolve(root, path), 'utf8'),
    exists: (path) => existsSync(resolve(root, path)),
  }))
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  } else console.log(`UI-контракт: ${Object.keys(baseline.files).length} исходных файлов, ${Object.keys(decisions.files).length} принятых изменений; расхождений нет.`)
}
