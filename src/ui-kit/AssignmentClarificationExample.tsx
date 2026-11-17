/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** Real clarification and family controls, with synthetic local transport only.
 * @see ../../docs/shared/design/student-review-step.md#assignment-clarification */
import {useState} from 'react'
import {Button} from '@/components/ui/button'
import PhotoHelpPanel from '@/components/PhotoHelpPanel'
import SubjectRequirementSwitch from '@/components/SubjectRequirementSwitch'
import type {DayHelp,DayTask} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import {taskRequirementChoice,type ParentCompletionEvent} from '@/lib/parentCompletion'

export default function AssignmentClarificationExample({task,subjectName}:{task:DayTask;subjectName:string}){
 const [parent,setParent]=useState(false),[help,setHelp]=useState<DayHelp>(),[guidance,setGuidance]=useState<DayGuidance[]>([]),[events,setEvents]=useState<ParentCompletionEvent[]>([])
 const decide=async(required:boolean)=>setEvents(rows=>[...rows,{id:`local-${rows.length}`,taskId:task.id,action:required?'task-required' as const:'task-optional' as const,reviewCheckedAt:null,decidedAt:{seconds:rows.length+1,nanoseconds:0}}])
 return <section data-presentation-contract="assignment-clarification" aria-label="Уточнение и семейный выбор" data-decision-nodes="learner.context family.requirement" data-decision-edges="context:clarification clarification:family">
  <h3>Уточнение задания → решение семьи</h3><p>Условный пример для выбранного задания. Сверку выполняет проверяющий; кнопка ниже показывает уже подготовленный пример ответа. Семейные данные не записываются.</p>
  <div className="edu-kit-presets"><button aria-pressed={!parent} onClick={()=>setParent(false)}>Ребёнок уточняет</button><button aria-pressed={parent} onClick={()=>setParent(true)}>Родитель решает</button></div>
  <SubjectRequirementSwitch name={subjectName} tasks={[task]} events={events} parent={parent} ready onChange={decide}/>
  <PhotoHelpPanel familyDecision={taskRequirementChoice(task.id,events)} onFamilyDecision={decide} studentToken="ui-kit-only" taskId={task.id} parent={parent} canRequest={!parent} canRead={false} uploads={[]} help={help} guidance={guidance} gallery={()=>null} onRequest={async(_token,taskId,revision,requestKind,requestText,options)=>{const id=options!.operationId.replaceAll('-','').padEnd(64,'0');setHelp({id,taskId,revision,requestKind,requestText,eventReceiptId:id});return id}}/>
  <Button type="button" variant="outline" className="min-h-[var(--edu-touch-target)] h-auto whitespace-normal text-base" disabled={!help} onClick={()=>setGuidance([{id:`help-${help!.eventReceiptId}`,taskId:task.id,stageId:'help-response',stageIndex:0,level:'hint',text:'В примере запись учителя и объяснение ребёнка пока расходятся. Родитель решает, учитывать ли это назначение в семейном плане. До решения задание не отменяется.',guideRevision:1,actorPersonId:'demo',createdAt:1,sourceRequestEventId:help!.eventReceiptId,clarification:'ask-parent'}])}>Показать передачу решения родителю</Button>
 </section>
}
