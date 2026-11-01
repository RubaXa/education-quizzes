/** @see ../docs/decisions/lesson-repetition-2026-11-01.md */
/** @see ../docs/modules/assessments/lesson-repetition.md */
import { lessonSubjectKey } from '../day/subject-identity.mjs'
const text = value => typeof value === 'string' && value.trim().length > 0
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
/** A pointer naming the previous lesson is content to resolve, not proof of practice. */
export function previousLessonReference(task) {
  return /(?:прошл|предыдущ)[а-яё]*\s+(?:урок|заняти)|(?:урок|заняти)[а-яё]*\s+(?:прошл|предыдущ)/iu.test(task?.meshText ?? '')
}
export function repetitionErrors(value) {
  if (value === undefined) return []
  if (value?.version !== 1 || !date(value.lessonDate) || !text(value.historyRef) || !date(value.historyAsOf) || !Array.isArray(value.taskIds) || !value.taskIds.length
    || value.taskIds.some(id => !text(id)) || new Set(value.taskIds).size !== value.taskIds.length
    || !Array.isArray(value.parts) || !value.parts.length || new Set(value.parts.map(p=>p.id)).size !== value.parts.length
    || value.parts.some(part => !text(part.id) || !['written','oral','reading'].includes(part.kind)
      || !text(part.topic) || !text(part.materialRef) || !['ready','missing'].includes(part.materialState))) return ['Нужны точный предыдущий урок, все части и подтверждённые материалы каждой части.']
  return []
}
export function repetitionDecision(task) {
  if (!previousLessonReference(task)) return null
  const value = task.repetition
  if (!value || repetitionErrors(value).length) return {job:'classify-assignment',reason:'resolve-previous-lesson-before-requesting-upload'}
  if (value.parts.some(part => part.materialState !== 'ready')) return {job:'classify-assignment',reason:'recover-only-missing-repetition-material'}
  return {job:'prepare-quiz',mode:'ordinary',reason:'new-repetition-not-old-remediation',evidenceRef:value.parts.map(p=>p.materialRef).join('; ')}
}
/** Read-only decision graph over an explicit owner-scoped evidence bundle.
 * Earlier passing work remains evidence/history; it never completes this new assignment.
 * No network access, free-form inference, cross-family matching or answer generation. */
export function planLessonRepetition({target,lessons=[],currentAssessment=null,historyCoverage}={}) {
  if (!target || !text(target.familyId) || !text(target.childId) || !date(target.lessonDate)
    || !text(target.subject) || !previousLessonReference(target)) throw new Error('Exact owned previous-lesson target required.')
  const subject = lessonSubjectKey(target.subject) ?? target.subject
  const lookup=['mesh-history-same-child-subject','education-previous-tasks-and-uploads','family-library-and-exact-edition']
  const coverage=historyCoverage
  const end=new Date(`${target.lessonDate}T00:00:00Z`);end.setUTCDate(end.getUTCDate()-1)
  const through=end.toISOString().slice(0,10)
  const days=[]
  if(date(coverage?.from)&&coverage.from<=through) for(let day=new Date(`${coverage.from}T00:00:00Z`);day<=end;day.setUTCDate(day.getUTCDate()+1)) {
    if(days.length>=366)break
    days.push(day.toISOString().slice(0,10))
  }
  if(coverage?.complete!==true||coverage.familyId!==target.familyId||coverage.childId!==target.childId
    ||(lessonSubjectKey(coverage.subject)??coverage.subject)!==subject||coverage.through!==through
    ||!text(coverage.evidenceRef)||!date(coverage.asOf)||!days.length||days.length>=366
    ||!Array.isArray(coverage.checkedDates)||days.some(day=>!coverage.checkedDates.includes(day)))
    return {state:'history-not-verified',lookup,request:[],complete:false}
  const candidates=lessons.filter(lesson=>lesson.familyId===target.familyId && lesson.childId===target.childId
    && (lessonSubjectKey(lesson.subject)??lesson.subject)===subject && date(lesson.date) && lesson.date>=coverage.from && lesson.date<target.lessonDate
    && lesson.cancelled!==true && lesson.verified===true && text(lesson.id) && text(lesson.evidenceRef))
  const latest=candidates.map(l=>l.date).sort().at(-1)
  const selected=candidates.filter(l=>l.date===latest)
  if (!selected.length) return {state:'missing-previous-lesson',lookup,request:['previous-lesson-record-and-required-materials'],complete:false}
  const unique=new Map(selected.map(l=>[l.id,l]))
  if (unique.size!==1 || selected.some(l=>JSON.stringify(l)!==JSON.stringify(selected[0]))) return {state:'ambiguous-previous-lesson',lookup,request:['clarify-candidate-lessons'],complete:false}
  const lesson=selected[0]
  const repetition={version:1,lessonDate:lesson.date,historyRef:coverage.evidenceRef,historyAsOf:coverage.asOf,taskIds:lesson.taskIds,parts:lesson.parts}
  if (repetitionErrors(repetition).length) return {state:'missing-lesson-content',lessonId:lesson.id,lookup,request:['exact-conditions-and-rule-pages'],complete:false}
  const missing=lesson.parts.filter(p=>p.materialState!=='ready').map(p=>p.id)
  if (missing.length) return {state:'missing-material',lessonId:lesson.id,repetition,lookup,request:missing,complete:false}
  const bound=currentAssessment?.familyId===target.familyId && currentAssessment?.childId===target.childId
    && currentAssessment?.taskId===target.id && currentAssessment?.lessonDate===target.lessonDate
    && text(currentAssessment?.token)
  return {state:bound?'existing-assessment':'prepare-quiz',lessonId:lesson.id,repetition,request:[],
    preservePriorWork:lesson.parts.filter(p=>text(p.workEvidence)).map(p=>p.id),
    checks:['cover-every-repeated-part','history-informs-new-questions','preserve-prior-credit','publish-current-assessment','both-role-readback'],complete:false}
}
