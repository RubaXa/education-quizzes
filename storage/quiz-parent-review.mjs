/** Addressed parent-only publication; no assessment or learner mutation.
 * @see ../docs/modules/reviews/parent-review.md */
/** @see ../docs/decisions/parent-review-pilot-2026-11-17.md */
import {grade} from '../src/lib/quiz.ts'
import {privateQuizKey} from '../assessment/manual-review-contract.mjs'
import {guidanceFingerprint} from './guidance-correction.mjs'
import {parentReviewContext,parentReviewErrors} from '../packages/education-presentation/parent-review.mjs'
import {sameReviewValue} from '../packages/education-presentation/review-reply.mjs'
import {isActiveFamilyChild} from '../packages/education-runtime/identity.mjs'
const segment=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const equal=(a,b)=>guidanceFingerprint(a)===guidanceFingerprint(b)
function address(input){if(!segment(input?.quizToken)||!segment(input.questionId))throw Error('Нужны один тест и точный вопрос.')}
async function read(db,input,tx){
 address(input)
 const paths={assignment:`assignments/${input.quizToken}`,key:`answerKeys/${input.quizToken}`,review:`reviews/${input.quizToken}`,privateReview:`quizReviewPrivate/${input.quizToken}`,parent:`quizParentReviews/${input.quizToken}/items/${input.questionId}`,archive:`quizParentReviewPrivate/${input.quizToken}/items/${input.questionId}`}
 const refs=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,db.doc(p)])),values={}
 for(const [k,ref] of Object.entries(refs)){const s=await (tx?tx.get(ref):ref.get());values[k]=s.exists?s.data():null}
 const a=values.assignment
 if(!a||a.status!=='submitted'||!segment(a.familyId)||!segment(a.childId)||!values.key)throw Error('Нужна существующая сданная попытка с владельцем и ключом.')
 for(const [k,p] of Object.entries({family:`families/${a.familyId}`,child:`families/${a.familyId}/children/${a.childId}`})){refs[k]=db.doc(p);const s=await (tx?tx.get(refs[k]):refs[k].get());values[k]=s.exists?s.data():null}
 if(!isActiveFamilyChild({familyId:a.familyId,childId:a.childId,family:values.family,child:values.child}))throw Error('Владелец недоступен.')
 const r=grade(a,privateQuizKey(values.key,values.privateReview),values.privateReview?.entries?values.privateReview:values.review).find(r=>r.question.id===input.questionId)
 if(!r||r.excluded||r.skipped||r.points===null)throw Error('Вопрос исключён, пропущен или ещё не проверен.')
 if(values.parent&&(values.parent.familyId!==a.familyId||values.parent.childId!==a.childId))throw Error('Родительский документ другого владельца.')
 if(values.archive&&(values.archive.familyId!==a.familyId||values.archive.childId!==a.childId))throw Error('История родительского разбора другого владельца.')
 const expected=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,guidanceFingerprint(v)]))
 return {refs,values,expected,result:r}
}
export async function exportQuizParentReview(db,input){
 const s=await read(db,input),a=s.values.assignment
 return {schemaVersion:1,privateOnly:true,quizToken:input.quizToken,questionId:input.questionId,familyId:a.familyId,childId:a.childId,expected:s.expected,assignment:a,result:s.result,parent:s.values.parent,context:parentReviewContext(s.result,a.submittedAt)}
}
function plan(input,s,now){
 const allowed=['schemaVersion','quizToken','questionId','familyId','childId','expected','analysis','reason','sourceEvidence','semanticChecked','sourceChecked','studentSafetyChecked']
 if(!object(input)||Object.keys(input).some(k=>!allowed.includes(k))||input.schemaVersion!==1||typeof input.reason!=='string'||input.reason.trim().length<20||input.reason.length>1200
  ||input.semanticChecked!==true||input.sourceChecked!==true||input.studentSafetyChecked!==true||!Array.isArray(input.sourceEvidence)||!input.sourceEvidence.length||input.sourceEvidence.some(v=>typeof v!=='string'||!v.trim()))throw Error('Нужен проверенный адресный пакет родительского разбора с источником и причиной.')
 const errors=parentReviewErrors(input.analysis);if(errors.length)throw Error(errors.join('\n'))
 const a=s.values.assignment
 if(a.familyId!==input.familyId||a.childId!==input.childId||!equal(input.expected,s.expected))throw Error('Попытка, владелец, ключ или прежний разбор изменились; нужен свежий экспорт.')
 if(input.analysis.answer.trim()===s.result.guidance?.question?.trim())throw Error('Правильный ответ нельзя заменить вопросом ученику.')
 const base={schemaVersion:1,quizToken:input.quizToken,questionId:input.questionId,familyId:a.familyId,childId:a.childId,context:parentReviewContext(s.result,a.submittedAt),analysis:input.analysis}
 const old=s.values.parent,unchanged=old&&Object.entries(base).every(([k,v])=>equal(old[k],v))
 const next={...base,revision:(old?.revision??0)+1,updatedAt:now}
 const historyId=guidanceFingerprint({expected:input.expected,analysis:input.analysis,reason:input.reason})
 const history={at:now,reason:input.reason,sourceEvidence:input.sourceEvidence,expected:input.expected,semanticChecked:true,sourceChecked:true,studentSafetyChecked:true,previous:old,published:next}
 const archive={familyId:a.familyId,childId:a.childId,quizToken:input.quizToken,questionId:input.questionId,revision:next.revision,historyId}
 return {next,archive,history,historyId,unchanged:Boolean(unchanged)}
}
export async function publishQuizParentReview(db,input,{apply=false,now=new Date()}={}){
 address(input)
 if(!apply){const s=await read(db,input),p=plan(input,s,now);return {valid:true,applied:false,unchanged:p.unchanged,questionId:input.questionId}}
 const result=await db.runTransaction(async tx=>{
  const s=await read(db,input,tx),p=plan(input,s,now)
  if(!p.unchanged){tx.set(s.refs.parent,p.next);tx.set(s.refs.archive,p.archive);tx.create(db.doc(`${s.refs.archive.path}/history/${p.historyId}`),p.history)}
  return {paths:{parent:s.refs.parent.path,archive:s.refs.archive.path},document:p.unchanged?s.values.parent:p.next,archive:p.unchanged?s.values.archive:p.archive,source:s.expected,unchanged:p.unchanged}
 })
 const fresh=await read(db,input)
 if(!sameReviewValue(fresh.values.parent,result.document))throw Error('Readback родительского документа не совпал.')
 if(!sameReviewValue(fresh.values.archive,result.archive))throw Error('Readback указателя истории не совпал.')
 if(!segment(result.archive?.historyId))throw Error('Не найдена сохранённая история разбора.')
 const history=await db.doc(`${result.paths.archive}/history/${result.archive.historyId}`).get()
 if(!history.exists||!sameReviewValue(history.data().published,result.document))throw Error('Readback опубликованной версии истории не совпал.')
 for(const k of ['assignment','key','review','privateReview','family','child'])if(fresh.expected[k]!==result.source[k])throw Error('Во время публикации изменился источник; проверьте новую версию.')
 return {valid:true,applied:!result.unchanged,verified:true,unchanged:result.unchanged,questionId:input.questionId,path:result.paths.parent,attemptChanged:false,gradeChanged:false,learnerChanged:false}
}
