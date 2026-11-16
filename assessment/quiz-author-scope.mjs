/** @see ../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
/** Explicit author-error correction; questions, responses and keys remain immutable.
 * @see ../docs/modules/assessments/quizzes.md#author-scope-correction
 */
import {createHash} from 'node:crypto'
import {isDeepStrictEqual as same} from 'node:util'
import {grade,summarize} from '../src/lib/quiz.ts'
import {quizSkillId} from './manual-review-contract.mjs'
import {learningObservation,prepareLearningWrites} from '../sync/learning-observations.mjs'
const segment=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
const text=v=>typeof v==='string'&&v.trim().length>0
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
export const authorScopeFingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest('hex')
const fail=message=>{throw Error(message)}
function assertContext(c){
 if(!c||![c.learnerToken,c.owner?.familyId,c.owner?.childId,c.source?.pageId,c.source?.taskId].every(segment)
  ||!Array.isArray(c.indexPaths)||c.indexPaths.length!==2||new Set(c.indexPaths).size!==c.indexPaths.length
  ||c.indexPaths.some(p=>!new RegExp(`^dashboard/[A-Za-z0-9_-]{1,128}/assignments/${c.learnerToken}$`).test(p)))fail('Нужны точные тест, владелец, источник и обе ролевые записи списка.')
}
function assertOwned(value,owner){if(!value||value.familyId!==owner.familyId||value.childId!==owner.childId)fail('Тест или источник принадлежит другому владельцу.')}
function assertBoardOwner(value,context){
 if(!value||['familyId','childId'].some(k=>value[k]!==undefined&&value[k]!==context.owner[k]))fail('Ролевой board принадлежит другому владельцу.')
 if((value.familyId===undefined||value.childId===undefined)&&!same(context.legacyBoardOwner,context.owner))fail('Владелец legacy board не подтверждён закрытым реестром.')
}
function sourceTask(page,id){const hits=[];for(const s of page.subjects??[])for(const t of s.tasks??[]){if(t.id===id)hits.push(t);for(const p of t.problems??[])if(p.id===id)hits.push({...t,...p})}if(hits.length!==1)fail('Точный источник задания отсутствует или неоднозначен.');return hits[0]}
async function capture(db,context){
 assertContext(context)
 const token=context.learnerToken,refs=[db.doc(`assignments/${token}`),db.doc(`answerKeys/${token}`),db.doc(`reviews/${token}`),db.doc(`quizReviewPrivate/${token}`)]
 const core=await db.getAll(...refs),assignment=core[0].data();if(!core[0].exists||!core[1].exists)fail('Назначение или ключ отсутствует.')
 assertOwned(assignment,context.owner)
 for(const s of [core[3]])if(s.exists&&(s.data().familyId!==undefined||s.data().childId!==undefined))assertOwned(s.data(),context.owner)
 const indexRefs=context.indexPaths.map(p=>db.doc(p)),indexes=await db.getAll(...indexRefs)
 if(indexes.some(s=>!s.exists||s.data().testId!==assignment.testId||!segment(s.data().previewToken)))fail('Не все ролевые индексы связаны с этим тестом.')
 for(const s of indexes)if(s.data().familyId!==undefined||s.data().childId!==undefined)assertOwned(s.data(),context.owner)
 const previewToken=indexes[0].data().previewToken;if(indexes.some(s=>s.data().previewToken!==previewToken))fail('Индексы указывают на разные предпросмотры.')
 const extraRefs=[db.doc(`previews/${previewToken}`),db.doc(`dayOwners/${context.source.pageId}`),db.doc(`dayPages/${context.source.pageId}`),...context.indexPaths.map(p=>db.doc(p.split('/').slice(0,2).join('/')))]
 const extras=await db.getAll(...extraRefs);if(extras.some(s=>!s.exists))fail('Предпросмотр или точное назначение отсутствует.')
 const preview=extras[0].data(),owner=extras[1].data(),page=extras[2].data();assertOwned(owner,context.owner);assertOwned(page,context.owner)
 for(const [i,header] of extras.slice(3).entries()){assertBoardOwner(header.data(),context);if(header.data().kind!==['student','parent'][i])fail('Роль ролевого списка не подтверждена заголовком board.')}
 if(page.kind!=='student'||preview.testId!==assignment.testId||!same(preview.questions,assignment.questions))fail('Исходная ролевaя проекция не совпадает с тестом.')
 const task=sourceTask(page,context.source.taskId)
 if(task.testToken!==token&&!page.testPlacements?.some(p=>p.token===token&&p.taskId===context.source.taskId))fail('Тест не связан с указанным текущим назначением.')
 const exactText=task.familyOrigin?task.detail:task.meshText
 if(!text(exactText))fail('Нет точного текста учителя или прямого семейного назначения.')
 const allRefs=[...refs,...indexRefs,...extraRefs],snapshots=[...core,...indexes,...extras]
 const state=snapshots.map((s,i)=>({path:allRefs[i].path,exists:s.exists,data:s.exists?s.data():null}))
 return {context,refs:allRefs,snapshots,state,assignment,key:core[1].data(),review:core[2].data(),privateReview:core[3].data(),indexCount:indexes.length,authority:{kind:task.familyOrigin?'family':'mesh',exactText},fingerprint:authorScopeFingerprint(state)}
}
export async function exportAuthorScope(db,context){const c=await capture(db,context);return {version:1,context,fingerprint:c.fingerprint,testId:c.assignment.testId,authority:c.authority,reason:'',exclusions:[],snapshot:c.state}}
/** A fresh source-bound export is mandatory; the proposed list is additive only. */
export async function correctAuthorScope(db,request,{apply=false,now=new Date().toISOString()}={}){
 const c=await capture(db,request?.context)
 if(request?.version!==1||request.testId!==c.assignment.testId||request.fingerprint!==c.fingerprint||!same(request.authority,c.authority))fail('Экспорт устарел: попытка, ключ, источник или ролевые индексы изменились.')
 if(!text(request.reason)||request.reason.trim().length<20||!Array.isArray(request.exclusions)||!request.exclusions.length||new Set(request.exclusions.map(x=>x.questionId)).size!==request.exclusions.length)fail('Нужны причина авторской ошибки и отдельное доказательство каждого исключения.')
 if(c.assignment.status!=='submitted'&&!c.assignment.startedAt&&!Object.values(c.assignment.answers??{}).some(v=>Array.isArray(v)?v.length:typeof v==='string'&&v.trim()))fail('Для не начатого теста используйте авторскую ревизию исходного spec.')
 const previous=c.assignment.authorScopeExclusions??{version:1,revision:0,questionIds:[]}
 if(previous.version!==1||!Array.isArray(previous.questionIds)||!Number.isInteger(previous.revision))fail('Повреждена прежняя коррекция объёма.')
 for(const e of request.exclusions){const q=c.assignment.questions.find(q=>q.id===e.questionId)
  if(!q||previous.questionIds.includes(q.id)||e.questionPrompt!==q.prompt||!text(e.scopeQuote)||!c.authority.exactText.includes(e.scopeQuote)||!text(e.explanation)||e.explanation.trim().length<20||!Array.isArray(e.evidenceRefs)||!e.evidenceRefs.length||e.evidenceRefs.some(r=>!text(r)))fail('Исключение требует текущий вопрос, точную цитату назначения и проверяемое основание выхода за его объём.')
 }
 const scope={version:1,revision:previous.revision+1,questionIds:[...previous.questionIds,...request.exclusions.map(e=>e.questionId)]}
 const before=summarize(grade(c.assignment,c.key,c.review)),after=summarize(grade({...c.assignment,authorScopeExclusions:scope},c.key,c.review))
 if(!apply)return {valid:true,applied:false,before,after,excludedQuestionIds:scope.questionIds}
 const correctionId=authorScopeFingerprint({fingerprint:c.fingerprint,reason:request.reason,exclusions:request.exclusions}),privateRef=c.refs[3],historyRef=db.doc(`${privateRef.path}/scopeHistory/${correctionId}`)
 const history=await db.getAll(historyRef);if(history[0].exists)fail('Коррекция уже записана; нужен новый экспорт.')
 const criteria=request.exclusions.flatMap(e=>{
  const q=c.assignment.questions.find(q=>q.id===e.questionId),rubric=c.privateReview?.rubrics?.[q.id]
  const skills=q.kind==='long'?(rubric??[]):[{id:q.id,skillId:quizSkillId(c.assignment.subject,q.topic??c.assignment.subject),skillLabel:q.topic??c.assignment.subject}]
  return skills.map(s=>({id:`${q.id}:${s.id}`,skillId:s.skillId,skillLabel:s.skillLabel,finding:{result:'unknown',uploadId:`answer:${q.id}`,location:`question:${q.id}`,observation:'Вопрос автора вне назначения; ответ сохранён, освоение по нему не оценивается.'}}))
 })
 const observation=learningObservation({owner:c.context.owner,taskId:c.assignment.testId,attemptRef:c.refs[0].path,sourceRevision:correctionId,criteria,outcome:'author-scope-corrected',helpLevel:'unknown',correctionReason:request.reason})
 const knowledge=await prepareLearningWrites(db,[observation],now)
 const privatePatch={authorScopeRevision:scope.revision,authorScopeHistory:[...(c.privateReview?.authorScopeHistory??[]),correctionId]}
 const archive={familyId:c.context.owner.familyId,childId:c.context.owner.childId,correctionId,reason:request.reason,authority:c.authority,exclusions:request.exclusions,previous:{scope:previous,assignmentFingerprint:authorScopeFingerprint(c.assignment),keyFingerprint:authorScopeFingerprint(c.key),reviewFingerprint:authorScopeFingerprint(c.review??null),exportFingerprint:c.fingerprint},before,after,observationId:observation.id,createdAt:now}
 await db.runTransaction(async tx=>{
  const docs=await tx.getAll(...c.refs,historyRef)
  if(docs.at(-1).exists||docs.slice(0,-1).some((s,i)=>s.exists!==c.snapshots[i].exists||s.exists&&(!s.updateTime.isEqual(c.snapshots[i].updateTime)||!same(s.data(),c.snapshots[i].data()))))fail('CAS: состояние изменилось; перечитайте точный экспорт.')
  tx.update(c.refs[0],{authorScopeExclusions:scope})
  for(const ref of c.refs.slice(4,4+c.indexCount))tx.update(ref,{authorScopeExclusions:scope})
  tx.update(c.refs[4+c.indexCount],{authorScopeExclusions:scope})
  if(c.snapshots[3].exists)tx.update(privateRef,privatePatch);else tx.create(privateRef,{...c.context.owner,...privatePatch})
  tx.create(historyRef,archive);knowledge.stage(tx)
 })
 const saved=await db.getAll(...c.refs,historyRef)
 for(const [i,s] of saved.slice(0,-1).entries()){
  let expected=c.state[i].data
  if(i===0||i>=4&&i<=4+c.indexCount)expected={...expected,authorScopeExclusions:scope}
  else if(i===3)expected={...(expected??c.context.owner),...privatePatch}
  if(s.exists!==(expected!==null)||!same(s.data()??null,expected))fail('Readback: содержимое, ответ, ключ или сохранённые ролевые поля не совпали.')
 }
 if(!same(saved.at(-1).data(),archive))fail('Закрытая история коррекции не подтверждена.')
 await knowledge.verify()
 return {applied:true,verified:true,correctionId,before,after,excludedQuestionIds:scope.questionIds}
}
