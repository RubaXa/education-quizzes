/** @see ../../docs/decisions/mesh-mark-work-2026-11-16.md */
/** @see ../../docs/modules/school-diary/README.md#diary-adapter */
export async function collectMarkDetails({ adapter, date, markId = null, save }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('invalid_date')
  if (!/^\d{1,20}$/.test(markId ?? '')) throw new Error('invalid_mark_id')
  await adapter.verifyAccess()
  const marks = await adapter.getMarkDetails(date, markId)
  if (!marks || typeof marks !== 'object') throw new Error('mesh_mark_details_invalid')
  const detail = marks.payload ?? marks
  if (String(detail.id) !== markId || detail.date !== date) throw new Error('mesh_mark_identity_mismatch')
  const filename = `mark-details-${date}${markId ? `-${markId}` : ''}.json`
  const result = { source: 'mesh-detailed-marks', date, markId, fetchedAt: new Date().toISOString(), marks }
  await save(filename, result)
  return { date, markId, count: Array.isArray(marks) ? marks.length : null, saved: filename }
}

export async function collectMarkFeed({ adapter, save }) {
  await adapter.verifyAccess()
  const marks = await adapter.getMarkFeed()
  if (!marks || typeof marks !== 'object') throw new Error('mesh_mark_feed_invalid')
  await save('mark-feed-latest.json', { source: 'mesh-recent-mark-feed', fetchedAt: new Date().toISOString(), marks })
  return { saved: 'mark-feed-latest.json', scope: 'recent-feed-not-date-filtered' }
}
