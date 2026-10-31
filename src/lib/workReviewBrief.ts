/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
/** @see ../../docs/shared/design/compact-review.md#data */
import type { DayWorkReview } from './dayStore'
import type { ReviewBriefData } from '@/components/ReviewBrief'
import { projectReviewSupplement } from '../../packages/education-presentation/review-content.mjs'
import { formatReviewObservation,formatReviewProse } from './reviewProse'

export function workReviewBrief(review:DayWorkReview,{complete=false,label,stateLabel}:{complete?:boolean;label?:string;stateLabel?:string}={}):ReviewBriefData {
 const f=review.studentFeedback,supplement=projectReviewSupplement(f?.presentation)
 const verified=complete||review.status==='verified'
 const steps=f?.steps?.map((step,index)=>({label:formatReviewProse(step.location||`Запись ${index+1}`),quotation:formatReviewObservation(step.observation),text:formatReviewProse(step.explanation)}))
 return {
  id:review.id,label:label??formatReviewProse(f?.title??'Разбор работы'),status:verified?'verified':review.status==='cannot-assess'?'uncertain':review.status==='needs-fix'?'incorrect':'revise',
  stateLabel,
  confirmed:f?.confirmed?formatReviewProse(f.confirmed):verified?formatReviewProse(review.summary??'Работа подтверждена.'):undefined,
  focus:!verified?formatReviewProse(f?.focus??(review.status==='partial'||review.status==='needs-fix'?'Работа проверена. Адресный вопрос к этой попытке ещё уточняется.':review.summary??'')):undefined,
  bridge:!verified&&f?.bridge?formatReviewProse(f.bridge):undefined,
  question:!verified&&f?.question?formatReviewProse(f.question):undefined,
  visual:supplement?.visual,
  details:supplement?.details??steps,
 }
}
