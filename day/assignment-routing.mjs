/** A reviewed course placement is separate from the immutable MESH attachment origin.
 * @see ../docs/modules/synchronization/plan-generation.md#assignment-routing */
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const tasks = (source) => source.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []
const routeKey = (route) => `${route.fromDate}:${route.taskId}`
const rawEntries = (snapshot) => {
  if (!snapshot?.complete || snapshot.assignments?.some((item) => item.detailStatus !== 'loaded')) throw new Error('Для привязки нужен полный исходный снимок МЭШ.')
  return (snapshot.assignments ?? []).flatMap((item) => (item.homeworkEntries ?? []).map((entry) => ({ id: `mesh-${entry.id}`, text: entry.description.trim() })))
}

export function assignmentRouteEvidence(source, readSource, readSnapshot) {
  const imports = [], exports = [], seen = new Set()
  for (const route of source.assignmentRoutes ?? []) {
    if (route.schemaVersion !== 1 || !/^mesh-\d+$/.test(route.taskId ?? '')
      || ![route.fromSourceDate, route.toSourceDate, route.fromDate, route.toDate].every((date) => datePattern.test(date ?? ''))
      || route.fromDate === route.toDate || !route.fromSubjectId || !route.toSubjectId || !route.toSubjectName
      || !route.targetLessonId || !route.targetLessonName?.trim() || !route.meshText?.trim() || !route.reason?.trim() || !route.decisionRef?.trim()
      || seen.has(routeKey(route))) throw new Error('Нужна уникальная подтверждённая привязка с происхождением и причиной.')
    seen.add(routeKey(route))
    if (!readSource || !readSnapshot) throw new Error('Для проверки привязки нужны оба локальных плана и снимки МЭШ.')
    const from = readSource(route.fromSourceDate), to = readSource(route.toSourceDate)
    if (from.targetDate !== route.fromDate || to.targetDate !== route.toDate
      || ![route.fromDate, route.toDate].includes(source.targetDate)
      || ![from, to].every((plan) => plan.assignmentRoutes?.some((item) => JSON.stringify(item) === JSON.stringify(route)))) {
      throw new Error(`Обе стороны привязки ${route.taskId} должны совпадать.`)
    }
    const original = readSnapshot(route.fromDate), target = readSnapshot(route.toDate)
    const origin = rawEntries(original).find((entry) => entry.id === route.taskId)
    const lesson = target?.schedule?.find((item) => String(item.id) === route.targetLessonId && !item.cancelled)
    const subject = to.subjects.find((item) => item.id === route.toSubjectId)
    const task = subject?.tasks.find((item) => item.id === route.taskId)
    if (origin?.text !== route.meshText || !target?.complete || !lesson
      || !String(lesson.subject_name).includes(route.targetLessonName)
      || !task || task.meshText !== route.meshText || task.lessonDate !== route.toDate
      || task.originDate !== route.toDate || subject.name !== route.toSubjectName
      || tasks(from).some((item) => item.id === route.taskId) || !from.retiredTaskIds?.includes(route.taskId)) {
      throw new Error(`Привязка ${route.taskId} потеряла исходник, целевой урок или единственного владельца.`)
    }
    const originAssignment = original.assignments.find((item) => item.homeworkEntries?.some((entry) => `mesh-${entry.id}` === route.taskId))
    if ((originAssignment.subjectName ?? originAssignment.subject_name) !== route.fromSubjectName) throw new Error('Изменился исходный предмет привязки.')
    if (source.targetDate === route.fromDate) exports.push({ id: route.taskId, text: route.meshText })
    else imports.push({ id: route.taskId, text: route.meshText })
  }
  return { imports, exports }
}

