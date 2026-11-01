/** Interactive examples of received/checked/next. Synthetic data, no network writes.
 * @see ../../docs/shared/design/student-review-step.md */
import {useCallback,useEffect,useRef,useState} from 'react'
import WorkReview from '@/components/WorkReview'
import type {DayHelp,DayWorkReview} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {ReviewResponse} from '../../packages/education-presentation/review-reply.mjs'
import {reviewStepExamples} from '@/lib/reviewStepExamples'
import {reviewBriefWorkExample} from '@/lib/reviewBriefExamples'
export default function ReviewConversationExample(){
 const [revision,setRevision]=useState(1),[parent,setParent]=useState(false),[history,setHistory]=useState<DayHelp[]>([]),[responses,setResponses]=useState<DayGuidance[]>([])
 const [outcome,setOutcome]=useState<ReviewResponse['outcome']>('correct')
 const review:DayWorkReview={...reviewBriefWorkExample(reviewStepExamples[0].data),id:`demo:${revision}`,taskId:'demo',checkedAt:{seconds:revision}}
 const listeners=useRef(new Set<(h:DayHelp[])=>void>())
 const historyRef=useRef(history)
 useEffect(()=>{historyRef.current=history;for(const listener of listeners.current)listener(history)},[history])
 const loadHistory=useCallback((change:(h:DayHelp[])=>void)=>{listeners.current.add(change);change(historyRef.current);return()=>{listeners.current.delete(change)}},[])
 const latest=history.at(-1)
 function process(){
  if(!latest?.reviewReply)return
  const a=reviewStepExamples[0].data.activity!
  const message=outcome==='correct'?'Ты нашёл сторону между двумя фигурами. Теперь проследи, как её считали до соединения.':outcome==='partial'?'Ты отметил нужный участок, но в выборе есть лишнее. Проверь, что осталось на наружном контуре.':outcome==='retry'?'Отмеченный отрезок остался снаружи. Проследи границу соединённых фигур.':outcome==='stuck'?'Пойдём от одной фигуры. Проследи её контур до соединения.':'По выбору пока неясно, какую границу ты сравниваешь. Уточни одну мысль.'
  const activity=outcome==='correct'?{kind:'write' as const,diagram:a.diagram,label:'Твой подсчёт',instruction:'Впиши свой вывод о выбранном отрезке.',tokens:[{id:'count',text:'Сколько раз его учитывали до соединения?'}],frame:[{slotId:'count'}]}:outcome==='clarify'?{kind:'write' as const,label:'Твоя мысль',instruction:'Объясни, какой контур ты проследил.',tokens:[{id:'thought',text:'Что ты сравнил?'}],frame:[{slotId:'thought'}]}:a
  const question=outcome==='correct'?'Сколько раз общая сторона входила в сумму периметров до соединения?':outcome==='clarify'?'Ты сравниваешь контур одной фигуры или обеих вместе?':outcome==='stuck'?'Какая сторона первой фигуры соприкасается со второй?':'Какой из отмеченных отрезков остался снаружи?'
  const r:DayGuidance={id:`help-${latest.eventReceiptId}`,taskId:'demo',stageId:'help-response',stageIndex:0,level:'hint',text:message,guideRevision:1,actorPersonId:'demo',createdAt:{seconds:Date.now()/1000},sourceRequestEventId:latest.eventReceiptId,reviewContext:{checkedAt:review.checkedAt,correctedAt:null},reviewResponse:{outcome,message,next:{title:outcome==='correct'?'Сосчитай до соединения':'Проверь контур',question,presentation:{version:1,activity}}}}
  setResponses(rows=>[...rows,r])
 }
 return <section aria-label="Ответ и следующий шаг"><h3>Ответ → отклик → следующий шаг</h3><p>Учебный пример. Отправка здесь локальная; готовый отклик проверяющего показывается отдельной кнопкой. Пример не определяет правильность введённой записи.</p>
  <div className="edu-kit-presets"><button onClick={()=>setParent(false)} aria-pressed={!parent}>Ученик отвечает</button><button onClick={()=>setParent(true)} aria-pressed={parent}>Родитель смотрит</button></div>
  <div style={{maxWidth:390}}><WorkReview parent={parent} review={review} uploads={[]} conversation={{canReply:!parent,ready:true,help:latest,guidance:responses,loadHistory,send:async(reply,note,operationId)=>{const id=operationId.replaceAll('-','').padEnd(64,'0');setHistory(rows=>[...rows,{id,taskId:'demo',revision:1,reviewReply:reply,requestText:note,eventReceiptId:id,requestedAt:{seconds:Date.now()/1000}}]);return id}}}/></div>
  <label>Пример результата проверки <select aria-label="Результат проверки примера" value={outcome} onChange={e=>setOutcome(e.target.value as ReviewResponse['outcome'])}>{(['correct','partial','retry','stuck','clarify'] as const).map((k,i)=><option key={k} value={k}>{['Верный переход','Часть верна','Нужно проверить','Непонятно','Неясный ответ'][i]}</option>)}</select></label>
  <div className="edu-kit-presets"><button disabled={!latest||responses.some(r=>r.sourceRequestEventId===latest.eventReceiptId)} onClick={process}>Показать проверенный отклик</button><button onClick={()=>{setRevision(n=>n+1);setHistory([]);setResponses([])}}>Начать пример заново</button></div>
 </section>
}
