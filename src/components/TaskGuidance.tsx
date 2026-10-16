import type { DayGuidance } from '@/lib/dayGuidance'
import { BookOpen, ChevronDown } from 'lucide-react'
import './ParentTaskGuide.css'
import './TaskGuidance.css'

/** Only parent-selected, published help is visible to the learner.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#data-contract
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#role-projection */
export default function TaskGuidance({ items }: { items: DayGuidance[] }) {
  if (!items.length) return null
  const ordered = [...items].sort((a, b) => a.stageIndex - b.stageIndex)
  return <details className="day-task-guidance day-parent-guide day-parent-learning-route" aria-label="Разбор от родителя">
    <summary className="day-learning-route-heading"><BookOpen size={18} aria-hidden="true" /><span><strong>Разбор</strong></span><ChevronDown className="day-learning-route-chevron" size={17} aria-hidden="true" /></summary>
    <div className="day-parent-learning-route-body"><div className="day-learning-route-stages">
      {ordered.map((item) => <details className="day-learning-route-stage" key={item.id}>
        <summary><span className="day-learning-route-number">{item.stageIndex + 1}</span><span className="day-learning-route-stage-title"><b>Шаг {item.stageIndex + 1}</b><small>{item.level === 'hint' ? 'Подсказка' : 'Показанный шаг'}</small></span></summary>
        <div className="day-learning-route-body"><p>{item.text}</p></div>
      </details>)}
    </div></div>
  </details>
}
