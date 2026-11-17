import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import TaskGuidance from '../src/components/TaskGuidance'
import {guidePublication} from './parent-guide-edit.mjs'
import {expect,it} from 'vitest'
import {correctGuidance,exportGuidanceCorrection} from './guidance-correction.mjs'
function fixture(){
 const data=new Map(),reads=[],writes=[]
 const doc=p=>({path:p,get:async()=>snap(p)})
 const snap=p=>({id:p.split('/').at(-1),ref:doc(p),exists:data.has(p),data:()=>data.get(p)})
 const query=(path,field,value,max)=>({query:true,path,where:(f,_op,v)=>query(path,f,v,max),limit:n=>query(path,field,value,n),get:async()=>{reads.push({path,field,value,max});return {docs:[...data.keys()].filter(k=>k.startsWith(path+'/')&&k.split('/').length===path.split('/').length+1&&data.get(k)[field]===value).slice(0,max).map(snap)}}})
 const db={doc,collection:path=>query(path),async runTransaction(fn){const batch=[];const result=await fn({get:ref=>ref.get(),set:(ref,v)=>batch.push([ref.path,v])});for(const [path,v]of batch){writes.push(path);data.set(path,v)}return result}}
 const token='student',taskId='mesh-biology',stageId='zone'
 data.set('dayOwners/student',{familyId:'family',childId:'child',date:'2026-11-16',targetDate:'2026-11-17'})
 data.set('dayPages/student',{familyId:'family',childId:'child',kind:'student',date:'2026-11-16',targetDate:'2026-11-17',subjects:[{tasks:[{id:taskId,meshText:'п8,вопросы5–7'}]}]})
 const guide={revision:2,stages:[{id:stageId,expected:'PRIVATE ANSWER',answer:'FULL PARENT PATH'}]}
 data.set(`dayTaskGuides/student/items/${taskId}`,{familyId:'family',childId:'child',taskId,guide,sourceResearch:{source:'original'}})
 const q='Найди на рисунке нужную зону. Где она расположена?',review={taskId,status:'partial',checkedAt:{seconds:1,nanoseconds:4},studentFeedback:{question:q,bridge:'Сверь подпись с соседними участками.'}}
 data.set(`dayProgress/student/items/${taskId}`,review);data.set(`dayReviewPrivate/student/items/${taskId}`,{...review,answerKey:'PRIVATE KEY'})
 for(const id of ['one','two'])data.set(`dayGuidance/student/items/${id}`,{taskId,stageId,stageIndex:2,level:'reveal',text:'UNSAFE CURRENT ANSWER',revealContent:{expected:'UNSAFE CURRENT ANSWER'},oldFullBody:'ALSO UNSAFE',history:[{text:'OLD LEAK'}],actorPersonId:'parent',createdAt:{seconds:10,nanoseconds:3},sourceRequestEventId:'source-'+id,eventOperationId:id,eventReceiptId:'receipt-'+id,guideRevision:1})
 data.set('dayGuidance/student/items/other-task',{taskId:'other',stageId:'zone',level:'reveal',text:'unrelated'})
 return {db,data,reads,writes,input:{studentToken:token,taskId},guide}
}
async function packet(f){const e=await exportGuidanceCorrection(f.db,f.input);return {schemaVersion:1,...f.input,familyId:e.familyId,childId:e.childId,date:e.date,targetDate:e.targetDate,expected:e.expected,stageId:'zone',eventIds:e.events.map(r=>r.eventId),text:e.currentReview.studentFeedback.question,reason:'Устаревший полный этап раскрывает ответ на текущий вопрос; агент сверил безопасную подсказку.',semanticSafetyReviewed:true}}
it('exports only one bounded task and dry-runs without writing',async()=>{
 const f=fixture(),p=await packet(f)
 expect(f.reads).toEqual([{path:'dayGuidance/student/items',field:'taskId',value:'mesh-biology',max:100}])
 expect(await correctGuidance(f.db,p)).toMatchObject({valid:true,applied:false,events:['one','two']})
 expect(f.writes).toEqual([])
})
it('corrects every explicit stale release, archives FULL old documents privately and preserves the current attempt',async()=>{
 const f=fixture(),p=await packet(f),before=new Map(f.data)
 const beforeHtml=renderToStaticMarkup(createElement(TaskGuidance,{items:p.eventIds.map(id=>({id,...before.get(`dayGuidance/student/items/${id}`)}))}));expect(beforeHtml).toContain('UNSAFE CURRENT ANSWER')
 const result=await correctGuidance(f.db,p,{apply:true,now:{seconds:20}})
 expect(result).toMatchObject({verified:true,attemptCreated:false,guideChanged:false})
 for(const id of p.eventIds){
  const old=before.get(`dayGuidance/student/items/${id}`),v=f.data.get(`dayGuidance/student/items/${id}`)
  expect(v).toMatchObject({taskId:old.taskId,stageId:old.stageId,stageIndex:old.stageIndex,actorPersonId:old.actorPersonId,createdAt:old.createdAt,sourceRequestEventId:old.sourceRequestEventId,eventOperationId:id,eventReceiptId:old.eventReceiptId,level:'hint',text:p.text})
  for(const key of ['revealContent','oldFullBody','history'])expect(v).not.toHaveProperty(key)
 }
 const closed=f.data.get('dayTaskGuides/student/items/mesh-biology')
 expect(closed.guide).toEqual(f.guide)
 expect(closed.guidanceCorrections[0].events.map(e=>e.previous)).toEqual(p.eventIds.map(id=>before.get(`dayGuidance/student/items/${id}`)))
 for(const [path,v]of before)if(!f.writes.includes(path))expect(f.data.get(path)).toEqual(v)
 expect(f.writes.sort()).toEqual(['dayGuidance/student/items/one','dayGuidance/student/items/two','dayTaskGuides/student/items/mesh-biology'])
 const after=await exportGuidanceCorrection(f.db,f.input)
 expect(after.events.every(e=>e.guidance.level==='hint'&&!e.guidance.revealContent)).toBe(true)
 const afterHtml=renderToStaticMarkup(createElement(TaskGuidance,{items:after.events.map(e=>({id:e.eventId,...e.guidance}))}));expect(afterHtml).toContain(p.text);expect(afterHtml).not.toContain('UNSAFE CURRENT ANSWER');expect(afterHtml).not.toContain('OLD LEAK')
 const deleted=Symbol('delete'),[publication,options]=guidePublication({familyId:'family',childId:'child',taskId:'mesh-biology',guide:f.guide,updatedAt:30},deleted),republished={...closed};for(const key of options.mergeFields){if(publication[key]===deleted)delete republished[key];else republished[key]=publication[key]}
 expect(republished.guidanceCorrections).toEqual(closed.guidanceCorrections);expect(republished.guide).toEqual(f.guide)
})
it('rejects missed previous reveal, foreign owner/stage/event, custom text, missing safety review and stale review/guide',async()=>{
 for(const patch of [{eventIds:['two']},{familyId:'foreign'},{stageId:'other'},{eventIds:['other-task']},{text:'Разреши мне показать готовый ответ.'},{semanticSafetyReviewed:false}]){
  const f=fixture(),p=await packet(f);await expect(correctGuidance(f.db,{...p,...patch},{apply:true,now:1})).rejects.toThrow();expect(f.writes).toEqual([])
 }
 for(const key of ['dayProgress/student/items/mesh-biology','dayReviewPrivate/student/items/mesh-biology','dayTaskGuides/student/items/mesh-biology','dayPages/student']){
  const f=fixture(),p=await packet(f);f.data.set(key,{...f.data.get(key),revisionAfterExport:2});await expect(correctGuidance(f.db,p,{apply:true,now:1})).rejects.toThrow(/изменились/);expect(f.writes).toEqual([])
 }
})
it('never treats a capped query as a complete export',async()=>{
 const f=fixture();for(let i=0;i<100;i++)f.data.set(`dayGuidance/student/items/event-${i}`,{taskId:'mesh-biology'})
 await expect(exportGuidanceCorrection(f.db,f.input)).rejects.toThrow(/предел100/)
})

it('rejects closed guide and review owner mismatches before export or write',async()=>{
 for(const [path,field]of [['dayTaskGuides/student/items/mesh-biology','familyId'],['dayTaskGuides/student/items/mesh-biology','childId'],['dayTaskGuides/student/items/mesh-biology','taskId'],['dayReviewPrivate/student/items/mesh-biology','familyId'],['dayProgress/student/items/mesh-biology','childId']]){const f=fixture();f.data.set(path,{...f.data.get(path),[field]:'foreign'});await expect(exportGuidanceCorrection(f.db,f.input)).rejects.toThrow();expect(f.writes).toEqual([])}
})
