import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {taskRoute} from '../sync/task-route.mjs'
import {quizDecision} from '../assessment/decision-graph.mjs'
import {publishedPhotoCoverage} from '../storage/review-coverage.mjs'

const code = readFileSync(new URL('./sync-queue.mjs', import.meta.url), 'utf8')
const body = code.slice(code.indexOf('async function verifiedResolution(record) {'), code.indexOf('\nasync function ', code.indexOf('async function verifiedResolution(record) {') + 1))
const resolveRecord = new Function('db', `${body}; return verifiedResolution`)

describe('queue resolution across source formats', () => {
  it.each(['review-work', 'repair-review'])('resolves %s by all visible photo tasks without assessing the placement', async kind => {
    const photo = {taskId:'placement',status:'reviewed',coveredTaskIds:['visible-a','visible-b'],coverageNote:'Both solutions are visible.'}
    const docs = { 'dayUploads/day/files/photo': photo,
      'dayProgress/day/items/visible-a':{status:'needs-fix',uploadIds:['photo']},
      'dayProgress/day/items/visible-b':{status:'verified',uploadIds:['photo']} }
    const db = {
      collection:()=>({where:()=>({get:async()=>({docs:[{id:'day',data:()=>({familyId:'family',childId:'child'})}]})})}),
      doc:path=>({path,get:async()=>({data:()=>docs[path]})}),
      getAll:async(...refs)=>refs.map(ref=>({id:ref.path.split('/').at(-1),data:()=>docs[ref.path]})),
    }
    const resolveCovered = new Function('db','publishedPhotoCoverage',`${body}; return verifiedResolution`)(db,publishedPhotoCoverage)
    const record={kind,familyId:'family',childId:'child',source:{date:'2026-11-24',uploadId:'photo'}}
    await expect(resolveCovered(record)).resolves.toBe('photo-coverage-reviews-published')
    delete docs['dayProgress/day/items/visible-b']
    await expect(resolveCovered(record)).resolves.toBeNull()
    expect(docs['dayProgress/day/items/placement']).toBeUndefined()
  })
  it.each(['review-work', 'review-quiz', 'transfer-work'])('leaves %s event artifacts for their addressed executor without querying legacy coordinates', async (kind) => {
    const db = new Proxy({}, { get() { throw new Error('legacy Firestore query must not run') } })
    await expect(resolveRecord(db)({ kind, artifactPath: 'operatorSyncTaskArtifacts/artifact', source: { eventId: 'event' } })).resolves.toBeNull()
  })
})

it.each(['classify-assignment','material-needed'])('preserves the page subject when resolving %s with explicit graph bindings',async(kind)=>{
 const page={subjects:[{id:'history',tasks:[{id:'mesh-example',kind:'check',meshText:'Изучить параграф',decisionRuleIds:['history.reading'],instructionStatus:{state:'reviewed'},materialStatus:{state:'textbook-page-linked'},assessmentIntent:{state:'confirmed',mode:'ordinary',topic:'Причины события',evidenceRef:'book:paragraph'}}]}]}
 const db={doc:()=>({get:async()=>({data:()=>page})})}
 const resolveBound=new Function('db','taskRoute','quizDecision',`${body}; return verifiedResolution`)(db,taskRoute,quizDecision)
 await expect(resolveBound({kind,source:{dayToken:'day',taskId:'mesh-example'}})).resolves.toBe(kind==='classify-assignment'?'assessment-intent-confirmed':'family-material-linked')
})
