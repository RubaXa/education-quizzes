/** Family-origin assignments are a separate source from MESH. They are
 * projected into the day page only when explicitly published, and survive
 * later MESH plan merges by stable ID.
 * @see ../docs/modules/families/README.md
 * @see ../docs/modules/school-diary/day-page.md
 * @see ../docs/modules/synchronization/plan-generation.md
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md */

import { validLearningRoute } from './card-policy.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[a-z0-9][a-z0-9-]{2,119}$/

export function familyAssignmentErrors(task, { familyId, childId, taskId } = {}) {
  const errors = []
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ['Нужно семейное назначение.']
  if (task.id !== taskId || !ID.test(task.id ?? '')) errors.push('Нужен устойчивый taskId из безопасных символов.')
  if (task.sourceSystem !== 'family' || task.sourceId !== task.id || !Number.isSafeInteger(task.sourceRevision) || task.sourceRevision < 1) errors.push('Источник должен быть семейным и иметь стабильную ревизию.')
  if (task.dayProjectionVersion !== 1) errors.push('Для страницы дня требуется явная версия проекции семейного назначения.')
  if (task.familyId !== familyId || task.childId !== childId) errors.push('Семейное назначение не совпадает с подтверждённым владельцем.')
  if (task.subjectId !== 'russian') errors.push('Подготовка к сочинению должна относиться к предмету «Русский язык».')
  const parsedDate = DATE.test(task.dueDate ?? '') ? new Date(`${task.dueDate}T12:00:00Z`) : null
  if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== task.dueDate) errors.push('Нужна точная дата сдачи YYYY-MM-DD.')
  if (task.publication !== 'active' || task.evidence !== 'photo') errors.push('Карточка должна быть активной и принимать фото работы.')
  if (typeof task.title !== 'string' || !task.title.trim() || typeof task.originalText !== 'string' || !task.originalText.trim()) errors.push('Нужны название и текст семейного задания.')
  if (!Array.isArray(task.steps) || !task.steps.length || task.steps.some((step) => typeof step !== 'string' || !step.trim())) errors.push('Нужны короткие ученические опоры отдельными шагами.')
  if (!task.submission || typeof task.submission.buttonLabel !== 'string' || !task.submission.buttonLabel.trim()
    || typeof task.submission.lead !== 'string' || !task.submission.lead.trim() || typeof task.submission.photo !== 'string' || !task.submission.photo.trim()) errors.push('Нужна явная отправка письменной работы с загрузкой фото.')
  if (!Array.isArray(task.materialIds) || task.materialIds.length) errors.push('В этой публикации нельзя добавлять неподтверждённые материалы.')
  return errors
}

export function projectFamilyAssignment(task) {
  const learnerText = typeof task.studentText === 'string' && task.studentText.trim() ? task.studentText.trim() : task.originalText
  const result = {
    id: task.id,
    title: task.title,
    detail: learnerText,
    kind: 'written',
    status: 'unknown',
    source: 'Education · назначено родителем',
    familyOrigin: { sourceSystem: 'family', sourceId: task.sourceId, sourceRevision: task.sourceRevision },
    steps: task.steps,
    submission: task.submission,
    cardPattern: task.cardPattern,
    cardPolicyVersion: task.cardPolicyVersion,
    outputKind: task.outputKind,
    lessonDate: task.dueDate,
    dueDate: task.dueDate,
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined))
}

export function familyAssignmentProjectionSignature(task) {
  const projection = task?.familyOrigin ? task : projectFamilyAssignment(task)
  const fields = Object.fromEntries(['id', 'title', 'detail', 'kind', 'source', 'steps', 'submission', 'cardPattern', 'cardPolicyVersion', 'outputKind', 'lessonDate', 'dueDate']
    .filter((key) => projection[key] !== undefined).map((key) => [key, projection[key]]))
  if (projection.familyOrigin) fields.familyOrigin = Object.fromEntries(['sourceSystem', 'sourceId', 'sourceRevision']
    .filter((key) => projection.familyOrigin[key] !== undefined).map((key) => [key, projection.familyOrigin[key]]))
  return fields
}

