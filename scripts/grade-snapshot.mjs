/** Stable operator command for the numeric grade ledger.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { proposeGradeSnapshot } from '../day/grade-snapshot.mjs'

const [date, reportPath, action] = process.argv.slice(2)
if (!/^20\d{2}-\d{2}-\d{2}$/.test(date ?? '') || !reportPath || action && action !== '--apply') {
  throw new Error('Использование: npm run grades:snapshot -- YYYY-MM-DD reports/YYYY-MM-DD-education-sync/baseline.md [--apply]')
}
const root = resolve(import.meta.dirname, '..')
const snapshotFile = resolve(root, `.local/diary/snapshot-${date}.json`)
const ledgerFile = resolve(root, '../learner/grade-snapshot.json')
const reportFile = resolve(root, '..', reportPath)
if (!existsSync(snapshotFile) || !existsSync(ledgerFile) || !existsSync(reportFile)) {
  throw new Error('Нужны полный снимок МЭШ, прежний срез оценок и постоянный отчёт запуска.')
}
const mesh = JSON.parse(readFileSync(snapshotFile, 'utf8'))
const previous = JSON.parse(readFileSync(ledgerFile, 'utf8'))
const { proposal, changes } = proposeGradeSnapshot(previous, mesh, reportPath)
if (action === '--apply' && changes.length) writeFileSync(ledgerFile, `${JSON.stringify(proposal, null, 2)}\n`)
console.log(JSON.stringify({ sourceDate: date, fetchedAt: mesh.fetchedAt, changedSubjects: changes,
  applied: action === '--apply' && changes.length > 0, unchanged: changes.length === 0 }, null, 2))
