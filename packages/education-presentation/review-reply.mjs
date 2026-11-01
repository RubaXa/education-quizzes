/** Public reply protocol. It validates evidence, never decides correctness.
 * @see ../../docs/shared/design/student-review-step.md */
import {reviewActivityValid} from './review-activity.mjs'
import {reviewOverviewErrors,reviewSupplementErrors} from './review-content.mjs'
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n
export function reviewCanonical(v){
 if(v===undefined||v===null)return null
 if(v instanceof Date)return v.toISOString()
 if(typeof v?.toDate==='function')return v.toDate().toISOString()
 if(object(v)&&typeof v.seconds==='number')return new Date(v.seconds*1000+(v.nanoseconds??0)/1e6).toISOString()
 if(Array.isArray(v))return v.map(reviewCanonical)
 return object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reviewCanonical(v[k])])):v
}
export const sameReviewValue=(a,b)=>JSON.stringify(reviewCanonical(a))===JSON.stringify(reviewCanonical(b))
export function reviewValueValid(a,v,{allowEmpty=false}={}){
 if(!reviewActivityValid(a)||!keys(v,['selected','groups','written'])||!Array.isArray(v.selected)||!keys(v.groups,a.tokens.map(t=>t.id))||!keys(v.written,a.tokens.map(t=>t.id)))return false
 const ids=a.tokens.map(t=>t.id),groupIds=a.groups?.map(g=>g.id)??[]
 if(v.selected.length>(a.maxItems??40)||v.selected.some(id=>!ids.includes(id))||(!a.repeat&&new Set(v.selected).size!==v.selected.length)
  ||Object.values(v.groups).some(g=>g!==''&&!groupIds.includes(g))||Object.values(v.written).some(t=>typeof t!=='string'||t.length>160))return false
 if(a.kind==='write')return !v.selected.length&&!Object.keys(v.groups).length&&(allowEmpty||a.tokens.every(t=>text(v.written[t.id],160)))
 if(a.kind==='sort')return !v.selected.length&&!Object.keys(v.written).length&&(allowEmpty||a.tokens.every(t=>groupIds.includes(v.groups[t.id])))
 return !Object.keys(v.groups).length&&!Object.keys(v.written).length&&(allowEmpty||v.selected.length>0)
}
export function reviewReplyErrors(r){
 if(!keys(r,['version','sourceId','checkedAt','correctedAt','step','intent','value'])||r.version!==1||!['answer','stuck'].includes(r.intent)
  ||!(r.sourceId==='review'||/^help-[a-f0-9]{64}$/.test(r.sourceId??''))||!keys(r.step,['question','activity'])||!text(r.step.question,160)
  ||!reviewActivityValid(r.step.activity)||typeof r.value!=='string'||r.value.length>6000)return ['Некорректный ответ на текущий шаг.']
 try{if(!reviewValueValid(r.step.activity,JSON.parse(r.value),{allowEmpty:r.intent==='stuck'}))return ['Заполни запись или нажми «Непонятно».']}catch{return ['Некорректная запись ответа.']}
 return []
}
export function reviewResponseErrors(r){
 if(!keys(r,['outcome','message','next','complete'])||!['correct','partial','retry','stuck','clarify'].includes(r.outcome)||!text(r.message,240)
  ||(r.complete!==undefined&&r.complete!==true)||(r.complete===true? r.next!==undefined||r.outcome!=='correct' : !r.next))return ['Нужен адресный отклик и один следующий шаг либо явное завершение шага.']
 if(r.next){const f=r.next
  if(!keys(f,['title','confirmed','focus','bridge','question','presentation'])||!text(f.title,80)||!text(f.question,160)||['confirmed','focus','bridge'].some(k=>f[k]!==undefined&&typeof f[k]!=='string')||!reviewActivityValid(f.presentation?.activity)
   ||reviewOverviewErrors(f).length||reviewSupplementErrors(f.presentation).length)return ['Следующий шаг требует краткого вопроса и безопасной модели.']
 }
 return []
}
/** Resolve against authorized public documents; a learner cannot invent a stage. */
export function resolveReviewReplyStep(reply,review,guidance){
 if(reviewReplyErrors(reply).length||!['partial','needs-fix','cannot-assess'].includes(review?.status)
  ||!sameReviewValue(reply.checkedAt,review.checkedAt)||!sameReviewValue(reply.correctedAt,review.correctedAt))throw new Error('review_reply_stale')
 const f=reply.sourceId==='review'?review.studentFeedback:guidance?.reviewResponse?.next
 if(reply.sourceId!=='review'&&(!guidance||guidance.taskId!==review.taskId||guidance.id!==reply.sourceId||!sameReviewValue(guidance.reviewContext,{checkedAt:reply.checkedAt,correctedAt:reply.correctedAt})))throw new Error('review_reply_stale')
 const step={question:f?.question,activity:f?.presentation?.activity}
 if(!sameReviewValue(reply.step,step))throw new Error('review_reply_stale')
 return step
}
