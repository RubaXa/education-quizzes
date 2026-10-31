import { historyDigest, studentHistory, validateHistoryCompetition } from './history.mjs'
import { projectPreparation, validatePreparationRoute } from './preparation.mjs'
/** Atomic updater in the existing event worker; all reads are child/route scoped.
 * @see ../docs/modules/assessments/olympiad-history.md#обновление-после-проверки */
const segment=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(v))throw Error('preparation_scope_invalid');return v}
const root=(familyId,childId)=>`families/${segment(familyId)}/children/${segment(childId)}`
function available(task,owner,familyId,childId,competition){
 return task?.familyId===familyId&&task?.childId===childId&&task.sourceSystem==='family'&&task.publication==='active'
  &&task.optional===true&&task.learningContext?.kind==='olympiad'&&[competition.id,...competition.aliases].includes(task.learningContext.id)
  &&owner?.familyId===familyId&&owner?.childId===childId
}
export async function refreshOlympiadPreparation({db,familyId,childId,configurations=null,apply=true,trigger=null}){
 const base=root(familyId,childId),expected=[]
 const receipt=await db.runTransaction(async tx=>{
  const child=await tx.get(db.doc(base));if(!child.exists||child.data().active===false)throw Error('preparation_child_unavailable')
  const stored=await tx.get(db.collection(`${base}/preparationRoutes`).limit(11))
  if(stored.size>10)throw Error('preparation_routes_limit')
  const routes=configurations??stored.docs.map(s=>s.data())
  if(routes.length>10)throw Error('preparation_routes_limit')
  const pending=[];expected.length=0
  for(const route of routes){
   const id=segment(route.competitionId),parentRef=db.doc(`${base}/olympiadHistory/${id}/views/parent`)
   const [parent,student]=await Promise.all([tx.get(parentRef),tx.get(db.doc(`${base}/olympiadHistory/${id}/views/student`))])
   const old=parent.data(),competition=old?.competition
   if(!competition||!student.exists||old.familyId!==familyId||old.childId!==childId)throw Error('preparation_history_missing')
   validatePreparationRoute(route,competition)
   if(configurations&&route.expectedDigest!==old.digest&&historyDigest(route)!==historyDigest(stored.docs.find(s=>s.id===id)?.data()??{}))throw Error('preparation_configuration_changed')
   const states={}
   for(const c of route.candidates){
    const [task,owner,review,decisions]=await Promise.all([
     tx.get(db.doc(`${base}/tasks/${c.taskId}`)),tx.get(db.doc(`dayOwners/${c.dayToken}`)),
     tx.get(db.doc(`dayProgress/${c.dayToken}/items/${c.taskId}`)),
     tx.get(db.collection(`dayParentDecisions/${c.dayToken}/events`).where('taskId','==',c.taskId).limit(501)),
    ])
    if(decisions.size>500)throw Error('preparation_decisions_limit')
    const valid=available(task.data(),owner.data(),familyId,childId,competition)
    if(configurations&&!valid)throw Error('preparation_task_scope_invalid')
    const r=review.data()
    states[c.taskId]={available:valid,review:r?.taskId===c.taskId?r:null,decisions:decisions.docs.map(s=>({...s.data(),id:s.id}))}
   }
   const next={...competition,preparation:projectPreparation(route,states,competition.preparation)}
   validateHistoryCompetition(next)
   const digest=historyDigest(next),changed=digest!==old.digest
   if(configurations)pending.push({path:`${base}/preparationRoutes/${id}`,body:route})
   if(!changed)continue
   const revision=`${base}/olympiadHistory/${id}/revisions/${old.digest}`
   pending.push({path:`${revision}-parent`,body:old},{path:`${revision}-student`,body:student.data()})
   const common={schemaVersion:1,familyId,childId,digest,supersedes:old.digest,correctionReason:'Обновление подготовки по текущим проверенным работам.'}
   pending.push({path:parentRef.path,body:{...common,competition:next}},
    {path:`${base}/olympiadHistory/${id}/views/student`,body:{...common,competition:studentHistory(next)}},
    {path:`${base}/preparationRoutes/${id}/updates/${digest}`,body:{schemaVersion:1,previousDigest:old.digest,digest,trigger:trigger??'operator',preparation:next.preparation}})
  }
  // All reads precede writes. Concurrent review/configuration/import changes retry the transaction.
  for(const item of pending){
   if(item.path.includes('/revisions/')||item.path.includes('/updates/')){
    if((await tx.get(db.doc(item.path))).exists)continue
   }
   expected.push(item)
  }
  if(apply)for(const item of expected)tx.set(db.doc(item.path),item.body)
  return {mode:apply?'apply':'plan',routes:routes.length,writes:pending.length}
 })
 if(apply)for(const item of expected){const got=await db.doc(item.path).get();if(historyDigest(got.data())!==historyDigest(item.body)){
  // Another valid review may already have advanced a live view; immutable journal remains the receipt.
  if(!item.path.includes('/views/'))throw Error('preparation_readback_failed')
 }}
 return {...receipt,verified:apply}
}
export function createPreparationEventHandler(db){
 return async event=>{
  if(event.source!=='firestore')return {state:'complete'}
  const review=event.eventType==='review.published',pattern=review?/^dayProgress\/([^/]+)\/items\/([^/]+)$/:/^dayParentDecisions\/([^/]+)\/events\/([^/]+)$/
  const match=pattern.exec(event.sourceRef?.documentPath??'')
  if(!match||event.sourceRef?.dayToken&&event.sourceRef.dayToken!==match[1]||review&&event.sourceRef?.taskId&&event.sourceRef.taskId!==match[2])return {state:'blocked',safeErrorCode:'preparation_source_invalid'}
  const owner=(await db.doc(`dayOwners/${match[1]}`).get()).data()
  if(owner?.familyId!==event.familyId||owner?.childId!==event.childId)return {state:'blocked',safeErrorCode:'preparation_owner_mismatch'}
  await refreshOlympiadPreparation({db,familyId:event.familyId,childId:event.childId,trigger:event.eventId})
  return {state:'complete'}
 }
}
