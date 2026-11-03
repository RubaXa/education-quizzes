/** Stable operator command for the numeric grade ledger.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { proposeGradeSnapshot, gradeCollectionProvenance } from '../day/grade-snapshot.mjs'

const args = process.argv.slice(2)
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const [date, reportPath] = args
const action = args.includes('--apply') ? '--apply' : undefined
const receiptPath = option('--receipt')
if (!/^20\d{2}-\d{2}-\d{2}$/.test(date ?? '') || !reportPath || action && action !== '--apply') {
  throw new Error('Использование: npm run grades:snapshot -- YYYY-MM-DD reports/YYYY-MM-DD-education-sync/baseline.md [--apply]')
}
const root = resolve(option('--workspace') ?? resolve(import.meta.dirname, '..'))
const snapshotFile = resolve(root, `.local/diary/snapshot-${date}.json`)
const ledgerFile = resolve(root, '../learner/grade-snapshot.json')
const reportFile = receiptPath ? resolve(receiptPath) : resolve(root, '..', reportPath)
if (!existsSync(snapshotFile) || !existsSync(ledgerFile) || !existsSync(reportFile)) {
  throw new Error('Нужны полный снимок МЭШ, прежний срез оценок и существующий источник подтверждения.')
}
const mesh = JSON.parse(readFileSync(snapshotFile, 'utf8'))
const previous = JSON.parse(readFileSync(ledgerFile, 'utf8'))
let provenance = reportPath
if (receiptPath) {
  const receipt = JSON.parse(readFileSync(reportFile, 'utf8'))
  provenance = gradeCollectionProvenance(receipt, mesh)
}
const { proposal, changes } = proposeGradeSnapshot(previous, mesh, provenance)
if (action === '--apply' && changes.length) writeFileSync(ledgerFile, `${JSON.stringify(proposal, null, 2)}\n`)
console.log(JSON.stringify({ sourceDate: date, fetchedAt: mesh.fetchedAt, changedSubjects: changes,
  applied: action === '--apply' && changes.length > 0, unchanged: changes.length === 0 }, null, 2))
