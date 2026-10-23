/** @see ../docs/decisions/sync-task-routing-2026-10-23.md */
/** Local inspection of the deterministic plan captured by the existing scan.
 * No Firestore or Mesh reads; old receipts without a plan are explicitly stale.
 * @see ../docs/modules/synchronization/task-routing.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function inspectRoutePlan(root, runId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId ?? '')) throw new Error('Plan requires a scan run UUID.')
  const journal = resolve(root, '.local/operator-runs', `${runId}.json`)
  const receipt = JSON.parse(readFileSync(journal, 'utf8'))
  if (receipt.operation !== 'queue.scan' || receipt.status !== 'succeeded') throw new Error('Plan requires a successful queue.scan receipt.')
  const snapshot = JSON.parse(receipt.stdout)
  const plan = snapshot.routePlan
  if (snapshot.inboxSnapshot?.complete !== true || plan?.schemaVersion !== 1
    || !Array.isArray(plan.tasks) || !Array.isArray(plan.jobs)) throw new Error('This scan has no complete route plan; run a fresh discovery.')
  const directory = resolve(root, '.local/operator-runs/plans')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const planPath = resolve(directory, `${runId}.json`)
  writeFileSync(planPath, JSON.stringify({ scannedAt: snapshot.scannedAt, journal, ...plan }, null, 2), { mode: 0o600 })
  const routes = {}
  for (const task of plan.tasks) routes[task.next] = (routes[task.next] ?? 0) + 1
  return { planPath, scannedAt: snapshot.scannedAt, tasks: plan.tasks.length, jobs: plan.jobs.length,
    routes, freshSourceCheckRequired: true, completionClaim: false }
}
