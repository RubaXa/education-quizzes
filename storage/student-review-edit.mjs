/** Addressed correction of presentation, never a new review or learner attempt.
 * @see ../docs/shared/design/student-review-step.md */
import {createHash} from 'node:crypto'
import {reviewOverviewErrors,reviewSupplementErrors} from '../packages/education-presentation/review-content.mjs'
import {studentReviewProjection} from './review-projection.mjs'
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v
export const studentReviewDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const only=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))
export function editStudentReview({privateReview,publicReview,edit,at}){
 if(!only(edit,['pageId','taskId','expectedPrivateDigest','expectedPublicDigest','feedback','reason','semanticChecked','noAnswerChecked'])
  ||edit.semanticChecked!==true||edit.noAnswerChecked!==true||typeof edit.reason!=='string'||edit.reason.trim().length<12)throw Error('student-view-semantic-review-required')
 if(!privateReview?.status||privateReview.taskId!==edit.taskId||publicReview?.taskId!==edit.taskId||privateReview.status!==publicReview.status
  ||studentReviewDigest(privateReview)!==edit.expectedPrivateDigest||studentReviewDigest(publicReview)!==edit.expectedPublicDigest)throw Error('student-view-stale-review')
 const f=edit.feedback
 if(!only(f,['title','confirmed','focus','bridge','question','anchor','presentation'])
  ||!['title','confirmed','focus','question'].every(k=>typeof f[k]==='string')||!f.title.trim()||!f.confirmed.trim()
  ||reviewOverviewErrors(f).length||reviewSupplementErrors(f.presentation).length)throw Error('student-view-invalid-feedback')
 if(['partial','needs-fix'].includes(privateReview.status)&&(!f.focus.trim()||!f.question.trim()||!f.presentation?.activity))throw Error('student-view-current-model-required')
 if(f.anchor&&(!only(f.anchor,['uploadId','location'])||!privateReview.uploadIds?.includes(f.anchor.uploadId)||typeof f.anchor.location!=='string'||!f.anchor.location.trim()))throw Error('student-view-anchor-mismatch')
 const publicText=JSON.stringify(f)
 if(/(?:объ[её]м (?:полученной )?помощи неизвестен|домашняя необязательная практика|конвейер (?:разбора|проверки)|semanticChecked|responseCriterion)/iu.test(publicText))throw Error('student-view-operator-copy')
 const revision=(privateReview.studentViewRevision??0)+1
 const next={...privateReview,studentFeedback:structuredClone(f),correctedAt:at,studentViewRevision:revision}
 // Keep the tutor's evidence/criterion/branches, synchronizing only its public wording.
 if(privateReview.tutoringPlan)next.tutoringPlan={...privateReview.tutoringPlan,acceptedConnection:f.confirmed,gapExplanation:f.focus,bridge:f.bridge||f.focus}
 return{privateReview:next,publicReview:studentReviewProjection(next),archive:{reason:edit.reason,at,revision,previousFeedback:privateReview.studentFeedback??null,previousTutoringPlan:privateReview.tutoringPlan??null,previousPublic:publicReview}}
}
