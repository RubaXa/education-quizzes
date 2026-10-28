/** Family-origin assignments are a separate source from MESH. They are
 * projected into the day page only when explicitly published, and survive
 * later MESH plan merges by stable ID.
 * @see ../docs/modules/families/README.md
 * @see ../docs/modules/school-diary/day-page.md
 * @see ../docs/modules/synchronization/plan-generation.md
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md */

import { validLearningRoute } from './card-policy.mjs'
import { learningContext } from '../assessment/learning-context.mjs'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[a-z0-9][a-z0-9-]{2,119}$/

export function familyAssignmentErrors(task, { familyId, childId, taskId } = {}) {
  const errors = []
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ['Нужно семейное назначение.']
  if (task.id !== taskId || !ID.test(task.id ?? '')) errors.push('Нужен устойчивый taskId из безопасных символов.')
  if (task.sourceSystem !== 'family' || task.sourceId !== task.id || !Number.isSafeInteger(task.sourceRevision) || task.sourceRevision < 1) errors.push('Источник должен быть семейным и иметь стабильную ревизию.')
  if (task.dayProjectionVersion !== 1) errors.push('Для страницы дня требуется явная версия проекции семейного назначения.')
  if (task.familyId !== familyId || task.childId !== childId) errors.push('Семейное назначение не совпадает с подтверждённым владельцем.')
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(task.subjectId ?? '') || task.subjectId !== 'russian' && (typeof task.subjectName !== 'string' || !task.subjectName.trim())) errors.push('Нужен подтверждённый предмет семейного задания.')
  try { learningContext(task.learningContext) } catch { errors.push('Некорректный контекст учебного материала.') }
  if (task.learningContext?.kind === 'olympiad' && task.optional !== true) errors.push('Олимпиадная практика должна оставаться дополнительной.')
  if (task.sourceIntake !== undefined && (task.sourceIntake?.kind !== 'olympiad-sheet' || Object.keys(task.sourceIntake ?? {}).some(key => key !== 'kind') || task.learningContext?.kind !== 'olympiad' || task.optional !== true)) errors.push('Приём фото условий допустим только для дополнительной олимпиады.')
  if (task.learnerOrigin !== undefined && (task.learningContext?.kind !== 'olympiad' || task.optional !== true || task.sourceIntake || !ID.test(task.learnerOrigin?.intakeTaskId ?? '') || !Array.isArray(task.learnerOrigin?.uploadIds) || !task.learnerOrigin.uploadIds.length || new Set(task.learnerOrigin.uploadIds).size !== task.learnerOrigin.uploadIds.length || task.learnerOrigin.uploadIds.some(id => !/^[A-Za-z0-9_-]{20,80}$/.test(id)) || Object.keys(task.learnerOrigin ?? {}).some(key => !['intakeTaskId','uploadIds'].includes(key)))) errors.push('Происхождение ученика требует подтверждённый приём и уникальные фотографии условий олимпиады.')
  if (task.testPlacements !== undefined && (!Array.isArray(task.testPlacements) || task.optional !== true || !task.learningContext || task.testPlacements.length > 30 ||
    task.testPlacements.some((placement) => !placement || Object.keys(placement).some(key => key !== 'token') || !/^[A-Za-z0-9_-]{24,64}$/.test(placement.token ?? '')) ||
    new Set(task.testPlacements.map(item => item.token)).size !== task.testPlacements.length)) errors.push('Дополнительным тестам нужны уникальные безопасные ссылки.')
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

/** Check uploaded source ownership before attaching learner provenance. */
export function learnerOriginErrors(task, intake, photos, sourceDate) {
  if (!task.learnerOrigin) return []
  const errors = []
  if (!intake || intake.familyId !== task.familyId || intake.childId !== task.childId || intake.sourceIntake?.kind !== 'olympiad-sheet' || intake.learningContext?.id !== task.learningContext?.id || intake.projectionSourceDate !== sourceDate) errors.push('Источник задачи не совпадает с приёмом листа этой олимпиады.')
  if (!Array.isArray(photos) || photos.length !== task.learnerOrigin.uploadIds.length || photos.some((photo, index) => !photo || photo.id !== task.learnerOrigin.uploadIds[index] || photo.taskId !== task.learnerOrigin.intakeTaskId || !['pending', 'reviewed'].includes(photo.status) || photo.storage?.state !== 'stored' || !/^[a-f0-9]{64}$/.test(photo.storage?.sha256 ?? ''))) errors.push('Исходные фото не подтверждены в приёме листа этого ребёнка.')
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
    ...(task.learningContext ? { learningContext: task.learningContext } : {}),
    ...(task.optional === true ? { optional: true } : {}),
    ...(task.sourceIntake ? { sourceIntake: task.sourceIntake } : {}),
    ...(task.learnerOrigin ? { learnerOrigin: task.learnerOrigin } : {}),
    ...(task.learnerSources?.length ? { learnerSources: task.learnerSources } : {}),
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
  const fields = Object.fromEntries(['id', 'title', 'detail', 'kind', 'source', 'steps', 'submission', 'cardPattern', 'cardPolicyVersion', 'outputKind', 'lessonDate', 'dueDate', 'learningContext', 'optional', 'sourceIntake', 'learnerOrigin', 'learnerSources']
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
    'title', 'originalText', 'studentText', 'publication', 'evidence', 'materialIds', 'steps', 'submission', 'cardPattern', 'cardPolicyVersion', 'outputKind', 'sourceEvidence', 'dayProjectionVersion', 'learningContext', 'optional', 'testPlacements', 'projectionSourceDate', 'sourceIntake', 'learnerOrigin', 'learnerSources']
  return Object.fromEntries(fields.filter((key) => task?.[key] !== undefined).map((key) => [key, task[key]]))
}

