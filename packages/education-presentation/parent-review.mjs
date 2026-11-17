/** @see ../../docs/modules/reviews/parent-review.md */
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
import {solutionBlocksErrors,solutionMethodErrors} from './solution-blocks.mjs'
import {sameReviewValue} from './review-reply.mjs'
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,max)=>typeof v==='string'&&v.trim().length>8&&v.length<=max
export function parentReviewErrors(a){
 const errors=[]
 if(!keys(a,['version','answer','difference','method','blocks','source'])||a.version!==1||!text(a.answer,400)||!text(a.difference,320))errors.push('Нужны правильный ответ и точное отличие от работы ученика.')
 if(!a?.method||solutionMethodErrors(a.method).length)errors.push('Нужен полный именованный метод родительского разбора.')
 if(!Array.isArray(a?.blocks)||a.blocks.length<2||solutionBlocksErrors(a.blocks).length)errors.push('Нужны минимум два структурированных звена разбора.')
 if(!keys(a?.source,['label','location'])||!text(a.source.label,240)||!text(a.source.location,240))errors.push('Нужен точный проверенный источник.')
 return errors
}
export function parentReviewContext(result,submittedAt){return {questionId:result.question.id,prompt:result.question.prompt,answer:result.answer??null,points:result.points,maxPoints:result.question.points,submittedAt:submittedAt??null}}
export function parentReviewMatches(record,result,submittedAt,quizToken){return (!quizToken||record?.quizToken===quizToken)&& record?.schemaVersion===1&&record.questionId===result.question.id&&!parentReviewErrors(record.analysis).length&&sameReviewValue(record.context,parentReviewContext(result,submittedAt))}
