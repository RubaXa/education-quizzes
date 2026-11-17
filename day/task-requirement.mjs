/** @see ../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** Shared family-plan selection for the UI and the existing synchronization pass.
 * This choice never changes a teacher source, verdict or mastery.
 * @see ../docs/shared/design/student-review-step.md#assignment-clarification */
const stamp=value=>{
 if(!value||typeof value!=='object')return ''
 const seconds=value.seconds??value._seconds,nanos=value.nanoseconds??value._nanoseconds
 return typeof seconds==='number'&&typeof nanos==='number'?`${String(seconds).padStart(12,'0')}:${String(nanos).padStart(9,'0')}`:''
}
export function taskRequirementChoice(taskId,events=[]){
 const latest=events.filter(e=>e.taskId===taskId&&['task-required','task-optional'].includes(e.action)&&stamp(e.decidedAt))
  .sort((a,b)=>stamp(b.decidedAt).localeCompare(stamp(a.decidedAt))||String(b.id).localeCompare(String(a.id)))[0]
 return latest?latest.action==='task-required':undefined
}
export function taskRequired(task,events=[]){return taskRequirementChoice(task.id,events)??task.optional!==true}
