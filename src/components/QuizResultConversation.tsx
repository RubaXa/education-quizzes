/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** @see ../../docs/shared/design/student-review-step.md#quiz-dialogue */
import {useCallback,useEffect,useEffectEvent,useState} from 'react'
import QuizResultCard from './QuizResultCard'
import {watchQuizParentReview} from '@/lib/quizParentReview'
import {parentReviewMatches,parentReviewContext,type ParentReviewState} from '../../packages/education-presentation/parent-review.mjs'
import {sendQuizReviewReply,watchQuizReplyHistory,watchQuizStepGuidance} from '@/lib/quizReviewConversation'
import type {DayGuidance} from '@/lib/dayGuidance'
import type {QuestionResult} from '@/lib/quiz'
import type {ReviewConversationBinding} from './ReviewConversation'
export default function QuizResultConversation({result,index,parent=false,token,submittedAt}:{result:QuestionResult;index:number;parent?:boolean;token?:string;submittedAt?:unknown}){
 const [guidance,setGuidance]=useState<DayGuidance[]>([]),[ready,setReady]=useState(false),[readError,setReadError]=useState(false)
 const active=Boolean(token&&!result.excluded&&!result.skipped&&result.points!==null&&result.points<result.question.points&&result.guidance?.question&&result.guidance.presentation?.activity)
 const questionId=result.question.id
 const parentScope=`${token}:${questionId}:${parent}:${JSON.stringify(parentReviewContext(result,submittedAt))}`
 const [adult,setAdult]=useState<{scope:string;value:ParentReviewState|undefined}>()
 const eligible=Boolean(parent&&token&&!result.excluded&&!result.skipped&&result.points!==null&&result.points<result.question.points)
 const receiveParent=useEffectEvent((scope:string,record:unknown)=>setAdult({scope,value:record?parentReviewMatches(record,result,submittedAt,token)?{state:'ready',analysis:(record as {analysis:import('../../packages/education-presentation/parent-review.mjs').ParentReviewAnalysis}).analysis}:{state:'stale'}:undefined}))
 useEffect(()=>{
  if(!eligible)return
  let live=true
  const stop=watchQuizParentReview(token!,questionId,record=>{if(live)receiveParent(parentScope,record)},()=>{if(live)setAdult({scope:parentScope,value:{state:'error'}})})
  return()=>{live=false;stop()}
 },[eligible,parentScope,token,questionId])
 const parentView=eligible?(adult?.scope===parentScope?adult.value:{state:'loading'} as ParentReviewState):undefined
 useEffect(()=>{if(!active)return;return watchQuizStepGuidance(token!,questionId,items=>{setGuidance(items);setReady(true);setReadError(false)},()=>{setReady(false);setReadError(true)})},[active,token,questionId])
 const loadHistory=useCallback<ReviewConversationBinding['loadHistory']>((change,error)=>watchQuizReplyHistory(token!,questionId,change,error),[token,questionId])
 const binding=active?{canReply:!parent,ready,guidance,loadHistory,send:(...args:Parameters<ReviewConversationBinding['send']>)=>sendQuizReviewReply(token!,questionId,...args)}:undefined
 return <>{readError&&<p role="alert">Не удалось загрузить отклики. Обнови страницу перед отправкой.</p>}<QuizResultCard result={result} index={index} parent={parent} submittedAt={submittedAt} conversation={binding} parentReview={parent?parentView:undefined}/></>
}
