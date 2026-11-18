/** @see ../docs/decisions/stage-assessment-evidence-2026-11-18.md */
import {stageAssessmentErrors} from '../day/stage-assessment.mjs'
/** Addressed, owner-fenced presentation correction; never a new assignment or review.
 * @see ../docs/modules/reviews/adaptive-problem-card.md#presentation-gate
 */
import {isDeepStrictEqual as same} from 'node:util'
import {parentGuideEditErrors} from './parent-guide-edit.mjs'
import {problemPresentationErrors,guidePresentationErrors,materialRequestPresentationErrors} from '../packages/education-presentation/task-presentation.mjs'
import {parentGuideProseErrors,taskSupportProseErrors} from '../src/lib/reviewProse.ts'
const segment=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
const taskId=v=>typeof v==='string'&&/^[a-z0-9-]+$/.test(v)
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))
const unchanged=(a,b,except)=>[...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].every(k=>except.includes(k)||same(a?.[k],b?.[k]))
function fail(message){throw new Error(message)}
function locate(page,id){
 const hits=[]
 for(const subject of page.subjects??[])for(const task of subject.tasks??[]){if(task.id===id)hits.push(task);for(const p of task.problems??[])if(p.id===id)hits.push(p)}
 if(hits.length!==1)fail(`Задание ${id} отсутствует или неоднозначно.`)
 return hits[0]
}
function updateTarget(subjects,id,patch){return subjects.map(s=>({...s,tasks:(s.tasks??[]).map(t=>t.id===id?{...t,...patch}:t.problems?.some(p=>p.id===id)?{...t,problems:t.problems.map(p=>p.id===id?{...p,...patch}:p)}:t)}))}
function sameVersion(a,b){return Boolean(a&&b&&(typeof a.isEqual==='function'?a.isEqual(b):same(a,b)))}
function assertOwner(input,owner,student,parent){
 if(!owner||!student||!parent||student.kind!=='student'||parent.kind!=='parent'
  ||parent.studentToken!==input.pageId||input.pageId===input.parentPageId
  ||student.parentToken!==undefined&&student.parentToken!==input.parentPageId
  ||[owner,student,parent].some(v=>v.familyId!==input.familyId||v.childId!==input.childId)
  ||student.planRevision!==input.expectedPlanRevision||parent.planRevision!==input.expectedPlanRevision
  ||student.date!==parent.date||student.targetDate!==parent.targetDate
  ||owner.date!==undefined&&owner.date!==student.date
  ||owner.targetDate!==undefined&&owner.targetDate!==student.targetDate)fail('Владелец, роли, связь страниц или ревизия плана не совпадают.')
}
function validateInput(input){
 if(!keys(input,['pageId','parentPageId','familyId','childId','expectedPlanRevision','reason','changes'])
  ||![input.pageId,input.parentPageId,input.familyId,input.childId].every(segment)
  ||!Number.isInteger(input.expectedPlanRevision)||input.expectedPlanRevision<0
  ||typeof input.reason!=='string'||input.reason.trim().length<20||input.reason.length>1000
  ||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>100
  ||new Set(input.changes.map(c=>c?.taskId)).size!==input.changes.length)fail('Нужны адресный пакет, причина и уникальные изменения.')
 for(const c of input.changes)if(!keys(c,['taskId','expectedSupportRevision','support','expectedGuideRevision','sourceRevision','guide','materialRequest','stageAssessments','expectedStageAssessments','learnerFlowBoundary','expectedLearnerFlowBoundary'])||!taskId(c.taskId)||!['support','guide','materialRequest','stageAssessments','learnerFlowBoundary'].some(k=>Object.hasOwn(c,k)))fail('Разрешены только support, guide и materialRequest представления.')
}
function continuationTargets(input){
 const targets=new Map()
 for(const c of input.changes){const target=c.materialRequest?.presentation?.continuation;if(!target)continue
  if(!keys(target,['label','dayToken','taskId'])||!segment(target.dayToken)||!taskId(target.taskId)||target.dayToken===input.pageId&&target.taskId===c.taskId)fail('Continuation требует один точный внутренний переход, без URL и ссылки на себя.')
  targets.set(`${target.dayToken}:${target.taskId}`,target)
 }
 if(targets.size>1)fail('Один пакет допускает только один точный внутренний переход материала.')
 return [...targets.values()]
}
function assertContinuation(input,targets,snaps){
 for(const [i,target] of targets.entries()){
  const owner=snaps[2*i],page=snaps[2*i+1]
  if(!owner?.exists||!page?.exists||[owner.data(),page.data()].some(v=>v.familyId!==input.familyId||v.childId!==input.childId)||page.data().kind!=='student')fail('Continuation: страница или владелец перехода не подтверждены.')
  locate(page.data(),target.taskId)
 }
}
function prepare(input,snaps,now){
 const [ownerSnap,studentSnap,parentSnap,...guides]=snaps
 if(snaps.some(s=>!s.exists))fail('Одна из адресных страниц или закрытых guides отсутствует.')
 const owner=ownerSnap.data(),student=studentSnap.data(),parent=parentSnap.data()
 assertOwner(input,owner,student,parent)
 let studentSubjects=student.subjects,parentSubjects=parent.subjects
 const guideWrites=[]
 for(const c of input.changes){
  const a=locate(student,c.taskId),b=locate(parent,c.taskId),patch={}
  if(Object.hasOwn(c,'learnerFlowBoundary')){
   if(typeof c.learnerFlowBoundary!=='string'||!c.learnerFlowBoundary.trim()||c.learnerFlowBoundary.length>500||!a.learnerFlow
    ||!same(a.learnerFlow,b.learnerFlow)||a.learnerFlow.boundary!==c.expectedLearnerFlowBoundary)fail('LearnerFlow boundary: CAS или текст не совпал.')
   patch.learnerFlow={...a.learnerFlow,boundary:c.learnerFlowBoundary}
  }
  if(Object.hasOwn(c,'stageAssessments')){
   const g=guides.find(s=>s.ref.path===`dayTaskGuides/${input.pageId}/items/${c.taskId}`)?.data()
   if(!g||g.familyId!==input.familyId||g.childId!==input.childId||g.taskId!==c.taskId||g.guide?.revision!==c.expectedGuideRevision
    ||!same(a.stageAssessments??[],c.expectedStageAssessments)||!same(a.stageAssessments,b.stageAssessments))fail('Stage assessment: CAS, guide или владелец не совпал.')
   const subject=student.subjects.find(s=>s.tasks.some(t=>t.id===c.taskId))
   const errors=stageAssessmentErrors({...a,stageAssessments:c.stageAssessments},subject?.id,student.testPlacements,g.guide)
   if(errors.length)fail(errors.join('\n'))
   patch.stageAssessments=c.stageAssessments
  }
  if(Object.hasOwn(c,'support')){
   if(!a.support||!same(a.support,b.support)||!object(c.support)
    ||!Number.isInteger(c.expectedSupportRevision)||a.support.revision!==c.expectedSupportRevision
    ||c.support.revision!==c.expectedSupportRevision+1
    ||!unchanged(a.support,c.support,['facts','find','parts','revision']))fail(`Support ${c.taskId}: CAS или неизменяемые поля нарушены.`)
   const errors=[...problemPresentationErrors({...a,support:c.support}),...taskSupportProseErrors({support:c.support})];if(errors.length)fail(errors.join('\n'))
   patch.support=c.support
  }
  if(Object.hasOwn(c,'materialRequest')){
   if(!a.materialRequest||!same(a.materialRequest,b.materialRequest)||!object(c.materialRequest)
    ||!unchanged(a.materialRequest,c.materialRequest,['presentation','question','photoPrompt']))fail(`MaterialRequest ${c.taskId}: исходное состояние и происхождение должны сохраниться.`)
   if(['question','photoPrompt'].some(k=>Object.hasOwn(c.materialRequest,k)&&(typeof c.materialRequest[k]!=='string'||!c.materialRequest[k].trim()||c.materialRequest[k].length>500)))fail('Нужны краткие question/photoPrompt.')
   const errors=[...materialRequestPresentationErrors(c.materialRequest),...taskSupportProseErrors({materialRequest:c.materialRequest})];if(errors.length)fail(errors.join('\n'))
   if(same(a.materialRequest,c.materialRequest)&&!Object.hasOwn(c,'support')&&!Object.hasOwn(c,'guide'))fail('Представление материала уже совпадает: повторная запись не нужна.')
   patch.materialRequest=c.materialRequest
  }
  studentSubjects=updateTarget(studentSubjects,c.taskId,patch);parentSubjects=updateTarget(parentSubjects,c.taskId,patch)
  if(Object.hasOwn(c,'guide')){
   const snap=guides.find(s=>s.ref.path===`dayTaskGuides/${input.pageId}/items/${c.taskId}`),old=snap.data(),next=c.guide
   if(old.familyId!==input.familyId||old.childId!==input.childId||old.taskId!==c.taskId)fail('Закрытый guide принадлежит другому владельцу или заданию.')
   const errors=parentGuideEditErrors(old,{version:1,reason:input.reason,...c})
   if(!object(next)||!unchanged(old.guide,next,['revision','overview','method','stages']))errors.push('Guide: границы, профиль и семантические правила должны сохраниться.')
   if(Array.isArray(next?.stages)&&Array.isArray(old.guide?.stages))for(const [i,s] of next.stages.entries()){
    if(!same(s.answer,old.guide.stages[i]?.answer)||!same(s.verification,old.guide.stages[i]?.verification))errors.push('Guide: answer/verification неизменяемы при коррекции представления.')
    if(!unchanged(old.guide.stages[i],s,['title','expected','rows','blocks','hintPreview','revealPreview','why']))errors.push('Guide: условие, ответ, проверка и идентичность этапа должны сохраниться.')
   }
   errors.push(...guidePresentationErrors(next),...parentGuideProseErrors(next));if(errors.length)fail(errors.join('\n'))
   guideWrites.push({ref:snap.ref,before:old,after:{...old,guide:next,updatedAt:now,guideEdits:[...(old.guideEdits??[]),{at:now,reason:input.reason,guide:old.guide}]}})
  }
 }
 const pageAfter=(before,subjects)=>({...before,subjects,presentationRevision:(before.presentationRevision??0)+1,presentationEdits:[...(before.presentationEdits??[]),{at:now,reason:input.reason,taskIds:input.changes.map(c=>c.taskId),previousRevision:before.presentationRevision??0}]})
 return {student:pageAfter(student,studentSubjects),parent:pageAfter(parent,parentSubjects),guideWrites}
}
/** Reads only supplied pages, their owner and explicitly edited closed guides. */
export async function editTaskPresentation(db,input,{apply=false,now=new Date().toISOString()}={}){
 validateInput(input)
 const refs=[db.doc(`dayOwners/${input.pageId}`),db.doc(`dayPages/${input.pageId}`),db.doc(`dayPages/${input.parentPageId}`)]
 const initial=await db.getAll(...refs)
 if(initial.some(s=>!s.exists))fail('Страница владельца или одна из двух ролей отсутствует.')
 assertOwner(input,...initial.map(s=>s.data()))
 const guideRefs=input.changes.filter(c=>Object.hasOwn(c,'guide')||Object.hasOwn(c,'stageAssessments')).map(c=>db.doc(`dayTaskGuides/${input.pageId}/items/${c.taskId}`))
 const targets=continuationTargets(input),continuationRefs=targets.flatMap(t=>[db.doc(`dayOwners/${t.dayToken}`),db.doc(`dayPages/${t.dayToken}`)])
 const extras=[...guideRefs,...continuationRefs],extraSnaps=extras.length?await db.getAll(...extras):[]
 const guideEnd=3+guideRefs.length,allRefs=[...refs,...extras],before=[...initial,...extraSnaps]
 assertContinuation(input,targets,before.slice(guideEnd))
 const prepared=prepare(input,before.slice(0,guideEnd),now)
 if(!apply)return {valid:true,applied:false,changes:input.changes.length,guides:guideRefs.length}
 await db.runTransaction(async tx=>{
  const fresh=await tx.getAll(...allRefs)
  if(fresh.some((s,i)=>!s.exists||!sameVersion(s.updateTime,before[i].updateTime)||!same(s.data(),before[i].data())))fail('CAS: данные изменились после проверки; перечитайте пакет.')
  assertContinuation(input,targets,fresh.slice(guideEnd))
  const next=prepare(input,fresh.slice(0,guideEnd),now)
  tx.update(refs[1],{subjects:next.student.subjects,presentationRevision:next.student.presentationRevision,presentationEdits:next.student.presentationEdits})
  tx.update(refs[2],{subjects:next.parent.subjects,presentationRevision:next.parent.presentationRevision,presentationEdits:next.parent.presentationEdits})
  for(const g of next.guideWrites)tx.update(g.ref,{guide:g.after.guide,updatedAt:g.after.updatedAt,guideEdits:g.after.guideEdits})
 })
 const after=await db.getAll(refs[1],refs[2],...guideRefs),expected=[prepared.student,prepared.parent,...guideRefs.map((ref,i)=>prepared.guideWrites.find(g=>g.ref.path===ref.path)?.after??extraSnaps[i].data())]
 if(after.some((s,i)=>!s.exists||!same(s.data(),expected[i])))fail('Readback: представление или сохранённые поля не совпали после записи.')
 return {applied:true,verified:true,changes:input.changes.length,guides:guideRefs.length,presentationRevision:prepared.student.presentationRevision}
}
