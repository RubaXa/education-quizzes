/** @see ../docs/modules/assignments/source-units.md
 * @see ../docs/decisions/source-bound-assignment-units-2026-11-19.md */
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k))
const unique=list=>Array.isArray(list)&&list.length===new Set(list).size
/** One provenance gate for the publisher and addressed correction. No inferred exercises. */
function validate(task,{sourceRefs=[],guide,subjectId,placements=[]}={},privateGuide=true){
 const plan=task?.assignmentUnits
 if(plan===undefined)return []
 const errors=[]
 if(!keys(plan,['version','sourceText','items'])||plan.version!==1||plan.sourceText!==(task.meshText??task.detail)
  ||!Array.isArray(plan.items)||!plan.items.length||plan.items.length>40||task.problems?.length)return ['assignmentUnits: нужны точная актуальная запись МЭШ и отдельные единицы без второго разбиения problems.']
 const ids=new Set(),usedStages=new Set(),usedLearnerStages=new Set(),tokens=new Set()
 for(const unit of plan.items){
  if(!keys(unit,['id','title','kind','sourceRefs','original','instructions','guideStageIds','learnerStageIds','quizToken'])
   ||!text(unit.id,64)||!/^[a-z][a-z0-9-]*$/.test(unit.id)||ids.has(unit.id)||!text(unit.title,160)
   ||!['written','reading','oral','mixed'].includes(unit.kind)||!text(unit.original,2000)
   ||!unique(unit.sourceRefs)||!unit.sourceRefs.length||unit.sourceRefs.some(ref=>ref!==task.id&&!sourceRefs.includes(ref))
   ||unit.sourceRefs.includes(task.id)&&!(task.meshText??task.detail??'').includes(unit.original)
   ||!Array.isArray(unit.instructions)||!unit.instructions.length||unit.instructions.length>8||unit.instructions.some(line=>!text(line,600))){errors.push('assignmentUnits: неполная единица, дубликат, закрытые поля или источник вне назначения.');continue}
  ids.add(unit.id)
  for(const [field,available] of [['guideStageIds',guide?.stages],['learnerStageIds',task.learnerFlow?.stages]]){
   const selected=unit[field]??[]
   if(!unique(selected)||selected.some(id=>!text(id,64)||!/^[a-z][a-z0-9-]*$/.test(id)||(field!=='guideStageIds'||privateGuide)&&!available?.some(stage=>stage.id===id)))errors.push(`assignmentUnits: ${field} ссылается на неизвестный этап.`)
   if(field==='learnerStageIds')for(const id of selected)usedLearnerStages.add(id)
   if(field==='guideStageIds')for(const id of selected){if(usedStages.has(id))errors.push('assignmentUnits: этап закрытого гида продублирован.');usedStages.add(id)}
  }
  if(unit.quizToken){
   if(tokens.has(unit.quizToken)||!placements.some(p=>p.token===unit.quizToken&&p.subjectId===subjectId&&(!p.taskId||p.taskId===task.id)))errors.push('assignmentUnits: тест отсутствует, принадлежит другому назначению или повторён.')
   tokens.add(unit.quizToken)
  }
 }
 if(privateGuide&&guide?.stages?.some(stage=>!usedStages.has(stage.id)))errors.push('assignmentUnits: существующий родительский этап потерян при разбиении.')
 if(task.learnerFlow?.stages?.some(stage=>!usedLearnerStages.has(stage.id)))errors.push('assignmentUnits: существующая ученическая помощь потеряна при разбиении.')
 return errors
}
/** The graph names the same unit level while retaining the established mathematical adapter. */
export function assignmentUnitNodes(task){
 return task.assignmentUnits?.items?.map(unit=>({id:unit.id,adapter:unit.kind}))
  ??task.problems?.map(problem=>({id:problem.id,adapter:'math-problem'}))??[]
}
export function assignmentOwnsQuiz(task,token){return Boolean(task.assignmentUnits?.items?.some(unit=>unit.quizToken===token)||task.assignmentUnits&&task.testToken===token)}

export const assignmentUnitErrors=(task,context)=>validate(task,context,true)
export const assignmentUnitShapeErrors=(task,context)=>validate(task,context,false)
