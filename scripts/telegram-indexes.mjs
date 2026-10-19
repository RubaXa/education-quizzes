#!/usr/bin/env node
/** Scoped, additive Firestore index provisioning for Telegram worker queries.
 * @see ../docs/services/telegram-bot/operations.md#index-readiness
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { prepareLocalApplicationCredentials } from '../packages/education-runtime/firestore.mjs'

const require = createRequire(import.meta.url)
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const defaultTimeoutMs = 90_000
const defaultPollMs = 2_000

export async function runIndexCommand(argv, { cwd = process.cwd(), env = process.env, clientFactory,
  readManifest = (path) => JSON.parse(readFileSync(path, 'utf8')), write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)), timeoutMs = defaultTimeoutMs,
  pollMs = defaultPollMs } = {}) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    write({ usage: 'node scripts/telegram-indexes.mjs list|plan [--project PROJECT_ID] [--apply]' })
    return { exitCode: 0 }
  }
  const projectId = parsed.projectId ?? env.TELEGRAM_FIRESTORE_PROJECT_ID
  if (!projectPattern.test(projectId ?? '')) throw safeError('firestore_project_required')
  if (parsed.command !== 'list' && parsed.command !== 'plan') throw safeError('invalid_command')
  if (parsed.apply && parsed.command !== 'plan') throw safeError('invalid_apply_mode')
  const manifest = readManifest(resolve(cwd, 'packages/telegram-notifications/firestore.indexes.json'))
  const expected = validateManifest(manifest)
  const client = clientFactory
    ? await clientFactory({ projectId, cwd, env })
    : createAdminClient({ projectId, cwd, env })
  try {
    const manager = createIndexManager({ client, projectId, expected, sleep, timeoutMs, pollMs })
    if (parsed.command === 'list') {
      const result = await manager.inspect()
      write({ operation: 'list', projectId, ready: result.ready, indexes: publicIndexes(result) })
      return { exitCode: 0, ...result }
    }

    const plan = await manager.inspect()
    if (!parsed.apply) {
      write({ operation: 'plan', projectId, applyRequired: plan.createCount > 0,
        createCount: plan.createCount, readyCount: plan.readyCount, notReadyCount: plan.notReadyCount,
        indexes: publicIndexes(plan) })
      return { exitCode: 0, ...plan }
    }

    await manager.createMissing(plan)
    const ready = await manager.waitUntilReady()
    write({ operation: 'plan', projectId, applied: true, ready: ready.ready,
      createCount: plan.createCount, readyCount: ready.readyCount, notReadyCount: ready.notReadyCount,
      indexes: publicIndexes(ready) })
    return { exitCode: ready.ready ? 0 : 2, ...ready, createCount: plan.createCount }
  } finally {
    await client.close?.()
  }
}

export function createIndexManager({ client, projectId, expected, sleep = async () => {},
  timeoutMs = defaultTimeoutMs, pollMs = defaultPollMs, now = () => Date.now() } = {}) {
  if (!client || !projectPattern.test(projectId ?? '') || !Array.isArray(expected)
    || !Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs < 1) {
    throw safeError('invalid_index_manager_config')
  }

  async function inspect() {
    const current = new Map()
    const seenIndexNames = new Set()
    const expectedGroups = new Set(expected.filter((index) => !index.fieldOverride).map((index) => index.collectionGroup))
    for (const collectionGroup of [...new Set(expected.filter((index) => !index.fieldOverride).map((index) => index.collectionGroup))]) {
      const parent = collectionGroupName(projectId, collectionGroup)
      let iterator
      try { iterator = client.listIndexesAsync({ parent }) }
      catch (error) { throw safeApiError(error) }
      try {
        for await (const index of iterator) {
          const actualGroup = collectionGroupFromIndexName(index?.name, projectId)
          if (!actualGroup || !expectedGroups.has(actualGroup) || seenIndexNames.has(index.name)) continue
          seenIndexNames.add(index.name)
          const key = indexKey({ ...index, collectionGroup: actualGroup })
          if (!key) continue
          const rows = current.get(key) ?? []
          rows.push(index)
          current.set(key, rows)
        }
      } catch (error) { throw safeApiError(error) }
    }
    const indexes = expected.filter((spec) => !spec.fieldOverride).map((spec) => {
      const matches = current.get(indexKey(spec)) ?? []
      const state = matches.length === 0 ? 'MISSING' : matches.length > 1 ? 'AMBIGUOUS' : stateName(matches[0].state)
      return Object.freeze({ collectionGroup: spec.collectionGroup,
        fields: Object.freeze(spec.fields.map((field) => field.fieldPath)), key: indexKey(spec), state })
    })
    for (const spec of expected.filter((item) => item.fieldOverride)) {
      let field
      const requestedName = fieldName(projectId, spec)
      try { [field] = await client.getField({ name: requestedName }) }
      catch (error) { throw safeApiError(error) }
      const matches = field?.name === requestedName
        ? (field.indexConfig?.indexes ?? []).filter((index) => fieldIndexMatches(index, spec)) : []
      const state = !matches.length ? 'MISSING' : matches.some((index) => stateName(index.state) === 'READY') ? 'READY' : stateName(matches[0].state)
      indexes.push({ collectionGroup: spec.collectionGroup, fields: [spec.fieldPath], queryScope: spec.queryScope,
        key: indexKey(spec), state, fieldOverride: true })
    }
    const readyCount = indexes.filter((index) => index.state === 'READY').length
    const createCount = indexes.filter((index) => index.state === 'MISSING').length
    return Object.freeze({ ready: readyCount === indexes.length, createCount, readyCount,
      notReadyCount: indexes.length - readyCount, indexes: Object.freeze(indexes) })
  }

  async function createMissing(plan) {
    for (const status of plan.indexes) {
      if (status.state !== 'MISSING') continue
      const spec = expected.find((item) => indexKey(item) === status.key)
      if (!spec) throw safeError('index_plan_mismatch')
      try {
        if (spec.fieldOverride) {
          const name = fieldName(projectId, spec)
          const [field] = await client.getField({ name })
          if (field?.name !== name) throw safeError('index_field_response_mismatch')
          const indexes = field?.indexConfig?.indexes ?? []
          if (!indexes.some((index) => fieldIndexMatches(index, spec))) {
            // Keep every existing field index; append just the explicitly declared group scope.
            const retained = indexes.map(({ name: _name, state: _state, ...definition }) => definition)
            await client.updateField({ field: { name, indexConfig: { indexes: [...retained,
              { queryScope: spec.queryScope, fields: [{ fieldPath: spec.fieldPath, order: spec.order }] }] } },
            updateMask: { paths: ['index_config'] } })
          }
        } else await client.createIndex({ parent: collectionGroupName(projectId, spec.collectionGroup), index: apiIndex(spec) })
      } catch (error) {
        if (error?.code === 'index_field_response_mismatch') throw error
        if (!isAlreadyExists(error)) throw safeApiError(error)
      }
    }
  }

  async function waitUntilReady() {
    const deadline = now() + timeoutMs
    let result = await inspect()
    while (!result.ready && now() < deadline) {
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())))
      result = await inspect()
    }
    return result
  }

  return Object.freeze({ inspect, createMissing, waitUntilReady })
}

export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.indexes) || !manifest.indexes.length) throw safeError('index_manifest_invalid')
  const indexes = manifest.indexes.map((item) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(item?.collectionGroup ?? '')
      || !['COLLECTION', 'COLLECTION_GROUP'].includes(item.queryScope) || !Array.isArray(item.fields) || item.fields.length < 2) throw safeError('index_manifest_invalid')
    const fields = item.fields.map((field) => {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(field?.fieldPath ?? '')
        || !['ASCENDING', 'DESCENDING'].includes(field.order) || field.arrayConfig || field.vectorConfig) {
        throw safeError('index_manifest_invalid')
      }
      return Object.freeze({ fieldPath: field.fieldPath, order: field.order })
    })
    if (new Set(fields.map((field) => field.fieldPath)).size !== fields.length) throw safeError('index_manifest_invalid')
    return Object.freeze({ collectionGroup: item.collectionGroup, queryScope: item.queryScope, fields: Object.freeze(fields) })
  })
  for (const field of manifest.fieldOverrides ?? []) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(field.collectionGroup ?? '')
      || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(field.fieldPath ?? '') || !Array.isArray(field.indexes) || !field.indexes.length) throw safeError('index_manifest_invalid')
    for (const index of field.indexes) {
      if (index.queryScope !== 'COLLECTION_GROUP' || !['ASCENDING', 'DESCENDING'].includes(index.order)) throw safeError('index_manifest_invalid')
      indexes.push(Object.freeze({ fieldOverride: true, collectionGroup: field.collectionGroup,
        fieldPath: field.fieldPath, queryScope: index.queryScope, order: index.order }))
    }
  }
  if (new Set(indexes.map(indexKey)).size !== indexes.length) throw safeError('index_manifest_duplicate')
  return Object.freeze(indexes)
}

function parseArgs(argv) {
  const args = [...argv]
  if (args.includes('--help') || args.includes('-h')) return { help: true }
  const command = args.shift()
  let projectId = null, apply = false
  while (args.length) {
    const flag = args.shift()
    if (flag === '--apply') { if (apply) throw safeError('invalid_arguments'); apply = true }
    else if (flag === '--project') {
      if (projectId || !args.length) throw safeError('invalid_arguments')
      projectId = args.shift()
    } else throw safeError('invalid_arguments')
  }
  return { command, projectId, apply }
}

function createAdminClient({ projectId, cwd, env }) {
  const keyFilename = prepareLocalApplicationCredentials({ cwd, env })
  const sdkRequire = createRequire(require.resolve('@google-cloud/firestore'))
  const FirestoreAdminClient = sdkRequire('@google-cloud/firestore-api').v1.FirestoreAdminClient
  return new FirestoreAdminClient({ projectId, ...(keyFilename ? { keyFilename } : {}) })
}

function collectionGroupName(projectId, collectionGroup) {
  return `projects/${projectId}/databases/(default)/collectionGroups/${collectionGroup}`
}
function collectionGroupFromIndexName(name, projectId) {
  const match = typeof name === 'string'
    ? /^projects\/([^/]+)\/databases\/\(default\)\/collectionGroups\/([A-Za-z][A-Za-z0-9_]{0,127})\/indexes\/[^/]+$/.exec(name)
    : null
  return match?.[1] === projectId ? match[2] : null
}
function apiIndex(spec) { return { queryScope: spec.queryScope, fields: spec.fields.map((field) => ({ ...field })) } }
function indexKey(index) {
  if (index?.fieldOverride) return JSON.stringify({ collectionGroup: index.collectionGroup, fieldPath: index.fieldPath,
    queryScope: normalizeScope(index.queryScope), order: normalizeOrder(index.order) })
  if (!index || typeof index.collectionGroup !== 'string' || !Array.isArray(index.fields)) return null
  const fields = index.fields.map((field) => ({ fieldPath: field.fieldPath, order: normalizeOrder(field.order),
    arrayConfig: field.arrayConfig ?? null, vectorConfig: field.vectorConfig ?? null }))
  const last = fields.at(-1), prior = fields.at(-2)
  if (last?.fieldPath === '__name__' && prior?.order === last.order) fields.pop()
  return JSON.stringify({ collectionGroup: index.collectionGroup, queryScope: normalizeScope(index.queryScope),
    fields })
}
function publicIndexes(result) {
  return result.indexes.map(({ collectionGroup, fields, state, queryScope, fieldOverride }) => ({ collectionGroup, fields, state,
    ...(fieldOverride ? { fieldOverride, queryScope } : {}) }))
}
function fieldName(projectId, spec) { return `${collectionGroupName(projectId, spec.collectionGroup)}/fields/${spec.fieldPath}` }
function fieldIndexMatches(index, spec) {
  return normalizeScope(index.queryScope) === spec.queryScope && index.fields?.length >= 1
    && index.fields[0].fieldPath === spec.fieldPath && normalizeOrder(index.fields[0].order) === spec.order
}
function normalizeScope(value) {
  return ({ 1: 'COLLECTION', 2: 'COLLECTION_GROUP', 3: 'COLLECTION_RECURSIVE' })[value]
    ?? String(value ?? 'COLLECTION').replace(/^QUERY_SCOPE_/, '')
}
function normalizeOrder(value) {
  return ({ 1: 'ASCENDING', 2: 'DESCENDING' })[value] ?? String(value ?? '').replace(/^ORDER_/, '')
}
function stateName(value) {
  return ({ 2: 'READY', 3: 'NEEDS_REPAIR', 1: 'CREATING' })[value]
    ?? String(value ?? 'UNKNOWN').replace(/^STATE_/, '').toUpperCase()
}
function isAlreadyExists(error) { return error?.code === 6 || error?.code === 'ALREADY_EXISTS' }
function safeApiError(error) {
  const grpcNames = ['ok', 'cancelled', 'unknown', 'invalid_argument', 'deadline_exceeded', 'not_found',
    'already_exists', 'permission_denied', 'resource_exhausted', 'failed_precondition', 'aborted',
    'out_of_range', 'unimplemented', 'internal', 'unavailable', 'data_loss', 'unauthenticated']
  const nameToCode = Object.fromEntries(grpcNames.map((name, code) => [name.toUpperCase(), code]))
  let current = error
  for (let depth = 0; depth < 3 && current; depth += 1, current = current.cause) {
    const rawCode = current.code
    const grpcCode = Number.isInteger(rawCode) ? rawCode
      : typeof rawCode === 'string' && /^\d{1,2}$/.test(rawCode) ? Number(rawCode)
        : nameToCode[String(rawCode ?? '').toUpperCase()]
    if (Number.isInteger(grpcCode) && grpcCode >= 0 && grpcCode < grpcNames.length) {
      const wrapped = safeError(grpcNames[grpcCode])
      wrapped.grpcCode = grpcCode
      if (Number.isInteger(current.status) && current.status >= 100 && current.status <= 599) wrapped.httpStatus = current.status
      return wrapped
    }
    if (Number.isInteger(current.status) && current.status >= 100 && current.status <= 599) {
      const wrapped = safeError('firestore_index_api_failed')
      wrapped.httpStatus = current.status
      return wrapped
    }
  }
  return safeError('firestore_index_api_failed')
}
function safeError(code) { const error = new Error(code); error.code = code; return error }

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runIndexCommand(process.argv.slice(2)).then((result) => { process.exitCode = result.exitCode ?? 0 })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({ operation: 'indexes', error: safeErrorCode(error),
        ...(Number.isInteger(error?.grpcCode) ? { grpcCode: error.grpcCode } : {}),
        ...(Number.isInteger(error?.httpStatus) ? { httpStatus: error.httpStatus } : {}) })}\n`)
      process.exitCode = 1
    })
}

function safeErrorCode(error) {
  return ['firestore_project_required', 'invalid_command', 'invalid_apply_mode', 'invalid_arguments',
    'index_manifest_invalid', 'index_manifest_duplicate', 'invalid_index_manager_config', 'index_plan_mismatch',
    'index_field_response_mismatch',
    'ok', 'cancelled', 'unknown', 'invalid_argument', 'deadline_exceeded', 'not_found', 'already_exists',
    'permission_denied', 'resource_exhausted', 'failed_precondition', 'aborted', 'out_of_range',
    'unimplemented', 'internal', 'unavailable', 'data_loss', 'unauthenticated', 'firestore_index_api_failed'].includes(error?.code)
    ? error.code : 'firestore_index_api_failed'
}
