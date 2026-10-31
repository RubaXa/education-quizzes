import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { matchesPhoto } from '../storage/direct-upload.mjs'
import { mergeHistory, studentHistory, historyIndexEntry, validateHistoryCompetition, historyDigest } from './history.mjs'
/** Family originals use the existing storage port, never Disk.publish.
 * @see ../docs/modules/assessments/olympiad-history.md */
export async function importOlympiadHistory({db,disk,plan,apply=false,readBytes=readFile}){
 const {familyId,childId}=plan
 if(![familyId,childId].every(v=>/^[A-Za-z0-9_-]{1,120}$/.test(v)))throw Error('history_owner_invalid')
 const base=`families/${familyId}/children/${childId}`
 const child=await db.doc(base).get(),members=await db.collection(`families/${familyId}/members`).get()
 if(!child.exists||child.data().active===false||!members.docs.some(s=>{const m=s.data();return m.active===true&&m.role==='parent'&&m.childIds?.includes(childId)}))throw Error('history_owner_unconfirmed')
 if(!Array.isArray(plan.competitions)||plan.competitions.length>100||!Array.isArray(plan.files)||plan.files.length>500)throw Error('history_plan_too_large')
 const competitions=plan.competitions.map(validateHistoryCompetition)
 const files=new Map(),pendingUploads=[]
 for(const file of plan.files){
  if(!/^[a-f0-9]{64}$/.test(file.id)||file.id!==file.sha256||files.has(file.id)||typeof file.studentVisible!=='boolean')throw Error('history_file_invalid')
  const bytes=await readBytes(file.localPath)
  if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('history_file_hash_mismatch')
  if(!matchesPhoto(bytes,file))throw Error('history_file_content_invalid')
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}[file.contentType]
  if(!extension)throw Error('history_file_type_invalid')
  const path=`app:/PETR/Семьи/${familyId}/${childId}/АрхивОлимпиад/${file.sha256}.${extension}`
  const metadata={familyId,childId,sha256:file.sha256,size:file.size,contentType:file.contentType,name:file.name,studentVisible:file.studentVisible,path}
  const previous=await db.doc(`${base}/learningFiles/${file.id}`).get()
  if(previous.exists&&!isDeepStrictEqual(previous.data(),metadata))throw Error('history_file_metadata_conflict')
  pendingUploads.push({id:file.id,path,bytes,metadata,exists:previous.exists})
  files.set(file.id,metadata)
 }
 for(const c of competitions)for(const s of c.seasons)for(const stage of s.stages)for(const file of stage.files){const registered=files.get(file.id);if(!registered||registered.studentVisible!==file.studentVisible||registered.contentType!==file.contentType||registered.name!==file.name||registered.size!==file.size)throw Error('history_file_reference_invalid')}
 if(apply)for(const file of pendingUploads){await disk.putAt(file.path,file.bytes,createHash('md5').update(file.bytes).digest('hex'));if(!file.exists)await db.doc(`${base}/learningFiles/${file.id}`).create(file.metadata)}
 const expected=[]
 const receipt=await db.runTransaction(async tx=>{
  const indexRef=db.doc(`${base}/learningHistory/olympiads`),indexSnap=await tx.get(indexRef)
  const snapshots=await Promise.all(competitions.map(c=>tx.get(db.doc(`${base}/olympiadHistory/${c.id}/views/parent`))))
  const entries=new Map((indexSnap.data()?.entries??[]).map(e=>[e.id,e]));const staged=[],conflicts=[]
  for(let i=0;i<competitions.length;i++){
   const previous=snapshots[i].data(),expectedDigest=plan.expectedDigests?.[competitions[i].id]
   const correcting=expectedDigest!==undefined&&expectedDigest===previous?.digest
   if(expectedDigest!==undefined&&!correcting&&previous?.digest!==historyDigest(competitions[i]))throw Error('history_correction_revision_changed')
   if(correcting&&(typeof plan.correctionReason!=='string'||plan.correctionReason.length<20))throw Error('history_correction_reason_required')
   let merged
   try{merged=mergeHistory(previous?.competition,competitions[i],{correctExisting:correcting})}
   catch(error){if(apply||!['history_stage_conflict','history_season_conflict'].includes(error.message))throw error;conflicts.push({id:competitions[i].id,code:error.message});merged=previous.competition}
   const digest=historyDigest(merged)
   entries.set(merged.id,historyIndexEntry(merged))
   const changed=previous?.digest&&previous.digest!==digest
   for(const role of ['parent','student']){
    if(changed)staged.push({path:`${base}/olympiadHistory/${merged.id}/revisions/${previous.digest}-${role}`,body:{...previous,competition:role==='student'?studentHistory(previous.competition):previous.competition}})
    const relation=changed&&correcting?{supersedes:previous.digest,correctionReason:plan.correctionReason}:previous?.supersedes?{supersedes:previous.supersedes,correctionReason:previous.correctionReason}:{}
    const body={schemaVersion:1,familyId,childId,digest,...relation,competition:role==='student'?studentHistory(merged):merged};staged.push({path:`${base}/olympiadHistory/${merged.id}/views/${role}`,body})
   }
  }
  const index={schemaVersion:1,familyId,childId,entries:[...entries.values()].sort((a,b)=>a.id.localeCompare(b.id))};staged.push({path:indexRef.path,body:index})
  expected.splice(0,expected.length,...staged)
  if(apply)for(const item of staged)tx.set(db.doc(item.path),item.body)
  return {mode:apply?'apply':'plan',competitions:competitions.length,files:files.size,resultCount:competitions.reduce((sum,c)=>sum+historyIndexEntry(c).resultCount,0),conflicts,revisionDigests:Object.fromEntries(competitions.map((c,i)=>[c.id,snapshots[i].data()?.digest??null]))}
 })
 if(apply){for(const item of expected){const snap=await db.doc(item.path).get();if(!isDeepStrictEqual(snap.data(),item.body))throw Error('history_projection_readback_failed')}for(const [id,metadata] of files){const saved=await db.doc(`${base}/learningFiles/${id}`).get();const remote=await disk.head(metadata.path);if(!isDeepStrictEqual(saved.data(),metadata)||remote?.size!==metadata.size)throw Error('history_original_readback_failed')}}
 return {...receipt,verified:apply}
}
