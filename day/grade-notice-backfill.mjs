import { createHash } from 'node:crypto'
import { gradeDetailRows } from './grade-reconciliation.mjs'
import { isRegisteredMeshChild } from '../packages/education-runtime/identity.mjs'
import { stageFamilyNotice } from '../storage/inbox-notifications.mjs'

/** Reuse the normal producer with create preconditions, preserving racing readAt.
 * @see ../docs/modules/notifications/inbox.md#notification-producers */
export async function createGradeNotices(db, owner, notices, stageNotice = stageFamilyNotice) {
  if (!notices.length) return 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const batch = db.batch()
    let writes = 0
    const createOnly = { set: (ref, value) => { writes++; return batch.create(ref, value) } }
    for (const notice of notices) await stageNotice(db, createOnly, { ...owner, ...notice, mode: 'create' })
    try { await batch.commit(); return writes }
    catch (error) {
      if (![6, 'already-exists', 'ALREADY_EXISTS'].includes(error.code) || attempt === 2) throw error
    }
  }
}

/** The legacy profile has no per-journal owner field: reject ambiguous children.
 * @see ../docs/modules/notifications/inbox.md#notification-producers */
export function assertGradeNoticeOwner(before, after, context) {
  if (!isRegisteredMeshChild(context)) throw Error('Владелец МЭШ не подтверждён реестром.')
  for (const snapshot of [before, after]) {
    const children = snapshot?.profile?.children
    if (!Array.isArray(children) || children.length !== 1
      || children[0].contingent_guid !== context.child.meshPersonId) throw Error('Неоднозначный или чужой владелец журнала МЭШ.')
  }
}

/** Recover notices when projections were reconciled before day publication.
 * @see ../docs/modules/notifications/inbox.md#notification-producers */
export function gradeNoticeBackfill(before, after, ledger, childId) {
  const complete = (snapshot) => snapshot?.complete === true && Array.isArray(snapshot.marks)
    && snapshot.marks.every((subject) => subject.count === subject.marks?.length
      && subject.marks.every((mark) => mark.id != null))
  if (!complete(before) || !complete(after) || !Number.isFinite(Date.parse(before.fetchedAt))
    || !Number.isFinite(Date.parse(after.fetchedAt)) || !Number.isFinite(Date.parse(ledger?.observed_at))
    || Date.parse(before.fetchedAt) >= Date.parse(after.fetchedAt)) throw Error('Нужны два последовательных полных журнала оценок.')
  const old = new Map(before.marks.map((subject) => [String(subject.subject_id), subject]))
  if (old.size !== after.marks.length || after.marks.some((subject) => !old.has(String(subject.subject_id)))) throw Error('Изменился набор предметов.')
  const rendered = gradeDetailRows(ledger, after)
  const result = []
  for (const subject of after.marks) {
    const prior = old.get(String(subject.subject_id))
    if (prior.start !== subject.start || prior.end !== subject.end || prior.period !== subject.period) throw Error('Разные аттестационные периоды.')
    const previousMarks = new Map(prior.marks.map((mark) => [String(mark.id), mark]))
    const currentMarks = new Map(subject.marks.map((mark) => [String(mark.id), mark]))
    if (previousMarks.size !== prior.count || currentMarks.size !== subject.count) throw Error('Повторён ID оценки.')
    for (const [id, mark] of previousMarks) {
      const current = currentMarks.get(id)
      if (!current || String(current.value) !== String(mark.value) || Number(current.weight) !== Number(mark.weight)) throw Error('Прежняя оценка изменена или снята: требуется отдельная сверка.')
    }
    const added = subject.marks.filter((mark) => !previousMarks.has(String(mark.id)))
    if (!added.length) continue
    const row = rendered.find((item) => item.grades.some((mark) => mark.sourceId === String(added[0].id)))
    if (!row) throw Error('Нет согласованной проекции предмета.')
    const fingerprint = createHash('sha256').update(JSON.stringify([row.id, row.displayed_average,
      row.grades.map((mark) => `${mark.mark}:${mark.weight}`).sort()])).digest('hex')
    result.push({ key: `grade:${childId}:${row.id}:${fingerprint}`, data: {
      type: 'grade_added', entityId: row.id, subject: row.name, title: 'Появилась новая оценка',
      body: added.length === 1 ? `Новая отметка: ${added[0].value}. Посмотрите, как изменился средний балл.` : 'Откройте обновлённую сводку оценок.',
      sourceRevision: Date.parse(ledger.observed_at),
    } })
  }
  return result
}
