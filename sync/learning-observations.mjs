import {createHash} from 'node:crypto'
/** Addressed publication writes; observation is evidence, never a mastery claim.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md#knowledge */
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const segment=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)
const validObservation=value=>{if(!value)return false;const {id,supersedes:_supersedes,recordedAt:_recordedAt,...body}=value;return hash(body)===id}
export function learningObservation({owner,taskId,attemptRef,sourceRevision,criteria=[],outcome,scope='assignment',helpLevel='unknown',supersedes=null,correctionReason=null}){
 if(!segment(owner?.familyId)||!segment(owner?.childId)||!taskId||!attemptRef||!['assignment','micro-step','source-material'].includes(scope))throw Error('Наблюдение требует владельца, адресную попытку и область.')
 const evidence={schemaVersion:1,owner:{familyId:owner.familyId,childId:owner.childId},taskId,attemptRef,sourceRevision:sourceRevision??null,scope,helpLevel,outcome,
  criteria:criteria.map(c=>({id:c.id,skillId:c.skillId,skillLabel:c.skillLabel,result:c.finding.result,evidenceRef:c.finding.uploadId,location:c.finding.location,observation:c.finding.observation??null,score:c.finding.score??null,maxPoints:c.finding.maxPoints??null})),correctionReason,mastery:'not-inferred'}
 return {...evidence,supersedes,id:hash(evidence)}
}
/** Exact preflight reads; immutable evidence and skill pointers commit with the result.
 * A concurrent change fails the caller's entire batch instead of losing history. */
export async function prepareLearningWrites(db,observations,now){
 if(observations.some(o=>!validObservation(o)))throw Error('Наблюдение изменилось после проверки.')
 const records=[...new Map(observations.map(o=>[o.id,o])).values()]
 const entries=records.map(o=>({observation:o,ref:db.doc(`families/${o.owner.familyId}/children/${o.owner.childId}/learningEvidence/${o.id}`)}))
 const current=entries.length?await db.getAll(...entries.map(e=>e.ref)):[]
 if(current.some((s,i)=>s.exists&&(!validObservation(s.data())||s.data().id!==entries[i].observation.id)))throw Error('Сохранённое свидетельство не совпадает с адресной попыткой.')
 const newEntries=entries.filter((e,i)=>!current[i].exists)
 const skillEntries=new Map()
 for(const entry of newEntries)for(const c of entry.observation.criteria){
  if(!segment(c.skillId))throw Error('Некорректный ID навыка.')
  const path=`families/${entry.observation.owner.familyId}/children/${entry.observation.owner.childId}/skills/${c.skillId}`
  const previous=skillEntries.get(path)
  const outcomes=[...new Set([...(previous?.outcomes??[]),c.result])]
  skillEntries.set(path,{ref:db.doc(path),data:{skillId:c.skillId,label:c.skillLabel,lastEvidenceId:entry.observation.id,lastOutcome:outcomes.length===1?outcomes[0]:'mixed',scope:entry.observation.scope,helpLevel:entry.observation.helpLevel,updatedAt:now},outcomes,ids:[...(previous?.ids??[]),entry.observation.id]})
 }
 const skills=[...skillEntries.values()],snapshots=skills.length?await db.getAll(...skills.map(e=>e.ref)):[]
 return {paths:entries.map(e=>e.ref.path),stage(writer){
  for(const e of newEntries)writer.create(e.ref,{...e.observation,recordedAt:now})
  for(const [i,e] of skills.entries()){
   const data={...e.data,evidenceIds:[...new Set([...(snapshots[i].data()?.evidenceIds??[]),...e.ids])].slice(-20)}
   if(snapshots[i].exists)writer.update(e.ref,data,{lastUpdateTime:snapshots[i].updateTime});else writer.create(e.ref,data)
  }
 },async verify(){
  const saved=entries.length?await db.getAll(...entries.map(e=>e.ref)):[]
  if(saved.some((s,i)=>!s.exists||!validObservation(s.data())||s.data().id!==entries[i].observation.id||s.data().owner?.familyId!==entries[i].observation.owner.familyId||s.data().owner?.childId!==entries[i].observation.owner.childId))throw Error('Запись знаний не подтверждена адресным readback.')
  return {observations:entries.length,verified:true}
 }}
}
