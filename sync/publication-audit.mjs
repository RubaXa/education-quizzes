/** Compare the current source projection with the last Firestore publication.
 * A fresh download alone must never clear an unpublished change.
 * @see ../docs/product/global-sync.md#reconciliation
 */
export function pendingPublicationDates(expected, published, dates) {
  const current = new Map((expected?.days ?? []).map((day) => [day.date, day]))
  const visible = new Map((published?.days ?? []).map((day) => [day.date, day]))
  const pending = []
  for (const date of dates) {
    const next = current.get(date)
    const prior = visible.get(date)
    const hadContent = Boolean(prior?.schedule?.length || prior?.homework?.length || prior?.homeworkDayToken)
    const hasContent = Boolean(next?.schedule?.length || next?.homework?.length || next?.homeworkDayToken)
    if (!hasContent && !hadContent) continue
    const reasons = []
    if (!next || !prior) reasons.push('day-not-published')
    else {
      if (!prior.sourceRevision || prior.sourceRevision !== next.sourceRevision) reasons.push('source-revision-differs')
      for (const field of ['schedule', 'homework', 'dayToken', 'homeworkDayToken']) {
        if (JSON.stringify(prior[field] ?? null) !== JSON.stringify(next[field] ?? null)) reasons.push(`${field}-differs`)
      }
    }
    if (next?.homework?.length && !next.homeworkDayToken) reasons.push('homework-page-missing')
    if (reasons.length) pending.push({ date, reasons })
  }
  return pending
}
