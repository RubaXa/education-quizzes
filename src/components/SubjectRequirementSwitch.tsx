/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** @see ../../docs/shared/design/student-review-step.md#assignment-clarification */
import {useState} from 'react'
import type {DayTask} from '@/lib/dayStore'
import {taskRequired,taskRequirementChoice,type ParentCompletionEvent} from '@/lib/parentCompletion'
import RequirementSwitch from './RequirementSwitch'
import {Button} from './ui/button'

/** The same control in the diary and UI Kit; callbacks do not decide academic correctness. */
export default function SubjectRequirementSwitch({name,tasks,events,parent,ready,onChange}:{name:string;tasks:Pick<DayTask,'id'|'optional'>[];events:ParentCompletionEvent[];parent:boolean;ready:boolean;onChange?:(required:boolean)=>Promise<void>}){
 const required=tasks.some(t=>taskRequired(t,events)),excluded=tasks.length>0&&!required
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retryChoice,setRetryChoice]=useState<boolean>()
 const explicitChoice=tasks.some(t=>taskRequirementChoice(t.id,events)!==undefined)
 if(!tasks.length)return null
 async function change(next:boolean){
  if(busy||!ready||!onChange)return
  setBusy(true);setError('');setRetryChoice(next)
  try{await onChange(next);setRetryChoice(undefined)}catch{setError('Не удалось подтвердить весь выбор. Сохранённые решения не потеряются.')}finally{setBusy(false)}
 }
 return <span className="edu-subject-requirement" data-decision-nodes="family.requirement" data-decision-edges="clarification:family family:component" data-presentation-contract="assignment-clarification">{parent&&<RequirementSwitch checked={required} disabled={!ready||busy} label={`Учитывать задания по предмету «${name}» в семейном плане`} onChange={next=>void change(next)} onTitle="Исключить задания предмета из семейного плана" offTitle="Включить задания предмета в семейный план"/>}{excluded&&<span className="day-task-source">{explicitChoice?'По выбору семьи':'Необязательно'}</span>}{error&&<span role="alert">{error}{retryChoice!==undefined&&<Button type="button" variant="outline" className="min-h-[var(--edu-touch-target)] whitespace-normal text-base" disabled={busy} onClick={()=>void change(retryChoice)}>Повторить сохранение</Button>}</span>}</span>
}
