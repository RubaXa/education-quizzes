import type { DayGuidance } from '@/lib/dayGuidance'
import './TaskGuidance.css'

/** Only parent-selected, published help is visible to the learner.
 * @see ../../docs/product/subject-aware-guidance.md#data-contract
 * @see ../../docs/product/design-system.md#cards-and-status */
export default function TaskGuidance({ items }: { items: DayGuidance[] }) {
  if (!items.length) return null
  return <section className="day-task-guidance" aria-label="Помощь от родителя"><strong>От родителя</strong>{items.map((item) => <div key={item.id}><small>{item.level === 'hint' ? 'Подсказка' : 'Показанный шаг'}</small><p>{item.text}</p></div>)}</section>
}
