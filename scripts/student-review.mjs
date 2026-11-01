#!/usr/bin/env node
/** Safe, opt-in CLI for same-attempt learner presentation corrections.
 * @see ../docs/shared/design/student-review-step.md */
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {Timestamp} from 'firebase-admin/firestore'
import {operatorFirestore} from './lib/admin-firebase.mjs'
import {editStudentReview,studentReviewDigest} from '../storage/student-review-edit.mjs'

const [file,...flags]=process.argv.slice(2)
if(!file||flags.some(f=>f!=='--apply')||flags.length>1)throw Error('Usage: node scripts/student-review.mjs .local/edits.json [--apply]')
const path=resolve(file)
if(!path.includes('/.local/')||readFileSync(path).length>2_000_000)throw Error('student-view-private-plan-required')
const plan=JSON.parse(readFileSync(path,'utf8'))
if(plan.version!==1||!plan.familyId||!plan.childId||!Array.isArray(plan.edits)||plan.edits.length<1||plan.edits.length>100
 ||new Set(plan.edits.map(e=>e.pageId+'/'+e.taskId)).size!==plan.edits.length)throw Error('student-view-invalid-plan')
for(const e of plan.edits)if(![e.pageId,e.taskId].every(s=>typeof s==='string'&&/^[\w-]{1,160}$/.test(s)))throw Error('student-view-invalid-resource')
const db=operatorFirestore(),apply=flags.includes('--apply'),at=Timestamp.now()
const refs=plan.edits.map(e=>({owner:db.doc('dayOwners/'+e.pageId),page:db.doc('dayPages/'+e.pageId),private:db.doc(`dayReviewPrivate/${e.pageId}/items/${e.taskId}`),public:db.doc(`dayProgress/${e.pageId}/items/${e.taskId}`),archive:db.doc(`dayReviewPrivate/${e.pageId}/items/${e.taskId}/studentViewEdits/${at.toMillis()}`)}))
function validate(docs){return refs.map((r,i)=>{const [owner,page,priv,pub]=docs.slice(i*4,i*4+4).map(d=>d.data()),edit=plan.edits[i]
 if(owner?.familyId!==plan.familyId||owner?.childId!==plan.childId||page?.kind!=='student'||!page.taskIds?.includes(edit.taskId))throw Error('student-view-owner-or-task-mismatch')
 return editStudentReview({privateReview:priv,publicReview:pub,edit,at})})}
try{
 const readRefs=refs.flatMap(r=>[r.owner,r.page,r.private,r.public])
 if(!apply){validate(await db.getAll(...readRefs));console.log(JSON.stringify({validated:true,apply:false,edits:refs.length}));}
 else{
  const next=await db.runTransaction(async tx=>{const values=validate(await tx.getAll(...readRefs));for(let i=0;i<refs.length;i++){tx.set(refs[i].private,values[i].privateReview);tx.set(refs[i].public,values[i].publicReview);tx.create(refs[i].archive,values[i].archive)}return values})
  const docs=await db.getAll(...refs.flatMap(r=>[r.private,r.public,r.archive]))
  for(let i=0;i<refs.length;i++)if(studentReviewDigest(docs[i*3].data())!==studentReviewDigest(next[i].privateReview)||studentReviewDigest(docs[i*3+1].data())!==studentReviewDigest(next[i].publicReview)||!docs[i*3+2].exists)throw Error('student-view-readback-mismatch')
  console.log(JSON.stringify({applied:true,readback:true,edits:refs.length,preserved:'status, checkedAt, attempts, uploads, source, parent guide and family decisions'}))
 }
}finally{await db.terminate()}
