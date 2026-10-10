import { useState } from 'react'
import { BookOpen, Lightbulb } from 'lucide-react'
import type { DayHelp, DayMaterialLink, DayProblem, DayWorkReview } from '@/lib/dayStore'
import SourceFragment from './SourceFragment'
import './ProblemStatement.css'

/** @see ../../docs/product/adaptive-problem-card.md#слои */
export default function ProblemStatement({ problem, links, parent, help, review, onRequestHelp, helpAccess = 'ready' }: {
  problem: DayProblem; links: DayMaterialLink[]; parent: boolean; help?: DayHelp; review?: DayWorkReview;
  onRequestHelp?: (taskId: string, revision: number) => Promise<void>; helpAccess?: 'checking' | 'ready' | 'login-required';
}) {
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const original = problem.original
  const attachment = links.find((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === original?.attachmentRef)
    ?? (!original ? links.find((link) => link.sourceType === 'teacher-attachment') : undefined)
  const hasFragment = Boolean(attachment && original?.crop && original.crop.sourceSha256 === attachment.sourceSha256)
  const support = problem.support
  const opened = Boolean(support && help && help.revision >= support.revision)
  const finished = review?.status === 'verified'
  const hasReviewGuidance = Boolean(review?.status && review.status !== 'verified' && review.nextStep)

  async function requestHelp() {
    if (!support || !onRequestHelp) return
    setRequesting(true)
    setError('')
    try { await onRequestHelp(problem.id, support.revision) }
    catch (cause) { setError((cause as Error & { code?: string })?.code === 'permission-denied'
      ? 'Открой личную ссылку ученика Education, чтобы получить ориентир.'
      : cause instanceof Error ? cause.message : 'Не удалось открыть ориентир.') }
    finally { setRequesting(false) }
  }

  return <div className="problem-statement">
    <div className="problem-statement-original">
      <div className="problem-statement-label"><BookOpen size={16} aria-hidden="true" /><strong>Условие № {problem.number}</strong><span>Оригинал учителя</span></div>
      {hasFragment && attachment && original?.crop && <SourceFragment link={attachment} crop={original.crop} number={problem.number} />}
      {attachment && !hasFragment && <p className="problem-statement-missing">Точный фрагмент ещё не подготовлен. Полный лист учителя показан над списком заданий.</p>}
      {original?.text ? hasFragment ? <details className="problem-statement-transcript"><summary>Условие текстом</summary><div className="problem-statement-text"><b>№ {problem.number}.</b> {original.text}</div></details>
        : <div className="problem-statement-text"><b>№ {problem.number}.</b> {original.text}</div>
        : <p className="problem-statement-missing">Точная текстовая запись этого номера ещё не подготовлена. Полное условие и рисунок — в исходном листе выше.</p>}
      <small className="problem-statement-source">{problem.source}</small>
    </div>
    {support && <div className="problem-statement-education">
      <div className="problem-statement-label"><Lightbulb size={16} aria-hidden="true" /><strong>Как читать условие</strong></div>
      {(parent || opened) && <>
        {!!support.facts.length && <div className="problem-statement-facts" aria-label="Дано">{support.facts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div>}
        {support.find && <div className="problem-statement-find"><small>Найти</small><strong>{support.find}</strong></div>}
      </>}
      {parent ? <>
        <p className="problem-statement-rationale">{support.skill} · {support.evidence}</p>
        {opened && <small className="problem-statement-help-used">Ребёнок открыл первый ориентир.</small>}
      </> : finished ? <p className="problem-statement-rationale">Работа проверена. Подсказка к этому номеру больше не нужна.</p>
        : hasReviewGuidance ? <p className="problem-statement-rationale">Следующий шаг по этой попытке показан в результате проверки.</p>
          : opened ? <p className="problem-statement-question">{support.firstQuestion}</p>
            : helpAccess === 'checking' ? <p className="problem-statement-rationale">Проверяем личный вход…</p>
              : helpAccess === 'login-required' ? <p className="problem-statement-rationale">Чтобы открыть ориентир, зайди по личной ссылке ученика Education.</p>
                : <button type="button" className="problem-statement-help-button" onClick={() => void requestHelp()} disabled={requesting || !onRequestHelp}>{requesting ? 'Открываем…' : 'Открыть разбор условия'}</button>}
      {error && <p className="problem-statement-error" role="alert">{error}</p>}
    </div>}
  </div>
}
