/** Read-only evidence bundle for an explicit audit, never an assessment.
 * @see ../docs/modules/reviews/criteria-and-knowledge.md#current-task-audit */
const own=(data,owner)=>data?.familyId===owner.familyId&&data?.childId===owner.childId
const ids=task=>[task.id,...(task.problems??[]).map(p=>p.id)]
export async function captureCurrentTaskAudit(db,{pairs,owner,viewDate}){
 if(!owner?.familyId||!owner?.childId||!/^\d{4}-\d{2}-\d{2}$/.test(viewDate)||!Array.isArray(pairs)||pairs.length>100)throw Error('Нужны владелец, дата и ограниченный список известных страниц.')
 const pages=[];const quizzes=new Map()
 for(const pair of pairs){
  if(!pair.student||!pair.parent)continue
  const [o,s,p]=await db.getAll(db.doc(`dayOwners/${pair.student}`),db.doc(`dayPages/${pair.student}`),db.doc(`dayPages/${pair.parent}`))
  if(!s.exists&&!p.exists)continue
  if(!own(o.data(),owner)||!own(s.data(),owner)||!own(p.data(),owner)||s.data().kind!=='student'||p.data().kind!=='parent')throw Error('Страница и обе роли не совпадают с подтверждённым владельцем.')
  const student=s.data(),parent=p.data(),continuous=student.weekendSlot?.mode==='until-complete'
  if(student.targetDate<viewDate&&!continuous)continue
  const tasks=(student.subjects??[]).flatMap(subject=>(subject.tasks??[]).filter(task=>student.targetDate>=viewDate||student.weekendSlot?.taskIds?.includes(task.id)).map(task=>({subject:subject.id,task})))
  const taskIds=[...new Set(tasks.flatMap(t=>ids(t.task)))],records=[]
  for(const id of taskIds){
   const [guide,criteria,progress,review,decision]=await db.getAll(db.doc(`dayTaskGuides/${pair.student}/items/${id}`),db.doc(`dayTaskGuides/${pair.student}/items/${id}/criteriaContract/current`),db.doc(`dayProgress/${pair.student}/items/${id}`),db.doc(`dayReviewPrivate/${pair.student}/items/${id}`),db.doc(`dayDecisions/${pair.student}/items/${id}`))
   records.push({taskId:id,guide:guide.data()??null,criteria:criteria.data()??null,progress:progress.data()??null,review:review.data()??null,decision:decision.data()??null})
  }
  const uploads=await db.collection(`dayUploads/${pair.student}/files`).get()
  const currentIds=new Set(tasks.map(t=>t.task.id))
  const placements=(student.testPlacements??[]).filter(t=>student.targetDate>=viewDate||currentIds.has(t.taskId))
  const tokens=new Set([...tasks.map(t=>t.task.testToken),...placements.map(t=>t.token??t.testToken)].filter(Boolean))
  for(const token of tokens){
   if(quizzes.has(token))continue
   const [a,k,r,privateReview]=await db.getAll(db.doc(`assignments/${token}`),db.doc(`answerKeys/${token}`),db.doc(`reviews/${token}`),db.doc(`quizReviewPrivate/${token}`))
   if(!a.exists||!own(a.data(),owner))throw Error('Связанный тест не принадлежит владельцу задания.')
   quizzes.set(token,{token,assignment:a.data(),answerKey:k.data()??null,review:r.data()??null,privateReview:privateReview.data()??null})
  }
  pages.push({sourceDate:pair.sourceDate,studentToken:pair.student,parentToken:pair.parent,continuous,currentTaskIds:tasks.map(t=>t.task.id),student,parent,records,uploads:uploads.docs.map(d=>({id:d.id,...d.data()}))})
 }
 return {schemaVersion:1,readOnly:true,privateOnly:true,capturedAt:new Date().toISOString(),viewDate,owner,pages,quizzes:[...quizzes.values()]}
}
