/** @see ../../docs/shared/design/information-hierarchy.md */
import type {ReactNode} from 'react'
import {ArrowRight} from 'lucide-react'
import {Button} from './ui/button'
import type {PersonalPreparation} from '@/lib/olympiad/historyTypes'
import './OlympiadNextStep.css'

/** One existing recommendation; it never invents a task or changes its checked work. */
export default function OlympiadNextStep({next,availableTaskIds,onOpenTask,heading='Следующая задача',prominent=false,children}:{
 next:PersonalPreparation['next'];availableTaskIds:readonly string[];onOpenTask:(id:string)=>void;heading?:string;prominent?:boolean;children?:ReactNode
}){
 const Heading=prominent?'h2':'h3'
 return <section className={`olympiad-preparation-next${prominent?' olympiad-next-step-primary':''}`} aria-label={heading}>
  <Heading>{heading}</Heading>
  {next?<><p className="olympiad-preparation-task-title">{next.title}</p><p>{next.reason}</p>{children}
   {availableTaskIds.includes(next.taskId)?<Button onClick={()=>onOpenTask(next.taskId)}>Открыть задачу<ArrowRight size={16} aria-hidden="true"/></Button>:<p className="olympiad-preparation-meta">Эта задача пока недоступна в практике.</p>}
  </>:<p>Следующий шаг пока не выбран.</p>}
 </section>
}
