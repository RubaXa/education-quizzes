import { createHash } from 'node:crypto'
import { notificationId, stageFamilyNotice } from '../../storage/inbox-notifications.mjs'

/** Only explicit behavioural comments become parent alerts. Ordinary mark topics stay out of the inbox.
 * @see ../../docs/modules/notifications/inbox.md#school-alerts
 */
export function schoolAlerts(snapshot) {
  if (!snapshot?.complete || !Array.isArray(snapshot.marks)) return []
  const alerts = []
  const seen = new Set()
  for (const subject of snapshot.marks) {
    for (const mark of [...(subject?.marks ?? []), ...(subject?.recentMarks ?? [])]) {
      const comment = typeof mark.comment === 'string' ? mark.comment.trim() : ''
      if (!comment || !/^\d{4}-\d{2}-\d{2}$/.test(mark.date ?? '')) continue
      const late = /(?:^|\s)опоздал(?:а)?(?=\s|[.,!]|$)/i.test(comment)
      const duration = late ? comment.match(/опоздал(?:а)?\s+на\s+(?:(\d{1,2})\s*час(?:а|ов)?\s*)?(?:(\d{1,3})\s*мин(?:ут[аыу]?)?)?/i) : null
      const remark = /(?:^|\s)(?:замечани[ея]|нарушил(?:а)?\s+дисциплину|мешал(?:а)?\s+на\s+уроке|плохое\s+поведение|не\s+готов(?:а)?\s+к\s+уроку)(?=\s|[.,!]|$)/i.test(comment)
      const homeworkDebt = (mark.is_point === true || (subject.recentMarks ?? []).some(item => String(item.id) === String(mark.id))) && Number(mark.value) === 2 && /нет\s+(?:домашней\s+работы|д\/?з)|домашн[а-я\s]+не\s+(?:сдан|выполн)|не\s+(?:сдан|выполн)[а-я\s]+домашн/iu.test(comment)
      if (!late && !remark && !homeworkDebt) continue
      const subjectName = subject.subject_name || 'Предмет не указан'
      const sourceId = String(mark.id ?? `${mark.date}:${subjectName}:${comment}`)
      const key = `${sourceId}:${comment}`
      if (seen.has(key)) continue
      seen.add(key)
      const durationMinutes = duration && (duration[1] || duration[2]) ? (Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)) : undefined
      alerts.push({ key, type: late ? 'school_late' : 'school_remark', ...(homeworkDebt ? { kind: 'homework-debt', value: String(mark.value), point: mark.is_point === true } : {}), sourceId, date: mark.date,
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
    const revision = parseInt(createHash('sha256').update(JSON.stringify([alert.date, alert.subject, alert.comment, alert.kind ?? null, 2])).digest('hex').slice(0, 12), 16)
    recipients += await stageFamilyNotice(db, batch, { ...owner, roles: alert.kind === 'homework-debt' ? ['parent', 'student'] : ['parent'],
      key: `school:${owner.childId}:${alert.sourceId}`, mode: 'replace',
      data: { type: alert.type, entityId: alert.sourceId, date: alert.date, subject: alert.subject,
        title: alert.kind === 'homework-debt' ? 'Учитель не получил домашнюю работу' : alert.type === 'school_late' ? alert.durationMinutes ? `Опоздание на ${alert.durationMinutes} мин` : 'Отмечено опоздание' : 'Замечание в МЭШ',
        body: alert.kind === 'homework-debt' ? `${alert.subject}, ${alert.date}: учитель отметил «${alert.comment}». Проверь, где находятся решения: в тетради или на листах. Готовую работу покажи учителю и уточни, какую часть он не принял. Если часть не сделана — доделай только её. Уже сохранённые фото повторно отправлять не нужно.` : `Комментарий в МЭШ: «${alert.comment}».`, sourceRevision: revision } })
  }
  return recipients
}

/** Explicit publisher readback only; no client polling. @see ../../docs/modules/notifications/inbox.md#school-alerts */
export async function verifySchoolAlerts(db, snapshot, owner) {
  const alerts = schoolAlerts(snapshot)
  if (!alerts.length) return { verified: true, documents: 0 }
  const members = (await db.collection(`families/${owner.familyId}/members`).get()).docs
  const expected = alerts.flatMap(alert => members.filter(member => {
    const value = member.data()
    return value.active === true && value.childIds?.includes(owner.childId)
      && (alert.kind === 'homework-debt' ? ['parent', 'student'] : ['parent']).includes(value.role)
  }).map(member => ({ ref: db.doc(`users/${member.id}/inbox/${notificationId(`school:${owner.childId}:${alert.sourceId}`)}`), alert })))
  if (!expected.length) throw new Error('school_alert_recipients_missing')
  const records = await db.getAll(...expected.map(item => item.ref))
  records.forEach((record, index) => {
    const value = record.data(), { alert } = expected[index]
    if (!record.exists || value.familyId !== owner.familyId || value.childId !== owner.childId
      || value.entityId !== alert.sourceId || value.type !== alert.type || !value.body?.includes(alert.comment)
      || alert.kind === 'homework-debt' && !value.body.includes('Уже сохранённые фото повторно отправлять не нужно.')) throw new Error('school_alert_readback_failed')
  })
  return { verified: true, documents: expected.length }
}
