import type {ComponentProps} from 'react'
import TaskDisclosure from './TaskDisclosure'
import {subjectDecisionPlan} from '../../sync/subject-decisions.mjs'
import type {DayTask} from '@/lib/dayStore'
/** The real task frame carries the same graph identity as its UI Kit scenario.
 * @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
export default function DecisionTaskDisclosure({subjectId='generic',task,...props}:ComponentProps<typeof TaskDisclosure>&{subjectId?:string;task?:DayTask}){
 const actions=subjectDecisionPlan(task,subjectId).actions
 return <TaskDisclosure {...props} decision={{nodes:['source.criteria','artifact.units','subject.choose',...actions.map(a=>a.nodeId).filter((id):id is string=>Boolean(id)),'view.component'],edges:['prepare:units','units:role',...actions.flatMap(a=>a.edgeIds??[])]}}/>
}
