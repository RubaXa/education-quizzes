/** @see ../../docs/decisions/archive-and-compact-written-review-2026-11-27.md */
/** @see ../../docs/modules/school-diary/dashboard.md#weekend-work-contract */
import {Archive,ArchiveRestore} from 'lucide-react'
import type {DayDashboardData} from '@/lib/dayDashboardStore'
import {useViewChoices} from '@/lib/useViewChoices'
import {activePreparations} from '../../sync/preparation-window.mjs'
import WeekendMathSlot from '../WeekendMathSlot'
import './PreparationCards.css'
type Slot=NonNullable<DayDashboardData['weekendWork']>[number]
const identity=(slot:Slot)=>JSON.stringify([slot.lessonDate,[...slot.taskIds].sort()])
export default function PreparationCards({scope,slots,parent,selectedDate}:{scope:string;slots:Slot[];parent:boolean;selectedDate:string}){
 const {choices,choose}=useViewChoices(`preparation:${parent?'parent':'student'}:${scope}`)
 const active=activePreparations(slots,selectedDate) as Slot[]
 const archived=active.filter(slot=>choices[identity(slot)])
 return <>
  {active.filter(slot=>!choices[identity(slot)]).map(slot=><div className="edu-preparation" key={identity(slot)}>
   <WeekendMathSlot token={slot.dayToken} taskIds={slot.taskIds} parent={parent} lessonDate={slot.lessonDate} dueDate={slot.dueDate} title={slot.title} preparationThrough={slot.preparationThrough} selectedDate={selectedDate}/>
   {selectedDate>(slot.preparationThrough??slot.dueDate)&&<button className="edu-preparation-archive" type="button" aria-label="В архив" title="В архив" onClick={()=>choose(identity(slot),true)}><Archive size={18} aria-hidden="true"/></button>}
  </div>)}
  {!!archived.length&&<details className="edu-preparation-history"><summary>Архив подготовки · {archived.length}</summary><ul>{archived.map(slot=><li key={identity(slot)}><span>{slot.title} · {new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date(`${slot.lessonDate}T12:00:00+03:00`))}</span><button type="button" aria-label="Вернуть из архива" title="Вернуть из архива" onClick={()=>choose(identity(slot),false)}><ArchiveRestore size={18} aria-hidden="true"/></button></li>)}</ul></details>}
 </>
}
