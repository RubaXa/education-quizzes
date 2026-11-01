/** @see ../../docs/shared/design/student-review-step.md */
import {useState} from 'react'
import type {ReviewValue} from '../../packages/education-presentation/review-reply.mjs'
export type ReviewReplyAction={sending:boolean;canAnswer:boolean;send:(intent:'answer'|'stuck',value:ReviewValue,note:string)=>Promise<void>;error?:string}
export default function ReviewReplyControls({value,action}:{value:ReviewValue;action:ReviewReplyAction}){
 const [note,setNote]=useState('')
 return <div className="edu-step-reply">
  <details><summary>Добавить пояснение</summary><label>Что ты хочешь спросить или объяснить?<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={800}/></label></details>
  <div className="edu-step-reply-buttons"><button type="button" className="edu-step-send" disabled={action.sending||!action.canAnswer} onClick={()=>void action.send('answer',value,note)}>{action.sending?'Отправляем…':'Отправить ответ'}</button><button type="button" disabled={action.sending} onClick={()=>void action.send('stuck',value,note)}>Непонятно</button></div>
  {action.error&&<p role="alert">{action.error}</p>}
 </div>
}