/** Build the expected date index against the post-transaction family task set. */
export function familyAssignmentsWithOverlay(assignments, task) {
  return [...(assignments ?? []).filter((item) => item?.id !== task.id), task]
}

/** Verify published quiz ownership and context before projecting its link.
 * No quiz answer keys or answers are copied to a day page. */
export function familyTestPlacementErrors(task, quizzes) {
  const errors = []
  for (const placement of task.testPlacements ?? []) {
    const quiz = quizzes.get(placement.token)
    if (!quiz || quiz.familyId !== task.familyId || quiz.childId !== task.childId ||
      stableFamilyProjectionJson(quiz.learningContext) !== stableFamilyProjectionJson(task.learningContext)) errors.push('Тест не подтверждён как дополнительный материал этого ребёнка и контекста.')
  }
  return errors
}

export function planFamilyTestPlacements(task, quizzes, page) {
  const errors = [...familyAssignmentErrors(task, { familyId: task.familyId, childId: task.childId, taskId: task.id }), ...familyTestPlacementErrors(task, quizzes)]
  if (errors.length) throw new Error(errors.join(' '))
  const placements = [...(page.testPlacements ?? [])]
  for (const { token } of task.testPlacements ?? []) {
    const prior = placements.find((item) => item.token === token)
    if (prior && (prior.subjectId !== task.subjectId || prior.taskId || prior.optional !== true)) throw new Error('Ссылка теста уже используется в другой части дня.')
    if (!prior) placements.push({ token, subjectId: task.subjectId, optional: true })
  }
  return placements
}

export function familyGuideErrors(guide, task) {
  if (!guide) return []
  if (!guide.overview?.trim() || !validLearningRoute(task.subjectId, task, guide)) return ['Родительский маршрут семейного задания имеет неверную структуру.']
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
  const added = [], changed = [], changedSubjects = new Set()
  for (const assignment of assignments) {
    if (subjects.some((item) => item.id !== assignment.subjectId && (item.tasks ?? []).some((task) => task.id === assignment.id))) throw new Error(`ID семейного задания ${assignment.id} уже занят в другом предмете.`)
    let subject = subjects.find((item) => item.id === assignment.subjectId)
    if (!subject) {
      subject = { id: assignment.subjectId, name: assignment.subjectName || 'Русский язык', icon: assignment.subjectId === 'russian' ? '✍' : '📘', materials: '', mesh: '', summary: '', tasks: [] }
      subjects.push(subject)
    }
    const byId = new Map((subject.tasks ?? []).map((item) => [item.id, item]))
    const baseProjection = projectFamilyAssignment(assignment)
    const projected = { ...baseProjection, familyOrigin: { ...baseProjection.familyOrigin, projectedSourceRevision: assignment.sourceRevision } }
    const existing = byId.get(projected.id)
    if (existing && existing.familyOrigin?.sourceId !== projected.familyOrigin.sourceId) throw new Error(`ID семейного задания ${projected.id} уже занят другим источником.`)
    if (!existing) { added.push(projected.id); changedSubjects.add(subject.id) }
    else if (stableFamilyProjectionJson(familyAssignmentProjectionSignature(existing)) !== stableFamilyProjectionJson(familyAssignmentProjectionSignature(projected))
      || existing.familyOrigin?.projectedSourceRevision !== assignment.sourceRevision) { changed.push(projected.id); changedSubjects.add(subject.id) }
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
    subject.tasks = [...byId.values()]
  }
  next.subjects = subjects
  next.taskIds = subjects.flatMap((item) => item.tasks ?? []).flatMap((item) => [item.id, ...(item.problems ?? []).map((problem) => problem.id)])
  if (added.length || changed.length) {
    next.planRevision = (Number.isInteger(page.planRevision) ? page.planRevision : 1) + 1
    next.changes = [{ at: new Date().toISOString(), added, removed: [], changed, changedSubjects: [...changedSubjects], newLinks: false, changedSchedule: false, changedWeekendSlot: false }, ...(page.changes ?? [])].slice(0, 20)
  }
  return next
}
