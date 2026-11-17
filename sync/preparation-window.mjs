/** @see ../docs/decisions/continuous-course-preparation-2026-11-07.md */
/** @see ../docs/decisions/moving-preparation-window-2026-11-05.md */
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
const preparationKinds = new Set(['prepare-quiz', 'classify-assignment', 'enrich-task', 'material-needed'])
import {isControlAssignment} from '../assessment/decision-graph.mjs'
const shiftedDate=(date,days)=>{const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}

/** Presentation is independent of assessment and the operator queue.
 * @see ../docs/modules/synchronization/task-routing.md#learning-lifecycle */
export function ensureContinuousPreparation(source, availableFrom) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(availableFrom) || availableFrom >= source.targetDate) return false
  let changed=false
  // A real published assessment/worksheet is required. An announcement alone is not a prepared lesson.
  // @see ../docs/modules/assignments/deadline-control.md#control-preparation
  const covered=new Set([...(source.weekendSlot?.taskIds??[]),...(source.controlPreparationSlot?.taskIds??[])])
  const controls=(source.subjects??[]).flatMap(s=>s.tasks??[]).filter(task=>isControlAssignment(task)
    && (task.dueDate??source.targetDate)===source.targetDate && !covered.has(task.id)
    && (task.problems?.length || task.kind==='check' && task.testToken
      && source.testPlacements?.some(p=>p.taskId===task.id&&p.token===task.testToken)))
  if(controls.length){
    const start=[availableFrom,shiftedDate(source.targetDate,-3)].sort().at(-1)
    source.controlPreparationSlot=source.controlPreparationSlot
      ? {...source.controlPreparationSlot,taskIds:[...source.controlPreparationSlot.taskIds,...controls.map(t=>t.id)]}
      : {mode:'until-complete',availableFrom:start,dates:[start],preparationThrough:shiftedDate(source.targetDate,-1),
        dueDate:source.targetDate,title:'Подготовка к контрольным и самостоятельным',taskIds:controls.map(t=>t.id)}
    changed=true
  }
  if (source.weekendSlot) return changed
  const tasks = (source.subjects ?? []).filter(subject => /спецкурс|специальный курс/iu.test(subject.name))
    .flatMap(subject => subject.tasks ?? []).filter(task => task.problems?.length)
  if (!tasks.length) return changed
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

/** The latest available course replaces the older active projection, never its evidence/history.
 * @see ../docs/modules/synchronization/task-routing.md#learning-lifecycle */
export function activePreparations(slots, selectedDate) {
  const visible=slots.filter(slot=>preparationVisible(slot,selectedDate))
  const isCourse=slot=>slot.kind==='course'||/спецкурс|специальный курс|практикум/iu.test(slot.title??'')
  const current=visible.filter(isCourse).sort((a,b)=>(b.lessonDate??'').localeCompare(a.lessonDate??'')
    || (b.availableFrom??b.dates[0]).localeCompare(a.availableFrom??a.dates[0])
    || b.taskIds.join(',').localeCompare(a.taskIds.join(',')))[0]
  return visible.filter(slot=>!isCourse(slot)||slot===current)
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
