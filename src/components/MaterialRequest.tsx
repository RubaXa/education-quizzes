import type { MaterialRequest as Request, SourceAnalysis } from '@/lib/materialRequest'

/** Existing submission-instructions surface; the normal photo control stays in DayPage.
 * @see ../../docs/modules/materials/material-clarification.md */
export default function MaterialRequest({ request, label, detail, analysis }: {
  request: Request; label: string; detail: string; analysis?: SourceAnalysis
}) {
  return <section className="day-submission-instructions" aria-label="Уточнение материала">
    {request.state === 'open' && <><strong>Уточним задание</strong><p>{request.question}</p>
    <p className="day-submission-photo"><b>На фото</b><span>{request.photoPrompt}</span></p></>}
    <p role="status"><b>{label}</b>{detail !== request.question && <span> · {detail}</span>}</p>
    {analysis?.requestId === request.id && <><p><b>Что видно:</b> {analysis.observed}</p><p><b>О записях:</b> {analysis.quality}</p><p>{analysis.limitation}</p></>}
  </section>
}
