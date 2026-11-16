import {expect,it} from 'vitest'
import {learningObservation,prepareLearningWrites} from './learning-observations.mjs'
import {studentReviewProjection} from '../storage/review-projection.mjs'
const input={owner:{familyId:'family',childId:'child'},taskId:'english-letter',attemptRef:'photo:one',sourceRevision:'source-1',outcome:'partial',criteria:[{id:'topic',skillId:'english-topic',skillLabel:'Содержательная задача',finding:{result:'not-met',uploadId:'photo',location:'Строка 1'}}]}
function fixture(){const rows=new Map(),db={doc:path=>({path}),getAll:async(...refs)=>refs.map(ref=>({exists:rows.has(ref.path),data:()=>rows.get(ref.path),updateTime:1}))};const writer={create(ref,value){if(rows.has(ref.path))throw Error('exists');rows.set(ref.path,value)},update(ref,value){rows.set(ref.path,{...rows.get(ref.path),...value})}};return {rows,db,writer}}
it('writes criterion evidence and a skill pointer, preserves correction history and deduplicates replay',async()=>{
 const {rows,db,writer}=fixture(),first=learningObservation(input)
 rows.set('families/family/children/child/skills/english-topic',{mastery:'demonstrated',label:'Содержательная задача'})
 let writes=await prepareLearningWrites(db,[first],1);writes.stage(writer);await expect(writes.verify()).resolves.toEqual({observations:1,verified:true})
 const size=rows.size;writes=await prepareLearningWrites(db,[learningObservation({...input,supersedes:first.id})],2);writes.stage(writer);expect(rows.size).toBe(size)
 const corrected=learningObservation({...input,outcome:'verified',sourceRevision:'source-2',supersedes:first.id,criteria:input.criteria.map(c=>({...c,finding:{...c.finding,result:'confirmed'}}))})
 writes=await prepareLearningWrites(db,[corrected],3);writes.stage(writer)
 expect(rows.has(`families/family/children/child/learningEvidence/${first.id}`)).toBe(true)
 expect(rows.get('families/family/children/child/skills/english-topic')).toMatchObject({lastOutcome:'confirmed',evidenceIds:[first.id,corrected.id]})
 expect(rows.get('families/family/children/child/skills/english-topic').mastery).toBe('demonstrated')
})
it('distinguishes partial scores 1/3 and 2/3 instead of collapsing their history',()=>{
 const a=learningObservation({...input,criteria:input.criteria.map(c=>({...c,finding:{...c.finding,result:'partial',score:1,maxPoints:3}}))})
 const b=learningObservation({...input,criteria:input.criteria.map(c=>({...c,finding:{...c.finding,result:'partial',score:2,maxPoints:3}}))})
 expect(a.id).not.toBe(b.id)
})
it('records a microresponse without an assignment pass or inferred mastery; private observations stay out of the student projection',async()=>{
 const {rows,db,writer}=fixture(),observation=learningObservation({...input,criteria:[],scope:'micro-step',outcome:'correct',helpLevel:'guided'})
 const writes=await prepareLearningWrites(db,[observation],1);writes.stage(writer)
 expect([...rows.keys()].some(key=>key.includes('/skills/'))).toBe(false)
 expect(observation).toMatchObject({scope:'micro-step',outcome:'correct',mastery:'not-inferred'})
 expect(studentReviewProjection({taskId:'task',criteriaContract:{secret:'key'},learningObservation:observation})).not.toHaveProperty('learningObservation')
 expect(()=>learningObservation({...input,owner:{familyId:'wrong/path',childId:'child'}})).toThrow()
})
