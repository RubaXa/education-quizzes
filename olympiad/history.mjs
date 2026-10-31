import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
/** Immutable historical evidence; importing it never creates today's learner attempt.
 * @see ../docs/modules/assessments/olympiad-history.md */
const id = /^[A-Za-z0-9_-]{1,120}$/
const hash = /^[a-f0-9]{64}$/
const fail = () => { throw Error('invalid_olympiad_history') }
const text = (v,n=500) => { if(typeof v!=='string'||!v.trim()||v.length>n)fail();return v }
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail()}
const list=(v,n=200)=>{if(!Array.isArray(v)||v.length>n)fail();return v}
const score=v=>{if(v!==null&&(!Number.isFinite(v)||v<0||v>1000000))fail()}
const unique=v=>{if(new Set(v).size!==v.length)fail()}
export function historyDigest(value){
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function historyFile(file){
 keys(file,['id','name','contentType','size','role','studentVisible'])
 if(!hash.test(file.id))fail();text(file.name,250)
 if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.contentType)||!Number.isSafeInteger(file.size)||file.size<1||file.size>100000000||typeof file.studentVisible!=='boolean')fail()
 text(file.role,80)
}
function preparation(value){
 keys(value,['updatedOn','strengths','workingOn','next','evidence','progress'])
 if(value.progress!==undefined){
  keys(value.progress,['tasks','exhausted']);if(typeof value.progress.exhausted!=='boolean')fail()
  list(value.progress.tasks,100).forEach(t=>{
   keys(t,['taskId','title','status','checkedOn','credited','confirmed','focus','achievedOn'])
   if(!id.test(t.taskId)||!['verified','partial','needs-fix'].includes(t.status)||![null,'review','family'].includes(t.credited))fail()
   text(t.title,160);for(const d of [t.checkedOn,t.achievedOn])if(d!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))))fail()
   for(const v of [t.confirmed,t.focus])if(v!==null)text(v,2000)
  });unique(value.progress.tasks.map(t=>t.taskId))
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.updatedOn)||Number.isNaN(Date.parse(value.updatedOn)))fail()
 list(value.evidence,12).forEach(e=>{keys(e,['id','label','competitionId','seasonId','stageId','taskNumber','file']);if(![e.id,e.competitionId,e.seasonId,e.stageId].every(v=>id.test(v)))fail();text(e.label,150);if(e.taskNumber!==undefined&&(!Number.isSafeInteger(e.taskNumber)||e.taskNumber<1||e.taskNumber>100))fail();historyFile(e.file)})
 unique(value.evidence.map(e=>e.id))
 const refs=items=>{list(items,4).forEach(v=>{if(!value.evidence.some(e=>e.id===v))fail()});unique(items)}
 for(const group of ['strengths','workingOn'])list(value[group],2).forEach(item=>{keys(item,['text','evidenceIds']);text(item.text,240);refs(item.evidenceIds)})
 if(value.next!==null){keys(value.next,['taskId','title','reason','evidenceIds']);if(!id.test(value.next.taskId))fail();text(value.next.title,160);text(value.next.reason,240);refs(value.next.evidenceIds)}
}
function studentPreparation(value){
 const copy=structuredClone(value),visible=new Set(copy.evidence.filter(e=>e.file.studentVisible).map(e=>e.id))
 copy.evidence=copy.evidence.filter(e=>visible.has(e.id))
 for(const group of ['strengths','workingOn'])copy[group]=copy[group].filter(item=>item.evidenceIds.every(id=>visible.has(id)))
 if(copy.next&&!copy.next.evidenceIds.every(id=>visible.has(id)))copy.next=null
 return copy
}
export function validateHistoryCompetition(value){
 keys(value,['id','title','aliases','seasons','preparation']);if(value.preparation!==undefined)preparation(value.preparation);if(!id.test(value.id))fail();text(value.title,200)
 list(value.aliases,50).forEach(v=>{if(!id.test(v))fail()});unique(value.aliases)
 list(value.seasons,30).forEach(season=>{
  keys(season,['id','label','grade','stages']);if(!id.test(season.id))fail();text(season.label,30);if(season.grade!==null)text(season.grade,20)
  list(season.stages,50).forEach(stage=>{
   keys(stage,['id','label','date','receivedOn','score','maximum','state','award','rank','notes','parentNotes','files','tasks'])
   if(!id.test(stage.id))fail();text(stage.label,150)
   if(stage.date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(stage.date)||Number.isNaN(Date.parse(stage.date))))fail()
   if(stage.receivedOn!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(stage.receivedOn))fail()
   score(stage.score);score(stage.maximum);if(stage.score!==null&&stage.maximum!==null&&stage.score>stage.maximum)fail()
   if(!['recorded','preliminary','appeal-window','jury-final','unknown','material-only'].includes(stage.state))fail()
   if(stage.award!==null)text(stage.award,150);if(stage.rank!==null&&(!Number.isSafeInteger(stage.rank)||stage.rank<1))fail()
   list(stage.notes,30).forEach(v=>text(v,2000));list(stage.parentNotes??[],30).forEach(v=>text(v,2000))
   list(stage.files,200).forEach(file=>{keys(file,['id','name','contentType','size','role','studentVisible']);if(!hash.test(file.id))fail();text(file.name,250);if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.contentType))fail();if(!Number.isSafeInteger(file.size)||file.size<1||file.size>100000000)fail();text(file.role,80);if(typeof file.studentVisible!=='boolean')fail()})
   unique(stage.files.map(f=>f.id))
   list(stage.tasks,100).forEach(task=>{keys(task,['number','label','score','maximum','statement','fileIds','pages']);if(!Number.isSafeInteger(task.number)||task.number<1||task.number>100)fail();if(task.label!==undefined)text(task.label,20);score(task.score);score(task.maximum);if(task.score!==null&&task.maximum!==null&&task.score>task.maximum)fail();if(task.statement!==null)text(task.statement,10000);list(task.fileIds,100).forEach(f=>{if(!stage.files.some(row=>row.id===f))fail()});if(task.pages!==undefined)text(task.pages,200)})
   unique(stage.tasks.map(t=>t.number))
  });unique(season.stages.map(s=>s.id))
 });unique(value.seasons.map(s=>s.id))
 return structuredClone(value)
}
export function studentHistory(value){
 const copy=structuredClone(value)
 if(copy.preparation)copy.preparation=studentPreparation(copy.preparation)
 for(const season of copy.seasons)for(const stage of season.stages){delete stage.parentNotes;stage.files=stage.files.filter(f=>f.studentVisible);for(const task of stage.tasks)task.fileIds=task.fileIds.filter(id=>stage.files.some(f=>f.id===id))}
 return copy
}
export function mergeHistory(previous,incoming,{correctExisting=false}={}){
 if(!previous)return validateHistoryCompetition(incoming)
 const result=validateHistoryCompetition(previous),next=validateHistoryCompetition(incoming)
 if(result.id!==next.id)throw Error('history_identity_mismatch')
 result.title=next.title;result.aliases=[...new Set([...result.aliases,...next.aliases])]
 if(next.preparation!==undefined){if(previous.preparation?.progress&&!isDeepStrictEqual(previous.preparation,next.preparation))throw Error('history_preparation_conflict');if(!isDeepStrictEqual(previous.preparation,next.preparation)&&!correctExisting)throw Error('history_preparation_conflict');result.preparation=next.preparation}
 for(const season of next.seasons){const found=result.seasons.find(s=>s.id===season.id);if(!found){result.seasons.push(season);continue}if(found.grade!==season.grade||found.label!==season.label)throw Error('history_season_conflict');for(const stage of season.stages){const index=found.stages.findIndex(s=>s.id===stage.id),old=found.stages[index];if(old&&!isDeepStrictEqual(old,stage)){if(!correctExisting)throw Error('history_stage_conflict');found.stages[index]=stage}if(!old)found.stages.push(stage)}}
 result.seasons.sort((a,b)=>a.id==='unknown'?1:b.id==='unknown'?-1:b.id.localeCompare(a.id));return result
}
export function historyIndexEntry(value){
 const seasons=[...value.seasons].sort((a,b)=>a.id==='unknown'?1:b.id==='unknown'?-1:b.id.localeCompare(a.id)),stages=seasons[0]?.stages??[]
 const graded=stages.filter(s=>s.score!==null),visible=(graded.length?graded:stages).slice(-3)
 const summary=[seasons[0]?.label,...visible.map(stage=>[stage.label,stage.score===null?'результат уточняется':`${stage.score}${stage.maximum===null?' баллов':` из ${stage.maximum}`}`,stage.award,['preliminary','appeal-window'].includes(stage.state)?'предварительно':null].filter(Boolean).join(': '))].filter(Boolean).join(' · ')
 return {id:value.id,title:value.title,aliases:value.aliases,resultCount:value.seasons.reduce((sum,s)=>sum+s.stages.filter(x=>x.score!==null).length,0),seasonCount:value.seasons.length,summary}
}
