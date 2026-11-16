import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
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
it('runs native export/register/review: omitted national criterion cannot write credit; full review writes knowledge consumed by the next task',async()=>{
 const cwd=process.cwd(),argv=process.argv,oldCredential=process.env.GOOGLE_APPLICATION_CREDENTIALS
 const temp=mkdtempSync(join(tmpdir(),'education-criteria-'));mkdirSync(join(temp,'.local'))
 const {rows,db,set}=fixture();state.db=db
 const photo='photo-abcdefghijklmnopqrstu',taskId='english-letter',text='Write about a traditional dish from your country.'
 set('families/family',{active:true});set('families/family/children/child',{displayName:'Условный ученик'})
 set('dayOwners/day',{familyId:'family',childId:'child',date:'2026-11-10'})
 set('dayPages/day',{kind:'student',date:'2026-11-10',targetDate:'2026-11-11',planRevision:1,taskIds:[taskId],subjects:[{id:'english',name:'Английский язык',tasks:[{id:taskId,kind:'written',meshText:text,title:'Письмо',detail:text}]}]})
 set(`dayUploads/day/files/${photo}`,{taskId,status:'pending',storage:{state:'stored',path:'app:/synthetic.jpg',sha256:'a'.repeat(64)}})
 const items=['country','language'].map(stageId=>({stageId,label:stageId,observed:'Видна соответствующая часть собственного письма.',note:'Пункт соответствует точному назначению.',status:'correct'}))
 const accepted='Содержательная задача и язык подтверждены.',focus='Все обязательные критерии работы проверены.',bridge='Проверенная работа соответствует назначению.'
 const review={date:'2026-11-10',planRevision:1,taskId,uploadIds:[photo],status:'verified',summary:'Все обязательные критерии подтверждены.',nextStep:'Новой обязательной работы нет.',source:'Точная инструкция условного учителя.',items,checkableStageIds:['country','language'],assessmentBasis:{grade:6,schoolYear:'2026/27',requirement:text,observed:'На фото виден собственный текст по назначенной теме.',comparison:'Содержательная задача и языковое оформление сверены.',outcome:'met',sources:[{kind:'mesh',role:'requirement',ref:'mesh:synthetic',excerpt:text}]},
 studentFeedback:{title:'Письмо проверено по всем критериям.',confirmed:accepted,focus,bridge,question:'Новых обязательных действий нет.',anchor:{uploadId:photo,location:'Вся работа на фотографии'},steps:items.map(i=>({stageId:i.stageId,uploadId:photo,location:'Текст письма на фотографии',observation:i.observed,explanation:i.note,status:i.status}))},
 tutoringPlan:{version:1,taskId,workType:'language-use',firstGapStageId:null,preserveStageIds:['country','language'],sourceRef:'mesh:synthetic-instruction',evidence:{uploadId:photo,location:'Вся работа на фотографии',observed:'Видно собственное письмо по назначенной теме.'},acceptedConnection:accepted,gapExplanation:focus,bridge,responseCriterion:'Новый ответ от ученика не требуется.',state:{sourceReady:true,attemptState:'complete',unsuccessfulHelp:0,prerequisite:'demonstrated'},move:'close',preserve:'Все верные части работы сохраняются.',semanticChecked:true}}
 async function run(...args){vi.resetModules();process.argv=['node','submissions',...args];await import('./submissions.mjs')}
 try{
  process.chdir(temp);process.env.GOOGLE_APPLICATION_CREDENTIALS='/synthetic/unused-adc'
  writeFileSync('.local/review.json',JSON.stringify(review))
  await expect(run('review','.local/review.json')).rejects.toThrow(/опись критериев/)
  expect(rows.has(`dayProgress/day/items/${taskId}`)).toBe(false)
  await run('criteria-export','day',taskId,'.local/criteria.json')
  const packet=JSON.parse(readFileSync('.local/criteria.json','utf8'))
  packet.manifest.sources[0].segments=[{text,kind:'requirement',criterionIds:['country','language']}]
  packet.manifest.criteria=[{id:'country',skillId:'english-content',skillLabel:'Коммуникативная задача',sourceRef:'mesh',quote:'from your country',action:'Блюдо своей страны',required:true},{id:'language',skillId:'english-language',skillLabel:'Языковое оформление',sourceRef:'mesh',quote:'Write about',action:'Собственный письменный текст',required:true}]
  writeFileSync('.local/criteria.json',JSON.stringify(packet));await run('criteria','.local/criteria.json')
  const contract=rows.get(`dayTaskGuides/day/items/${taskId}/criteriaContract/current`).criteriaContract
  review.criteriaFingerprint=contract.fingerprint
  review.criteriaChecks=packet.manifest.criteria.map(c=>({id:c.id,stageId:c.id,result:'confirmed',uploadId:photo,location:'Строки собственного письма',observation:'Соответствие критерию подтверждено на фото.'}))
  writeFileSync('.local/review.json',JSON.stringify({...review,criteriaChecks:review.criteriaChecks.slice(1)}))
  await expect(run('review','.local/review.json')).rejects.toThrow(/Пропущен критерий/)
  expect(rows.has(`dayProgress/day/items/${taskId}`)).toBe(false)
  writeFileSync('.local/review.json',JSON.stringify(review));await run('review','.local/review.json')
  expect(rows.get(`dayProgress/day/items/${taskId}`).status).toBe('verified')
  expect(rows.get(`dayProgress/day/items/${taskId}`)).not.toHaveProperty('criteriaChecks')
  expect(rows.get('families/family/children/child/skills/english-content').lastOutcome).toBe('confirmed')
  const evidence=[...rows.entries()].filter(([path])=>path.includes('/learningEvidence/'))
  expect(evidence).toHaveLength(1);expect(evidence[0][1].mastery).toBe('not-inferred')
  set(`dayHelp/day/items/${taskId}`,{taskId,planRevision:1,revision:1,photoUploadIds:[photo]})
  const {captureEventTaskInputs}=await import('../sync/event-task-artifact.mjs')
  const inputs=await captureEventTaskInputs(db,{eventId:'a'.repeat(64),eventType:'help.requested',familyId:'family',childId:'child',source:'firestore',actor:{type:'system',id:'test'},sourceRef:{dayToken:'day',taskId,recordId:taskId,documentPath:`dayHelp/day/items/${taskId}`}})
  expect(inputs.learnerEvidence).toHaveLength(2)
  expect(inputs.learnerEvidence.every(e=>e.observation.id===evidence[0][1].id)).toBe(true)
 }finally{process.chdir(cwd);process.argv=argv;if(oldCredential===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;else process.env.GOOGLE_APPLICATION_CREDENTIALS=oldCredential;rmSync(temp,{recursive:true,force:true})}
})