export function prepareAssignmentRoute(request, fromSource, toSource, links, readSnapshot) {
  if (request.schemaVersion !== 1 || !datePattern.test(request.fromSourceDate ?? '') || !datePattern.test(request.toSourceDate ?? '')
    || !request.targetSubject?.id || !request.targetSubject?.name || !request.targetSubject?.icon
    || !request.reason?.trim() || !request.decisionRef?.trim()) throw new Error('Неполный пакет привязки задания.')
  const from = structuredClone(fromSource), to = structuredClone(toSource)
  const existing = from.assignmentRoutes?.find((item) => item.taskId === request.taskId)
  if (existing) {
    if (existing.toSourceDate !== request.toSourceDate || existing.toSubjectId !== request.targetSubject.id) throw new Error('Задание уже связано с другим курсом.')
    assignmentRouteEvidence(from, (date) => date === request.fromSourceDate ? from : to, readSnapshot)
    return { from, to, route: existing, reused: true }
  }
  const subject = from.subjects.find((item) => item.tasks.some((task) => task.id === request.taskId))
  const task = subject?.tasks.find((item) => item.id === request.taskId)
  if (!task || tasks(to).some((item) => item.id === request.taskId)) throw new Error('Нужен единственный исходный экземпляр задания.')
  if (task.testToken || from.testPlacements?.some((item) => item.taskId === task.id)) throw new Error('Перенос тестового назначения требует отдельной миграции.')
  if (!links[request.fromSourceDate]?.student || !links[request.toSourceDate]?.student) throw new Error('Сначала нужны опубликованные страницы обеих дат.')
  const lesson = readSnapshot(to.targetDate)?.schedule?.find((item) => String(item.id) === String(request.targetLessonId))
  if (!lesson || !request.targetLessonName?.trim()) throw new Error('Не найдено целевое занятие МЭШ.')
  const route = { schemaVersion: 1, taskId: task.id, fromSourceDate: request.fromSourceDate, toSourceDate: request.toSourceDate,
    fromDate: from.targetDate, toDate: to.targetDate, fromSubjectId: subject.id, fromSubjectName: subject.name,
    toSubjectId: request.targetSubject.id, toSubjectName: request.targetSubject.name,
    targetLessonId: String(request.targetLessonId), targetLessonName: request.targetLessonName,
    meshText: task.meshText, reason: request.reason, decisionRef: request.decisionRef }
  const originMaterials = subject.materials
  from.assignmentRoutes = [...(from.assignmentRoutes ?? []), route]
  to.assignmentRoutes = [...(to.assignmentRoutes ?? []), route]
  subject.tasks = subject.tasks.filter((item) => item.id !== task.id)
  from.subjects = from.subjects.filter((item) => item.tasks.length)
  // Keep only the source text for the actions remaining at the old lesson.
  subject.mesh = subject.tasks.map((item) => item.meshText).filter(Boolean).join('; ')
  from.retiredTaskIds = [...new Set([...(from.retiredTaskIds ?? []), task.id])]
  let targetSubject = to.subjects.find((item) => item.id === request.targetSubject.id)
  if (!targetSubject) { targetSubject = { ...request.targetSubject, summary: '', materials: originMaterials ?? '', mesh: '', tasks: [] }; to.subjects.push(targetSubject) }
  task.originDate = to.targetDate
  task.lessonDate = to.targetDate
  if (!task.dueDateEvidence && (!task.dueDate || task.dueDate === from.targetDate)) task.dueDate = to.targetDate
  targetSubject.tasks.push(task)
  targetSubject.mesh = targetSubject.tasks.map((item) => item.meshText).filter(Boolean).join('; ')
  to.materialLinks = { ...(to.materialLinks ?? {}), [task.id]: from.materialLinks?.[task.id] ?? [] }
  if (from.materialLinks) delete from.materialLinks[task.id]
  subject.materials = [...new Set(subject.tasks.flatMap((item) => from.materialLinks?.[item.id] ?? []).map((link) => link.title))].join('; ')
  from.materialLinkReplacements = (from.materialLinkReplacements ?? []).filter((id) => id !== task.id)
  to.evidenceDayTokens = [...new Set([...(to.evidenceDayTokens ?? []), links[request.fromSourceDate].student, ...(from.evidenceDayTokens ?? [])])]
  const removedWeekend = from.weekendSlot?.taskIds.includes(task.id) ? structuredClone(from.weekendSlot) : null
  if (removedWeekend) {
    if (removedWeekend.taskIds.length !== 1 || to.weekendSlot) throw new Error('Для объединения нескольких выходных листов нужен отдельный план.')
    to.weekendSlot = { ...removedWeekend, dueDate: task.dueDate ?? to.targetDate }
    from.weekendSlot = null
  }
  assignmentRouteEvidence(from, (date) => date === request.fromSourceDate ? from : to, readSnapshot)
  return { from, to, route, reused: false, removedWeekend }
}
