/** @see ../../docs/decisions/archive-and-compact-written-review-2026-11-27.md */
/** Local presentation choices only; never completion, grading or source data.
 * @see ../../docs/modules/school-diary/dashboard.md#weekend-work-contract
 * @see ../../docs/modules/reviews/marked-work-sheet.md */
import {useState} from 'react'
function read(scope:string):Record<string,boolean>{
 try{
  const value:unknown=JSON.parse(localStorage.getItem(`education-view-choices-v1:${scope}`)??'{}')
  if(!value||typeof value!=='object'||Array.isArray(value))return {}
  return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v==='boolean'))
 }catch{return {}}
}
export function useViewChoices(scope:string){
 const [state,setState]=useState(()=>({scope,choices:read(scope)}))
 const choices=state.scope===scope?state.choices:read(scope)
 function choose(key:string,value:boolean){
  const next={...read(scope),...choices,[key]:value}
  try{localStorage.setItem(`education-view-choices-v1:${scope}`,JSON.stringify(next))}catch{/* Current view remains usable without storage. */}
  setState({scope,choices:next})
 }
 return {choices,choose}
}
