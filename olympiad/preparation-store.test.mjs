import { expect, it } from 'vitest'
import { refreshOlympiadPreparation, createPreparationEventHandler } from './preparation-store.mjs'
import { historyDigest, studentHistory, mergeHistory } from './history.mjs'
const base='families/f/children/c',path=`${base}/olympiadHistory/contest/views/parent`
const stamp=n=>({seconds:n,nanoseconds:0})
function fixture(){
 const preparation={updatedOn:'2026-10-31',strengths:[{text:'Сохранённое достижение',evidenceIds:[]}],workingOn:[],next:null,evidence:[]}
 const competition={id:'contest',title:'Пример',aliases:['now'],seasons:[],preparation}
 const route={schemaVersion:1,competitionId:'contest',baseline:preparation,candidates:['a','b'].map(taskId=>({taskId,dayToken:'day',title:taskId,reason:'Уточнить обоснование.',evidenceIds:[]})),goals:[{text:'Полнота',evidenceIds:[],taskIds:['a']}]}
 const history={schemaVersion:1,familyId:'f',childId:'c',digest:historyDigest(competition),competition}
 const state=new Map([[base,{active:true}],[path,history],[path.replace('parent','student'),{...history,competition:studentHistory(competition)}],[`${base}/preparationRoutes/contest`,route],['dayOwners/day',{familyId:'f',childId:'c'}]])
 for(const id of ['a','b'])state.set(`${base}/tasks/${id}`,{familyId:'f',childId:'c',sourceSystem:'family',publication:'active',optional:true,learningContext:{kind:'olympiad',id:'now'}})
 const snap=(path)=>({id:path.split('/').at(-1),exists:state.has(path),data:()=>structuredClone(state.get(path))})
 const db={doc:path=>({path,get:async()=>snap(path)}),collection:path=>{
  const query={path,filters:[],maximum:Infinity,where(k,op,v){return {...this,filters:[...this.filters,[k,v]]}},limit(n){return {...this,maximum:n}}};return query
 },runTransaction:async fn=>{
  let writing=false;return fn({get:async ref=>{
   if(writing)throw Error('read after write')
   if(!ref.filters)return snap(ref.path)
   const docs=[...state.keys()].filter(p=>p.startsWith(`${ref.path}/`)&&p.slice(ref.path.length+1).split('/').length===1&&ref.filters.every(([k,v])=>state.get(p)[k]===v)).slice(0,ref.maximum).map(snap)
   return {docs,size:docs.length}
  },set:(ref,data)=>{writing=true;state.set(ref.path,structuredClone(data))}})
 }}
 return {db,state,route,history}
}
it('plans without writes; atomically updates both roles, saves exact old projections and is replay-safe',async()=>{
 const f=fixture(),before=JSON.stringify([...f.state]);f.state.set('dayProgress/day/items/a',{taskId:'a',status:'verified',checkedAt:stamp(10),studentFeedback:{confirmed:'Верный ход',focus:'',private:'secret'},officialAnswer:'secret'})
 const beforePlan=JSON.stringify([...f.state]);await refreshOlympiadPreparation({...f,familyId:'f',childId:'c',apply:false});expect(JSON.stringify([...f.state])).toBe(beforePlan)
 const first=await refreshOlympiadPreparation({...f,familyId:'f',childId:'c'});expect(first.verified).toBe(true)
 const updated=f.state.get(path);expect(updated.competition.preparation.next.taskId).toBe('b');expect(updated.competition.preparation.workingOn).toEqual([])
 expect(f.state.get(`${base}/olympiadHistory/contest/revisions/${f.history.digest}-parent`)).toEqual(f.history)
 expect(f.state.get(path.replace('parent','student')).competition).toEqual(studentHistory(updated.competition))
 expect(JSON.stringify(updated)).not.toContain('secret');expect(before).not.toBe(beforePlan)
 const after=JSON.stringify([...f.state]);expect((await refreshOlympiadPreparation({...f,familyId:'f',childId:'c',trigger:'old-event'})).writes).toBe(0);expect(JSON.stringify([...f.state])).toBe(after)
 expect((await refreshOlympiadPreparation({...f,familyId:'f',childId:'c',triggerTask:{dayToken:'day',taskId:'school-work'}})).writes).toBe(0)
 // Two identical outcomes on the same date remain separate checked versions.
 f.state.get('dayProgress/day/items/a').checkedAt=stamp(11)
 await refreshOlympiadPreparation({...f,familyId:'f',childId:'c'})
 expect([...f.state.keys()].filter(p=>p.includes('/updates/'))).toHaveLength(2)
 // Current authoritative correction wins even for a late event, and history is append-only.
 f.state.set('dayProgress/day/items/a',{taskId:'a',status:'partial',checkedAt:stamp(20),studentFeedback:{focus:'Проверить полноту.'}})
 await refreshOlympiadPreparation({...f,familyId:'f',childId:'c',trigger:'old-event'})
 expect(f.state.get(path).competition.preparation.next.taskId).toBe('a')
 expect(f.state.get(path).competition.preparation.progress.tasks[0].achievedOn).toBeTruthy()
 expect([...f.state.keys()].filter(p=>p.includes('/updates/'))).toHaveLength(3)
 expect(()=>mergeHistory(f.state.get(path).competition,f.history.competition,{correctExisting:true})).toThrow('history_preparation_conflict')
})
it('rejects stale configuration, wrong family targets and foreign or inconsistent events',async()=>{
 const f=fixture();await expect(refreshOlympiadPreparation({...f,familyId:'f',childId:'c',configurations:[{...f.route,expectedDigest:'stale'}]})).rejects.toThrow('configuration_changed')
 f.state.get(`${base}/tasks/a`).childId='foreign'
 await expect(refreshOlympiadPreparation({...f,familyId:'f',childId:'c',configurations:[{...f.route,expectedDigest:f.history.digest}]})).rejects.toThrow('task_scope_invalid')
 const handler=createPreparationEventHandler(f.db)
 expect(await handler({eventType:'review.published',source:'firestore',familyId:'f',childId:'wrong',sourceRef:{documentPath:'dayProgress/day/items/a'}})).toMatchObject({state:'blocked'})
 expect(await handler({eventType:'review.published',source:'firestore',familyId:'f',childId:'c',sourceRef:{documentPath:'dayProgress/day/items/a',taskId:'b'}})).toMatchObject({state:'blocked'})
})
it('does not overwrite journal or previous role versions when a state recurs',async()=>{
 const f=fixture();await refreshOlympiadPreparation({...f,familyId:'f',childId:'c'})
 const journal=[...f.state.entries()].find(([p])=>p.includes('/updates/'));const saved=structuredClone(journal[1])
 f.state.set('dayProgress/day/items/a',{taskId:'a',status:'verified',checkedAt:stamp(10)})
 await refreshOlympiadPreparation({...f,familyId:'f',childId:'c'})
 f.state.delete('dayProgress/day/items/a');await refreshOlympiadPreparation({...f,familyId:'f',childId:'c'})
 expect(f.state.get(journal[0])).toEqual(saved)
})
