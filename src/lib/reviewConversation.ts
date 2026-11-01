/** Bind the existing task help queue; no second assessment or grade is created.
 * @see ../../docs/shared/design/student-review-step.md */
import {requestDayHelp,watchDayHelpHistory,type DayHelp,type DayWorkReview} from './dayStore'
import type {DayGuidance} from './dayGuidance'
import type {ReviewConversationBinding} from '@/components/ReviewConversation'
export function reviewConversationFor(studentToken:string,review:DayWorkReview|undefined,canReply:boolean,ready:boolean,help:DayHelp|undefined,guidance:DayGuidance[]):ReviewConversationBinding|undefined{
 if(!review||!ready||!studentToken||!review.studentFeedback?.presentation?.activity)return undefined
 // The route must own this exact review, not a previous day's carried evidence.
 if(review.id.includes(':')&&!review.id.startsWith(`${studentToken}:`))return undefined
 return {canReply,ready,help,guidance:guidance.filter(g=>g.taskId===review.taskId),
  loadHistory:(change,error)=>watchDayHelpHistory(studentToken,review.taskId,change,error),
  send:(reply,note,operationId)=>requestDayHelp(studentToken,review.taskId,Math.max(1,help?.revision??1),reply.intent==='stuck'?'step':'check',note,{operationId,reviewReply:reply})}
}
