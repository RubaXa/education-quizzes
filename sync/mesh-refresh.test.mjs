import {expect,it} from 'vitest'
import {reusableMeshRun} from './mesh-refresh.mjs'
import {dateWindow} from './project-plan.mjs'
const now=Date.parse('2026-11-21T12:00:00Z'),dates=dateWindow('2026-11-21')
const target={familyId:'f',childId:'c',sourceAccountId:'a'}
const job={...target,state:'awaiting-enrichment',checkedDates:42,checkedFrom:dates[0],checkedThrough:dates.at(-1),lastFullMeshAt:'2026-11-21T11:30:00Z',sourceDir:'/private/source'}
const run={runId:'prior',jobs:[job]}
it('reuses a complete recent collection without declaring publication complete',()=>{
 expect(reusableMeshRun([run],target,'2026-11-21',now)).toMatchObject({runId:'prior',job:{state:'awaiting-enrichment'}})
})
it('expires at one hour and rejects partial, failed, future, other-owner and other-week receipts',()=>{
 for(const patch of [{lastFullMeshAt:'2026-11-21T11:00:00Z'},{checkedDates:41},{state:'blocked'},{lastFullMeshAt:'2026-11-21T12:01:00Z'},{childId:'other'},{sourceAccountId:'other'},{checkedFrom:'2026-11-09'}])
  expect(reusableMeshRun([{...run,jobs:[{...job,...patch}]}],target,'2026-11-21',now)).toBeNull()
})
