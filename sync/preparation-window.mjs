/** @see ../docs/decisions/moving-preparation-window-2026-11-05.md */
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const preparationKinds = new Set(['prepare-quiz', 'classify-assignment', 'enrich-task', 'material-needed'])

/** Expire only legacy preparation; attempts, help and frozen event actions retain their own lifecycle. */
export function preparationExpiry(record, windowDates) {
  if (record.artifactPath || !preparationKinds.has(record.kind) || !windowDates?.length) return null
  const date = record.source?.date ?? record.source?.dayDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || date >= windowDates[0]) return null
  return `outside-active-preparation-window:${date}:active-from:${windowDates[0]}`
}
