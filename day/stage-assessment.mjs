/** @see ../docs/decisions/stage-assessment-evidence-2026-11-18.md */
/** @see ../docs/modules/school-diary/day-page.md#stage-assessments */
export function stageAssessmentErrors(task,subjectId,placements,guide){
 if(task.stageAssessments===undefined)return []
 const errors=[],links=task.stageAssessments
 if(!Array.isArray(links)||links.length>8)return ['stageAssessments: нужен список до восьми этапов.']
 const ids=new Set()
 for(const link of links){
  if(!link||Object.keys(link).some(k=>!['stageId','title','scope','token'].includes(k))||!['stageId','title','scope','token'].every(k=>typeof link[k]==='string'&&link[k].trim())
   ||!/^[A-Za-z0-9_-]{24,64}$/.test(link.token)
   ||!guide?.stages?.some(s=>s.id===link.stageId)||ids.has(link.stageId)
   ||link.title.length>120||link.scope.length>400
   ||!placements?.some(p=>p.token===link.token&&p.subjectId===subjectId))errors.push('stageAssessments: нужны уникальный существующий этап, область и назначенный тест того же предмета.')
  ids.add(link?.stageId)
 }
 return errors
}
