/** One compact assignment heading; the authorized body stays mounted while closed.
 * @see ../../docs/modules/school-diary/day-page.md#task-disclosure */
import {useState,type ReactNode} from 'react'
import {ChevronDown} from 'lucide-react'
import {Popover} from 'radix-ui'
import './TaskDisclosure.css'
/** @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
export default function TaskDisclosure({id,title,status,statusExplanation,meta,assignmentLabel,className='',children,decision}:{id?:string;title:string;status:ReactNode;statusExplanation?:string;meta?:string;assignmentLabel?:string;className?:string;children:ReactNode;decision?:{nodes:string[];edges:string[]}}){
 const [statusOpen,setStatusOpen]=useState(false)
 return <details id={id} className={`edu-task-disclosure ${className}`} data-assignment-unit={id?.startsWith('day-unit-')?id:undefined} data-decision-nodes={decision?.nodes.join(' ')} data-decision-edges={decision?.edges.join(' ')}>
  <summary className="edu-task-heading">
   <h3 className="edu-task-title">{title}</h3><ChevronDown className="edu-task-chevron" size={18} aria-hidden="true"/>
   <span className="edu-task-summary-status">{statusExplanation?<Popover.Root open={statusOpen} onOpenChange={setStatusOpen}>
    <Popover.Trigger asChild><button type="button" className="edu-task-status-help" aria-label="Почему такой статус" onClick={event=>{event.preventDefault();event.stopPropagation();setStatusOpen(open=>!open)}} onKeyDown={event=>event.stopPropagation()}><span className="edu-task-status-value">{status}</span></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="edu-task-status-popup" sideOffset={6} collisionPadding={12} aria-label="Статус задания" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
     <p>{statusExplanation}</p><Popover.Close asChild><button type="button">Понятно</button></Popover.Close>
    </Popover.Content></Popover.Portal>
   </Popover.Root>:<span className="edu-task-status-value">{status}</span>}</span>
   {(assignmentLabel||meta)&&<span className="edu-task-summary-meta">{[assignmentLabel,meta].filter(Boolean).join(' · ')}</span>}
  </summary>
  <div className="edu-task-body">{children}</div>
 </details>
}
