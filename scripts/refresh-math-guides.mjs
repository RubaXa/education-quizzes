import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { refreshGuides, assertRefreshReadback, assertRefreshPreflight, assertPolicyChecks } from '../day/guidance-refresh.mjs'
/** @see ../docs/decisions/guidance-refresh-readback-2026-10-25.md */

/** Addressed revision-only refresh; publication stays in the established day CLI.
 * @see ../docs/modules/synchronization/task-routing.md#guidance-refresh */
const [command, file] = process.argv.slice(2)
const read = path => JSON.parse(readFileSync(path,'utf8'))
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
if (!['snapshot','prepare','apply'].includes(command) || !file) throw new Error('usage: snapshot|prepare|apply PRIVATE_PLAN.json')
const plan=read(resolve(file))
const templates=plan.templates??(plan.contentFile?read(resolve(plan.contentFile)):{})
if (plan.schemaVersion!==1 || !/^[a-z0-9-]+$/.test(plan.policyRevision??'') || !Array.isArray(plan.dates)
  || new Set(plan.dates).size!==plan.dates.length || plan.dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('invalid_scope')
const dir=resolve('.local/guidance-refresh',plan.policyRevision);mkdirSync(dir,{recursive:true,mode:0o700})
const snapshotFile=resolve(dir,'snapshot.json'),receiptFile=resolve(dir,command==='prepare'?'prepare.json':'receipt.json')
const links=read('.local/day-links.json'),db=operatorFirestore()
const evidencePaths=token=>['dayProgress','dayReviewPrivate','dayUploads','dayHelp','dayGuidance','dayParentDecisions']
  .map(c=>`${c}/${token}/${c==='dayUploads'?'files':c==='dayParentDecisions'?'events':'items'}`)
async function inspect(date) {
  const pair=links[date];if(!pair?.student||!pair?.parent)throw new Error(`missing_roles:${date}`)
  const [owner,...pages]=await Promise.all([db.doc(`dayOwners/${pair.student}`).get(),...['student','parent'].map(r=>db.doc(`dayPages/${pair[r]}`).get())])
  if(!owner.exists||!owner.data().familyId||!owner.data().childId||pages.some((p,i)=>!p.exists||p.data().date!==date
    ||p.data().kind!==['student','parent'][i]||p.data().familyId!==owner.data().familyId||p.data().childId!==owner.data().childId))throw new Error(`owner_unavailable:${date}`)
  const evidence={}
  for(const path of evidencePaths(pair.student)) {const s=await db.collection(path).get();evidence[path]=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.id.localeCompare(b.id))}
  const g=await db.collection(`dayTaskGuides/${pair.student}/items`).get()
  return JSON.parse(JSON.stringify({owner:owner.data(),pages:pages.map(p=>p.data()),evidence,guides:Object.fromEntries(g.docs.map(d=>[d.id,d.data()])),
    fence:{owner:owner.updateTime.toMillis(),pages:pages.map(p=>p.updateTime.toMillis()),guides:Object.fromEntries(g.docs.map(d=>[d.id,d.updateTime.toMillis()]))}}))
}
const receipt={policyRevision:plan.policyRevision,results:[]}
try {
  if(command==='snapshot') {
    if(existsSync(snapshotFile))throw new Error('snapshot_already_exists_use_new_revision_or_existing_snapshot')
    const entries=[]
    for(const date of plan.dates) {const source=read(`.local/day-source-${date}.json`);const live=await inspect(date);entries.push({date,source,sourceHash:hash(source),...live})}
    writeFileSync(snapshotFile,JSON.stringify({policyRevision:plan.policyRevision,createdAt:new Date().toISOString(),entries},null,2),{mode:0o600,flag:'wx'})
    console.log(JSON.stringify({snapshotFile,dates:entries.length,guideCount:entries.reduce((n,e)=>n+e.source.subjects.filter(s=>['math','special'].includes(s.id)).flatMap(s=>s.tasks.flatMap(t=>t.problems??[])).filter(p=>p.parentGuide).length,0)}))
  } else {
    assertPolicyChecks(plan,plan.updates??[])
    const snapshot=read(snapshotFile)
    if(JSON.stringify(snapshot.entries.map(e=>e.date))!==JSON.stringify(plan.dates)||!Array.isArray(plan.updates))throw new Error('snapshot_scope_mismatch')
    for(const entry of snapshot.entries) {
      const sourceFile=resolve('.local',`day-source-${entry.date}.json`),current=read(sourceFile)
      const changes=plan.updates.filter(u=>u.sourceDate===entry.date).map(u=>{
        if(!u.template)return u
        const authored=templates[u.template]
        if(!authored)throw new Error(`missing_authored_template:${u.template}`)
        return {...authored,...u,firstQuestion:u.firstQuestion??authored.firstQuestion}
      })
      const newer=refreshGuides(entry.source,changes)
      if(hash(current)!==entry.sourceHash&&hash(current)!==hash(newer))throw new Error(`local_source_changed:${entry.date}`)
      const pre=await inspect(entry.date)
      let baseline=entry
      const ack=plan.acknowledgedEvidence?.[entry.date]
      if(ack?.sha256===hash(pre.evidence)&&typeof ack.basis==='string'&&ack.basis.length>=30)baseline={...entry,evidence:pre.evidence}
      try {assertRefreshPreflight(baseline,pre,newer)} catch(error) {
        writeFileSync(resolve(dir,`stale-${entry.date}.json`),JSON.stringify({date:entry.date,...pre,evidenceHash:hash(pre.evidence)},null,2),{mode:0o600})
        throw new Error(`${entry.date}: ${error.message}`)
      }
      writeFileSync(sourceFile,JSON.stringify(newer,null,2)+'\n',{mode:0o600})
      try {execFileSync(process.execPath,['scripts/day.mjs','validate',entry.date],{stdio:'pipe'})}
      catch(error){writeFileSync(sourceFile,JSON.stringify(current,null,2)+'\n',{mode:0o600});throw error}
      if(command==='prepare') {
        receipt.results.push({date:entry.date,prepared:true,guideCount:changes.length,sourceHash:hash(newer)})
        writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
        continue
      }
      const fenceFile=resolve(dir,`fence-${entry.date}.json`);writeFileSync(fenceFile,JSON.stringify(pre.fence),{mode:0o600})
      execFileSync(process.execPath,['scripts/day.mjs','problem-support',entry.date,'--expected',fenceFile],{stdio:'pipe'})
      const after=await inspect(entry.date)
      const count=assertRefreshReadback({beforePages:entry.pages,afterPages:after.pages,source:newer,guides:after.guides,beforeEvidence:baseline.evidence,afterEvidence:after.evidence})
      receipt.results.push({date:entry.date,guideCount:count,published:true,readbackVerified:true,evidenceUnchanged:true,
        taskIds:changes.map(c=>c.taskId),sourceHash:hash(newer),operatorChecks:{policyRevision:plan.policyRevision,
          adultReadability:true,targetedHint:true,semanticQuality:'human-reviewed-not-machine-proven'}})
      writeFileSync(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600})
    }
    console.log(JSON.stringify({receiptFile,dates:receipt.results.length,guideCount:receipt.results.reduce((n,e)=>n+e.guideCount,0),readbackVerified:command==='apply',published:command==='apply'}))
  }
} finally {await db.terminate()}
