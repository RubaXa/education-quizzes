/** @see ../../docs/shared/design/student-review-step.md */
import {useEffect,useEffectEvent,useRef,useState,type ReactNode} from 'react'
import ReviewBrief from './ReviewBrief'
import type {ReviewBriefData} from './ReviewBrief'
import type {DayHelp,DayWorkReview} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {ReviewReply,ReviewValue} from '../../packages/education-presentation/review-reply.mjs'
import {reviewResponseErrors,reviewReplyErrors,sameReviewValue} from '../../packages/education-presentation/review-reply.mjs'
export type ReviewConversationBinding={canReply:boolean;ready:boolean;help?:DayHelp;guidance:DayGuidance[];loadHistory:(change:(items:DayHelp[])=>void,error:()=>void)=>()=>void;send:(reply:ReviewReply,note:string,operationId:string)=>Promise<string>}
const requestTime=(h:DayHelp)=>{const t=h.requestedAt as {seconds?:number;nanoseconds?:number};return (t?.seconds??0)*1000+(t?.nanoseconds??0)/1e6}
const labels={correct:'Шаг получился',partial:'Почти получилось',retry:'Проверь ещё раз',stuck:'Попробуем проще',clarify:'Уточним мысль'}
/** A persisted, causal dialogue. Only the checked response chooses the next step. */
export default function ReviewConversation({data,review,binding,parent,children}:{data:ReviewBriefData;review:DayWorkReview;binding?:ReviewConversationBinding;parent:boolean;children?:ReactNode}){
 const [history,setHistory]=useState<DayHelp[]>([]),[loaded,setLoaded]=useState(false),[readError,setReadError]=useState(false)
 const [sending,setSending]=useState(false),[error,setError]=useState(''),[local,setLocal]=useState<DayHelp>(),[note,setNote]=useState('')
 const article=useRef<HTMLElement>(null),wasWaiting=useRef(false)
 const operation=useRef<{id:string;payload:string}|null>(null)
 const scope=`${review.id}:${JSON.stringify(review.checkedAt??null)}:${JSON.stringify(review.correctedAt??null)}`
 const loader=binding?.loadHistory
 const loadHistory=useEffectEvent((change:(items:DayHelp[])=>void,error:()=>void)=>binding?.loadHistory(change,error))
 const active=data.status!=='verified'&&Boolean(data.activity&&data.question)
 const hasLoader=Boolean(loader)&&active
 useEffect(()=>{if(!hasLoader)return;return loadHistory(items=>{setHistory(items);setLoaded(true);setReadError(false)},()=>setReadError(true))},[hasLoader,scope])
 const context={checkedAt:review.checkedAt??null,correctedAt:review.correctedAt??null}
 const optimistic=local&&!history.some(h=>h.eventReceiptId===local.eventReceiptId)&&binding?.help?.eventReceiptId!==local.eventReceiptId?local:undefined
 const requests=[...history,...(binding?.help?[binding.help]:[]),...(optimistic?[optimistic]:[])].filter(h=>active&&h.taskId===review.taskId&&h.reviewReply&&!reviewReplyErrors(h.reviewReply).length&&sameReviewValue({checkedAt:h.reviewReply.checkedAt,correctedAt:h.reviewReply.correctedAt},context)).sort((a,b)=>requestTime(a)-requestTime(b))
 const responses=(binding?.guidance??[]).filter(g=>g.reviewResponse&&!reviewResponseErrors(g.reviewResponse).length&&sameReviewValue(g.reviewContext,context))
 let sourceId='review',current=data,last:DayGuidance|undefined,pending:DayHelp|undefined
 const visited=new Set<string>()
 while(!visited.has(sourceId)){
  visited.add(sourceId)
  const request=requests.filter(h=>h.reviewReply?.sourceId===sourceId).at(-1)
  if(!request)break
  const response=responses.find(g=>g.sourceRequestEventId===request.eventReceiptId)
  if(!response){pending=request;break}
  last=response;sourceId=response.id
  if(response.reviewResponse?.complete){current={id:sourceId,label:labels[response.reviewResponse.outcome],status:'neutral'};break}
  const f=response.reviewResponse!.next!
  current={id:sourceId,label:f.title,status:'neutral',confirmed:f.confirmed,focus:f.focus,bridge:f.bridge,question:f.question,activity:f.presentation.activity,visual:f.presentation.visual,details:f.presentation.details}
 }
 async function send(intent:'answer'|'stuck',value:ReviewValue,text:string){
  if(parent||!binding?.canReply||!binding.ready||!loaded||readError||sending||!current.activity||!current.question)return
  const reply:ReviewReply={version:1,sourceId,...context,step:{question:sourceId==='review'?review.studentFeedback!.question:current.question,activity:current.activity},intent,value:JSON.stringify(value)}
  const payload=JSON.stringify([reply,text]);if(operation.current?.payload!==payload)operation.current={id:crypto.randomUUID(),payload}
  setSending(true);setError('')
  try{const id=await binding.send(reply,text,operation.current!.id);setLocal({id,taskId:review.taskId,revision:1,eventReceiptId:id,reviewReply:reply,requestText:text,requestedAt:{seconds:Date.now()/1000}});operation.current=null;setNote('')}
  catch{setError('Не удалось отправить. Запись осталась на месте — попробуй ещё раз.')}
  finally{setSending(false)}
 }
 const feedback=active&&last?.reviewResponse
 const busy=active&&pending
 const waiting=Boolean(busy),responseId=last?.id
 useEffect(()=>{if(wasWaiting.current&&!waiting&&responseId)article.current?.querySelector<HTMLElement>('.edu-review-question,.edu-step-feedback')?.focus();wasWaiting.current=waiting},[waiting,responseId])
 const action=!parent&&active&&binding?.canReply&&binding.ready&&loaded&&!readError&&!busy&&!last?.reviewResponse?.complete?{sending,send,error}:undefined
 return <ReviewBrief articleRef={article} data={busy?{...current,activity:undefined,question:undefined,focus:undefined,bridge:undefined,visual:undefined,details:undefined}:current} reply={action} context={feedback?<div tabIndex={-1} className="edu-step-feedback" role="status"><strong>{labels[feedback.outcome]}</strong><p>{feedback.message}</p></div>:undefined}>
  {busy&&pending&&<div className="edu-step-wait" role="status"><strong>{pending.reviewReply?.intent==='stuck'?'Вопрос отправлен':'Ответ отправлен'}</strong><p>{pending.reviewReply?.intent==='stuck'?'Помогу разобраться с этим шагом. Ответ появится здесь после проверки.':'Проверю твою мысль. Следующий шаг появится здесь после проверки.'}</p>
    <details><summary>Что отправлено</summary><p>{pending.reviewReply?.step.question}</p><p>{describeValue(pending.reviewReply!)}</p>{pending.requestText&&<p>{pending.requestText}</p>}</details>
    {!parent&&binding?.canReply&&<details><summary>Дополнить вопрос</summary><label>Что именно непонятно?<textarea maxLength={800} value={note} onChange={e=>setNote(e.target.value)}/></label><button type="button" disabled={sending||!note.trim()} onClick={()=>void send('stuck',JSON.parse(pending.reviewReply!.value),note)}>{sending?'Отправляем…':'Отправить пояснение'}</button>{error&&<p role="alert">{error}</p>}</details>}
  </div>}
  {active&&binding?.canReply&&!loaded&&!readError&&<p role="status">Загружаем ответы…</p>}
  {active&&readError&&<p role="alert">Не удалось загрузить ответы. Обнови страницу перед отправкой.</p>}
  {active&&last?.reviewResponse?.complete&&<p className="edu-step-closed">Этот шаг завершён. Добавь полученный переход в свою запись решения.</p>}
  {children}
 </ReviewBrief>
}
function describeValue(reply:ReviewReply){
 const value=JSON.parse(reply.value) as ReviewValue,a=reply.step.activity,tokens=new Map(a.tokens.map(t=>[t.id,t.text]))
 if(a.kind==='write')return a.tokens.map(t=>`${t.text}: ${value.written[t.id]||'—'}`).join(' · ')
 if(a.kind==='sort')return a.tokens.map(t=>`${t.text}: ${a.groups?.find(g=>g.id===value.groups[t.id])?.label??'—'}`).join(' · ')
 return value.selected.length?value.selected.map(id=>tokens.get(id)).join(a.kind==='build'?a.joiner??' ':' · '):'Пока без записи.'
}
