/** @see ../../docs/decisions/stage-assessment-evidence-2026-11-18.md */
/** @see ../../docs/modules/school-diary/day-page.md#stage-assessments */
import type {DayTask,DayWorkReview,StageAssessmentLink} from './dayStore'
import type {QuizScore,QuizWorkState} from './homeworkStatus'
import {quizPassed} from './quizCompletion'
export type StageAssessmentResult = StageAssessmentLink & {state:'waiting'|'active'|'checking'|'passed'|'needs-fix'; detail:string; token:string; slug?:string; previewToken?:string; submitted:boolean}
/** A family switch changes obligation, never the factual result. No new reads. */
export function stageAssessmentResults(task:Pick<DayTask,'stageAssessments'>,tests:Record<string,QuizWorkState>,scores:Record<string,QuizScore>):StageAssessmentResult[]{
 return (task.stageAssessments??[]).map(link=>{
  let token=link.token
  const seen=new Set<string>()
  let ambiguous=false
  while(tests[token]?.testId&&!seen.has(tests[token].testId!)){
   seen.add(tests[token].testId!)
   const candidates=Object.entries(tests).filter(([,t])=>t.linkedToTestId===tests[token].testId&&t.testId&&!seen.has(t.testId))
   if(candidates.length!==1){ambiguous=candidates.length>1;break}
   token=candidates[0][0]
  }
  const test=tests[token],score=scores[token],submitted=test?.status==='submitted'
  const state=ambiguous||!test?'waiting':!submitted?test.answered?'active':'waiting':!score?'checking':test.followupRequested||test.followupRequestedAt?'waiting':quizPassed(score)?'passed':'needs-fix'
  const detail=state==='passed'?`Подтверждено тестом · ${score.points} из ${score.maxPoints}`:state==='checking'?'Тест отправлен · ждём проверки':state==='active'?`Тест начат · ответов: ${test.answered}`:state==='needs-fix'?`Нужна доработка · ${score.points} из ${score.maxPoints}`:'Ожидает теста'
  return {...link,token,slug:test?.slug,previewToken:test?.previewToken,submitted,state,detail}
 })
}
/** Derive the current stage result, retaining the stored photo review and choices.
 * Only the explicitly linked stage is substituted. No grade/attempt is written. */
export function stageAssessmentReview(review:DayWorkReview|undefined,results:StageAssessmentResult[]):DayWorkReview|undefined{
 if(!review||!results.length)return review
 return {...review,items:review.items?.map(item=>{
  const result=results.find(result=>result.stageId===item.stageId)
  return !result?item:{...item,status:result.state==='passed'?'correct' as const:result.state==='needs-fix'?'partial' as const:'cannot-assess' as const,observed:result.detail,note:result.scope}
 })}
}
