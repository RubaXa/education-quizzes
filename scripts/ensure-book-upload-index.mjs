import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault } from 'firebase-admin/app'

/** Add only the collection-group status index used by direct-upload-worker.
 * Preserve the collection-scope indexes already configured on this field.
 * @see ../docs/architecture/local-first-sync.md#operator-upload-index
 */
const credentials = resolve('.local/adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = credentials
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('Нужен локальный Firestore ADC.')
const apply = process.argv.includes('--apply')
const projectId = 'education-9d7c6'
const name = `projects/${projectId}/databases/(default)/collectionGroups/bookUploads/fields/status`
const url = `https://firestore.googleapis.com/v1/${name}`
const { access_token: token } = await applicationDefault().getAccessToken()

async function api(method, target, body) {
  const response = await fetch(target, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`Firestore index API ${response.status}: ${result.error?.message ?? 'неизвестная ошибка'}`)
  return result
}

const field = await api('GET', url)
const indexes = field.indexConfig?.indexes ?? []
const modes = indexes.map((index) => `${index.queryScope}:${index.fields?.[0]?.order ?? index.fields?.[0]?.arrayConfig}`)
const expected = ['COLLECTION:ASCENDING', 'COLLECTION:DESCENDING', 'COLLECTION:CONTAINS']
if (expected.some((mode) => !modes.includes(mode))) {
  throw new Error(`Нестандартная конфигурация status; не изменяю индекс: ${modes.join(', ')}`)
}
const groupIndex = indexes.find((index) => index.queryScope === 'COLLECTION_GROUP'
  && index.fields?.length === 1 && index.fields[0].fieldPath === 'status' && index.fields[0].order === 'ASCENDING')
if (groupIndex) {
  console.log(JSON.stringify({ index: 'bookUploads/status', state: groupIndex.state, ready: groupIndex.state === 'READY' }))
} else if (!apply) {
  console.log(JSON.stringify({ index: 'bookUploads/status', ready: false, action: 'run --apply to add it' }))
} else {
  // PATCH is additive: do not remove the existing collection-scope modes.
  const normalized = indexes.map((index) => ({ queryScope: index.queryScope,
    fields: index.fields.map((part) => ({ fieldPath: part.fieldPath,
      ...(part.order ? { order: part.order } : {}),
      ...(part.arrayConfig ? { arrayConfig: part.arrayConfig } : {}) })) }))
  const operation = await api('PATCH', `${url}?updateMask=indexConfig`, { name,
    indexConfig: { indexes: [...normalized, { queryScope: 'COLLECTION_GROUP',
      fields: [{ fieldPath: 'status', order: 'ASCENDING' }] }] } })
  console.log(JSON.stringify({ index: 'bookUploads/status', submitted: true, operation: operation.name,
    next: 'rerun without --apply until state is READY; then restart the upload worker' }))
}
