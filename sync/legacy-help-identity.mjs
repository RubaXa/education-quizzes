import { createHash } from 'node:crypto'

/** @see ../docs/modules/synchronization/event-queue.md#обратная-совместимость */
export function legacyHelpOperationId({ dayToken, taskId, revision, requestedAtMs }) {
  if (typeof dayToken !== 'string' || !dayToken || typeof taskId !== 'string' || !taskId
    || !Number.isInteger(revision) || !Number.isFinite(requestedAtMs)) throw new TypeError('invalid_legacy_help_identity')
  const digest = createHash('sha256').update(JSON.stringify([dayToken, taskId, revision, requestedAtMs])).digest('hex')
  return `legacy-help:${digest}`
}
