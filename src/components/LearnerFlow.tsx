/** @see ../../docs/decisions/scoped-learner-flow-2026-10-21.md */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LearnerFlowData } from '@/lib/dayStore'
import './LearnerFlow.css'
/** Public process prompts, no private solutions. Navigation never grades work.
 * @see ../../docs/modules/reviews/subject-aware-guidance.md#learner-flow */
export default function LearnerFlow({ flow }: { flow: LearnerFlowData }) {
  const [index, setIndex] = useState(0)
  const stage = flow.stages[index]
  if (!stage) return null
  return <section className="day-learner-flow" aria-label="Помощь с заданием">
    <h4>Разберёмся по шагам</h4>
    <p><strong>{flow.scope}</strong> · {flow.goal}</p>
    <p className="day-learner-flow-boundary">{flow.boundary}</p>
    <div key={`${flow.version}:${stage.id}`} className="day-learner-flow-stage" aria-live="polite">
      <small>Шаг {index + 1} из {flow.stages.length}</small><h5>{stage.title}</h5><p>{stage.prompt}</p>
      <details><summary>Нужна подсказка</summary><p>{stage.hint}</p>
        <details><summary>Покажи опору</summary><p>{stage.frame}</p></details>
      </details><small>{stage.sourceLabel}</small>
    </div>
    <nav aria-label="Шаги помощи"><Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>Назад</Button>
      {index < flow.stages.length - 1 ? <Button onClick={() => setIndex(index + 1)}>Следующий шаг</Button>
        : <span>Теперь сверяй свой диалог. Просмотр шагов не означает, что работа проверена.</span>}
    </nav>
  </section>
}
