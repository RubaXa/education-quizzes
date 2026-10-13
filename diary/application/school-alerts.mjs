import { createHash } from 'node:crypto'
import { stageFamilyNotice } from '../../storage/inbox-notifications.mjs'

/** Only explicit behavioural comments become parent alerts. Ordinary mark topics stay out of the inbox.
 * @see ../../docs/architecture/activity-and-inbox.md#school-alerts
 */
export function schoolAlerts(snapshot) {
  if (!snapshot?.complete || !Array.isArray(snapshot.marks)) return []
  const alerts = []
  const seen = new Set()
  for (const subject of snapshot.marks) {
    for (const mark of subject?.marks ?? []) {
      const comment = typeof mark.comment === 'string' ? mark.comment.trim() : ''
      if (!comment || !/^\d{4}-\d{2}-\d{2}$/.test(mark.date ?? '')) continue
      const late = /(?:^|\s)опоздал(?:а)?(?=\s|[.,!]|$)/i.test(comment)
      const duration = late ? comment.match(/опоздал(?:а)?\s+на\s+(?:(\d{1,2})\s*час(?:а|ов)?\s*)?(?:(\d{1,3})\s*мин(?:ут[аыу]?)?)?/i) : null
      const remark = /(?:^|\s)(?:замечани[ея]|нарушил(?:а)?\s+дисциплину|мешал(?:а)?\s+на\s+уроке|плохое\s+поведение|не\s+готов(?:а)?\s+к\s+уроку)(?=\s|[.,!]|$)/i.test(comment)
      if (!late && !remark) continue
      const subjectName = subject.subject_name || 'Предмет не указан'
      const sourceId = String(mark.id ?? `${mark.date}:${subjectName}:${comment}`)
      const key = `${sourceId}:${comment}`
      if (seen.has(key)) continue
      seen.add(key)
      const durationMinutes = duration && (duration[1] || duration[2]) ? (Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)) : undefined
      alerts.push({ key, type: late ? 'school_late' : 'school_remark', sourceId, date: mark.date,
        subject: subjectName, comment, ...(durationMinutes ? { durationMinutes } : {}) })
    }
  }
  return alerts
}

/** Shared by day publication and a targeted backfill; never route an ambiguous MESH profile to a family. */
export async function stageSchoolAlerts(db, batch, snapshot, owner) {
  const alerts = schoolAlerts(snapshot)
  if (!alerts.length) return 0
  if (snapshot.profile?.children?.length !== 1 || !owner?.familyId || !owner?.childId) {
    throw new Error('Нельзя адресовать школьное замечание без однозначной связи МЭШ с ребёнком семьи.')
  }
  let recipients = 0
  for (const alert of alerts) {
    const revision = parseInt(createHash('sha256').update(JSON.stringify([alert.date, alert.subject, alert.comment])).digest('hex').slice(0, 12), 16)
    recipients += await stageFamilyNotice(db, batch, { ...owner, roles: ['parent'],
      key: `school:${owner.childId}:${alert.sourceId}`, mode: 'replace',
      data: { type: alert.type, entityId: alert.sourceId, date: alert.date, subject: alert.subject,
        title: alert.type === 'school_late' ? alert.durationMinutes ? `Опоздание на ${alert.durationMinutes} мин` : 'Отмечено опоздание' : 'Замечание в МЭШ',
        body: `Комментарий в МЭШ: «${alert.comment}».`, sourceRevision: revision } })
  }
  return recipients
}
