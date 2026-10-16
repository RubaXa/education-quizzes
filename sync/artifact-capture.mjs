import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDataDir, writeJson } from '../diary/local-store.mjs'

/** Immutable, family-private input to the shared enrichment pipeline.
 * The current MESH snapshot remains in diary/; this copy survives later revisions.
 * @see ../docs/modules/synchronization/shared-artifact-pipeline.md#capture
 */
const safeId = /^[A-Za-z0-9_-]{1,120}$/
const safeDate = /^\d{4}-\d{2}-\d{2}$/
const safeRun = /^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])]))
  return value
}

export function capturePayload(snapshot) {
  if (!snapshot?.complete || snapshot.source !== 'mesh' || !safeDate.test(snapshot.date ?? '')
    || !snapshot.profile || !Array.isArray(snapshot.schedule) || !Array.isArray(snapshot.marks)
    || !Array.isArray(snapshot.assignments)) throw new Error('Неполный снимок нельзя сохранить как подтверждённый исходник.')
  return canonical({ schemaVersion: snapshot.schemaVersion, source: snapshot.source, date: snapshot.date,
    marksScope: snapshot.marksScope, assignmentScope: snapshot.assignmentScope,
    profile: snapshot.profile, schedule: snapshot.schedule, marks: snapshot.marks, assignments: snapshot.assignments })
}

export function captureHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(capturePayload(snapshot))).digest('hex')
}

export function persistMeshCapture({ runDir, runId, familyId, childId, snapshot }) {
  if (!safeRun.test(runId ?? '') || !safeId.test(familyId ?? '') || !safeId.test(childId ?? '')) {
    throw new Error('Нужны безопасные ID запуска, семьи и ребёнка.')
  }
  const content = capturePayload(snapshot)
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  const dir = resolve(runDir, 'private-captures', familyId, childId, snapshot.date)
  ensureDataDir(dir)
  const file = resolve(dir, `${hash}.json`)
  const bytes = `${JSON.stringify(content, null, 2)}\n`
  if (!existsSync(file)) {
    try { writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' }) }
    catch (error) { if (error?.code !== 'EEXIST') throw error }
  }
  if (readFileSync(file, 'utf8') !== bytes) throw new Error('Неизменяемый артефакт источника не совпал со своим хэшем.')
  const observationDir = resolve(runDir, 'observations', runId, familyId, childId)
  writeJson(observationDir, `${snapshot.date}.json`, {
    schemaVersion: 1, kind: 'mesh-source-capture', scope: 'family-private',
    familyId, childId, date: snapshot.date, contentSha256: hash, fetchedAt: snapshot.fetchedAt,
    stage: 'captured',
  })
  return { contentSha256: hash, relativePath: `private-captures/${familyId}/${childId}/${snapshot.date}/${hash}.json` }
}
