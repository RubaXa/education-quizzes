/** @see ../../docs/modules/assignments/source-units.md
 * @see ../../docs/decisions/source-bound-assignment-units-2026-11-19.md */
import type {ReactNode} from 'react'
import type {AssignmentUnit} from '../../day/assignment-units.mjs'
import type {DayTask,DayMaterialLink,DayWorkReview,ParentTaskGuide as Guide} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {ParentCompletionEvent} from '@/lib/parentCompletion'
import {stageCompletion} from '@/lib/parentCompletion'
import {assignmentUnitGuide,assignmentUnitReview,assignmentUnitSourceRef} from '@/lib/assignmentUnitView'
import {groupAdjacentMaterialPages} from '@/lib/dayMaterialRefs'
import type {StageAssessmentResult} from '@/lib/stageAssessment'
import DecisionTaskDisclosure from './DecisionTaskDisclosure'
import MaterialReader,{canReadInside} from './MaterialReader'
import ParentTaskGuide from './ParentTaskGuide'
import TaskGuidance from './TaskGuidance'
import LearnerFlow from './LearnerFlow'
import PhotoUploadControl from './PhotoUploadControl'
import StatusIcon from './StatusIcon'
import AudioPlayer from './AudioPlayer'
import StageAssessment from './StageAssessment'
/** Composes existing components; subject changes source data, never this shell. */
export default function AssignmentUnits({task,subjectId,links,parent,guide,review,decisions=[],guidance=[],guidanceReady,stageAssessments=[],onSend,onStageChoice,onPhotos,renderQuiz,imageResolver}:{
 task:DayTask;subjectId:string;links:DayMaterialLink[];parent:boolean;guide?:Guide;review?:DayWorkReview;decisions?:ParentCompletionEvent[];guidance?:DayGuidance[];guidanceReady?:boolean;stageAssessments?:StageAssessmentResult[];
 onSend?:(stage:Guide['stages'][number],level:'hint'|'reveal')=>Promise<void>;onStageChoice?:(stage:Guide['stages'][number],required:boolean)=>Promise<void>;onPhotos:(files:File[])=>void;renderQuiz?:(unit:AssignmentUnit)=>ReactNode;imageResolver?:(source:string,size:string,refresh:boolean)=>Promise<string>
}){
 return <div className="assignment-units day-task-list">{task.assignmentUnits!.items.map(unit=>{
  const unitLinks=links.filter(link=>unit.sourceRefs.includes(assignmentUnitSourceRef(link)))
  const unitReview=assignmentUnitReview(review,unit),unitGuide=assignmentUnitGuide(guide,unit)
  const completion=stageCompletion(unitReview,decisions)
  const confirmed=completion?completion.actualConfirmed===completion.total:unitReview?.status==='verified'
  const status=confirmed?(unit.kind==='mixed'?'Есть проверенный результат':'Подтверждено проверкой'):unitReview?.status==='needs-fix'?'Есть правка':unitReview?.status==='partial'?'Часть подтверждена':unitReview?'Есть общий разбор':unit.kind==='reading'?'Прочитать':unit.kind==='oral'?'Устно':'В тетради'
  const flow=task.learnerFlow&&unit.learnerStageIds?.length?{...task.learnerFlow,scope:unit.title,stages:task.learnerFlow.stages.filter(stage=>unit.learnerStageIds!.includes(stage.id))}:undefined
  return <DecisionTaskDisclosure subjectId={subjectId} task={task} key={unit.id} id={`day-unit-${task.id}-${unit.id}`} className="assignment-unit" title={unit.title} status={<><StatusIcon size={15} status={confirmed?'complete':unitReview?.status==='needs-fix'?'needs-fix':'ready'}/>{status}</>} meta={unitLinks.filter(link=>link.printedPage).map(link=>`с. ${link.printedPage}`).join(', ')}>
   <div>
    {groupAdjacentMaterialPages(unitLinks.filter(link=>canReadInside(link)||link.url.startsWith('data:image/'))).map(group=><MaterialReader key={group[0].url} links={group} parent={parent} imageResolver={imageResolver}/>)}
    {unitLinks.filter(link=>link.sourceType==='audio').map(link=><AudioPlayer key={link.url} link={link}/>)}
    {!unitLinks.length&&<p className="day-loading">Открываем связанный оригинал…</p>}
    <details className="day-assignment-brief-compact"><summary>Как написано в оригинале</summary><p>{unit.original}</p></details>
    <div className="assignment-unit-instructions day-submission-instructions"><strong>Что сделать</strong><ol>{unit.instructions.map((line,index)=><li key={index}>{line}</li>)}</ol></div>
    {!parent&&<TaskGuidance items={guidance.filter(item=>unit.guideStageIds?.includes(item.stageId))}/>}
    {flow&&<LearnerFlow flow={flow} reviewed={Boolean(unitReview?.status)} briefProvided/>}
    {parent&&unitGuide&&<ParentTaskGuide guide={unitGuide} review={unitReview} decisions={decisions} guidance={guidance.filter(item=>unit.guideStageIds?.includes(item.stageId))} guidanceReady={guidanceReady} stageAssessments={stageAssessments.filter(result=>unit.guideStageIds?.includes(result.stageId))} onSend={onSend} onStageChoice={onStageChoice}/>}
    {!parent&&!unit.quizToken&&stageAssessments.filter(result=>unit.guideStageIds?.includes(result.stageId)).map(result=><StageAssessment key={result.stageId} result={result} parent={false}/>)}
    {renderQuiz?.(unit)}
    {!parent&&['written','mixed'].includes(unit.kind)&&<div className="day-task-actions"><PhotoUploadControl label="Добавить фото работы" onPhotos={onPhotos}/></div>}
   </div>
  </DecisionTaskDisclosure>
 })}</div>
}
