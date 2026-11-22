/** @see ../docs/decisions/queue-evidence-2026-11-22.md */
/** Private, read-only evidence for one explicitly selected operator job.
 * @see ../docs/modules/synchronization/global-sync.md#operator-queue
 * @see ../docs/modules/synchronization/firestore-read-paths.md */
const owned=(value,job)=>value?.familyId===job.familyId&&value?.childId===job.childId
const data=async(db,path)=>(await db.doc(path).get()).data()??null
export async function queueEvidence(db,job){
 if(!job?.familyId||!job.childId)throw Error('queue_evidence_owner_missing')
 const s=job.source??{},base={readOnly:true,observedAt:new Date().toISOString()}
 if(s.type==='quiz'){
  const token=s.id
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(token??''))throw Error('queue_evidence_quiz_missing')
  const [assignment,key,review,privateReview]=await Promise.all(['assignments','answerKeys','reviews','quizReviewPrivate'].map(c=>data(db,`${c}/${token}`)))
  if(!owned(assignment,job)||assignment.testId!==s.testId)throw Error('queue_evidence_owner_mismatch')
  const linked=await db.collection('assignments').where('linkedToTestId','==',s.testId).get()
  return {...base,assignment,key,review,privateReview,linked:linked.docs.filter(x=>owned(x.data(),job)).map(x=>({token:x.id,...x.data()}))}
 }
 if(!['day-task','student-work'].includes(s.type))return {...base,source:s,sourceOnly:true}
 let token=s.dayToken
 if(!token){
  const owners=await db.collection('dayOwners').where('familyId','==',job.familyId).where('childId','==',job.childId).where('date','==',s.dayDate??s.date).limit(2).get()
  if(owners.docs.length!==1)throw Error('queue_evidence_owner_ambiguous')
  token=owners.docs[0].id
 }
 const [owner,page]=await Promise.all([data(db,`dayOwners/${token}`),data(db,`dayPages/${token}`)])
 if(!owned(owner,job)||!owned(page,job)||page.kind!=='student')throw Error('queue_evidence_owner_mismatch')
 const subject=page.subjects?.find(x=>x.tasks?.some(t=>t.id===s.taskId||t.problems?.some(p=>p.id===s.taskId)))
 const task=subject?.tasks?.find(t=>t.id===s.taskId||t.problems?.some(p=>p.id===s.taskId))??null
 const ids=[...new Set([s.taskId,...(task?.problems??[]).map(p=>p.id)])]
 const refs=ids.flatMap(id=>['dayProgress','dayReviewPrivate','dayTaskGuides'].map(c=>db.doc(`${c}/${token}/items/${id}`)))
 const [results,files]=await Promise.all([db.getAll(...refs),db.collection(`dayUploads/${token}/files`).get()])
 const reviews=Object.fromEntries(ids.map((id,i)=>[id,{public:results[3*i].data()??null,private:results[3*i+1].data()??null,guide:results[3*i+2].data()??null}]))
 const uploads=files.docs.filter(x=>x.id===(s.uploadId??s.id)||ids.includes(x.data().taskId)||(x.data().coveredTaskIds??[]).some(id=>ids.includes(id))).map(x=>({id:x.id,...x.data()}))
 return {...base,dayToken:token,owner,date:page.date,targetDate:page.targetDate,planRevision:page.planRevision,subject:subject?.id??null,task,materialLinks:page.materialLinks?.[task?.id]??[],taskPageRefs:page.taskPageRefs?.[task?.id]??[],reviews,uploads}
}
