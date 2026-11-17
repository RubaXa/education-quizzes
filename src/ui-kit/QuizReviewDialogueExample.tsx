/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** Synthetic fixture of the production result card; no family reads or writes.
 * @see ../../docs/shared/design/student-review-step.md#quiz-dialogue */
import {useCallback,useEffect,useRef,useState} from 'react'
import QuizResultCard from '@/components/QuizResultCard'
import type {DayHelp} from '@/lib/dayStore'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {ReviewConversationBinding} from '@/components/ReviewConversation'
import type {QuestionResult} from '@/lib/quiz'
import {quizQuestionReview} from '../../packages/education-presentation/quiz-review-reply.mjs'
const activity={kind:'choice' as const,label:'Смысл слова',instruction:'Нажми на один вариант.',tokens:[{id:'time',text:'Время'},{id:'distance',text:'Расстояние'},{id:'mass',text:'Масса'}]}
const result:QuestionResult={question:{id:'demo-quiz-step',kind:'short',prompt:'Какую величину измеряют метрами?',points:1},answer:'время',points:0,guidance:{observation:'В ответе названа другая величина.',question:'Что можно измерить между двумя точками?',presentation:{version:1,activity},source:{title:'Авторский пример',edition:'UI Kit',section:'Величины',pages:'Пример',locator:'Единицы'}}}
const review=quizQuestionReview(result.question.id,{seconds:1},result.guidance)
export default function QuizReviewDialogueExample(){
 const [parent,setParent]=useState(false),[history,setHistory]=useState<DayHelp[]>([]),[guidance,setGuidance]=useState<DayGuidance[]>([])
 const current=useRef(history),listeners=useRef(new Set<(items:DayHelp[])=>void>())
 useEffect(()=>{current.current=history;for(const listener of listeners.current)listener(history)},[history])
 const loadHistory=useCallback<ReviewConversationBinding['loadHistory']>(change=>{listeners.current.add(change);change(current.current);return()=>{listeners.current.delete(change)}},[])
 const latest=history.at(-1),canRespond=latest&&!guidance.some(g=>g.sourceRequestEventId===latest.eventReceiptId)
 const binding:ReviewConversationBinding={canReply:!parent,ready:true,guidance,loadHistory,send:async(reply,note,id)=>{const eventReceiptId=id.replaceAll('-','').padEnd(64,'0');setHistory(items=>[...items,{id:eventReceiptId,eventReceiptId,taskId:result.question.id,revision:items.length+1,reviewReply:reply,requestText:note,requestedAt:{seconds:Date.now()/1000}}]);return eventReceiptId}}
 function respond(){
  if(!latest)return
  const stuck=latest.reviewReply?.intent==='stuck'
  setGuidance(items=>[...items,{id:`help-${latest.eventReceiptId}`,taskId:result.question.id,stageId:'help-response',stageIndex:0,level:'hint',text:'Учебный отклик',guideRevision:1,actorPersonId:'demo',createdAt:{seconds:Date.now()/1000},sourceRequestEventId:latest.eventReceiptId,reviewContext:{checkedAt:review.checkedAt,correctedAt:review.correctedAt},reviewResponse:stuck?{outcome:'stuck',message:'Возьмём два конкретных предмета.',next:{title:'Сравни измерения',question:'Что измеряют линейкой?',presentation:{version:1,activity:{kind:'choice',label:'Измерение',instruction:'Выбери один предмет.',tokens:[{id:'length',text:'Длину стола'},{id:'weight',text:'Массу стола'}]}}}}:{outcome:'partial',message:'Выбор сохранён. Следующий вопрос помогает его проверить.',next:{title:'Проверь единицу',question:'Какая единица подходит для выбранной величины?',presentation:{version:1,activity:{kind:'choice',label:'Единица',instruction:'Выбери одну единицу.',tokens:[{id:'m',text:'Метр'},{id:'s',text:'Секунда'},{id:'kg',text:'Килограмм'}]}}}}}])
 }
 return <section aria-label="Диалог в результате теста"><h3>Результат теста → ответ на шаг</h3><p>Локальный пример. Отклик ниже — учебная демонстрация, он не проверяет выбранный вариант и не меняет 0 из 1 баллов.</p><button type="button" onClick={()=>setParent(!parent)}>{parent?'Посмотреть как ребёнок':'Посмотреть как родитель'}</button> <button type="button" disabled={!canRespond} onClick={respond}>Показать учебный отклик</button><QuizResultCard result={result} index={0} parent={parent} submittedAt={review.checkedAt} conversation={binding}/></section>
}
