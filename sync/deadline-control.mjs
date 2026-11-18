/** @see ../docs/decisions/numbered-source-gap-2026-11-18.md */
/** @see ../docs/decisions/adaptive-review-modes-2026-11-17.md */
import {taskRequired,problemRequired} from '../day/task-requirement.mjs'
/** @see ../docs/modules/assignments/deadline-control.md */
import { learningGate } from '../day/learning-gate.mjs'
import { isControlAssignment } from '../assessment/decision-graph.mjs'
const dateValue = value => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? Date.parse(`${value}T12:00:00Z`) : NaN
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === value ? parsed : NaN
}
const daysBetween = (end, start) => (dateValue(end) - dateValue(start)) / 86400000

export function deadlineDecision({ task, today, dueDate, reviews = [], pendingUploadIds = [], independentCheck = null,parentDecisions=[],preparationAvailable=false,teacherMaterialAvailable=false } = {}) {
  const days = daysBetween(dueDate, today)
  if (!task?.id || !taskRequired(task,parentDecisions) || task.referenceDate && !task.repetition || !Number.isInteger(days) || days < -7 || days > 3) return null
  const control = isControlAssignment(task)
  const packing = /(?:взять|сдать|принести)[^.]{0,80}(?:тетрад|лист|альбом)/iu.test(task.meshText ?? '')
  if (!control && days > 1 || !control && !packing && !['written','read','check','cdz'].includes(task.kind)) return null
  const gate = learningGate({ requiredIds: task.problems?.length ? task.problems.filter(problemRequired).map(p => p.id) : [task.id], reviews,
    pendingUploadIds, readinessRequired: control, independentCheck })
  const issues = []
  if(control&&days>=0&&!preparationAvailable)issues.push('publish-control-preparation')
  if (pendingUploadIds.length) issues.push('review-existing-uploads')
  else if (days <= 1 && !packing && gate.work !== 'verified' && task.platformResult?.state !== 'completed') issues.push('audit-homework-and-archive')
  if (control && gate.readiness !== 'confirmed') issues.push('verify-independent-readiness')
  if (days <= 1 && (packing || task.kind === 'written' && gate.work === 'verified')) issues.push('confirm-packing-with-child')
  if (!issues.length) return null
  return { dueDate, stage: days < 0 ? 'overdue' : days === 0 ? 'due' : days === 1 ? 'before' : 'preparation',
    work: gate.work, readiness: gate.readiness, missingIds: gate.missingIds, verifiedIds: gate.verifiedIds,
    packing: 'unknown', issues,...(control?{preparation:{available:preparationAvailable,
      sourceRoute:teacherMaterialAvailable?'teacher-material':'course-and-comparable-work',researchRequired:true}}:{}) }
}

export function periodRiskChecks(subjects, today) {
  return (subjects ?? []).flatMap(subject => {
    const end = subject.end?.slice(0,10), days = daysBetween(end,today)
    if (Number.isFinite(days) && (days < 0 || days > 14)) return []
    const average = typeof subject.average === 'number' || typeof subject.average === 'string' && subject.average.trim()
      ? Number(String(subject.average).replace(',','.')) : NaN
    const recent = [...(subject.marks ?? [])].filter(m => Number(m.value) >= 2 && Number(m.value) <= 5 && dateValue(m.date) <= dateValue(today))
      .sort((a,b) => a.date.localeCompare(b.date)).slice(-3)
    const reasons = []
    if (!Number.isFinite(days)) reasons.push('period-end-unknown')
    if (!Number.isFinite(average)) reasons.push('average-unknown')
    else if (average < 4.5) reasons.push('average-below-4-5')
    if (recent.length && Number(recent.at(-1).value) < 5) reasons.push('latest-below-five')
    if (recent.length === 3 && Number(recent[2].value) < Number(recent[0].value)) reasons.push('recent-deterioration')
    if ((subject.recentMarks ?? []).some(m => m.is_point === true && [2,3].includes(Number(m.value)))) reasons.push('open-low-point')
    return reasons.length ? [{ subjectId: String(subject.subject_id ?? subject.subject_name), periodEnd: Number.isFinite(days) ? end : null,
      average: Number.isFinite(average) ? average : null, reasons,
      markIds: recent.map(m => String(m.id ?? `${m.date}:${m.value}`)), lastValues: recent.map(m => Number(m.value)) }] : []
  })
}
