/** @see ../../docs/decisions/review-readability-repair-2026-10-31.md */
/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** @see ../../docs/shared/design/compact-review.md#data */
import type { DayWorkReview } from './dayStore'
import type { ReviewBriefData } from '@/components/ReviewBrief'
import { projectReviewSupplement,reviewOverviewLimits } from '../../packages/education-presentation/review-content.mjs'
import { formatReviewObservation,formatReviewProse } from './reviewProse'

export function workReviewBrief(review:DayWorkReview,{complete=false,label,stateLabel}:{complete?:boolean;label?:string;stateLabel?:string}={}):ReviewBriefData {
 const f=review.studentFeedback,supplement=projectReviewSupplement(f?.presentation)
 const verified=complete||review.status==='verified'
 const steps=f?.steps?.map(step=>[formatReviewProse(step.location),formatReviewObservation(step.observation),formatReviewProse(step.explanation)].filter(Boolean).join('\n'))
 // Older documents predate the authoring budget. Preserve their exact prose in a
 // disclosure; do not truncate, summarise, infer a new hint or reduce the type size.
 let focus=f?.focus?formatReviewProse(f.focus):undefined
 let bridge=f?.bridge?formatReviewProse(f.bridge):undefined
 const deferred:string[]=[]
 if(focus&&focus.trim().length>reviewOverviewLimits.focus){deferred.push(focus.trim());focus=undefined}
 if(bridge&&bridge.trim().length>reviewOverviewLimits.bridge){deferred.push(bridge.trim());bridge=undefined}
 const legacyText=[...deferred,...(steps??[])].join('\n\n')
 const details=supplement?.details
  ? [...(deferred.length?[{label:'Подробное пояснение',text:deferred.join('\n\n')}]:[]),...supplement.details]
  : legacyText?[{label:'Как проверяли запись',text:legacyText}]:[]
 return {
  id:`${review.id}:${JSON.stringify(review.checkedAt??null)}:${JSON.stringify(review.correctedAt??null)}`,label:label??formatReviewProse(f?.title??'Разбор работы'),status:verified?'verified':review.status==='cannot-assess'?'uncertain':review.status==='needs-fix'?'incorrect':'revise',
  stateLabel,
  confirmed:f?.confirmed?formatReviewProse(f.confirmed):verified?formatReviewProse(review.summary??'Работа подтверждена.'):undefined,
  focus:!verified?(typeof f?.focus==='string'?focus:formatReviewProse(review.status==='partial'||review.status==='needs-fix'?'Работа проверена. Адресный вопрос к этой попытке ещё уточняется.':review.summary??'')):undefined,
  bridge:!verified?bridge:undefined,
  question:!verified&&f?.question?formatReviewProse(f.question):undefined,
  visual:supplement?.visual,
  activity:supplement?.activity,
  details,
 }
}
