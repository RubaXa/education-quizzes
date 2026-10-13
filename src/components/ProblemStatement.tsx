import { useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, CheckCircle2, CircleHelp, Lightbulb, TriangleAlert } from 'lucide-react'
import type { DayHelp, DayMaterialLink, DayProblem, DaySourceResearch, DayWorkReview } from '@/lib/dayStore'
import { reportUiError } from '@/lib/uiErrors'
import SourceFragment from './SourceFragment'
import TaskGuidance from './TaskGuidance'
import type { DayGuidance } from '@/lib/dayGuidance'
import './ProblemStatement.css'

const helpKinds: { value: NonNullable<DayHelp['requestKind']>; label: string }[] = [
  { value: 'condition', label: 'Не понял условие' },
  { value: 'start', label: 'Не знаю, с чего начать' },
  { value: 'step', label: 'Застрял на шаге' },
  { value: 'check', label: 'Хочу проверить ход' },
]

/** @see ../../docs/product/adaptive-problem-card.md#показ-ученику */
export default function ProblemStatement({ problem, links, parent, help, review, guidance = [], sourceResearch, hideParentSupport = false, finished: parentFinished = false, onRequestHelp, helpAccess = 'ready' }: {
  problem: DayProblem; links: DayMaterialLink[]; parent: boolean; help?: DayHelp; review?: DayWorkReview; guidance?: DayGuidance[]; sourceResearch?: DaySourceResearch; hideParentSupport?: boolean;
  finished?: boolean;
  onRequestHelp?: (taskId: string, revision: number, kind: NonNullable<DayHelp['requestKind']>, text: string) => Promise<void>;
  helpAccess?: 'checking' | 'ready' | 'login-required';
}) {
  const [requesting, setRequesting] = useState(false)
  const [kind, setKind] = useState<NonNullable<DayHelp['requestKind']>>('start')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const original = problem.original
  const attachment = links.find((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === original?.attachmentRef)
    ?? (!original ? links.find((link) => link.sourceType === 'teacher-attachment') : undefined)
  const hasFragment = Boolean(attachment && original?.crop && original.crop.sourceSha256 === attachment.sourceSha256)
  const support = problem.support
  const opened = Boolean(support && help && help.revision >= support.revision)
  const finished = review?.status === 'verified' || parentFinished

  async function requestHelp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!support || !onRequestHelp) return
    setRequesting(true)
    setError('')
    try { await onRequestHelp(problem.id, support.revision, kind, note) }
    catch (cause) { reportUiError(cause, 'Помощь по задаче'); setError((cause as Error & { code?: string })?.code === 'permission-denied'
      ? 'Открой личную ссылку ученика Education, чтобы отправить запрос.'
      : cause instanceof Error ? cause.message : 'Не удалось отправить запрос.') }
    finally { setRequesting(false) }
  }

  return <div className="problem-statement">
    <div className="problem-statement-original">
      <div className="problem-statement-label"><BookOpen size={16} aria-hidden="true" /><strong>Условие № {problem.number}</strong><span>Оригинал учителя</span></div>
      {hasFragment && attachment && original?.crop && <SourceFragment link={attachment} crop={original.crop} number={problem.number} />}
      {attachment && !hasFragment && <p className="problem-statement-missing">Точный фрагмент ещё не подготовлен. Полный лист учителя показан над списком заданий.</p>}
      {original?.text ? <div className="problem-statement-transcript"><div className="problem-statement-transcript-title">Условие текстом <small>Сверь с оригиналом</small></div><div className="problem-statement-text"><b>№ {problem.number}.</b> {original.text}</div></div>
        : <p className="problem-statement-missing">Точная текстовая запись этого номера ещё не подготовлена. Полное условие и рисунок — в исходном листе выше.</p>}
      <small className="problem-statement-source">{problem.source}</small>
    </div>
    {!parent && <TaskGuidance items={guidance} />}
    {support && !(parent && hideParentSupport) && <div className="problem-statement-education">
      <div className="problem-statement-label"><Lightbulb size={16} aria-hidden="true" /><strong>Как читать условие</strong></div>
      {!!support.facts.length && <div className="problem-statement-facts" aria-label="Дано">{support.facts.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}</div>}
      {support.find && <div className="problem-statement-find"><small>Найти</small><strong>{support.find}</strong></div>}
      {parent || finished || !onRequestHelp ? null
          : opened ? <div className="problem-statement-help-result"><strong>Первый ориентир</strong><p>{support.firstQuestion}</p><small>Этот вопрос подготовлен к задаче заранее. Твой запрос сохранён для следующего разбора.</small></div>
            : helpAccess === 'checking' ? <p className="problem-statement-rationale">Проверяем личный вход…</p>
              : helpAccess === 'login-required' ? <p className="problem-statement-rationale">Чтобы попросить ориентир, зайди по личной ссылке ученика Education.</p>
                : <details className="problem-statement-help"><summary>Нужен ориентир?</summary><form onSubmit={(event) => void requestHelp(event)}><fieldset><legend>На чём ты остановился?</legend>{helpKinds.map((option) => <label key={option.value}><input type="radio" name={`help-${problem.id}`} value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} />{option.label}</label>)}</fieldset><label className="problem-statement-help-note">Что уже пробовал? Можно написать «Пока не знаю».<textarea value={note} maxLength={800} onChange={(event) => setNote(event.target.value)} placeholder="Моя мысль или вопрос" /></label><button type="submit" className="problem-statement-help-button" disabled={requesting || !onRequestHelp}>{requesting ? 'Отправляем…' : 'Отправить'}</button></form></details>}
      {error && <p className="problem-statement-error" role="alert">{error}</p>}
    </div>}
    {parent && <details className="problem-statement-parent-source">
      <summary>{sourceResearch?.status === 'verified' ? <CheckCircle2 size={16} aria-hidden="true" /> : sourceResearch?.status === 'conflict' ? <TriangleAlert size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
        <span>{sourceResearch?.status === 'verified' ? 'Источник подтверждён' : sourceResearch?.status === 'candidate' ? 'Возможный источник' : sourceResearch?.status === 'conflict' ? 'Источники расходятся' : 'Происхождение не установлено'}</span>
      </summary>
      {sourceResearch ? <div><p>{sourceResearch.title}</p><p>{sourceResearch.match}</p>{sourceResearch.url && <a href={sourceResearch.url} target="_blank" rel="noopener noreferrer">Открыть источник ↗</a>}<small>Ключ: {sourceResearch.keyStatus === 'verified' ? 'сверен' : sourceResearch.keyStatus === 'candidate' ? 'кандидат требует сверки' : sourceResearch.keyStatus === 'unavailable' ? 'не найден' : 'не проверен'}. {sourceResearch.note}</small></div>
        : <div><p>Есть исходный лист учителя. Более ранний источник пока не подтверждён.</p></div>}
    </details>}
  </div>
}
