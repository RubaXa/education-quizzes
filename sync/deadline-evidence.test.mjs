import { expect, it } from 'vitest'
import { inspectDeadlinePage } from './deadline-evidence.mjs'
const page = {kind:'student',familyId:'f',childId:'c',targetDate:'2026-11-17',subjects:[{id:'math',tasks:[{id:'t',kind:'written',problems:[{id:'a'}]}]}]}
it('rejects another child before reading work', async () => {
 await expect(inspectDeadlinePage({}, {page,owner:{familyId:'f',childId:'other'},token:'d',today:'2026-11-16'})).rejects.toThrow('deadline_owner_mismatch')
})
it('uses existing verified work and all covered-photo links without requesting a new submission', async () => {
 const rows = path => path.includes('dayProgress') ? [{id:'a',data:()=>({status:'verified'})}] : [{id:'photo',data:()=>({taskId:'other',coveredTaskIds:['a'],status:'pending'})}]
 const db={collection:path=>({get:async()=>({docs:rows(path),size:1})})}
 const result=await inspectDeadlinePage(db,{page,owner:{familyId:'f',childId:'c'},token:'d',today:'2026-11-16'})
 expect(result.checks[0]).toMatchObject({ verifiedIds:['a'],missingIds:[],issues:['review-existing-uploads'],pendingUploadIds:['photo'] })
})