export function stableFamilyProjectionJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableFamilyProjectionJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableFamilyProjectionJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function familyAssignmentRecordSignature(task) {
  const fields = ['id', 'familyId', 'childId', 'sourceSystem', 'sourceId', 'sourceRevision', 'subjectId', 'subjectName', 'dueDate',
    'title', 'originalText', 'studentText', 'publication', 'evidence', 'materialIds', 'steps', 'submission', 'cardPattern', 'cardPolicyVersion', 'outputKind', 'sourceEvidence', 'dayProjectionVersion']
  return Object.fromEntries(fields.filter((key) => task?.[key] !== undefined).map((key) => [key, task[key]]))
}

/** Build the expected date index against the post-transaction family task set. */
export function familyAssignmentsWithOverlay(assignments, task) {
  return [...(assignments ?? []).filter((item) => item?.id !== task.id), task]
}

export function familyGuideErrors(guide, task) {
  if (!guide) return []
  if (!guide.overview?.trim() || !validLearningRoute('russian', task, guide)) return ['Родительский маршрут семейного сочинения имеет неверную структуру.']
  for (const stage of guide.stages) {
    if (!stage.title?.trim() || stage.answer || stage.verification?.length
      || stage.source?.kind !== 'family' || stage.source.ref !== task.id || !stage.source.label?.trim()
      || !stage.source.excerpt?.trim() || ![task.originalText, task.sourceEvidence?.excerpt].some((text) => text?.includes(stage.source.excerpt))) {
      return [`Этап родительского маршрута ${stage.id ?? '(без ID)'} должен опираться на семейное задание и не содержать готовый ответ.`]
    }
  }
  return []
}

export function mergeFamilyAssignments(page, assignments = []) {
  if (!assignments.length) return page
  const next = structuredClone(page)
  const subjects = next.subjects ?? []
  let subject = subjects.find((item) => item.id === 'russian')
  if (!subject) {
    subject = { id: 'russian', name: 'Русский язык', icon: '✍', materials: '', mesh: '', summary: '', tasks: [] }
    subjects.push(subject)
  }
  const byId = new Map((subject.tasks ?? []).map((item) => [item.id, item]))
  const added = [], changed = []
  for (const assignment of assignments) {
    const baseProjection = projectFamilyAssignment(assignment)
    const projected = { ...baseProjection, familyOrigin: { ...baseProjection.familyOrigin, projectedSourceRevision: assignment.sourceRevision } }
    const existing = byId.get(projected.id)
    if (existing && existing.familyOrigin?.sourceId !== projected.familyOrigin.sourceId) throw new Error(`ID семейного задания ${projected.id} уже занят другим источником.`)
    if (!existing) added.push(projected.id)
    else if (stableFamilyProjectionJson(familyAssignmentProjectionSignature(existing)) !== stableFamilyProjectionJson(familyAssignmentProjectionSignature(projected))
      || existing.familyOrigin?.projectedSourceRevision !== assignment.sourceRevision) changed.push(projected.id)
    const next = { ...existing, ...projected }
    if (existing?.familyOrigin?.sourceId === projected.familyOrigin.sourceId
      && existing.familyOrigin.sourceRevision === projected.familyOrigin.sourceRevision
      && existing.title === projected.title && existing.detail === projected.detail
      && JSON.stringify(existing.steps) === JSON.stringify(projected.steps)
      && JSON.stringify(existing.submission) === JSON.stringify(projected.submission)) {
      next.status = existing.status ?? projected.status
      for (const key of ['platformResult', 'materialRequest', 'referenceDate']) if (existing[key] !== undefined) next[key] = existing[key]
    }
    byId.set(projected.id, next)
  }
  subject.tasks = [...byId.values()]
  next.subjects = subjects
  next.taskIds = subjects.flatMap((item) => item.tasks ?? []).flatMap((item) => [item.id, ...(item.problems ?? []).map((problem) => problem.id)])
  if (added.length || changed.length) {
    next.planRevision = (Number.isInteger(page.planRevision) ? page.planRevision : 1) + 1
    next.changes = [{ at: new Date().toISOString(), added, removed: [], changed, changedSubjects: ['russian'], newLinks: false, changedSchedule: false, changedWeekendSlot: false }, ...(page.changes ?? [])].slice(0, 20)
  }
  return next
}
