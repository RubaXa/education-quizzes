/** @see ../docs/decisions/independent-action-dispatch-2026-10-21.md */
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prepareEventTaskArtifact, taskArtifactFingerprint, validateTaskArtifact } from './event-task-artifact.mjs'
import { resolveEducationSyncExecution } from '../packages/telegram-notifications/application/education-sync-dispatcher.mjs'

/** Materialize a frozen request as private pages, with no global source discovery.
 * @see ../docs/modules/synchronization/execution-artifact.md
 */
export async function exportEventTaskManifest(db, store, { root, requestId, tokenHash, now = new Date().toISOString() }) {
  const state = await store.read()
  const execution = resolveEducationSyncExecution(state, { requestId, tokenHash, now })
  if (!execution) throw new Error('claim_file_invalid')
  if (!Number.isInteger(execution.actionThroughGeneration)) throw new Error('education_sync_action_request_unclaimed')
  if (typeof store.readActionTasks !== 'function') throw new Error('task_manifest_unavailable')
  const directory = resolve(root, '.local/education-sync-dispatch/tasks', requestId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const pages = [], seenCursors = new Set()
  let cursor = null, taskCount = 0, doneCount = 0, legacyCount = 0
  do {
    const page = await store.readActionTasks({ requestId, cursor, limit: 100, now })
    if (!page || !Array.isArray(page.tasks) || page.complete !== true || page.tasks.length > 100) throw new Error('task_manifest_incomplete')
    const tasks = []
    for (const row of page.tasks) {
      if (!/^[a-f0-9]{64}$/.test(row.jobId ?? '') || !/^[a-f0-9]{64}$/.test(row.eventId ?? '')) throw new Error('task_manifest_invalid')
      const job = await db.doc(`operatorSyncJobs/${row.jobId}`).get()
      if (!job.exists) throw new Error('task_manifest_incomplete')
      const jobData = job.data()
      if (jobData.status === 'done') { doneCount += 1; continue }
      if (!row.artifactPath) {
        if (row.source === 'mesh' || row.kind === 'mesh') { legacyCount += 1; continue }
        throw new Error('task_manifest_incomplete')
      }
      const currentPath = jobData.artifactPath ?? row.artifactPath
      if (!/^operatorSyncTaskArtifacts\/[a-f0-9]{64}$/.test(currentPath)) throw new Error('task_manifest_invalid')
      let snap = await db.doc(currentPath).get()
      if (!snap.exists) throw new Error('task_manifest_incomplete')
      let artifact = snap.data()
      if (artifact.familyId !== jobData.familyId || artifact.childId !== jobData.childId) throw new Error('task_owner_mismatch')
      const observationSnap = await db.doc(`operatorSyncTaskObservations/${row.eventId}`).get()
      const observation = observationSnap.exists ? observationSnap.data() : null
      // A newer verified observation is an invalidation signal for this old
      // immutable snapshot, so rebuild the same addressed action below.
      const superseded = observation && observation.artifactId !== artifact.artifactId
      let validation = superseded ? { state: 'stale' } : validateTaskArtifact(artifact, { eventId: row.eventId, observation, now })
      if (validation.state === 'stale') {
        const refreshed = await prepareEventTaskArtifact(db, artifact, { now })
        if (refreshed.fingerprint !== artifact.fingerprint) {
          const jobRef = db.doc(`operatorSyncJobs/${row.jobId}`)
          await db.runTransaction(async (tx) => {
            const current = await tx.get(jobRef)
            const value = current.data()
            if (!current.exists || !['queued', 'blocked'].includes(value.status)
              || (value.artifactPath ?? row.artifactPath) !== currentPath) throw new Error('task_artifact_refresh_conflict')
            tx.create(db.doc(`operatorSyncJobs/${row.jobId}/artifactRevisions/${refreshed.artifactId}`), {
              artifactPath: refreshed.artifactPath, supersedes: currentPath, fingerprint: refreshed.fingerprint, verifiedAt: now })
            tx.update(jobRef, { artifactPath: refreshed.artifactPath, fingerprint: refreshed.fingerprint,
              artifactRevision: (value.artifactRevision ?? 1) + 1, status: 'queued', phase: 'discovered',
              reason: 'source_refreshed', updatedAt: now })
          })
        }
        snap = await db.doc(refreshed.artifactPath).get()
        artifact = snap.data()
        const freshObservation = await db.doc(refreshed.observationPath).get()
        validation = validateTaskArtifact(artifact, { eventId: row.eventId, observation: freshObservation.data(), now })
        if (validation.state !== 'ready') throw new Error('task_manifest_incomplete')
      }
      tasks.push({ jobId: row.jobId, kind: row.kind, generation: row.generation, artifact,
        acceptance: 'Перед публикацией перепроверить текущего владельца и исходную ревизию/CAS. После публикации перечитать результат; затем finish того же jobId с evidence. Не сканировать общий inbox.' })
    }
    if (tasks.length) {
      const name = `page-${pages.length + 1}.json`
      const content = { schemaVersion: 1, requestId, tasks }
      writePrivate(resolve(directory, name), content)
      pages.push({ name, count: tasks.length, fingerprint: taskArtifactFingerprint(content) })
      taskCount += tasks.length
    }
    cursor = page.nextCursor ?? null
    if (cursor && (typeof cursor !== 'string' || seenCursors.has(cursor))) throw new Error('task_manifest_cursor_invalid')
    if (cursor) seenCursors.add(cursor)
  } while (cursor)
  const finalState = await store.read()
  const finalExecution = resolveEducationSyncExecution(finalState, { requestId, tokenHash, now })
  if (!finalExecution || finalExecution.scope !== execution.scope
    || finalExecution.actionAfterGeneration !== execution.actionAfterGeneration
    || finalExecution.actionThroughGeneration !== execution.actionThroughGeneration) throw new Error('claim_file_invalid')
  const manifest = { schemaVersion: 1, requestId, createdAt: now, state: legacyCount ? 'partial' : taskCount ? 'ready' : 'no-work',
    coverage: { actionAfterGeneration: execution.actionAfterGeneration ?? null,
      actionThroughGeneration: execution.actionThroughGeneration ?? null },
    pages, taskCount, doneCount, legacyCount }
  const manifestPath = resolve(directory, 'manifest.json')
  writePrivate(manifestPath, manifest)
  return { status: manifest.state, requestId, manifestPath, taskCount, doneCount, legacyCount, pageCount: pages.length }
}

function writePrivate(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, path)
  chmodSync(path, 0o600)
}
