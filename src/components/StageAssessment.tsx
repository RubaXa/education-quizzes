/** @see ../../docs/decisions/stage-assessment-evidence-2026-11-18.md */
/** @see ../../docs/modules/school-diary/day-page.md#stage-assessments */
import type {StageAssessmentResult} from '@/lib/stageAssessment'
import StatusIcon from './StatusIcon'
/** Safe shared evidence row; uses the existing route typography and quiz action. */
export default function StageAssessment({result,parent,linksEnabled=true}:{result:StageAssessmentResult;parent:boolean;linksEnabled?:boolean}){
 const href=result.slug ? parent&&!result.submitted ? result.previewToken?`#/preview/${result.slug}~${result.previewToken}`:undefined : `#/t/${result.slug}~${result.token}` : undefined
 return <div className="day-learning-route-observed" data-stage-assessment={result.stageId}>
  <b><StatusIcon status={result.state==='passed'?'complete':result.state==='needs-fix'?'partial':'waiting'} size={16}/> {result.title}</b>
  <p role="status">{result.detail}</p><small>{result.scope}</small>
  {href&&linksEnabled&&<p><a className="day-quiz-link" href={href}>{parent&&!result.submitted?'Посмотреть вопросы':result.submitted?'Результат теста':result.state==='active'?'Продолжить тест':'Пройти тест'}</a></p>}
 </div>
}
