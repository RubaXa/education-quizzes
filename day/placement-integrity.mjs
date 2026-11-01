/** @see ../docs/decisions/source-completion-consistency-2026-11-01.md */
/** @see ../docs/decisions/informatics-assessment-2026-11-01.md */
import { assignmentShapeErrors, dayPageShapeErrors } from './data-contract.mjs'

/** Deterministic graph checks for a staged/published day. An assignment document
 * is checked separately by the publisher before the Firestore batch commits.
 * @see ../docs/modules/families/access-and-state.md#integrity-gates */
export function placementIntegrityErrors(page) {
  const errors = dayPageShapeErrors(page)
  if (!page || !Array.isArray(page.subjects)) return errors
  const tasks = new Map()
  for (const subject of page?.subjects ?? []) for (const task of subject.tasks ?? []) {
    if (tasks.has(task.id)) errors.push(`Повторяется taskId ${task.id}.`)
    tasks.set(task.id, { task, subjectId: subject.id })
  }
  const byTask = new Set(), byToken = new Set()
  for (const placement of page?.testPlacements ?? []) {
    const token = placement?.token
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token ?? '')) errors.push(`Некорректный токен теста у ${placement?.taskId ?? 'отдельного теста'}.`)
    if (byToken.has(token)) errors.push('Один токен теста указан дважды.')
    byToken.add(token)
    if (placement.relatedTaskId && placement.optional !== undefined) {
      const related = tasks.get(placement.relatedTaskId)
      if (placement.taskId || placement.optional !== true || !related || related.subjectId !== placement.subjectId
        || related.task.outputKind !== 'platform-result' || related.task.testToken) errors.push('Дополнительный тест платформы должен быть отдельным optional-пунктом того же предмета.')
    }
    if (!placement.taskId) continue
    const owner = tasks.get(placement.taskId)
    if (!owner) errors.push(`Тест ссылается на отсутствующее задание ${placement.taskId}.`)
    else if (owner.subjectId !== placement.subjectId || owner.task.testToken !== token) {
      errors.push(`Тест ${placement.taskId} не совпадает с токеном и предметом задания.`)
    }
    if (byTask.has(placement.taskId)) errors.push(`Два теста привязаны к одному заданию ${placement.taskId}.`)
    byTask.add(placement.taskId)
  }
  for (const [taskId, { task }] of tasks) {
    if (task.testToken && !byTask.has(taskId)) errors.push(`Задание ${taskId} имеет testToken без testPlacement.`)
  }
  // Old day pages keep an archive of prior material links for cross-day evidence.
  // Only a current task claiming linked pages must have its own readable link.
  for (const [taskId, { task }] of tasks) if (task.materialStatus?.state === 'textbook-page-linked'
    && !(page?.materialLinks?.[taskId] ?? []).some((link) => link.sourceType === 'textbook-page')) {
    errors.push(`Для задания ${taskId} нет заявленной страницы учебника.`)
  }
  for (const taskId of Object.keys(page?.taskPageRefs ?? {})) if (!tasks.has(taskId)) {
    errors.push(`Страницы учебника ссылаются на отсутствующее задание ${taskId}.`)
  }
  return errors
}

export function assertPlacementIntegrity(page) {
  const errors = placementIntegrityErrors(page)
  if (errors.length) throw new Error(`Нарушена целостность страницы дня: ${errors.join(' ')}`)
}

/** Validate the actual Firestore edges before a new day revision is committed.
 * Legacy assignments without owner fields remain readable; conflicting owners do not. */
export async function assertAssignmentLinksExist(db, page) {
  assertPlacementIntegrity(page)
  for (const placement of page.testPlacements ?? []) {
    const [assignment, boardEntry] = await Promise.all([
      db.doc(`assignments/${placement.token}`).get(),
      db.doc(`dashboard/${page.boardToken}/assignments/${placement.token}`).get(),
    ])
    if (!assignment.exists || !boardEntry.exists) {
      throw new Error(`Тест ${placement.taskId ?? placement.subjectId} отсутствует в задании или списке роли; день не выпускается.`)
    }
    const owner = assignment.data()
    const assignmentErrors = assignmentShapeErrors(owner)
    if (assignmentErrors.length) throw new Error(`Тест ${placement.taskId ?? placement.subjectId} нарушает схему: ${assignmentErrors.join(' ')}`)
    if (boardEntry.data()?.testId !== owner.testId) throw new Error(`Список роли указывает не на тот тест ${placement.taskId ?? placement.subjectId}.`)
    if (page.familyId && page.childId && (owner.familyId && owner.familyId !== page.familyId
      || owner.childId && owner.childId !== page.childId)) {
      throw new Error(`Тест ${placement.taskId ?? placement.subjectId} связан с другой семьёй или ребёнком.`)
    }
  }
}
