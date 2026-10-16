/** Stable, typed operator operations. No caller may provide executable code.
 * @see ../docs/architecture/operator-core.md#operation-contract */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const date = /^20\d{2}-\d{2}-\d{2}$/
const id = /^[A-Za-z0-9_-]{1,120}$/
const report = /^reports\/20\d{2}-\d{2}-\d{2}-education-sync\/baseline\.md$/
const file = (value) => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
const none = () => []
const args = (...names) => (input) => names.map((name) => input[name])
const fields = (shape) => (input) => {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object']
  for (const [name, valid] of Object.entries(shape)) if (!valid(input[name])) errors.push(`invalid input.${name}`)
  for (const name of Object.keys(input)) if (!(name in shape)) errors.push(`unknown input.${name}`)
  return errors
}

export const operations = Object.freeze({
  'project.plan': { effect: 'read', script: 'scripts/sync-project.mjs', command: 'plan', validate: fields({}), argv: none },
  'project.collect': { effect: 'write', script: 'scripts/sync-project.mjs', command: 'collect', validate: fields({}), argv: none },
  'inbox.snapshot': { effect: 'read', script: 'scripts/sync-inbox.mjs', validate: fields({}), argv: none },
  'queue.list': { effect: 'read', script: 'scripts/sync-queue.mjs', command: 'list', validate: fields({}), argv: none },
  'queue.scan': { effect: 'write', script: 'scripts/sync-queue.mjs', command: 'scan', validate: fields({}), argv: none },
  'grades.snapshot': { effect: 'reconcile', script: 'scripts/grade-snapshot.mjs',
    validate: fields({ sourceDate: (v) => date.test(v), reportPath: (v) => report.test(v) }),
    argv: (input, apply) => [...args('sourceDate', 'reportPath')(input), ...(apply ? ['--apply'] : [])] },
  'grades.publish': { effect: 'reconcile', script: 'scripts/day.mjs', command: 'reconcile-grades',
    validate: fields({}), argv: (_input, apply) => apply ? ['--apply'] : [] },
  'calendar.publish': { effect: 'write', script: 'scripts/day.mjs', command: 'dashboard', validate: fields({}), argv: none },
  'day.audit': { effect: 'read', script: 'scripts/day.mjs', command: 'audit', validate: fields({}), argv: none },
  'quiz.validate': { effect: 'read', script: 'scripts/quiz.mjs', command: 'validate',
    validate: fields({ specPath: file }), argv: args('specPath') },
  'quiz.publish': { effect: 'create', script: 'scripts/quiz.mjs', command: 'create', preflight: 'validate',
    validate: fields({ specPath: file, personId: (v) => typeof v === 'string' && id.test(v) }), argv: args('specPath', 'personId'), payloadField: 'specPath' },
  'quiz.revise-open': { effect: 'create', script: 'scripts/quiz.mjs', command: 'revise-open', preflight: 'validate',
    validate: fields({ learnerToken: (v) => typeof v === 'string' && id.test(v), specPath: file,
      personId: (v) => typeof v === 'string' && id.test(v) }),
    argv: args('learnerToken', 'specPath', 'personId'), payloadField: 'specPath' },
  'review.validate': { effect: 'read', script: 'scripts/submissions.mjs', command: 'validate',
    validate: fields({ reviewPath: file }), argv: args('reviewPath') },
  'review.publish': { effect: 'create', script: 'scripts/submissions.mjs', command: 'review', preflight: 'validate',
    validate: fields({ reviewPath: file }), argv: args('reviewPath'), payloadField: 'reviewPath' },
})

export function validateOperationRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.schemaVersion !== 1) {
    throw new Error('OperationRequest requires schemaVersion 1.')
  }
  if (Object.keys(request).some((name) => !['schemaVersion', 'operation', 'input'].includes(name))) {
    throw new Error('OperationRequest contains unknown fields.')
  }
  const operation = operations[request.operation]
  if (!operation) throw new Error(`Unknown operation: ${request.operation}`)
  const errors = operation.validate(request.input)
  if (errors.length) throw new Error(errors.join('; '))
  return operation
}

export function operationCommand(request, apply) {
  const operation = validateOperationRequest(request)
  if (!apply && ['write', 'create'].includes(operation.effect)) throw new Error(`${request.operation} requires --apply.`)
  return { script: operation.script, argv: [...(operation.command ? [operation.command] : []), ...operation.argv(request.input, apply)] }
}

export function operationFingerprint(request, root) {
  const operation = validateOperationRequest(request)
  const payloadPath = operation.payloadField ? resolve(root, request.input[operation.payloadField]) : null
  const payload = payloadPath ? readFileSync(payloadPath) : Buffer.alloc(0)
  const plan = ['quiz.publish', 'quiz.revise-open'].includes(request.operation)
    ? JSON.parse(payload.toString('utf8')).assessmentPlanPath : null
  const planBytes = plan ? readFileSync(resolve(dirname(payloadPath), plan)) : Buffer.alloc(0)
  return createHash('sha256').update(JSON.stringify([request.schemaVersion, request.operation, request.input,
    payload.toString('base64'), planBytes.toString('base64')])).digest('hex')
}

export function operationCatalog() {
  return Object.entries(operations).map(([id, value]) => ({ id, effect: value.effect,
    input: Object.keys(sampleFields[id] ?? {}) }))
}

const sampleFields = {
  'grades.snapshot': { sourceDate: 1, reportPath: 1 },
  'quiz.validate': { specPath: 1 }, 'quiz.publish': { specPath: 1, personId: 1 },
  'quiz.revise-open': { learnerToken: 1, specPath: 1, personId: 1 },
  'review.validate': { reviewPath: 1 }, 'review.publish': { reviewPath: 1 },
}
