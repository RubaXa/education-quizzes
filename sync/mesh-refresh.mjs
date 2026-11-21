import {dateWindow} from './project-plan.mjs'
/** A recent complete source receipt never certifies publication or pupil work.
 * @see ../docs/modules/synchronization/global-sync.md#global-sync */
export const MESH_REFRESH_MS=3_600_000
export function reusableMeshRun(manifests,target,today,now=Date.now()) {
 const dates=dateWindow(today),candidates=[]
 for(const manifest of manifests)for(const job of manifest.jobs??[]){
  const age=now-Date.parse(job.lastFullMeshAt)
  if(['familyId','childId','sourceAccountId'].some(k=>!target[k]||job[k]!==target[k])
   ||job.sourcePersonId&&job.sourcePersonId!==target.sourcePersonId
   ||!['complete','awaiting-enrichment'].includes(job.state)||job.checkedDates!==42
   ||job.checkedFrom!==dates[0]||job.checkedThrough!==dates.at(-1)||!job.sourceDir
   ||!Number.isFinite(age)||age<0||age>=MESH_REFRESH_MS)continue
  candidates.push({runId:manifest.runId,job})
 }
 return candidates.sort((a,b)=>Date.parse(b.job.lastFullMeshAt)-Date.parse(a.job.lastFullMeshAt))[0]??null
}
