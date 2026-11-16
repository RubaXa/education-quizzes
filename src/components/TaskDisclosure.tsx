/** One compact assignment heading; the authorized body stays mounted while closed.
 * @see ../../docs/modules/school-diary/day-page.md#task-disclosure */
import type {ReactNode} from 'react'
import {ChevronDown} from 'lucide-react'
import './TaskDisclosure.css'
/** @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
export default function TaskDisclosure({id,title,status,meta,assignmentLabel,className='',children,decision}:{id?:string;title:string;status:ReactNode;meta?:string;assignmentLabel?:string;className?:string;children:ReactNode;decision?:{nodes:string[];edges:string[]}}){
 return <details id={id} className={`edu-task-disclosure ${className}`} data-decision-nodes={decision?.nodes.join(' ')} data-decision-edges={decision?.edges.join(' ')}>
  <summary className="edu-task-heading">
   <h3 className="edu-task-title">{title}</h3><ChevronDown className="edu-task-chevron" size={18} aria-hidden="true"/>
   <span className="edu-task-summary-status">{status}</span>
   {(assignmentLabel||meta)&&<span className="edu-task-summary-meta">{[assignmentLabel,meta].filter(Boolean).join(' · ')}</span>}
  </summary>
  <div className="edu-task-body">{children}</div>
 </details>
}
