import { expect, it } from 'vitest'
import { inspectDeadlinePage, deadlinePageOwner } from './deadline-evidence.mjs'
const page = {kind:'student',familyId:'f',childId:'c',targetDate:'2026-11-17',subjects:[{id:'math',tasks:[{id:'t',kind:'written',problems:[{id:'a'}]}]}]}
it('rejects another child before reading work', async () => {
 await expect(inspectDeadlinePage({}, {page,owner:{familyId:'f',childId:'other'},token:'d',today:'2026-11-16'})).rejects.toThrow('deadline_owner_mismatch')
})
it('uses existing verified work and all covered-photo links without requesting a new submission', async () => {
 const rows = path => path.includes('dayParentDecisions')?[]:path.includes('dayProgress') ? [{id:'a',data:()=>({status:'verified'})}] : [{id:'photo',data:()=>({taskId:'other',coveredTaskIds:['a'],status:'pending'})}]
 const db={collection:path=>({get:async()=>({docs:rows(path),size:rows(path).length})})}
 const result=await inspectDeadlinePage(db,{page,owner:{familyId:'f',childId:'c'},token:'d',today:'2026-11-16'})
 expect(result.checks[0]).toMatchObject({ verifiedIds:['a'],missingIds:[],issues:['review-existing-uploads'],pendingUploadIds:['photo'] })
})

it('resolves the Monday target through the exact Sunday source owner without widening the global query', async () => {
 const paths=[]
 const db={doc:path=>{paths.push(path);return{get:async()=>({data:()=>({familyId:'f',childId:'c',date:'2026-11-15'})})}}}
 const owner=await deadlinePageOwner(db,{token:'monday',page:{...page,targetDate:'2026-11-16'},ownerByToken:new Map()})
 expect(owner.date).toBe('2026-11-15')
 expect(paths).toEqual(['dayOwners/monday'])
 await expect(deadlinePageOwner({}, {token:'monday',page,ownerByToken:new Map([['monday',{familyId:'f',childId:'other'}]])})).rejects.toThrow('deadline_owner_mismatch')
})

it('reads family decisions once for an eligible page and excludes work without inventing a completed review',async()=>{
 const paths=[],choice={taskId:'t',action:'task-optional',decidedAt:{seconds:100,nanoseconds:0}}
 const db={collection:path=>({get:async()=>{paths.push(path);const docs=path.includes('dayParentDecisions')?[{id:'choice',data:()=>choice}]:[];return{docs,size:docs.length}}})}
 const result=await inspectDeadlinePage(db,{page,owner:{familyId:'f',childId:'c'},token:'d',today:'2026-11-16'})
 expect(result.checks).toEqual([]);expect(result.fetched).toBe(1)
 expect(paths.filter(p=>p.includes('dayParentDecisions'))).toEqual(['dayParentDecisions/d/events'])
})
