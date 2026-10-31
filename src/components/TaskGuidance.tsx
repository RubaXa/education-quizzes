/** @see ../../docs/decisions/compact-review-rollout-2026-10-31.md */
import { compareDayGuidanceChronology, type DayGuidance } from '@/lib/dayGuidance'
import { formatReviewProse } from '@/lib/reviewProse'
import { BookOpen, ChevronDown } from 'lucide-react'
/** @see ../../docs/decisions/released-stage-parity-2026-10-20.md */
/** @see ../../docs/shared/design/ui-kit.md#помощь-по-этапам */
import GuidanceStageContent from './GuidanceStageContent'
import './ParentTaskGuide.css'
import './TaskGuidance.css'
import './ReviewTypography.css'

/** Only parent-selected, published help is visible to the learner.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#data-contract
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#role-projection */
export default function TaskGuidance({ items }: { items: DayGuidance[] }) {
  if (!items.length) return null
  const byStage = new Map<string, DayGuidance[]>()
  for (const item of items) {
    const key = `${item.taskId}:${item.stageId}`
    byStage.set(key, [...(byStage.get(key) ?? []), item])
  }
  const ordered = [...byStage.values()].map((events) => {
    const chronological = [...events].sort(compareDayGuidanceChronology)
    return { summary: chronological.at(-1)!, previous: chronological.slice(0, -1) }
  }).sort((a, b) => a.summary.stageIndex - b.summary.stageIndex)
  return <details className="day-task-guidance day-parent-guide day-parent-learning-route" aria-label="Разбор от родителя">
    <summary className="day-learning-route-heading"><BookOpen size={18} aria-hidden="true" /><span><strong>Разбор</strong></span><ChevronDown className="day-learning-route-chevron" size={17} aria-hidden="true" /></summary>
    <div className="day-parent-learning-route-body"><div className="day-learning-route-stages">
      {ordered.map(({ summary, previous }) => <details className="day-learning-route-stage" key={`${summary.taskId}:${summary.stageId}`}>
        <summary><span className="day-learning-route-number">{summary.stageIndex + 1}</span><span className="day-learning-route-stage-title"><b>{summary.level === 'reveal' && summary.revealContent?.title ? formatReviewProse(summary.revealContent.title) : `Шаг ${summary.stageIndex + 1}`}</b><small>{summary.level === 'hint' ? 'Подсказка' : 'Показанный шаг'}</small></span></summary>
        <div className="day-learning-route-body">{summary.level === 'reveal' && summary.revealContent && <GuidanceStageContent content={summary.revealContent} />}<p>{formatReviewProse(summary.text)}</p>
          {previous.length > 0 && <details className="day-guidance-previous"><summary>Предыдущая помощь · {previous.length}</summary>{previous.map((item) => <div className="day-guidance-release-event" key={item.id}><small>{item.level === 'hint' ? 'Подсказка' : 'Показанный шаг'}</small>{item.level === 'reveal' && item.revealContent && <GuidanceStageContent content={item.revealContent} />}<p>{formatReviewProse(item.text)}</p></div>)}</details>}
        </div>
      </details>)}
    </div></div>
  </details>
}
