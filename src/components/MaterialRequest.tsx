import type { MaterialRequest as Request, SourceAnalysis } from '@/lib/materialRequest'
import { formatReviewObservation, formatReviewProse } from '@/lib/reviewProse'

/** Existing submission-instructions surface; the normal photo control stays in DayPage.
 * @see ../../docs/modules/materials/material-clarification.md */
export default function MaterialRequest({ request, label, detail, analysis }: {
  request: Request; label: string; detail: string; analysis?: SourceAnalysis
}) {
  return <section className="day-submission-instructions" aria-label="Уточнение материала">
    {request.state === 'open' && <><strong>Уточним задание</strong><p>{formatReviewProse(request.question)}</p>
    <p className="day-submission-photo"><b>На фото</b><span>{formatReviewProse(request.photoPrompt)}</span></p></>}
    <p role="status"><b>{label}</b>{detail !== request.question && <span> · {formatReviewProse(detail)}</span>}</p>
    {analysis?.requestId === request.id && <><p><b>Что видно:</b> {formatReviewObservation(analysis.observed)}</p><p><b>О записях:</b> {formatReviewProse(analysis.quality)}</p><p>{formatReviewProse(analysis.limitation)}</p></>}
  </section>
}
