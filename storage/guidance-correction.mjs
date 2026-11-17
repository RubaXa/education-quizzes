/** @see ../docs/decisions/stale-guidance-safety-correction-2026-11-17.md */
import {createHash} from 'node:crypto'
/** Addressed correction of stale public help; archived prose is adult-only.
 * @see ../docs/modules/reviews/subject-aware-guidance.md#guidance-correction */
const segment=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)
const taskId=v=>typeof v==='string'&&/^[a-z0-9-]{1,120}$/.test(v)
const canonical=v=>{
 if(v&&typeof v==='object'&&Number.isInteger(v.seconds??v._seconds)&&Number.isInteger(v.nanoseconds??v._nanoseconds))return {seconds:v.seconds??v._seconds,nanoseconds:v.nanoseconds??v._nanoseconds}
 return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
}
export const guidanceFingerprint=v=>createHash('sha256').update(JSON.stringify(canonical(v??null))).digest('hex')
const same=(a,b)=>guidanceFingerprint(a)===guidanceFingerprint(b)
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max
function target(page,id){return page?.subjects?.flatMap(s=>s.tasks??[]).find(t=>t.id===id||t.problems?.some(p=>p.id===id))}
function query(db,input){return db.collection(`dayGuidance/${input.studentToken}/items`).where('taskId','==',input.taskId).limit(100)}
function refs(db,input){return ['dayOwners/'+input.studentToken,'dayPages/'+input.studentToken,`dayTaskGuides/${input.studentToken}/items/${input.taskId}`,`dayReviewPrivate/${input.studentToken}/items/${input.taskId}`,`dayProgress/${input.studentToken}/items/${input.taskId}`].map(p=>db.doc(p))}
function address(input){if(!segment(input?.studentToken)||!taskId(input?.taskId))throw Error('Нужны один ученический день и точный taskId.')}
async function read(db,input,tx){
 address(input)
 const r=refs(db,input)
 const [snaps,events]=await Promise.all([Promise.all(r.map(ref=>tx?tx.get(ref):ref.get())),tx?tx.get(query(db,input)):query(db,input).get()])
 if(events.docs.length>=100)throw Error('Достигнут предел100 событий; полнота неизвестна, частичный экспорт запрещён.')
 const [owner,page,guide,privateReview,publicReview]=snaps.map(s=>s.data()??null)
 if(!owner?.familyId||!owner?.childId||page?.kind!=='student'||page.familyId!==owner.familyId||page.childId!==owner.childId||!target(page,input.taskId)
  ||owner.date!==undefined&&owner.date!==page.date||owner.targetDate!==undefined&&owner.targetDate!==page.targetDate||!guide?.guide||guide.familyId!==owner.familyId||guide.childId!==owner.childId||guide.taskId!==input.taskId
  ||publicReview?.taskId!==input.taskId||privateReview&&privateReview.taskId!==input.taskId||!publicReview?.studentFeedback?.question)throw Error('Владелец, задание, закрытый guide или текущий вопрос разбора не подтверждены.')
 if([privateReview,publicReview].filter(Boolean).some(r=>r.familyId!==undefined&&r.familyId!==owner.familyId||r.childId!==undefined&&r.childId!==owner.childId))throw Error('Разбор принадлежит другому владельцу.')
 const values={owner,page,guide,privateReview,publicReview}
 const rows=events.docs.map(s=>({eventId:s.id,guidance:s.data(),fingerprint:guidanceFingerprint(s.data())})).sort((a,b)=>a.eventId.localeCompare(b.eventId))
 if(rows.some(r=>r.guidance.taskId!==input.taskId))throw Error('Чужое событие в адресном наборе.')
 const expected={...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,guidanceFingerprint(v)])),events:guidanceFingerprint(rows.map(r=>[r.eventId,r.fingerprint])),reviewVersion:canonical({checkedAt:publicReview.checkedAt??null,correctedAt:publicReview.correctedAt??null})}
 return {r,snaps,values,rows,expected}
}
export async function exportGuidanceCorrection(db,input){
 const state=await read(db,input)
 return {schemaVersion:1,privateOnly:true,studentToken:input.studentToken,taskId:input.taskId,familyId:state.values.owner.familyId,childId:state.values.owner.childId,date:state.values.page.date,targetDate:state.values.page.targetDate,expected:state.expected,events:state.rows,currentReview:state.values.publicReview,privateReview:state.values.privateReview,guide:state.values.guide.guide}
}
function plan(input,state,now){
 if(!keys(input,['schemaVersion','studentToken','taskId','familyId','childId','date','targetDate','expected','stageId','eventIds','text','reason','semanticSafetyReviewed'])||input.schemaVersion!==1||!segment(input.stageId)||!text(input.reason,20,1000)||input.semanticSafetyReviewed!==true
  ||!Array.isArray(input.eventIds)||!input.eventIds.length||input.eventIds.length>100||new Set(input.eventIds).size!==input.eventIds.length||!input.eventIds.every(segment))throw Error('Нужен явный однопредметный пакет событий, причина и подтверждённая агентом проверка безопасности.')
 const {owner,page,guide,publicReview}=state.values
 if(input.familyId!==owner.familyId||input.childId!==owner.childId||input.date!==page.date||input.targetDate!==page.targetDate||!same(input.expected,state.expected))throw Error('Ожидаемые владелец, день, guide, события или версия текущего разбора изменились; нужен свежий экспорт.')
 const q=publicReview.studentFeedback.question,b=publicReview.studentFeedback.bridge
 if(!text(input.text,8,420)||![q,...(b?[`${b}\n${q}`]:[])].includes(input.text))throw Error('Разрешён только текущий вопрос или текущая опора и вопрос; безопасность смысла проверяет агент.')
 if(!guide.guide.stages?.some(s=>s.id===input.stageId))throw Error('Этап отсутствует в текущем закрытом guide.')
 const selected=state.rows.filter(r=>input.eventIds.includes(r.eventId))
 if(selected.length!==input.eventIds.length||selected.some(r=>r.guidance.stageId!==input.stageId||r.guidance.reviewResponse||r.guidance.stageId==='help-response'))throw Error('Каждый явный event должен относиться к тому же выбранному этапу, без ответа на микро-попытку.')
 if(state.rows.some(r=>r.guidance.stageId===input.stageId&&r.guidance.level==='reveal'&&!input.eventIds.includes(r.eventId)))throw Error('Остался другой reveal того же этапа, доступный в предыдущей помощи; выберите все такие события.')
 const preserve=['taskId','stageId','stageIndex','guideRevision','actorPersonId','createdAt','eventOperationId','eventReceiptId','eventProducerVersion','sourceRequestEventId']
 const replacements=selected.map(r=>({eventId:r.eventId,previous:r.guidance,next:{...Object.fromEntries(preserve.filter(k=>r.guidance[k]!==undefined).map(k=>[k,r.guidance[k]])),level:'hint',text:input.text}}))
 if(replacements.some(r=>!r.next.actorPersonId||r.next.createdAt===undefined||!Number.isInteger(r.next.stageIndex)))throw Error('У исходного события нет подтверждённых автора, времени или индекса этапа.')
 const correction={id:guidanceFingerprint(input),reason:input.reason,semanticSafetyReviewed:true,originallyLearnerReadable:true,unaided:'not-inferred',expected:input.expected,stageId:input.stageId,correctedAt:now,events:replacements.map(r=>({eventId:r.eventId,previous:r.previous,previousFingerprint:guidanceFingerprint(r.previous),replacementFingerprint:guidanceFingerprint(r.next)}))}
 return {replacements,guide:{...guide,guidanceCorrections:[...(guide.guidanceCorrections??[]),correction]}}
}
export async function correctGuidance(db,input,{apply=false,now}={}){
 address(input)
 if(!apply){const state=await read(db,input),p=plan(input,state,now??null);return {valid:true,applied:false,taskId:input.taskId,events:p.replacements.map(r=>r.eventId)}}
 const committed=await db.runTransaction(async tx=>{
  const state=await read(db,input,tx),p=plan(input,state,now)
  tx.set(state.r[2],p.guide)
  for(const r of p.replacements)tx.set(db.doc(`dayGuidance/${input.studentToken}/items/${r.eventId}`),r.next)
  return {state,p}
 })
 const current=await read(db,input),{state,p}=committed
 if(!same(current.values.guide,p.guide)||!['owner','page','privateReview','publicReview'].every(k=>same(current.values[k],state.values[k]))
  ||current.rows.length!==state.rows.length||!current.rows.every(r=>same(r.guidance,p.replacements.find(n=>n.eventId===r.eventId)?.next??state.rows.find(n=>n.eventId===r.eventId)?.guidance)))throw Error('Адресный readback коррекции не совпал; не повторяйте запись без свежего экспорта.')
 return {valid:true,applied:true,verified:true,taskId:input.taskId,events:p.replacements.map(r=>r.eventId),attemptCreated:false,guideChanged:false}
}
