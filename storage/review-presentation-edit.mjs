/** @see ../docs/shared/design/student-review-step.md#addressed-presentation-migration */
/** @see ../docs/decisions/review-presentation-migration-2026-11-17.md */
import {guidanceFingerprint as hash} from './guidance-correction.mjs'
import {studentReviewProjection} from './review-projection.mjs'
import {tutoringPlanErrors} from './tutoring-decision.mjs'
import {reviewActivityValid} from '../packages/education-presentation/review-activity.mjs'
const same=(a,b)=>hash(a)===hash(b)
const text=(v,min=12,max=1000)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const segment=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
function address(input){if(!segment(input?.studentToken)||!/^[-a-z0-9]{1,120}$/.test(input?.taskId??''))throw Error('Нужны один день и точное задание.')}
function target(page,id){return page?.subjects?.flatMap(s=>s.tasks??[]).find(t=>t.id===id||t.problems?.some(p=>p.id===id))}
async function read(db,input,tx){
 address(input)
 const token=input.studentToken,id=input.taskId
 const refs=[`dayOwners/${token}`,`dayPages/${token}`,`dayTaskGuides/${token}/items/${id}`,`dayReviewPrivate/${token}/items/${id}`,`dayProgress/${token}/items/${id}`,`dayHelp/${token}/items/${id}`].map(p=>db.doc(p))
 const queries=[db.collection(`dayUploads/${token}/files`).limit(100),db.collection(`dayGuidance/${token}/items`).where('taskId','==',id).limit(100)]
 const [snaps,...sets]=await Promise.all([tx?tx.getAll(...refs):db.getAll(...refs),...queries.map(q=>tx?tx.get(q):q.get())])
 if(sets.some(s=>s.docs.length>=100))throw Error('Достигнут предел100; полнота адресного набора неизвестна.')
 const [owner,page,guide,privateReview,publicReview,help]=snaps.map(s=>s.data()??null)
 if(!owner?.familyId||!owner?.childId||page?.kind!=='student'||page.familyId!==owner.familyId||page.childId!==owner.childId||!target(page,id)
  ||owner.date!==undefined&&owner.date!==page.date||owner.targetDate!==undefined&&owner.targetDate!==page.targetDate
  ||!guide?.guide||guide.familyId!==owner.familyId||guide.childId!==owner.childId||guide.taskId!==id
  ||privateReview?.taskId!==id||publicReview?.taskId!==id||privateReview.planRevision!==publicReview.planRevision
  ||privateReview.familyId!==undefined&&privateReview.familyId!==owner.familyId||privateReview.childId!==undefined&&privateReview.childId!==owner.childId)throw Error('Владелец, исходное задание, guide или обе проверки не подтверждены.')
 const assignment=target(page,id),problem=assignment.problems?.find(p=>p.id===id)
 const sourceIdentity={assignmentId:assignment.id,teacherText:assignment.meshText??assignment.detail,original:problem?.original??null,materialLinks:page.materialLinks?.[assignment.id]??[],taskPageRefs:page.taskPageRefs?.[assignment.id]??[]}
 const values={owner,page,guide,privateReview,publicReview,help,uploads:sets[0].docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id.localeCompare(b.id)),guidance:sets[1].docs.map(d=>({id:d.id,data:d.data()})).sort((a,b)=>a.id.localeCompare(b.id))}
 return {refs,values,sourceIdentity,expected:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,hash(v)]))}
}
export async function exportReviewPresentation(db,input){const s=await read(db,input);return {schemaVersion:1,privateOnly:true,studentToken:input.studentToken,taskId:input.taskId,familyId:s.values.owner.familyId,childId:s.values.owner.childId,expected:s.expected,sourceIdentity:s.sourceIdentity,...s.values}}
function prepare(input,state,now){
 if(!keys(input,['schemaVersion','studentToken','taskId','familyId','childId','expected','sourceIdentity','reason','semanticSafetyReviewed','question','activity','responseCriterion','branches'])||input.schemaVersion!==1||!text(input.reason,20)||input.semanticSafetyReviewed!==true||!text(input.question,12,160)||!reviewActivityValid(input.activity)||!text(input.responseCriterion)
  ||!keys(input.branches,['correct','partial','stuck','ambiguous'])||!['correct','partial','stuck','ambiguous'].every(k=>text(input.branches[k])))throw Error('Разрешены только вопрос, activity и закрытые ветки с причиной и проверкой смысла.')
 const v=state.values,old=v.privateReview
 if(v.owner.familyId!==input.familyId||v.owner.childId!==input.childId||!same(state.expected,input.expected)||!same(input.sourceIdentity,state.sourceIdentity))throw Error('CAS: владелец, источник или адресные данные устарели; нужен свежий экспорт.')
 if(!['partial','needs-fix','cannot-assess'].includes(old.status)||old.purpose||!old.studentFeedback||!old.tutoringPlan)throw Error('Нужен существующий незавершённый разбор; новый зачёт этим путём запрещён.')
 if(!same(v.publicReview,studentReviewProjection(old)))throw Error('Исходная публичная проекция не совпала: сначала штатный аудит приватности.')
 const updated={...old,studentFeedback:{...old.studentFeedback,question:input.question,presentation:{...old.studentFeedback.presentation,version:1,activity:input.activity}},nextStep:input.question,tutoringPlan:{...old.tutoringPlan,responseCriterion:input.responseCriterion,branches:input.branches}}
 const errors=tutoringPlanErrors(updated);if(errors.length)throw Error(errors.join('\n'))
 const unchanged=same(updated.studentFeedback,old.studentFeedback)&&same(updated.tutoringPlan,old.tutoringPlan)&&updated.nextStep===old.nextStep
 if(unchanged)return {unchanged:true}
 const archive={at:now,reason:input.reason,sourceIdentity:state.sourceIdentity,sourcePlanRevision:v.page.planRevision,reviewPlanRevision:old.planRevision,priorStatus:old.status,priorFeedbackTitle:old.studentFeedback.title,studentFeedback:old.studentFeedback,responseCriterion:old.tutoringPlan.responseCriterion,branches:old.tutoringPlan.branches,presentationOnly:true,semanticSafetyReviewed:true}
 const privateReview={...updated,correctedAt:now,feedbackCorrections:[...(old.feedbackCorrections??[]),archive]}
 return {privateReview,publicReview:studentReviewProjection(privateReview),unchanged:false}
}
/** No grade, criteria, upload, attempt, event or learning writes are permitted here. */
export async function editReviewPresentation(db,input,{apply=false,now=null}={}){
 address(input)
 const state=await read(db,input),planned=prepare(input,state,now)
 if(!apply||planned.unchanged)return {valid:true,applied:false,unchanged:planned.unchanged,taskId:input.taskId}
 if(now===null)throw Error('Для записи нужна дата коррекции.')
 await db.runTransaction(async tx=>{const fresh=await read(db,input,tx),next=prepare(input,fresh,now);tx.set(fresh.refs[3],next.privateReview);tx.set(fresh.refs[4],next.publicReview)})
 const after=await read(db,input)
 if(!same(after.values.privateReview,planned.privateReview)||!same(after.values.publicReview,planned.publicReview)||!['owner','page','guide','help','uploads','guidance'].every(k=>same(after.values[k],state.values[k])))throw Error('Readback: коррекция или неизменные данные не совпали; нужен свежий экспорт.')
 return {valid:true,applied:true,verified:true,taskId:input.taskId,attemptCreated:false,learningChanged:false,gradeChanged:false}
}
