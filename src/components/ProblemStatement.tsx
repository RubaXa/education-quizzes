import { useState } from 'react'
import { BookOpen, Lightbulb } from 'lucide-react'
import type { DayHelp, DayMaterialLink, DayProblem, DayWorkReview } from '@/lib/dayStore'
import MaterialReader from './MaterialReader'
import './ProblemStatement.css'

/** @see ../../docs/product/adaptive-problem-card.md#слои */
export default function ProblemStatement({ problem, links, parent, help, review, onRequestHelp }: {
  problem: DayProblem; links: DayMaterialLink[]; parent: boolean; help?: DayHelp; review?: DayWorkReview;
  onRequestHelp?: (taskId: string, revision: number) => Promise<void>;
}) {
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const original = problem.original
  const attachment = links.find((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === original?.attachmentRef)
    ?? (!original ? links.find((link) => link.sourceType === 'teacher-attachment') : undefined)
  const support = problem.support
  const opened = Boolean(support && help && help.revision >= support.revision)
  const finished = review?.status === 'verified'
  const hasReviewGuidance = Boolean(review?.status && review.status !== 'verified' && review.nextStep)

  async function requestHelp() {
    if (!support || !onRequestHelp) return
    setRequesting(true)
    setError('')
    try { await onRequestHelp(problem.id, support.revision) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть ориентир.') }
    finally { setRequesting(false) }
  }

  return <div className="problem-statement">
    <div className="problem-statement-original">
      <div className="problem-statement-label"><BookOpen size={16} aria-hidden="true" /><strong>Оригинальное задание</strong><span>Лист учителя</span></div>
      {attachment && <MaterialReader links={[attachment]} parent={parent} statement />}
      {original?.text ? <div className="problem-statement-text"><b>№ {problem.number}.</b> {original.text}</div>
        : <p className="problem-statement-missing">Точная текстовая запись этого номера ещё не подготовлена. Полное условие и рисунок — в исходном листе выше.</p>}
      <small className="problem-statement-source">{problem.source}</small>
    </div>
    {support && <div className="problem-statement-education">
      <div className="problem-statement-label"><Lightbulb size={16} aria-hidden="true" /><strong>{parent ? 'Как читать условие' : 'Помощь Education'}</strong></div>
      {parent ? <>
        {!!support.facts.length && <div className="problem-statement-facts" aria-label="Дано">{support.facts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div>}
        {support.find && <div className="problem-statement-find"><small>Найти</small><strong>{support.find}</strong></div>}
        <p className="problem-statement-rationale">{support.skill} · {support.evidence}</p>
        {opened && <small className="problem-statement-help-used">Ребёнок открыл первый ориентир.</small>}
      </> : finished ? <p className="problem-statement-rationale">Работа проверена. Подсказка к этому номеру больше не нужна.</p>
        : hasReviewGuidance ? <p className="problem-statement-rationale">Следующий шаг по этой попытке показан в результате проверки.</p>
          : opened ? <p className="problem-statement-question">{support.firstQuestion}</p>
            : <button type="button" className="problem-statement-help-button" onClick={() => void requestHelp()} disabled={requesting || !onRequestHelp}>{requesting ? 'Открываем…' : 'Нужен ориентир'}</button>}
      {error && <p className="problem-statement-error" role="alert">{error}</p>}
    </div>}
  </div>
}
