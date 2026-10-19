import { formatReviewProse } from '@/lib/reviewProse'
/** @see ../../docs/decisions/released-stage-parity-2026-10-20.md */
import type { DayGuidanceRevealContent, ParentTaskGuide } from '@/lib/dayStore'

type StageContent = Pick<ParentTaskGuide['stages'][number], 'title' | 'expected' | 'rows' | 'why' | 'role' | 'answer' | 'verification'>
  & { sourceLabel: string }

/** Shared selected-stage disclosure used by the parent preview and learner release.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#data-contract */
export default function GuidanceStageContent({ content, showTitle = false }: { content: StageContent | DayGuidanceRevealContent; showTitle?: boolean }) {
  const answer = content.role === 'answer' ? content.answer ?? '' : ''
  return <div className="day-guidance-release-content">
    {showTitle && <strong>{formatReviewProse(content.title)}</strong>}
    <p>{formatReviewProse(content.expected)}</p>
    {content.rows?.length ? <div className={`day-learning-route-rows day-learning-route-rows-${content.role}`}>{content.rows.map((row, index) => <div key={index}>
      <div>{row.label && <small>{formatReviewProse(row.label)}</small>}<strong>{formatReviewProse(row.value)}</strong></div>
      {row.explanation && <p>{formatReviewProse(row.explanation)}</p>}
    </div>)}</div> : null}
    {answer && <div className="day-learning-route-answer"><small>Ответ</small><strong>{formatReviewProse(answer)}</strong></div>}
    {content.role === 'answer' && Boolean(content.verification?.length) && <details className="day-learning-route-check"><summary>Проверка по условию</summary>{content.verification?.map((row, index) => <p key={index}>{row.label && <b>{formatReviewProse(row.label)}: </b>}{formatReviewProse(row.value)}</p>)}</details>}
    {content.why && <p className="day-learning-route-why">Почему: {formatReviewProse(content.why)}</p>}
    {'sourceLabel' in content && <small className="day-learning-route-source">Источник: {content.sourceLabel}</small>}
  </div>
}
