/** @see ../docs/modules/synchronization/plan-generation.md#assignment-routing */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { prepareAssignmentRoute } from '../day/assignment-routing.mjs'
import { assertSourceAligned } from '../day/pipeline-contract.mjs'

const [requestFile, flag] = process.argv.slice(2)
if (!requestFile || flag && flag !== '--apply') throw new Error('Использование: npm run day:route -- REQUEST.json [--apply]')
const local = resolve(process.env.EDUCATION_CHILD_WORKSPACE || '.local')
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const request = read(resolve(requestFile))
const planFile = (date) => resolve(local, `day-source-${date}.json`)
const readSnapshot = (date) => read(resolve(local, `diary/snapshot-${date}.json`))
const result = prepareAssignmentRoute(request, read(planFile(request.fromSourceDate)), read(planFile(request.toSourceDate)), read(resolve(local, 'day-links.json')), readSnapshot)
const plans = { [request.fromSourceDate]: result.from, [request.toSourceDate]: result.to }
const context = { readSnapshot, readSource: (date) => plans[date] ?? read(planFile(date)) }
for (const plan of Object.values(plans)) assertSourceAligned(plan, readSnapshot(plan.targetDate), context)
if (flag === '--apply' && !result.reused) {
  const removalsFile = resolve(local, 'weekend-slot-removals.json')
  const removals = existsSync(removalsFile) ? read(removalsFile) : { removals: [] }
  if (result.removedWeekend) removals.removals.push({ lessonDate: result.route.fromDate, taskIds: result.removedWeekend.taskIds,
    reason: `Перенос того же листа к ${result.route.toDate}: ${result.route.reason}` })
  const writes = [...Object.entries(plans).map(([date, plan]) => [planFile(date), plan]), [removalsFile, removals]]
  const backup = resolve(local, 'assignment-routing', `${Date.now()}-${request.taskId}.json`)
  mkdirSync(resolve(local, 'assignment-routing'), { recursive: true, mode: 0o700 })
  writeFileSync(backup, `${JSON.stringify({ request, before: writes.map(([file]) => ({ file, text: existsSync(file) ? readFileSync(file, 'utf8') : null })) }, null, 2)}\n`, { mode: 0o600 })
  for (const [file, value] of writes) writeFileSync(`${file}.route-tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  for (const [file] of writes) renameSync(`${file}.route-tmp`, file)
}
console.log(JSON.stringify({ valid: true, applied: flag === '--apply', reused: result.reused, taskId: result.route.taskId,
  fromDate: result.route.fromDate, toDate: result.route.toDate, subject: result.route.toSubjectName,
  next: `npm run day -- publish-batch ${request.fromSourceDate} ${request.toSourceDate}` }))
