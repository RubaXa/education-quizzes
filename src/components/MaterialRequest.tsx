import type { MaterialRequest as Request, SourceAnalysis } from '@/lib/materialRequest'
import { formatReviewObservation, formatReviewProse } from '@/lib/reviewProse'
import './MaterialRequest.css'

/** Existing submission-instructions surface; the normal photo control stays in DayPage.
 * @see ../../docs/modules/materials/material-clarification.md */
export default function MaterialRequest({ request, label, detail, analysis, parent=false, phase='waiting' }: {
  request: Request; label: string; detail: string; analysis?: SourceAnalysis;parent?:boolean;phase?:string
}) {
  const p=request.presentation,waiting=phase==='waiting'&&request.state==='open'
  return <section className="day-submission-instructions material-request" aria-label="Уточнение материала" data-presentation-contract="source-request">
    {request.state==='open'&&p?<>
      <strong>{waiting?'Чего не хватает':'Материал уточняется'}</strong>
      <ul className="material-request-missing">{p.missing.map(item=><li key={item}>{formatReviewProse(item)}</li>)}</ul>
      <dl className="material-request-facts"><div><dt>Уже есть</dt><dd><ul>{p.available.map(item=><li key={item}>{formatReviewProse(item)}</li>)}</ul></dd></div><div><dt>Почему этого недостаточно</dt><dd>{formatReviewProse(p.reason)}</dd></div></dl>
      {waiting&&<p className="material-request-action"><b>{parent?'Что нужно получить':'Следующий шаг'}</b><span>{formatReviewProse(p.action)}</span></p>}
      {p.continuation&&<a className="material-request-continuation" href={`#/day/${p.continuation.dayToken}`} onClick={()=>{sessionStorage.setItem('education-day-initial-tab','homework');sessionStorage.setItem('education-day-focus-task',JSON.stringify({dayToken:p.continuation!.dayToken,taskId:p.continuation!.taskId}))}}>{p.continuation.label} →</a>}
      <details className="material-request-search"><summary>Где проверено</summary><ul>{p.checkedSources.map(item=><li key={item}>{formatReviewProse(item)}</li>)}</ul><small>Проверено {new Date(p.checkedAt).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</small></details>
    </>:request.state === 'open' && waiting?<><strong>Уточним задание</strong><p>{formatReviewProse(request.question)}</p>
    <p className="day-submission-photo"><b>На фото</b><span>{formatReviewProse(request.photoPrompt)}</span></p></>:null}
    {(!waiting||!p)&&<p role="status"><b>{label}</b>{detail !== request.question && <span> · {formatReviewProse(detail)}</span>}</p>}
    {analysis?.requestId === request.id && <><p><b>Что видно:</b> {formatReviewObservation(analysis.observed)}</p><p><b>О записях:</b> {formatReviewProse(analysis.quality)}</p><p>{formatReviewProse(analysis.limitation)}</p></>}
  </section>
}
