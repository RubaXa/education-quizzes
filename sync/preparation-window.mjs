/** @see ../docs/decisions/continuous-course-preparation-2026-11-07.md */
/** @see ../docs/decisions/moving-preparation-window-2026-11-05.md */
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const preparationKinds = new Set(['prepare-quiz', 'classify-assignment', 'enrich-task', 'material-needed'])

/** Presentation is independent of assessment and the operator queue.
 * @see ../docs/modules/synchronization/task-routing.md#learning-lifecycle */
export function ensureContinuousPreparation(source, availableFrom) {
  if (source.weekendSlot) return false
  const tasks = (source.subjects ?? []).filter(subject => /спецкурс|специальный курс/iu.test(subject.name))
    .flatMap(subject => subject.tasks ?? []).filter(task => task.problems?.length)
  if (!tasks.length || !/^\d{4}-\d{2}-\d{2}$/.test(availableFrom) || availableFrom >= source.targetDate) return false
  const lesson = new Date(`${source.targetDate}T12:00:00Z`)
  const back = (lesson.getUTCDay() + 5) % 7 || 7
  lesson.setUTCDate(lesson.getUTCDate() - back)
  const through = lesson.toISOString().slice(0, 10)
  source.weekendSlot = { mode: 'until-complete', availableFrom, dates: [availableFrom],
    preparationThrough: through < availableFrom ? availableFrom : through,
    title: 'Спецкурс по математике · текущий лист', taskIds: tasks.map(task => task.id),
    dueDate: tasks[0].dueDate ?? source.targetDate }
  return true
}

/** A new day/week cannot silently remove unfinished preparation. */
export function preparationVisible(slot, selectedDate) {
  return slot.mode === 'until-complete' ? selectedDate >= slot.availableFrom : slot.dates.includes(selectedDate)
}

/** Expire only legacy preparation; attempts, help and frozen event actions retain their own lifecycle. */
export function preparationExpiry(record, windowDates) {
  if (record.artifactPath || !preparationKinds.has(record.kind) || !windowDates?.length) return null
  const date = record.source?.date ?? record.source?.dayDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || date >= windowDates[0]) return null
  return `outside-active-preparation-window:${date}:active-from:${windowDates[0]}`
}
