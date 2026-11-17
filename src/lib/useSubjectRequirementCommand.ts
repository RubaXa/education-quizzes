/** @see ../../docs/decisions/adaptive-review-modes-2026-11-17.md */
/** @see ../../docs/shared/design/student-review-step.md#assignment-clarification */
import {useRef} from 'react'
import {recordTaskChoice} from './parentCompletion'
import type {DayTask} from './dayStore'
/** Retain every operation across a partial failure; retries cannot create duplicate decisions. */
export function useSubjectRequirementCommand(studentToken:string){
 const retry=useRef<{payload:string;operations:Map<string,string>}|null>(null)
 return async(tasks:Pick<DayTask,'id'>[],required:boolean)=>{
  const payload=JSON.stringify([studentToken,tasks.map(t=>t.id).sort(),required])
  if(retry.current?.payload!==payload)retry.current={payload,operations:new Map(tasks.map(t=>[t.id,crypto.randomUUID()]))}
  for(const task of tasks)await recordTaskChoice(studentToken,task.id,required,retry.current.operations.get(task.id))
  retry.current=null
 }
}
