import { historyDigest, validateHistoryCompetition } from './history.mjs'
/** Deterministic route over checked work, never a skill/mastery estimator.
 * @see ../docs/modules/assessments/olympiad-history.md#обновление-после-проверки */
export function timestampKey(value) {
 const seconds=value?.seconds??value?._seconds, nanos=value?.nanoseconds??value?._nanoseconds
 return Number.isInteger(seconds)&&Number.isInteger(nanos)?`${String(seconds).padStart(12,'0')}:${String(nanos).padStart(9,'0')}`:''
}
const dateOf=value=>new Date(Number(timestampKey(value).split(':')[0])*1000).toISOString().slice(0,10)
const safeText=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max?v:null
export function taskCredit(review,decisions=[]) {
 if(!review||review.purpose==='source-material'||!timestampKey(review.checkedAt))return null
 if(review.status==='verified')return 'review'
 const ids=review.checkableStageIds
 if(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length&&ids.every(id=>{
  const latest=decisions.filter(d=>d.taskId===review.taskId&&d.stageId===id&&['stage-required','stage-optional'].includes(d.action)
   &&timestampKey(d.reviewCheckedAt)===timestampKey(review.checkedAt)&&timestampKey(d.decidedAt))
   .sort((a,b)=>timestampKey(b.decidedAt).localeCompare(timestampKey(a.decidedAt))||b.id.localeCompare(a.id))[0]
  const items=(review.items??[]).filter(i=>i.stageId===id)
  return latest?.action==='stage-optional'||items.length>0&&items.every(i=>i.status==='correct')
 }))return 'family'
 if(review.status!=='partial'||review.mathReasoning?.answer!=='correct'
  ||!['incomplete','not-shown','unreadable'].includes(review.mathReasoning?.argument)
  ||!['met','not-met'].includes(review.assessmentBasis?.outcome))return null
 const latest=decisions.filter(d=>d.taskId===review.taskId&&['accept','reopen'].includes(d.action)
  &&timestampKey(d.reviewCheckedAt)===timestampKey(review.checkedAt)&&timestampKey(d.decidedAt))
  .sort((a,b)=>timestampKey(b.decidedAt).localeCompare(timestampKey(a.decidedAt))||b.id.localeCompare(a.id))[0]
 return latest?.action==='accept'?'family':null
}
export function validatePreparationRoute(route,competition) {
 if(route?.schemaVersion!==1||route.competitionId!==competition.id||!Array.isArray(route.candidates)||!route.candidates.length||route.candidates.length>50
  ||new Set(route.candidates.map(c=>c.taskId)).size!==route.candidates.length||!Array.isArray(route.goals)||route.goals.length>2)throw Error('preparation_route_invalid')
 validateHistoryCompetition({...competition,preparation:route.baseline})
 if(route.baseline.progress)throw Error('preparation_baseline_must_be_static')
 for(const e of route.baseline.evidence)if(!competition.preparation?.evidence.some(old=>historyDigest(old)===historyDigest(e)))throw Error('preparation_evidence_not_registered')
 for(const c of route.candidates){
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(c.taskId)||!/^[A-Za-z0-9_-]{1,120}$/.test(c.dayToken))throw Error('preparation_candidate_invalid')
  validateHistoryCompetition({...competition,preparation:{...route.baseline,next:{taskId:c.taskId,title:c.title,reason:c.reason,evidenceIds:c.evidenceIds}}})
 }
 for(const g of route.goals){
  if(!g.taskIds?.length||g.taskIds.some(id=>!route.candidates.some(c=>c.taskId===id)))throw Error('preparation_goal_invalid')
  validateHistoryCompetition({...competition,preparation:{...route.baseline,workingOn:[{text:g.text,evidenceIds:g.evidenceIds}]}})
 }
 return route
}
export function projectPreparation(route,states,previous) {
 const result=structuredClone(route.baseline), tasks=[]
 for(const c of route.candidates){
  const state=states[c.taskId],r=state?.review
  if(!state?.available||r?.purpose==='source-material'||!['verified','partial','needs-fix'].includes(r?.status)||!timestampKey(r.checkedAt))continue
  const credited=taskCredit(r,state.decisions), prior=previous?.progress?.tasks.find(t=>t.taskId===c.taskId)
  const at=timestampKey(r.correctedAt)?r.correctedAt:r.checkedAt
  tasks.push({taskId:c.taskId,title:c.title,status:r.status,checkedOn:dateOf(at),credited,
   confirmed:safeText(r.studentFeedback?.confirmed,2000),focus:credited?null:safeText(r.studentFeedback?.focus,2000),
   achievedOn:prior?.achievedOn??(credited?dateOf(at):null)})
 }
 const credited=id=>Boolean(tasks.find(t=>t.taskId===id)?.credited)
 result.workingOn=route.goals.filter(g=>!g.taskIds.every(credited)).map(g=>{
  const current=g.taskIds.map(id=>tasks.find(t=>t.taskId===id&&!t.credited)).find(t=>safeText(t?.focus,240))
  return {text:current?.focus??g.text,evidenceIds:g.evidenceIds}
 })
 const candidate=route.candidates.find(c=>states[c.taskId]?.available&&!credited(c.taskId))
 const focus=tasks.find(t=>t.taskId===candidate?.taskId)?.focus
 const reviewed=candidate&&tasks.some(t=>t.taskId===candidate.taskId)
 const reason=safeText(focus,240)??(reviewed?'Продолжить с текущего вопроса в разборе. Зачтённые части сохраняются.':candidate?.reason)
 result.next=candidate?{taskId:candidate.taskId,title:candidate.title,reason,evidenceIds:candidate.evidenceIds}:null
 // Retain first achievements even when a task is withdrawn or a review is corrected.
 for(const prior of previous?.progress?.tasks??[])if(prior.achievedOn&&!tasks.some(t=>t.taskId===prior.taskId))tasks.push({...prior,credited:null,focus:null})
 const dates=tasks.map(t=>t.checkedOn).concat(route.baseline.updatedOn)
 result.updatedOn=dates.sort().at(-1)
 result.progress={tasks,exhausted:!candidate&&route.candidates.every(c=>credited(c.taskId))}
 return result
}
export const preparationRevision=historyDigest
