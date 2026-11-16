import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({db:null}))
class Stamp{constructor(value){this.value=value}toMillis(){return this.value}toDate(){return new Date(this.value)}isEqual(other){return this.value===other?.value}}
vi.mock('firebase-admin/app',()=>({initializeApp:vi.fn(),applicationDefault:()=>({})}))
vi.mock('firebase-admin/firestore',()=>({getFirestore:()=>state.db,Timestamp:{now:()=>new Stamp(1000)},FieldValue:{delete:()=>null,serverTimestamp:()=>new Stamp(1000)}}))
function fixture(){
 const rows=new Map(),versions=new Map();let clock=1
 const snap=path=>({id:path.split('/').at(-1),ref:db.doc(path),exists:rows.has(path),data:()=>rows.get(path),updateTime:new Stamp(versions.get(path)??0)})
 const set=(path,value)=>{rows.set(path,value);versions.set(path,clock++)}
 const writer=()=>{const writes=[];return {get:async ref=>snap(ref.path),create(ref,value){writes.push(()=>{if(rows.has(ref.path))throw Error('already-exists');set(ref.path,value)})},set(ref,value,options){writes.push(()=>set(ref.path,options?.merge?{...rows.get(ref.path),...value}:value))},update(ref,value,precondition){writes.push(()=>{if(precondition?.lastUpdateTime&&!snap(ref.path).updateTime.isEqual(precondition.lastUpdateTime))throw Error('stale');set(ref.path,{...rows.get(ref.path),...value})})},async commit(){for(const write of writes)write()}}}
 const collection=(path,filters=[])=>({where:(field,op,value)=>collection(path,[...filters,[field,value]]),get:async()=>({docs:[...rows.keys()].filter(key=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1&&filters.every(([f,v])=>rows.get(key)[f]===v)).map(snap)})})
 const db={doc:path=>({path,get:async()=>snap(path)}),getAll:async(...refs)=>refs.map(ref=>snap(ref.path)),collection,batch:writer,async runTransaction(fn){const transaction=writer(),result=await fn(transaction);await transaction.commit();return result}}
 return {rows,db,set}
}
it.each([false,true])('runs native context validate/review without grading or knowledge writes (prior=%s)',async hasPrior=>{
 const cwd=process.cwd(),argv=process.argv,oldCredential=process.env.GOOGLE_APPLICATION_CREDENTIALS
 const temp=mkdtempSync(join(tmpdir(),'education-context-'));mkdirSync(join(temp,'.local'))
 const {rows,db,set}=fixture();state.db=db
 const taskId='mesh-123',photo='photo-abcdefghijklmnopqrstu'
 const task={id:taskId,title:'§38',detail:'п.38',meshText:'п.38',kind:'read',outputKind:'reading',testToken:'own-quiz'}
 set('dayOwners/day',{familyId:'family',childId:'child',date:'2026-11-15'})
 const page={kind:'student',planRevision:4,taskIds:[taskId],subjects:[{id:'geography',tasks:[task]}]}
 set('dayPages/day',page);set('quizAssignments/own-quiz',{state:'submitted',points:8,maxPoints:8})
 set(`dayUploads/day/files/${photo}`,{taskId,status:'pending',storage:{state:'stored',sha256:'a'.repeat(64)}})
 const prior={date:'2026-11-15',taskId,planRevision:3,status:'verified',checkedAt:new Stamp(500),uploadIds:['earlier-photo'],learningObservationId:'keep-existing',studentFeedback:{title:'Прежняя проверка',confirmed:'Самопроверка восемь из восьми.',focus:'',question:''}}
 if(hasPrior){set(`dayReviewPrivate/day/items/${taskId}`,prior);set(`dayProgress/day/items/${taskId}`,{...prior})}
 const packet={purpose:'context-evidence',date:'2026-11-15',taskId,planRevision:4,uploadIds:[photo],evidence:{type:'platform-result',title:'Гидросфера',points:10,maxPoints:10,duration:3,observedDate:'2026-11-16',uploadId:photo,location:'Карточка тематического теста',summary:'На снимке виден результат тематического теста МЭШ.'}}
 const run=async command=>{process.argv=['node','scripts/submissions.mjs',command,'.local/receipt.json'];vi.resetModules();await import('./submissions.mjs')}
 try{
  process.chdir(temp);process.env.GOOGLE_APPLICATION_CREDENTIALS='/synthetic/unused-adc'
  writeFileSync('.local/receipt.json',JSON.stringify({...packet,status:'verified'}))
  await expect(run('validate')).rejects.toThrow(/не принимает вердикт/)
  expect(rows.get(`dayUploads/day/files/${photo}`).status).toBe('pending')
  writeFileSync('.local/receipt.json',JSON.stringify(packet));await run('validate')
  expect(rows.get(`dayUploads/day/files/${photo}`).status).toBe('pending')
  await run('review')
  const full=rows.get(`dayReviewPrivate/day/items/${taskId}`),publicDoc=rows.get(`dayProgress/day/items/${taskId}`)
  expect(full.contextEvidence).toHaveLength(1);expect(publicDoc.contextEvidence).toEqual(full.contextEvidence)
  expect(full.contextEvidence[0]).toMatchObject(packet.evidence)
  if(hasPrior){expect(full).toMatchObject(prior);expect(publicDoc.status).toBe('verified');expect(publicDoc.checkedAt).toEqual(prior.checkedAt)}
  else for(const key of ['status','workCoverage','learningObservationId','checkedAt','assessmentBasis'])expect(full).not.toHaveProperty(key)
  expect(rows.get(`dayUploads/day/files/${photo}`).status).toBe('reviewed')
  expect(rows.get('dayPages/day')).toEqual(page)
  expect(rows.get('quizAssignments/own-quiz')).toEqual({state:'submitted',points:8,maxPoints:8})
  expect([...rows.keys()].some(path=>/learningEvidence|\/skills\/|educationEvents/.test(path))).toBe(false)
 }finally{process.chdir(cwd);process.argv=argv;if(oldCredential===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;else process.env.GOOGLE_APPLICATION_CREDENTIALS=oldCredential;rmSync(temp,{recursive:true,force:true})}
})
