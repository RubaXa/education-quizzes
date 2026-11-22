/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
import {describe,it,expect} from 'vitest'
import {queueEvidence} from './queue-evidence.mjs'
const snap=(data,id='id')=>({id,data:()=>data})
function database(values,collections={}){
 return {doc:path=>({path,get:async()=>snap(values[path])}),
  getAll:async(...refs)=>refs.map(r=>snap(values[r.path],r.path.split('/').at(-1))),
  collection:path=>({get:async()=>({docs:(collections[path]??[]).map(([id,v])=>snap(v,id))})})}
}
describe('addressed queue evidence',()=>{
 it('checks the quiz owner before fetching the private key or results',async()=>{
  const db={doc:path=>({get:async()=>{if(path!=='assignments/quiz')throw Error('private read before owner');return snap({familyId:'other',childId:'c',testId:'test'})}})}
  await expect(queueEvidence(db,{familyId:'f',childId:'c',source:{type:'quiz',id:'quiz',testId:'test'}})).rejects.toThrow(/^queue_evidence_owner_mismatch$/)
 })
 it('rejects another owner before reading photos or private results',async()=>{
  const db=database({'dayOwners/day':{familyId:'other',childId:'c'},'dayPages/day':{}})
  await expect(queueEvidence(db,{familyId:'f',childId:'c',source:{type:'day-task',dayToken:'day',taskId:'task'}})).rejects.toThrow('owner')
 })
 it('keeps reviewed photos and partial results without inferring completion',async()=>{
  const db=database({'dayOwners/day':{familyId:'f',childId:'c'},'dayPages/day':{familyId:'f',childId:'c',kind:'student',subjects:[{id:'math',tasks:[{id:'task',problems:[{id:'task-p1'}]}]}]},'dayProgress/day/items/task-p1':{status:'partial'},'dayReviewPrivate/day/items/task-p1':{answer:'private'}},{'dayUploads/day/files':[['photo',{taskId:'task-p1',status:'reviewed'}],['unrelated',{taskId:'else'}]]})
  const result=await queueEvidence(db,{familyId:'f',childId:'c',source:{type:'day-task',dayToken:'day',taskId:'task'}})
  expect(result.uploads.map(x=>x.id)).toEqual(['photo'])
  expect(result.reviews['task-p1'].public.status).toBe('partial')
  expect(result.reviews['task-p1'].private.answer).toBe('private')
  expect(result.readOnly).toBe(true)
  expect(result).not.toHaveProperty('completed')
 })
})
